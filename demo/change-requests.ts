import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { RoomRepository } from '../src/room-model.ts';
import { prepareModelProposal, validateModelProposalRequest } from '../src/model-proposal.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

export type RequestState = 'queued' | 'working' | 'needs-input' | 'ready' | 'completed' | 'rejected' | 'cancelled' | 'failed';
type BoundRequest = ReturnType<typeof validateModelProposalRequest>;
type RequestInput = Pick<BoundRequest, 'requestId' | 'proposalName' | 'baseRevisionId' | 'instruction' | 'visualIntent'> & { selectedObjectIds: readonly string[] };
type StoredResult = { status: 'ready' | 'declined'; project: string; review: unknown };
interface Ticket {
  id: string;
  projectId: string;
  state: RequestState;
  request: RequestInput;
  project: string;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  error: string | null;
  result: StoredResult | null;
  decisionId: string | null;
  decisionAction: string | null;
  history: readonly string[];
}
export type TicketSummary = Omit<Ticket, 'project' | 'fingerprint' | 'result' | 'decisionId' | 'decisionAction' | 'history'>;
export class BacklogConflict extends Error {}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('Invalid request or project identity.');
  return value;
}
function parseStored(text: string): Ticket {
  const value: unknown = JSON.parse(text);
  if (!object(value) || typeof value.project !== 'string' || !object(value.request) || typeof value.id !== 'string'
      || typeof value.projectId !== 'string' || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number'
      || typeof value.attempts !== 'number' || typeof value.fingerprint !== 'string'
      || !Array.isArray(value.history) || !value.history.every((item) => typeof item === 'string')
      || (value.error !== null && typeof value.error !== 'string')
      || (value.decisionId !== null && typeof value.decisionId !== 'string') || (value.decisionAction !== null && typeof value.decisionAction !== 'string')
      || !['queued', 'working', 'needs-input', 'ready', 'completed', 'rejected', 'cancelled', 'failed'].includes(String(value.state))) {
    throw new Error('The stored change request is invalid.');
  }
  // The payload is parsed by the model request boundary again before every run.
  const r = value.request;
  if (typeof r.requestId !== 'string' || typeof r.proposalName !== 'string' || typeof r.baseRevisionId !== 'string'
      || typeof r.instruction !== 'string' || !Array.isArray(r.selectedObjectIds) || !r.selectedObjectIds.every((id) => typeof id === 'string')) {
    throw new Error('The stored request binding is invalid.');
  }
  const state = value.state;
  if (state !== 'queued' && state !== 'working' && state !== 'needs-input' && state !== 'ready' && state !== 'completed'
      && state !== 'rejected' && state !== 'cancelled' && state !== 'failed') throw new Error('Invalid request state.');
  const visual = r.visualIntent;
  // Restore validates the complete input before exposing it; JSON has no executable data.
  if (!object(visual) || !('kind' in visual)) throw new Error('Invalid stored visual context.');
  let result: StoredResult | null = null;
  if (value.result !== null) {
    if (!object(value.result) || (value.result.status !== 'ready' && value.result.status !== 'declined') || typeof value.result.project !== 'string') throw new Error('Invalid stored proposal result.');
    result = { status: value.result.status, project: value.result.project, review: value.result.review };
  }
  return { id: value.id, projectId: value.projectId, state, project: value.project, fingerprint: value.fingerprint,
    createdAt: value.createdAt, updatedAt: value.updatedAt, attempts: value.attempts, error: value.error,
    decisionId: value.decisionId, decisionAction: value.decisionAction, result, history: value.history,
    request: { requestId: r.requestId, proposalName: r.proposalName, baseRevisionId: r.baseRevisionId,
      selectedObjectIds: r.selectedObjectIds, instruction: r.instruction, visualIntent: storedVisual(visual) } };
}
function storedVisual(value: Record<string, unknown>): RequestInput['visualIntent'] {
  if (value.kind === 'selection') return { kind: 'selection' };
  if (value.kind === 'spatial-reference' && object(value.destination)) {
    const d = value.destination;
    if (d.kind === 'floor-point' && Array.isArray(d.positionMm) && d.positionMm.length === 2
        && typeof d.positionMm[0] === 'number' && typeof d.positionMm[1] === 'number') {
      return { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [d.positionMm[0], d.positionMm[1]] } };
    }
    if (d.kind === 'wall-point' && typeof d.wallId === 'string' && typeof d.alongWallMm === 'number') {
      return { kind: 'spatial-reference', destination: { kind: 'wall-point', wallId: d.wallId, alongWallMm: d.alongWallMm } };
    }
  }
  if (value.kind === 'rectangle-layout-sketch' && object(value.layout) && object(value.layout.boundsMm) && object(value.layout.door)) {
    const b = value.layout.boundsMm; const d = value.layout.door;
    if (typeof b.minX === 'number' && typeof b.minY === 'number' && typeof b.maxX === 'number' && typeof b.maxY === 'number'
        && typeof d.widthMm === 'number' && typeof d.offsetMm === 'number') return { kind: 'rectangle-layout-sketch', layout: {
      boundsMm: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }, door: { widthMm: d.widthMm, offsetMm: d.offsetMm } } };
  }
  throw new Error('Invalid stored visual context.');
}

export class ChangeRequests {
  readonly #db: DatabaseSync;
  readonly #worker: () => ModelWorker | null;
  #closed = false;
  #active = 0;
  readonly #timer: ReturnType<typeof setInterval>;
  constructor(file: string, worker: () => ModelWorker | null) {
    this.#db = new DatabaseSync(file);
    this.#worker = worker;
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.#db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS requests_project ON requests(project_id); CREATE INDEX IF NOT EXISTS requests_state ON requests(state);');
    this.#db.exec('CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES requests(id), fingerprint TEXT NOT NULL);');
    for (const ticket of this.#withState('working')) {
      this.#put({ ...ticket, state: ticket.attempts < 3 ? 'queued' : 'failed',
        error: 'The server restarted during processing. The accepted model is unchanged.', updatedAt: Date.now() });
    }
    this.#timer = setInterval(() => this.#pump(), 1000);
    this.#timer.unref();
    this.#pump();
  }
  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #all(projectId?: string): Ticket[] {
    const rows = projectId === undefined ? this.#db.prepare('SELECT body FROM requests ORDER BY rowid').all()
      : this.#db.prepare('SELECT body FROM requests WHERE project_id = ? ORDER BY rowid').all(projectId);
    return rows.map((row) => { if (typeof row.body !== 'string') throw new Error('Unreadable request store.'); return parseStored(row.body); });
  }
  #put(ticket: Ticket): void {
    this.#db.prepare('INSERT INTO requests(id, project_id, state, body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, body=excluded.body').run(ticket.id, ticket.projectId, ticket.state, JSON.stringify(ticket));
  }
  #withState(state: RequestState): Ticket[] {
    return this.#db.prepare('SELECT body FROM requests WHERE state=? ORDER BY rowid').all(state).map((row) => {
      if (typeof row.body !== 'string') throw new Error('Unreadable request store.');
      return parseStored(row.body);
    });
  }
  #submission(id: string, fingerprint: string): Ticket | null {
    const row = this.#db.prepare('SELECT ticket_id, fingerprint FROM submissions WHERE id=?').get(id);
    if (!row) return null;
    if (row.fingerprint !== fingerprint || typeof row.ticket_id !== 'string') throw new BacklogConflict('This request identity is already bound to different input.');
    return this.get(row.ticket_id);
  }
  get(id: string): Ticket {
    const row = this.#db.prepare('SELECT body FROM requests WHERE id=?').get(identifier(id));
    if (!row || typeof row.body !== 'string') throw new Error('Unknown change request.');
    return parseStored(row.body);
  }
  project(id: string): string | null {
    const row = this.#db.prepare('SELECT body FROM projects WHERE id=?').get(identifier(id));
    return row && typeof row.body === 'string' ? row.body : null;
  }
  list(projectId: string): TicketSummary[] {
    return this.#all(identifier(projectId)).map(({ project: _project, fingerprint: _fingerprint, result: _result, decisionId: _id, decisionAction: _action, history: _history, ...summary }) => summary);
  }
  async submit(project: unknown, input: unknown): Promise<TicketSummary> {
    const repository = await RoomRepository.restore(project);
    const bound = validateModelProposalRequest(repository, input);
    const request: RequestInput = { requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
      selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent };
    const body = repository.serialize();
    const fingerprint = createHash('sha256').update(JSON.stringify({ project: body, request })).digest('hex');
    const existing = this.#submission(request.requestId, fingerprint);
    if (existing) {
      const ticket = existing;
      const summary = this.list(ticket.projectId).find((item) => item.id === ticket.id);
      if (!summary) throw new Error('Missing request summary.');
      return summary;
    }
    const currentText = this.project(repository.projectId);
    const current = currentText ? await RoomRepository.restore(currentText) : repository;
    const replay = this.#submission(request.requestId, fingerprint);
    if (replay) {
      const summary = this.list(replay.projectId).find((item) => item.id === replay.id);
      if (!summary) throw new Error('Missing request summary.');
      return summary;
    }
    if (current.root() !== repository.root()) throw new BacklogConflict('This project identity belongs to a different model.');
    if (current.head('main') !== repository.head('main')) throw new BacklogConflict('The accepted server model changed. Refresh the backlog and open its current model before submitting.');
    if (this.#all(repository.projectId).some((ticket) => ticket.request.proposalName === request.proposalName)) throw new BacklogConflict('Another ticket already uses this proposal name.');
    const pending = this.#db.prepare("SELECT COUNT(*) AS count FROM requests WHERE state IN ('queued','working')").get();
    if (pending && typeof pending.count === 'number' && pending.count >= 64) throw new Error('The pending request backlog is full. Finish or cancel existing work first.');
    const ticket: Ticket = { id: request.requestId, projectId: repository.projectId, request, project: body, fingerprint,
      state: 'queued', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), error: null, result: null, decisionId: null, decisionAction: null, history: [] };
    this.#transaction(() => {
      if (this.#submission(request.requestId, fingerprint)) return;
      const latest = this.project(repository.projectId);
      if (latest !== currentText && latest !== body) throw new BacklogConflict('The accepted server model changed during submission. Refresh before submitting.');
      if (!latest) this.#db.prepare('INSERT INTO projects(id,body) VALUES(?,?)').run(repository.projectId, body);
      this.#put(ticket);
      this.#db.prepare('INSERT INTO submissions(id,ticket_id,fingerprint) VALUES(?,?,?)').run(request.requestId, ticket.id, fingerprint);
    });
    // Start after the acknowledgement can be sent; submission never awaits the worker.
    setImmediate(() => this.#pump());
    const summary = this.list(ticket.projectId).find((item) => item.id === ticket.id);
    if (!summary) throw new Error('Missing request summary.');
    return summary;
  }
  async revise(id: string, project: unknown, input: unknown): Promise<Ticket> {
    const ticket = this.get(id);
    const repository = await RoomRepository.restore(project);
    const bound = validateModelProposalRequest(repository, input);
    const request: RequestInput = { requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
      selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent };
    const body = repository.serialize();
    const fingerprint = createHash('sha256').update(JSON.stringify({ project: body, request })).digest('hex');
    const previous = this.#submission(request.requestId, fingerprint);
    if (previous) {
      if (previous.id !== ticket.id) throw new BacklogConflict('This request identity belongs to another ticket.');
      return previous;
    }
    if (!['ready', 'needs-input', 'failed'].includes(ticket.state)) throw new BacklogConflict('Only finished, unaccepted work can be revised.');
    if (ticket.history.length >= 8) throw new Error('This ticket has reached the eight-revision preview limit.');
    const currentText = this.project(ticket.projectId);
    if (!currentText) throw new Error('Missing project.');
    const current = await RoomRepository.restore(currentText);
    if (repository.projectId !== ticket.projectId || repository.root() !== current.root() || repository.head('main') !== current.head('main') || request.baseRevisionId !== current.head('main')) {
      throw new BacklogConflict('A revision must use the current accepted model in this project.');
    }
    if (this.#all(ticket.projectId).some((other) => other.id !== ticket.id && other.request.proposalName === request.proposalName)) throw new BacklogConflict('Another ticket uses that proposal name.');
    const archived = JSON.stringify({ ...ticket, history: [] });
    const next: Ticket = { ...ticket, project: body, request, fingerprint, history: [...ticket.history, archived],
      state: 'queued', attempts: 0, result: null, error: null, decisionId: null, decisionAction: null, updatedAt: Date.now() };
    this.#transaction(() => {
      if (this.#submission(request.requestId, fingerprint)) return;
      if (this.project(ticket.projectId) !== currentText || this.get(id).fingerprint !== ticket.fingerprint) throw new BacklogConflict('The request changed while revising. Refresh and try again.');
      this.#put(next);
      this.#db.prepare('INSERT INTO submissions(id,ticket_id,fingerprint) VALUES(?,?,?)').run(request.requestId, ticket.id, fingerprint);
    });
    setImmediate(() => this.#pump());
    return this.get(id);
  }
  #pump(): void {
    if (this.#closed || this.#active >= 2) return;
    let worker: ModelWorker | null;
    try { worker = this.#worker(); } catch { return; }
    if (!worker) return;
    for (const ticket of this.#withState('queued')) {
      if (this.#active >= 2) break;
      if (ticket.state !== 'queued') continue;
      this.#put({ ...ticket, state: 'working', attempts: ticket.attempts + 1, error: null, updatedAt: Date.now() });
      this.#active += 1;
      void this.#run(ticket, worker).finally(() => { this.#active -= 1; this.#pump(); });
    }
  }
  async #run(ticket: Ticket, worker: ModelWorker): Promise<void> {
    try {
      const repository = await RoomRepository.restore(ticket.project);
      const result = await prepareModelProposal(repository, ticket.request, worker);
      if (this.#closed || this.get(ticket.id).state !== 'working') return;
      const currentText = this.project(ticket.projectId);
      const current = await RoomRepository.restore(currentText);
      if (this.#closed || this.get(ticket.id).state !== 'working') return;
      const stale = current.head('main') !== ticket.request.baseRevisionId || this.project(ticket.projectId) !== currentText;
      this.#put({ ...this.get(ticket.id), state: result.status === 'ready' && !stale ? 'ready' : 'needs-input',
        error: stale ? 'The accepted model changed. Revise this request against the current model before accepting.' : null, updatedAt: Date.now(),
        result: { status: result.status, project: result.repository.serialize(), review: result.review } });
    } catch (error) {
      if (this.#closed || this.get(ticket.id).state !== 'working') return;
      this.#put({ ...this.get(ticket.id), state: 'failed', updatedAt: Date.now(), error: error instanceof Error ? error.message.slice(0, 1000) : 'The agent could not finish this request.' });
    }
  }
  async decide(id: string, input: unknown): Promise<{ ticket: Ticket; project: string }> {
    if (!object(input) || Object.keys(input).length !== 3 || typeof input.action !== 'string') throw new Error('A decision requires action, decisionId and expectedRequestId.');
    const decisionId = identifier(input.decisionId);
    const expectedRequestId = identifier(input.expectedRequestId);
    const action = input.action;
    const ticket = this.get(id);
    if (ticket.request.requestId !== expectedRequestId) throw new BacklogConflict('This ticket has a newer revision than the one you reviewed. Reopen it before deciding.');
    const text = this.project(ticket.projectId);
    if (!text) throw new Error('The request project is missing.');
    if (ticket.decisionId === decisionId) {
      if (ticket.decisionAction !== action) throw new BacklogConflict('This decision identity was already used for another action.');
      return { ticket, project: text };
    }
    if (action === 'retry') {
      if (ticket.state !== 'failed' || ticket.attempts >= 3) throw new BacklogConflict('Only failed work with fewer than three attempts can be retried.');
      const next = { ...ticket, state: 'queued' as const, error: null, decisionId, decisionAction: action, updatedAt: Date.now() };
      this.#put(next); setImmediate(() => this.#pump()); return { ticket: next, project: text };
    }
    if (action === 'cancel' || action === 'reject') {
      const allowed = action === 'cancel' ? ticket.state === 'queued' || ticket.state === 'working'
        : ticket.state === 'ready' || ticket.state === 'needs-input' || ticket.state === 'failed';
      if (!allowed) throw new BacklogConflict('This request can no longer receive that decision.');
      const next: Ticket = { ...ticket, state: action === 'cancel' ? 'cancelled' : 'rejected', decisionId, decisionAction: action, updatedAt: Date.now() };
      this.#put(next); return { ticket: next, project: text };
    }
    if (action === 'accept' && ticket.state === 'needs-input' && ticket.result?.status === 'ready') throw new BacklogConflict('This proposal is based on an older or unaccepted model. Revise it against the current accepted model.');
    if (action !== 'accept' || ticket.state !== 'ready' || ticket.result?.status !== 'ready') throw new BacklogConflict('Only a ready proposal can be accepted.');
    const current = await RoomRepository.restore(text);
    if (current.head('main') !== ticket.request.baseRevisionId) throw new BacklogConflict('This proposal is based on an older or unaccepted model. Request a revision against the current accepted model; accepting it would overwrite intervening work.');
    const proposed = await RoomRepository.restore(ticket.result.project);
    if (proposed.projectId !== current.projectId || proposed.root() !== current.root()) throw new Error('The proposal belongs to another project.');
    const accepted = proposed.accept(ticket.request.proposalName, { decisionId, actor: 'preview-human' });
    const acceptedText = accepted.serialize();
    const next: Ticket = { ...ticket, state: 'completed', decisionId, decisionAction: action, updatedAt: Date.now() };
    this.#transaction(() => {
      // Async validation above may have overlapped another decision.
      const latest = this.get(id);
      if (latest.decisionId === decisionId && latest.decisionAction === action) return;
      if (this.project(ticket.projectId) !== text || this.get(id).updatedAt !== ticket.updatedAt || this.get(id).state !== 'ready') throw new BacklogConflict('The model or ticket changed while reviewing. Refresh before deciding.');
      this.#db.prepare('UPDATE projects SET body=? WHERE id=?').run(acceptedText, ticket.projectId);
      this.#put(next);
      for (const other of this.#withState('ready')) {
        if (other.projectId === ticket.projectId && other.id !== ticket.id) this.#put({ ...other, state: 'needs-input',
          error: 'The accepted model changed. Revise this request against the current model before accepting.', updatedAt: Date.now() });
      }
    });
    return { ticket: this.get(id), project: this.project(ticket.projectId) ?? acceptedText };
  }
  close(): void { this.#closed = true; clearInterval(this.#timer); this.#db.close(); }
}
