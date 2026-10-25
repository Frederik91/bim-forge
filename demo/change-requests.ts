import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { RoomRepository, ProposalConflict } from '../src/room-model.ts';
import type { Point } from '../src/room-model.ts';
import { prepareModelProposal, validateModelProposalRequest } from '../src/model-proposal.ts';
import { parseRequestActivity } from '../src/request-activity.ts';
import type { RequestActivity, ActivityUpdate } from '../src/request-activity.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { ModelScripts } from '../src/model-script.ts';
import { parseScriptExecutionEvidence } from '../src/script-evidence.ts';
import type { ScriptExecutionEvidence } from '../src/script-evidence.ts';
import { RequestSourceStore } from './request-source-store.ts';
import { parseRequestSources, parseAuthoringScope } from '../src/request-sources.ts';
import type { RequestSource } from '../src/request-sources.ts';

export type RequestState = 'queued' | 'working' | 'needs-input' | 'ready' | 'completed' | 'rejected' | 'cancelled' | 'failed';
type BoundRequest = ReturnType<typeof validateModelProposalRequest>;
type RequestInput = Pick<BoundRequest, 'requestId' | 'proposalName' | 'baseRevisionId' | 'instruction' | 'visualIntent' | 'sources' | 'authoringScope'> & { selectedObjectIds: readonly string[] };
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
  activity: readonly RequestActivity[];
}
export type TicketSummary = Omit<Ticket, 'project' | 'fingerprint' | 'result' | 'decisionId' | 'decisionAction' | 'history' | 'activity'>;
export class BacklogConflict extends Error {}

type ProposalReadiness = { state: 'ready'; error: null } | { state: 'needs-input'; error: string };
function proposalReadiness(current: RoomRepository, proposed: RoomRepository, name: string): ProposalReadiness {
  try { current.proposalSnapshot(proposed, name); return { state: 'ready', error: null }; }
  catch (error) {
    if (!(error instanceof ProposalConflict)) throw error;
    return { state: 'needs-input', error: error.message.slice(0, 1000) };
  }
}

function assessedTicket(ticket: Ticket, readiness: ProposalReadiness): Ticket {
  if (ticket.state === readiness.state && ticket.error === readiness.error) return ticket;
  return recordActivity({ ...ticket, ...readiness }, { stage: readiness.state,
    message: readiness.error?.slice(0, 300) ?? 'Proposal is compatible with the current model. Unrelated accepted changes will be retained.' });
}

interface ActiveAttempt {
  requestId: string;
  attempt: number;
  controller: AbortController;
  task: Promise<void>;
}
export interface StoredExecution {
  ticketId: string;
  requestId: string;
  attempt: number;
  evidence: ScriptExecutionEvidence;
}

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
  const activity = parseRequestActivity(value.activity);
  if (activity.some((event) => event.requestId !== r.requestId)) throw new Error('Activity belongs to another request revision.');
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
    decisionId: value.decisionId, decisionAction: value.decisionAction, result, history: value.history, activity,
    request: { requestId: r.requestId, proposalName: r.proposalName, baseRevisionId: r.baseRevisionId,
      selectedObjectIds: r.selectedObjectIds, instruction: r.instruction, visualIntent: storedVisual(visual),
      ...(Object.hasOwn(r, 'sources') ? { sources: parseRequestSources(r.sources) } : {}),
      ...(Object.hasOwn(r, 'authoringScope') ? { authoringScope: parseAuthoringScope(r.authoringScope) } : {}) } };
}
function recordActivity(ticket: Ticket, update: ActivityUpdate): Ticket {
  const at = Date.now();
  const event: RequestActivity = { ...update, at, sequence: (ticket.activity.at(-1)?.sequence ?? 0) + 1,
    requestId: ticket.request.requestId, attempt: ticket.attempts };
  return { ...ticket, updatedAt: at, activity: [...ticket.activity, event].slice(-96) };
}

function storedVisual(value: Record<string, unknown>): RequestInput['visualIntent'] {
  if (value.kind === 'selection') return { kind: 'selection' };
  if (value.kind === 'spatial-reference' && object(value.destination)) {
    const d = value.destination;
    if (d.kind === 'floor-point' && Array.isArray(d.positionMm) && d.positionMm.length === 2
        && typeof d.positionMm[0] === 'number' && typeof d.positionMm[1] === 'number') {
      if (Object.hasOwn(d, 'levelId')) {
        if (typeof d.levelId !== 'string') throw new Error('Invalid stored floor level.');
        const positionMm: Point = [d.positionMm[0], d.positionMm[1]];
        const destination = { kind: 'floor-point' as const, levelId: d.levelId, positionMm };
        return { kind: 'spatial-reference', destination };
      }
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
  readonly #sources: RequestSourceStore;
  readonly #uploads = new Map<AbortController, Promise<RequestSource>>();
  readonly #worker: () => ModelWorker | null;
  readonly #scripts = new ModelScripts();
  readonly #attempts = new Map<string, ActiveAttempt>();
  #closing: Promise<void> | null = null;
  #closed = false;
  readonly #timer: ReturnType<typeof setInterval>;
  constructor(file: string, worker: () => ModelWorker | null) {
    this.#db = new DatabaseSync(file);
    this.#worker = worker;
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.#db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS requests_project ON requests(project_id); CREATE INDEX IF NOT EXISTS requests_state ON requests(state);');
    this.#db.exec('CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES requests(id), fingerprint TEXT NOT NULL);');
    this.#db.exec('CREATE TABLE IF NOT EXISTS request_executions (ticket_id TEXT NOT NULL REFERENCES requests(id), request_id TEXT NOT NULL, attempt INTEGER NOT NULL, execution_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(ticket_id, request_id, attempt, execution_id));');
    this.#sources = new RequestSourceStore(this.#db);
    for (const ticket of this.#withState('working')) {
      this.#put(recordActivity({ ...ticket, state: ticket.attempts < 3 ? 'queued' : 'failed',
        error: 'The server restarted during processing. The accepted model is unchanged.' },
        { stage: 'recovered', message: ticket.attempts < 3 ? 'Server restarted. Interrupted work is queued for another bounded attempt.' : 'Server restarted during the final attempt. Human input is required.' }));
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
  async refreshProposal(id: string): Promise<Ticket> {
    for (;;) {
      this.#assertOpen();
      const ticket = this.get(id);
      if ((ticket.state !== 'ready' && ticket.state !== 'needs-input') || ticket.result?.status !== 'ready') return ticket;
      const text = this.project(ticket.projectId);
      const [current, proposed] = await Promise.all([RoomRepository.restore(text), RoomRepository.restore(ticket.result.project)]);
      this.#assertOpen();
      if (this.project(ticket.projectId) !== text || JSON.stringify(this.get(id)) !== JSON.stringify(ticket)) continue;
      const next = assessedTicket(ticket, proposalReadiness(current, proposed, ticket.request.proposalName));
      if (next !== ticket) this.#put(next);
      return next;
    }
  }
  async refreshProject(projectId: string): Promise<void> {
    for (const ticket of this.#all(identifier(projectId))) {
      if ((ticket.state === 'ready' || ticket.state === 'needs-input') && ticket.result?.status === 'ready') await this.refreshProposal(ticket.id);
    }
  }
  executions(id: string): StoredExecution[] {
    this.get(id);
    return this.#db.prepare('SELECT request_id, attempt, execution_id, body FROM request_executions WHERE ticket_id=? ORDER BY rowid').all(id).map((row) => {
      if (typeof row.request_id !== 'string' || typeof row.attempt !== 'number' || !Number.isInteger(row.attempt)
          || row.attempt < 1 || row.attempt > 3 || typeof row.body !== 'string') throw new Error('Unreadable execution journal.');
      const evidence = parseScriptExecutionEvidence(JSON.parse(row.body));
      if (evidence.executionId !== row.execution_id) throw new Error('Execution evidence identity mismatch.');
      return { ticketId: id, requestId: identifier(row.request_id), attempt: row.attempt, evidence };
    });
  }
  #recordExecution(ticket: Ticket, record: ScriptExecutionEvidence): void {
    const active = this.#attempts.get(ticket.id);
    if (!active || active.requestId !== ticket.request.requestId || active.attempt !== ticket.attempts) {
      throw new Error('This execution no longer belongs to an active attempt.');
    }
    const evidence = parseScriptExecutionEvidence(record);
    const body = JSON.stringify(evidence);
    if (Buffer.byteLength(body, 'utf8') > 1024 * 1024) throw new Error('Execution evidence exceeds the journal limit.');
    const key = [ticket.id, ticket.request.requestId, ticket.attempts, evidence.executionId];
    const existing = this.#db.prepare('SELECT body FROM request_executions WHERE ticket_id=? AND request_id=? AND attempt=? AND execution_id=?').get(...key);
    if (existing) {
      if (existing.body !== body) throw new Error('Execution evidence cannot be overwritten.');
      return;
    }
    // Terminal evidence may arrive while cancellation or shutdown drains this attempt.
    // It is append-only and never changes the ticket's state or visible activity.
    this.#db.prepare('INSERT INTO request_executions(ticket_id,request_id,attempt,execution_id,body) VALUES(?,?,?,?,?)').run(...key, body);
  }
  project(id: string): string | null {
    const row = this.#db.prepare('SELECT body FROM projects WHERE id=?').get(identifier(id));
    return row && typeof row.body === 'string' ? row.body : null;
  }
  async addSource(input: Parameters<RequestSourceStore['add']>[0]): Promise<RequestSource> {
    this.#assertOpen();
    const controller = new AbortController();
    const forward = () => controller.abort(input.signal.reason);
    if (input.signal.aborted) forward();
    input.signal.addEventListener('abort', forward, { once: true });
    const task = this.#sources.add({ ...input, projectId: identifier(input.projectId), signal: controller.signal });
    this.#uploads.set(controller, task);
    try { const source = await task; this.#assertOpen(); return source; }
    finally { input.signal.removeEventListener('abort', forward); this.#uploads.delete(controller); }
  }
  source(projectId: string, id: string): ReturnType<RequestSourceStore['get']> {
    this.#assertOpen();
    return this.#sources.get(identifier(projectId), identifier(id));
  }
  list(projectId: string): TicketSummary[] {
    return this.#all(identifier(projectId)).map(({ project: _project, fingerprint: _fingerprint, result: _result, decisionId: _id, decisionAction: _action, history: _history, activity: _activity, ...summary }) => summary);
  }
  async submit(project: unknown, input: unknown): Promise<TicketSummary> {
    this.#assertOpen();
    const repository = await RoomRepository.restore(project);
    this.#assertOpen();
    const bound = validateModelProposalRequest(repository, input);
    const request: RequestInput = { requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
      selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent,
      ...(bound.sources ? { sources: bound.sources } : {}), ...(bound.authoringScope ? { authoringScope: bound.authoringScope } : {}) };
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
    this.#assertOpen();
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
    const ticket: Ticket = recordActivity({ id: request.requestId, projectId: repository.projectId, request, project: body, fingerprint,
      state: 'queued', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), error: null, result: null, decisionId: null, decisionAction: null, history: [], activity: [] }, { stage: 'queued', message: 'Request saved to the server backlog. Waiting for an available agent and ChatGPT connection.' });
    this.#transaction(() => {
      if (this.#submission(request.requestId, fingerprint)) return;
      const latest = this.project(repository.projectId);
      if (latest !== currentText && latest !== body) throw new BacklogConflict('The accepted server model changed during submission. Refresh before submitting.');
      if (!latest) this.#db.prepare('INSERT INTO projects(id,body) VALUES(?,?)').run(repository.projectId, body);
      if (request.sources) this.#sources.bind(repository.projectId, request.sources, request.requestId);
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
    this.#assertOpen();
    const ticket = this.get(id);
    const repository = await RoomRepository.restore(project);
    this.#assertOpen();
    const bound = validateModelProposalRequest(repository, input);
    const request: RequestInput = { requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
      selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent,
      ...(bound.sources ? { sources: bound.sources } : {}), ...(bound.authoringScope ? { authoringScope: bound.authoringScope } : {}) };
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
    this.#assertOpen();
    if (repository.projectId !== ticket.projectId || repository.root() !== current.root() || repository.head('main') !== current.head('main') || request.baseRevisionId !== current.head('main')) {
      throw new BacklogConflict('A revision must use the current accepted model in this project.');
    }
    if (this.#all(ticket.projectId).some((other) => other.id !== ticket.id && other.request.proposalName === request.proposalName)) throw new BacklogConflict('Another ticket uses that proposal name.');
    const archived = JSON.stringify({ ...ticket, history: [] });
    const next: Ticket = recordActivity({ ...ticket, project: body, request, fingerprint, history: [...ticket.history, archived], activity: [],
      state: 'queued', attempts: 0, result: null, error: null, decisionId: null, decisionAction: null, updatedAt: Date.now() }, { stage: 'queued', message: 'New revision queued. Earlier attempts remain in request history.' });
    this.#transaction(() => {
      if (this.#submission(request.requestId, fingerprint)) return;
      if (this.project(ticket.projectId) !== currentText || this.get(id).fingerprint !== ticket.fingerprint) throw new BacklogConflict('The request changed while revising. Refresh and try again.');
      if (request.sources) this.#sources.bind(ticket.projectId, request.sources, request.requestId);
      this.#put(next);
      this.#db.prepare('INSERT INTO submissions(id,ticket_id,fingerprint) VALUES(?,?,?)').run(request.requestId, ticket.id, fingerprint);
    });
    setImmediate(() => this.#pump());
    return this.get(id);
  }
  #pump(): void {
    if (this.#closed || this.#attempts.size >= 2) return;
    let worker: ModelWorker | null;
    try { worker = this.#worker(); } catch { return; }
    if (!worker) return;
    for (const ticket of this.#withState('queued')) {
      if (this.#attempts.size >= 2) break;
      if (ticket.state !== 'queued' || this.#attempts.has(ticket.id)) continue;
      const working = recordActivity({ ...ticket, state: 'working', attempts: ticket.attempts + 1, error: null },
        { stage: 'started', message: 'Agent started on the bound model. Waiting for its next reported tool action.' });
      this.#put(working);
      const controller = new AbortController();
      const task = this.#run(working, worker, controller.signal).finally(() => {
        this.#attempts.delete(ticket.id); this.#pump();
      });
      this.#attempts.set(ticket.id, { requestId: working.request.requestId, attempt: working.attempts, controller, task });
      // The attempt owns its rejection until shutdown drains all tasks.
      void task.catch(() => {});
    }
  }
  #isWorking(ticket: Ticket): boolean {
    if (this.#closed) return false;
    const current = this.get(ticket.id);
    return current.state === 'working' && current.request.requestId === ticket.request.requestId && current.attempts === ticket.attempts;
  }
  async #run(ticket: Ticket, worker: ModelWorker, signal: AbortSignal): Promise<void> {
    let evidenceError: Error | null = null;
    let prepared: Awaited<ReturnType<RequestSourceStore['prepare']>> | null = null;
    const work: { task: Promise<void> | null } = { task: null };
    const trackedWorker: ModelWorker = { identity: worker.identity, run: (session) => {
      work.task = Promise.resolve().then(() => worker.run(session));
      return work.task;
    } };
    try {
      const repository = await RoomRepository.restore(ticket.project);
      if (!this.#isWorking(ticket) || signal.aborted) return;
      if (ticket.request.sources) {
        this.#put(recordActivity(this.get(ticket.id), { stage: 'inspecting', message: 'Preparing the attached reference files for the agent.' }));
        prepared = await this.#sources.prepare(ticket.projectId, ticket.request.sources, signal);
        if (!this.#isWorking(ticket) || signal.aborted) return;
      }
      const result = await prepareModelProposal(repository, ticket.request, trackedWorker, (event) => {
        if (this.#isWorking(ticket)) this.#put(recordActivity(this.get(ticket.id), event));
      }, { signal, scripts: this.#scripts, ...(prepared ? { sourceInput: prepared } : {}), onExecution: (record) => {
        try { this.#recordExecution(ticket, record); }
        catch (error) {
          evidenceError = error instanceof Error ? error : new Error('Execution evidence could not be saved.');
          this.#attempts.get(ticket.id)?.controller.abort();
          throw evidenceError;
        }
      } });
      if (evidenceError) throw evidenceError;
      if (!this.#isWorking(ticket)) return;
      this.#put(recordActivity({ ...this.get(ticket.id), state: result.status === 'ready' ? 'ready' : 'needs-input',
        error: null, updatedAt: Date.now(),
        result: { status: result.status, project: result.repository.serialize(), review: result.review } },
        { stage: result.status === 'ready' ? 'ready' : 'needs-input', message: result.status === 'ready' ? 'Validated proposal is ready for your review. Nothing is accepted automatically.' : 'The agent needs clarification. Open the request to review its explanation.' }));
      if (result.status === 'ready') await this.refreshProposal(ticket.id);
    } catch (error) {
      this.#attempts.get(ticket.id)?.controller.abort();
      if (!this.#isWorking(ticket)) return;
      const failure = evidenceError ?? error;
      this.#put(recordActivity({ ...this.get(ticket.id), state: 'failed', error: failure instanceof Error ? failure.message.slice(0, 1000) : 'The agent could not finish this request.' }, { stage: 'failed', message: 'The agent could not complete this attempt. The accepted model is unchanged.' }));
    } finally {
      // Core drains script calls; retain the slot until provider cleanup also ends.
      if (work.task) await work.task.catch(() => {});
      await prepared?.dispose();
    }
  }
  async decide(id: string, input: unknown): Promise<{ ticket: Ticket; project: string }> {
    this.#assertOpen();
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
      const next = recordActivity({ ...ticket, state: 'queued', error: null, decisionId, decisionAction: action }, { stage: 'queued', message: 'Retry queued. Earlier attempt activity is retained.' });
      this.#put(next); setImmediate(() => this.#pump()); return { ticket: next, project: text };
    }
    if (action === 'cancel' || action === 'reject') {
      const allowed = action === 'cancel' ? ticket.state === 'queued' || ticket.state === 'working'
        : ticket.state === 'ready' || ticket.state === 'needs-input' || ticket.state === 'failed';
      if (!allowed) throw new BacklogConflict('This request can no longer receive that decision.');
      const next: Ticket = recordActivity({ ...ticket, state: action === 'cancel' ? 'cancelled' : 'rejected', decisionId, decisionAction: action }, { stage: action === 'cancel' ? 'cancelled' : 'rejected', message: action === 'cancel' ? 'Request cancelled. Late worker activity and results will be ignored.' : 'Proposal rejected. The accepted model is unchanged.' });
      this.#put(next);
      const active = this.#attempts.get(id);
      if (action === 'cancel' && active?.requestId === ticket.request.requestId && active.attempt === ticket.attempts) active.controller.abort();
      return { ticket: next, project: text };
    }
    if (action !== 'accept' || (ticket.state !== 'ready' && ticket.state !== 'needs-input') || ticket.result?.status !== 'ready') throw new BacklogConflict('Only a ready proposal can be accepted.');
    const current = await RoomRepository.restore(text);
    const proposed = await RoomRepository.restore(ticket.result.project);
    this.#assertOpen();
    const readiness = proposalReadiness(current, proposed, ticket.request.proposalName);
    if (readiness.state === 'needs-input') throw new BacklogConflict(readiness.error);
    const accepted = await current.acceptFrom(proposed, ticket.request.proposalName, { decisionId, actor: 'preview-human' });
    const acceptedText = accepted.serialize();
    const next: Ticket = recordActivity({ ...ticket, state: 'completed', decisionId, decisionAction: action }, { stage: 'completed', message: 'Proposal explicitly accepted and saved as the current model.' });
    const assessments = await Promise.all(this.#all(ticket.projectId).filter((other) => other.id !== ticket.id
      && (other.state === 'ready' || other.state === 'needs-input') && other.result?.status === 'ready').map(async (other) => {
      const otherProposal = await RoomRepository.restore(other.result?.project);
      return { before: other, after: assessedTicket(other, proposalReadiness(accepted, otherProposal, other.request.proposalName)) };
    }));
    this.#assertOpen();
    this.#transaction(() => {
      // Async validation above may have overlapped another decision.
      const latest = this.get(id);
      if (latest.decisionId === decisionId && latest.decisionAction === action) return;
      if (this.project(ticket.projectId) !== text || JSON.stringify(latest) !== JSON.stringify(ticket)) throw new BacklogConflict('The model or ticket changed while reviewing. Refresh before deciding.');
      this.#db.prepare('UPDATE projects SET body=? WHERE id=?').run(acceptedText, ticket.projectId);
      this.#put(next);
      for (const assessment of assessments) {
        if (assessment.after !== assessment.before && JSON.stringify(this.get(assessment.before.id)) === JSON.stringify(assessment.before)) this.#put(assessment.after);
      }
    });
    return { ticket: this.get(id), project: this.project(ticket.projectId) ?? acceptedText };
  }
  #assertOpen(): void { if (this.#closed) throw new Error('The change request queue is closed.'); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    clearInterval(this.#timer);
    for (const active of this.#attempts.values()) active.controller.abort();
    for (const controller of this.#uploads.keys()) controller.abort();
    this.#closing = (async () => {
      try {
        await Promise.allSettled([...this.#attempts.values()].map((active) => active.task));
        await Promise.allSettled([...this.#uploads.values()]);
        await this.#scripts.dispose();
      } finally { this.#db.close(); }
    })();
    return this.#closing;
  }
}
