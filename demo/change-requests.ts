import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { RoomRepository, ProposalConflict, diffSnapshots } from '../src/room-model.ts';
import type { Point } from '../src/room-model.ts';
import { prepareModelProposal, validateModelProposalRequest } from '../src/model-proposal.ts';
import { parseRequestActivity } from '../src/request-activity.ts';
import type { RequestActivity, ActivityUpdate } from '../src/request-activity.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { ModelScripts, summarizeModelDelta } from '../src/model-script.ts';
import { parseScriptExecutionEvidence } from '../src/script-evidence.ts';
import type { ScriptExecutionEvidence } from '../src/script-evidence.ts';
import { RequestSourceStore } from './request-source-store.ts';
import { parseRequestSources, parseAuthoringScope } from '../src/request-sources.ts';
import type { RequestSource } from '../src/request-sources.ts';
import { parseIntentAssessment } from '../src/model-intent.ts';
import { VersionedProjectStore } from './versioned-project-store.ts';
import type { RepositoryReference, VersionedProjects } from './versioned-project-contract.ts';
import { parseScopedRequest, parseFrozenModelScope, parseModelScopeQuery, plainScopeData } from '../src/model-scope-contract.ts';
import type { FrozenModelScope, ScopedRequest } from '../src/model-scope-contract.ts';
import { assertModelScopeFresh, assertModelScopeWrites } from '../src/model-scope.ts';
import { CONVERSATION_LIMITS, parseConversationReply, parseConversationMessage, parseConversationVisual, parseRequestConversation } from '../src/request-conversation.ts';
import type { RequestConversation, ConversationMessage } from '../src/request-conversation.ts';
import { ModelScopeStore } from './model-scope-store.ts';
import type { RequestDraft } from '../src/request-draft.ts';
import { parseDesignTarget, parseFrozenDesignTarget, sameDesignTarget } from '../src/design-targets.ts';
import type { DesignTarget, FrozenDesignTarget, WritableDesignTarget } from '../src/design-targets.ts';
import { ProjectEvidenceStore } from './project-evidence-store.ts';
import { MAX_EVIDENCE_PINS, parseEvidenceEntry, parseEvidencePin, parseEvidenceReadSet } from '../src/model-evidence.ts';
import type { EvidencePin, EvidenceReadSet } from '../src/model-evidence.ts';
import { GeometryEvidenceConflict, geometryNativeInput, readGeometryEvidence, validateGeometryEvidence,
  publishWithGeometryGuard } from '../src/geometry-evidence.ts';
import type { GeometryEvidenceSource, GeometryEvidence } from '../src/geometry-evidence.ts';

export type RequestState = 'queued' | 'working' | 'needs-input' | 'ready' | 'completed' | 'rejected' | 'cancelled' | 'failed';
type BoundRequest = ReturnType<typeof validateModelProposalRequest>;
type RequestInput = Pick<BoundRequest, 'requestId' | 'proposalName' | 'baseRevisionId' | 'instruction' | 'visualIntent' | 'sources' | 'authoringScope' | 'conversationVisual' | 'target' | 'evidencePins'> & { selectedObjectIds: readonly string[]; scope?: ScopedRequest };
interface RequestTicket<Project> {
  evidence?: EvidenceReadSet;
  conversation?: RequestConversation;
  id: string;
  projectId: string;
  state: RequestState;
  request: RequestInput;
  scope?: FrozenModelScope;
  project: Project;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  error: string | null;
  result: { status: 'ready' | 'declined'; project: Project; review: unknown } | null;
  decisionId: string | null;
  decisionAction: string | null;
  history: readonly string[];
  activity: readonly RequestActivity[];
}
type Ticket = RequestTicket<RepositoryReference>;
type TicketProjection = RequestTicket<string> & { conversation?: RequestConversation };
export type TicketSummary = Omit<Ticket, 'project' | 'fingerprint' | 'result' | 'decisionId' | 'decisionAction' | 'history' | 'activity' | 'conversation'> & { title: string };
export class BacklogConflict extends Error {}

type ProposalReadiness = { state: 'ready'; error: null } | { state: 'needs-input'; error: string };
function proposalReadiness(current: RoomRepository, proposed: RoomRepository, name: string, target?: FrozenDesignTarget): ProposalReadiness {
  try {
    const review = proposed.review(name);
    if (review.scope) {
      const base = proposed.view(review.baseRevisionId).snapshot;
      try {
        const head = target ? current.freezeDesignTarget(target.target).revisionId : current.head('main');
        assertModelScopeFresh({ base, current: current.view(head).snapshot, binding: review.scope });
        assertModelScopeWrites({ before: base, after: proposed.view(review.proposalRevisionId).snapshot, binding: review.scope });
      } catch (error) { return { state: 'needs-input', error: error instanceof Error ? error.message.slice(0, 1000) : 'Scope requires a new review.' }; }
    }
    current.proposalSnapshot(proposed, name, target); return { state: 'ready', error: null };
  }
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
function fields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (!required.every((key) => Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) throw new Error('Unexpected stored request fields.');
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('Invalid request or project identity.');
  return value;
}
function reference(value: unknown): RepositoryReference {
  if (!object(value) || Object.keys(value).length !== 2) throw new Error('Invalid repository reference.');
  return { projectId: identifier(value.projectId), documentId: identifier(value.documentId) };
}
function portable(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid legacy project.');
  return value;
}
function validateSourceBytes(db: DatabaseSync): void {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='request_source_blobs'").get()) return;
  for (const row of db.prepare('SELECT * FROM request_source_blobs').all()) {
    const [source] = parseRequestSources([{ id: row.id, name: row.name, mediaType: row.media_type, byteLength: row.byte_length, sha256: row.sha256 }]);
    if (!source || !(row.bytes instanceof Uint8Array) || row.bytes.byteLength !== source.byteLength
        || createHash('sha256').update(row.bytes).digest('hex') !== source.sha256
        || typeof row.project_id !== 'string' || typeof row.visual_count !== 'number' || !Number.isSafeInteger(row.visual_count)
        || row.visual_count < 0 || row.visual_count > 4 || typeof row.text_bytes !== 'number' || !Number.isSafeInteger(row.text_bytes)
        || row.text_bytes < 0 || row.text_bytes > 65536 || typeof row.created_at !== 'number' || !Number.isSafeInteger(row.created_at)) {
      throw new Error('Invalid legacy source bytes or metadata.');
    }
    identifier(row.project_id);
  }
}
function parseTicket<Project>(text: string, parseProject: (value: unknown) => Project): RequestTicket<Project> {
  const value: unknown = JSON.parse(text);
  if (!object(value) || !object(value.request) || typeof value.id !== 'string'
      || typeof value.projectId !== 'string' || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number'
      || typeof value.attempts !== 'number' || typeof value.fingerprint !== 'string'
      || !Array.isArray(value.history) || value.history.length > 20 || !value.history.every((item) => typeof item === 'string')
      || (value.error !== null && typeof value.error !== 'string')
      || (value.decisionId !== null && typeof value.decisionId !== 'string') || (value.decisionAction !== null && typeof value.decisionAction !== 'string')
      || !['queued', 'working', 'needs-input', 'ready', 'completed', 'rejected', 'cancelled', 'failed'].includes(String(value.state))) {
    throw new Error('The stored change request is invalid.');
  }
  // The payload is parsed by the model request boundary again before every run.
  fields(value, ['id', 'projectId', 'state', 'request', 'project', 'fingerprint', 'createdAt', 'updatedAt', 'attempts', 'error', 'result', 'decisionId', 'decisionAction', 'history'], ['activity', 'scope', 'conversation', 'evidence']);
  const r = value.request;
  fields(r, ['requestId', 'proposalName', 'baseRevisionId', 'selectedObjectIds', 'instruction', 'visualIntent'], ['sources', 'authoringScope', 'scope', 'conversationVisual', 'target', 'evidencePins']);
  const target = Object.hasOwn(r, 'target') ? parseFrozenDesignTarget(r.target) : undefined;
  if (target && (target.projectId !== value.projectId || target.revisionId !== r.baseRevisionId)) throw new Error('Stored request design does not match its project and base.');
  const evidence = Object.hasOwn(value, 'evidence') ? parseEvidenceReadSet(value.evidence) : undefined;
  let evidencePins: EvidencePin[] | undefined;
  if (Object.hasOwn(r, 'evidencePins')) {
    if (!Array.isArray(r.evidencePins) || r.evidencePins.length > MAX_EVIDENCE_PINS) throw new Error('Invalid stored evidence selection.');
    evidencePins = r.evidencePins.map(parseEvidencePin);
    if (new Set(evidencePins.map(pin => pin.entryId)).size !== evidencePins.length) throw new Error('Duplicate stored evidence selection.');
  }
  if (evidencePins?.length && !evidence) throw new Error('Stored request is missing its frozen project evidence.');
  if (evidence && (evidence.projectId !== value.projectId || evidence.revisionId !== r.baseRevisionId
      || !isDeepStrictEqual(evidence.target, target?.target ?? { kind: 'main' })
      || !isDeepStrictEqual(evidence.pins, evidencePins ?? []))) throw new Error('Stored project evidence differs from its request binding.');
  const scopedRequest = Object.hasOwn(r, 'scope') ? parseScopedRequest(r.scope) : undefined;
  const scope = Object.hasOwn(value, 'scope') ? parseFrozenModelScope(value.scope) : undefined;
  if (Boolean(scopedRequest) !== Boolean(scope) || (scope && (scope.baseRevisionId !== r.baseRevisionId || !isDeepStrictEqual(scope.query, scopedRequest?.query)))) {
    throw new Error('Stored scope does not match its request revision and query.');
  }
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
  if (!Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt) || value.createdAt < 0 || value.updatedAt < 0
      || !Number.isSafeInteger(value.attempts) || value.attempts < 0 || value.attempts > 3
      || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error('Invalid stored request metadata.');
  if ((value.decisionId === null) !== (value.decisionAction === null)
      || (value.decisionAction !== null && !['accept', 'reject', 'cancel', 'retry'].includes(value.decisionAction))) throw new Error('Invalid stored decision.');
  if (value.decisionId !== null) identifier(value.decisionId);
  let result: RequestTicket<Project>['result'] = null;
  if (value.result !== null) {
    if (!object(value.result) || (value.result.status !== 'ready' && value.result.status !== 'declined') || !object(value.result.review)) throw new Error('Invalid stored proposal result.');
    fields(value.result, ['status', 'project', 'review']);
    result = { status: value.result.status, project: parseProject(value.result.project), review: value.result.review };
  }
  if ((state === 'ready' && result?.status !== 'ready')
      || (state === 'completed' && (result?.status !== 'ready' || value.decisionAction !== 'accept'))
      || (state === 'cancelled' && value.decisionAction !== 'cancel') || (state === 'rejected' && value.decisionAction !== 'reject')) throw new Error('Stored state and decision do not match.');
  const conversation = Object.hasOwn(value, 'conversation') ? parseRequestConversation(value.conversation) : undefined;
  if (conversation && conversation.ticketId !== value.id) throw new Error('Conversation belongs to another ticket.');
  return { ...(conversation ? { conversation } : {}), id: identifier(value.id), projectId: identifier(value.projectId), state, project: parseProject(value.project), fingerprint: value.fingerprint,
    ...(evidence ? { evidence } : {}),
    ...(scope ? { scope } : {}),
    createdAt: value.createdAt, updatedAt: value.updatedAt, attempts: value.attempts, error: value.error,
    decisionId: value.decisionId, decisionAction: value.decisionAction, result, history: value.history, activity,
    request: { requestId: r.requestId, proposalName: r.proposalName, baseRevisionId: r.baseRevisionId,
      ...(target ? { target } : {}),
      ...(evidencePins ? { evidencePins } : {}),
      ...(Object.hasOwn(r, 'conversationVisual') ? { conversationVisual: parseConversationVisual(r.conversationVisual) } : {}),
      selectedObjectIds: r.selectedObjectIds, instruction: r.instruction, visualIntent: storedVisual(visual),
      ...(Object.hasOwn(r, 'sources') ? { sources: parseRequestSources(r.sources) } : {}),
      ...(scopedRequest ? { scope: scopedRequest } : {}),
      ...(Object.hasOwn(r, 'authoringScope') ? { authoringScope: parseAuthoringScope(r.authoringScope) } : {}) } };
}
function recordActivity(ticket: Ticket, update: ActivityUpdate): Ticket {
  const at = Date.now();
  const event: RequestActivity = { ...update, at, sequence: (ticket.activity.at(-1)?.sequence ?? 0) + 1,
    requestId: ticket.request.requestId, attempt: ticket.attempts };
  return { ...ticket, updatedAt: at, activity: [...ticket.activity, event].slice(-96) };
}

function storedVisual(value: Record<string, unknown>): RequestInput['visualIntent'] {
  if (value.kind === 'selection') { fields(value, ['kind']); return { kind: 'selection' }; }
  if (value.kind === 'spatial-reference' && object(value.destination)) {
    fields(value, ['kind', 'destination']);
    const d = value.destination;
    if (d.kind === 'floor-point' && Array.isArray(d.positionMm) && d.positionMm.length === 2
        && typeof d.positionMm[0] === 'number' && typeof d.positionMm[1] === 'number') {
      if (Object.hasOwn(d, 'levelId')) {
        fields(d, ['kind', 'levelId', 'positionMm']);
        if (typeof d.levelId !== 'string') throw new Error('Invalid stored floor level.');
        const positionMm: Point = [d.positionMm[0], d.positionMm[1]];
        return { kind: 'spatial-reference', destination: { kind: 'floor-point', levelId: d.levelId, positionMm } };
      }
      fields(d, ['kind', 'positionMm']);
      return { kind: 'spatial-reference', destination: { kind: 'floor-point', positionMm: [d.positionMm[0], d.positionMm[1]] } };
    }
    if (d.kind === 'wall-point' && typeof d.wallId === 'string' && typeof d.alongWallMm === 'number') {
      fields(d, ['kind', 'wallId', 'alongWallMm']);
      return { kind: 'spatial-reference', destination: { kind: 'wall-point', wallId: d.wallId, alongWallMm: d.alongWallMm } };
    }
  }
  if (value.kind === 'rectangle-layout-sketch' && object(value.layout) && object(value.layout.boundsMm) && object(value.layout.door)) {
    fields(value, ['kind', 'layout']); fields(value.layout, ['boundsMm', 'door']);
    const b = value.layout.boundsMm; const d = value.layout.door;
    fields(b, ['minX', 'minY', 'maxX', 'maxY']); fields(d, ['widthMm', 'offsetMm']);
    if (typeof b.minX === 'number' && typeof b.minY === 'number' && typeof b.maxX === 'number' && typeof b.maxY === 'number'
        && typeof d.widthMm === 'number' && typeof d.offsetMm === 'number') return { kind: 'rectangle-layout-sketch', layout: {
      boundsMm: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }, door: { widthMm: d.widthMm, offsetMm: d.offsetMm } } };
  }
  throw new Error('Invalid stored visual context.');
}

export class ChangeRequests {
  readonly #db: DatabaseSync;
  readonly #projects: VersionedProjects;
  readonly #scopes: ModelScopeStore;
  readonly #sources: RequestSourceStore;
  readonly #evidence: ProjectEvidenceStore;
  readonly #geometry: GeometryEvidenceSource | undefined;
  readonly #geometryDecisions = new Set<AbortController>();
  readonly #uploads = new Map<AbortController, Promise<RequestSource>>();
  readonly #worker: () => ModelWorker | null;
  readonly #scripts = new ModelScripts();
  readonly #attempts = new Map<string, ActiveAttempt>();
  readonly #drafts = new Map<string, RequestDraft>();
  #closing: Promise<void> | null = null;
  #closed = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  private constructor(db: DatabaseSync, worker: () => ModelWorker | null, options: { geometry?: GeometryEvidenceSource }) {
    this.#db = db;
    this.#worker = worker;
    this.#geometry = options.geometry;
    this.#db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS requests_project ON requests(project_id); CREATE INDEX IF NOT EXISTS requests_state ON requests(state);');
    this.#db.exec('CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES requests(id), fingerprint TEXT NOT NULL);');
    this.#db.exec('CREATE TABLE IF NOT EXISTS request_executions (ticket_id TEXT NOT NULL REFERENCES requests(id), request_id TEXT NOT NULL, attempt INTEGER NOT NULL, execution_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(ticket_id, request_id, attempt, execution_id));');
    this.#db.exec('CREATE TABLE IF NOT EXISTS request_geometry_evidence (request_id TEXT NOT NULL, ticket_id TEXT NOT NULL REFERENCES requests(id), attempt INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(request_id,ticket_id,attempt));');
    this.#db.exec('CREATE TABLE IF NOT EXISTS request_geometry_acceptances (decision_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, ticket_id TEXT NOT NULL REFERENCES requests(id), body TEXT NOT NULL);');
    this.#db.exec('CREATE TABLE IF NOT EXISTS request_messages (ticket_id TEXT NOT NULL REFERENCES requests(id), sequence INTEGER NOT NULL, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL, PRIMARY KEY(ticket_id,sequence));');
    this.#db.exec('CREATE TABLE IF NOT EXISTS request_continuations (request_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES requests(id));');
    this.#db.exec('CREATE TABLE IF NOT EXISTS project_design_commands (project_id TEXT NOT NULL REFERENCES projects(id), command_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(project_id,command_id));');
    this.#projects = new VersionedProjectStore(this.#db);
    this.#scopes = new ModelScopeStore(this.#db, this.#projects);
    this.#sources = new RequestSourceStore(this.#db);
    this.#evidence = new ProjectEvidenceStore(this.#db, this.#sources);
  }
  static async open(file: string, worker: () => ModelWorker | null, options: { geometry?: GeometryEvidenceSource } = {}): Promise<ChangeRequests> {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.exec('BEGIN IMMEDIATE');
    let queue: ChangeRequests;
    try {
      validateSourceBytes(db);
      queue = new ChangeRequests(db, worker, options);
      await queue.#migrate();
      for (const ticket of queue.#all()) queue.#seedConversation(ticket);
      for (const ticket of queue.#withState('working')) {
        queue.#put(recordActivity({ ...ticket, state: ticket.attempts < 3 ? 'queued' : 'failed',
        error: 'The server restarted during processing. The accepted model is unchanged.' },
        { stage: 'recovered', message: ticket.attempts < 3 ? 'Server restarted. Interrupted work is queued for another bounded attempt.' : 'Server restarted during the final attempt. Human input is required.' }));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK'); db.close(); throw error;
    }
    queue.#timer = setInterval(() => queue.#pump(), 1000);
    queue.#timer.unref();
    queue.#pump();
    return queue;
  }
  async #migrate(): Promise<void> {
    this.#db.exec('CREATE TABLE IF NOT EXISTS queue_storage_metadata (version INTEGER PRIMARY KEY CHECK(version=1));');
    const hasLegacyBody = this.#db.prepare('PRAGMA table_info(projects)').all().some((column) => column.name === 'body');
    if (this.#db.prepare('SELECT version FROM queue_storage_metadata').get()) {
      if (hasLegacyBody) {
        for (const row of this.#db.prepare('SELECT id,body FROM projects').all()) {
          if (typeof row.id !== 'string' || row.body !== 'versioned' || !this.#projects.current(identifier(row.id))) throw new Error('Unexpected normalized project marker.');
        }
        if (this.#db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Normalized database relationships are invalid.');
        this.#db.exec('ALTER TABLE projects DROP COLUMN body');
      }
      return;
    }
    const projects = new Map<string, RoomRepository>();
    if (!hasLegacyBody && this.#db.prepare('SELECT id FROM projects LIMIT 1').get()) throw new Error('Project migration metadata is missing.');
    const legacyProjects = hasLegacyBody ? this.#db.prepare('SELECT id, body FROM projects ORDER BY rowid').all() : [];
    for (const row of legacyProjects) {
      if (typeof row.id !== 'string' || typeof row.body !== 'string') throw new Error('Unreadable legacy project.');
      const repository = await RoomRepository.restore(row.body);
      if (repository.projectId !== row.id) throw new Error('Legacy project identity mismatch.');
      projects.set(row.id, repository);
      this.#projects.publish({ projectId: row.id, expectedDocumentId: null, reference: this.#projects.put(repository),
        origin: 'imported', requestId: null, decisionId: null });
    }
    const submissions = new Map<string, { ticketId: string; fingerprint: string; projectId: string; sources: readonly RequestSource[] }>();
    const reviewedExecutions: { ticketId: string; requestId: string; attempt: number; evidence: ScriptExecutionEvidence }[] = [];
    const convert = async (ticket: TicketProjection, archived: boolean): Promise<Ticket> => {
      if (archived && ticket.history.length) throw new Error('Nested legacy archives are invalid.');
      const repository = await RoomRepository.restore(ticket.project);
      const accepted = projects.get(ticket.projectId);
      if (!accepted || repository.projectId !== ticket.projectId || repository.root() !== accepted.root()) throw new Error('Legacy request project/root mismatch.');
      if (ticket.state === 'completed') {
        const decision = accepted.review(ticket.request.proposalName).decision;
        if (decision.status === 'pending' || decision.decisionId !== ticket.decisionId) throw new Error('Legacy accepted ticket decision does not match project evidence.');
      }
      validateModelProposalRequest(repository, ticket.request);
      const fingerprint = createHash('sha256').update(JSON.stringify({ project: repository.serialize(), request: ticket.request })).digest('hex');
      if (fingerprint !== ticket.fingerprint) throw new Error('Legacy submission fingerprint mismatch.');
      if (submissions.has(ticket.request.requestId)) throw new Error('Duplicate legacy request identity.');
      submissions.set(ticket.request.requestId, { ticketId: ticket.id, fingerprint, projectId: ticket.projectId, sources: ticket.request.sources ?? [] });
      let result: Ticket['result'] = null;
      if (ticket.result) {
        const proposed = await RoomRepository.restore(ticket.result.project);
        if (proposed.projectId !== ticket.projectId || proposed.root() !== repository.root()) throw new Error('Legacy result project/root mismatch.');
        const review = ticket.result.review;
        if (!object(review) || review.requestId !== ticket.request.requestId || review.proposalName !== ticket.request.proposalName
            || review.baseRevisionId !== ticket.request.baseRevisionId || review.instruction !== ticket.request.instruction
            || JSON.stringify(review.selectedObjectIds) !== JSON.stringify(ticket.request.selectedObjectIds)) throw new Error('Legacy result review binding mismatch.');
        if (ticket.result.status === 'ready') {
          const record = proposed.review(ticket.request.proposalName);
          const expected = { ...record, changes: summarizeModelDelta(diffSnapshots(proposed.view(record.baseRevisionId).snapshot, proposed.view(record.proposalRevisionId).snapshot)) };
          if (!isDeepStrictEqual(expected, review)) throw new Error('Legacy result review evidence mismatch.');
          for (const evidence of record.scriptExecutions ?? []) reviewedExecutions.push({ ticketId: ticket.id, requestId: ticket.request.requestId, attempt: ticket.attempts, evidence });
        } else if (review.proposalRevisionId !== null || review.changes !== null
            || !['summary', 'rationale', 'constraints', 'uncertainty'].every((key) => typeof review[key] === 'string' && review[key].length > 0 && review[key].length <= 4000)
            || proposed.serialize() !== repository.serialize()) throw new Error('Invalid legacy declined result.');
        if (ticket.result.status === 'declined') fields(review, ['requestId', 'proposalName', 'baseRevisionId', 'proposalRevisionId', 'selectedObjectIds', 'instruction', 'summary', 'rationale', 'constraints', 'uncertainty', 'changes'], ['intent']);
        if (Object.hasOwn(review, 'intent')) parseIntentAssessment(review.intent);
        result = { ...ticket.result, project: this.#projects.put(proposed) };
      }
      const history: string[] = [];
      for (const text of ticket.history) {
        const previous = parseTicket(text, portable);
        if (previous.id !== ticket.id || previous.projectId !== ticket.projectId) throw new Error('Legacy archive identity mismatch.');
        history.push(JSON.stringify(await convert(previous, true)));
      }
      return { ...ticket, project: this.#projects.put(repository), result, history };
    };
    for (const row of this.#db.prepare('SELECT id, project_id, state, body FROM requests ORDER BY rowid').all()) {
      if (typeof row.body !== 'string') throw new Error('Unreadable legacy request.');
      const ticket = parseTicket(row.body, portable);
      if (ticket.id !== row.id || ticket.projectId !== row.project_id || ticket.state !== row.state) throw new Error('Legacy request row identity mismatch.');
      this.#put(await convert(ticket, false));
    }
    for (const row of this.#db.prepare('SELECT id, ticket_id, fingerprint FROM submissions').all()) {
      const bound = typeof row.id === 'string' ? submissions.get(row.id) : undefined;
      if (!bound || row.ticket_id !== bound.ticketId || row.fingerprint !== bound.fingerprint) throw new Error('Legacy submission replay mismatch.');
    }
    if (this.#db.prepare('SELECT COUNT(*) AS count FROM submissions').get()?.count !== submissions.size) throw new Error('Legacy submission replay is incomplete.');
    for (const row of this.#db.prepare('SELECT ticket_id, request_id, attempt, execution_id, body FROM request_executions').all()) {
      const bound = typeof row.request_id === 'string' ? submissions.get(row.request_id) : undefined;
      if (!bound || bound.ticketId !== row.ticket_id || typeof row.attempt !== 'number' || !Number.isInteger(row.attempt)
          || row.attempt < 1 || row.attempt > 3 || typeof row.body !== 'string') throw new Error('Invalid legacy execution binding.');
      const evidence = parseScriptExecutionEvidence(JSON.parse(row.body));
      if (evidence.executionId !== row.execution_id) throw new Error('Legacy execution identity mismatch.');
    }
    for (const record of reviewedExecutions) {
      const row = this.#db.prepare('SELECT body FROM request_executions WHERE ticket_id=? AND request_id=? AND attempt=? AND execution_id=?')
        .get(record.ticketId, record.requestId, record.attempt, record.evidence.executionId);
      if (!row || typeof row.body !== 'string' || !isDeepStrictEqual(parseScriptExecutionEvidence(JSON.parse(row.body)), record.evidence)) throw new Error('Legacy reviewed execution evidence is missing or mismatched.');
    }
    for (const row of this.#db.prepare('SELECT request_id, project_id, manifest FROM request_source_bindings').all()) {
      const bound = typeof row.request_id === 'string' ? submissions.get(row.request_id) : undefined;
      if (!bound || bound.projectId !== row.project_id || JSON.stringify(bound.sources) !== row.manifest) throw new Error('Legacy source binding mismatch.');
      this.#sources.assert(bound.projectId, bound.sources);
      const members = this.#db.prepare('SELECT source_id FROM request_source_memberships WHERE request_id=? ORDER BY source_id').all(identifier(row.request_id));
      if (JSON.stringify(members.map((item) => item.source_id)) !== JSON.stringify(bound.sources.map((item) => item.id).sort())) throw new Error('Legacy source membership mismatch.');
    }
    for (const row of this.#db.prepare('SELECT id, project_id, manifest FROM request_source_identities').all()) {
      if (typeof row.manifest !== 'string' || typeof row.project_id !== 'string') throw new Error('Invalid legacy source identity.');
      const [source] = parseRequestSources([JSON.parse(row.manifest)]);
      if (!source || source.id !== row.id) throw new Error('Legacy source identity mismatch.');
      identifier(row.project_id);
      const blob = this.#db.prepare('SELECT project_id, name, media_type, byte_length, sha256 FROM request_source_blobs WHERE id=?').get(source.id);
      if (blob && (blob.project_id !== row.project_id || blob.name !== source.name || blob.media_type !== source.mediaType
          || blob.byte_length !== source.byteLength || blob.sha256 !== source.sha256)) throw new Error('Legacy source manifest does not match its bytes.');
    }
    for (const [requestId, bound] of submissions) {
      if (bound.sources.length && !this.#db.prepare('SELECT request_id FROM request_source_bindings WHERE request_id=?').get(requestId)) throw new Error('Legacy request source binding is missing.');
    }
    if (this.#db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Legacy database relationships are invalid.');
    if (hasLegacyBody) this.#db.exec('ALTER TABLE projects DROP COLUMN body');
    this.#db.exec('INSERT INTO queue_storage_metadata(version) VALUES(1)');
  }
  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #all(projectId?: string): Ticket[] {
    const rows = projectId === undefined ? this.#db.prepare('SELECT body FROM requests ORDER BY rowid').all()
      : this.#db.prepare('SELECT body FROM requests WHERE project_id = ? ORDER BY rowid').all(projectId);
    return rows.map((row) => { if (typeof row.body !== 'string') throw new Error('Unreadable request store.'); return parseTicket(row.body, reference); });
  }
  #put(ticket: Ticket): void {
    const { conversation, ...stored } = ticket;
    if (conversation) {
      const existing = this.#messages(ticket.id);
      if (existing.length && !isDeepStrictEqual(existing, conversation.messages)) throw new Error('Imported conversation differs from the immutable journal.');
    }
    this.#db.prepare('INSERT INTO requests(id, project_id, state, body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, body=excluded.body').run(ticket.id, ticket.projectId, ticket.state, JSON.stringify(stored));
    const draft = this.#drafts.get(ticket.id);
    if (ticket.state !== 'working' || (draft && (draft.requestId !== ticket.request.requestId || draft.attempt !== ticket.attempts))) this.#drafts.delete(ticket.id);
    if (conversation && !this.#messages(ticket.id).length) for (const message of conversation.messages) this.#appendMessage(ticket.id, message);
  }
  #withState(state: RequestState): Ticket[] {
    return this.#db.prepare('SELECT body FROM requests WHERE state=? ORDER BY rowid').all(state).map((row) => {
      if (typeof row.body !== 'string') throw new Error('Unreadable request store.');
      return parseTicket(row.body, reference);
    });
  }
  #submission(id: string, fingerprint: string): Ticket | null {
    const row = this.#db.prepare('SELECT ticket_id, fingerprint FROM submissions WHERE id=?').get(id);
    if (!row) return null;
    if (row.fingerprint !== fingerprint || typeof row.ticket_id !== 'string') throw new BacklogConflict('This request identity is already bound to different input.');
    return this.#get(row.ticket_id);
  }
  #get(id: string): Ticket {
    const row = this.#db.prepare('SELECT body FROM requests WHERE id=?').get(identifier(id));
    if (!row || typeof row.body !== 'string') throw new Error('Unknown change request.');
    const ticket = parseTicket(row.body, reference);
    if (ticket.project.projectId !== ticket.projectId || (ticket.result && ticket.result.project.projectId !== ticket.projectId)) throw new Error('Stored request reference belongs to another project.');
    return ticket;
  }
  #projection(ticket: Ticket, archived = false): TicketProjection {
    if (archived && ticket.history.length) throw new Error('Nested request archives are invalid.');
    return { ...ticket, ...(!archived ? { conversation: this.#conversation(ticket.id) } : {}), project: this.#projects.read(ticket.project),
      result: ticket.result ? { ...ticket.result, project: this.#projects.read(ticket.result.project) } : null,
      history: ticket.history.map((text) => JSON.stringify(this.#projection(parseTicket(text, reference), true))) };
  }
  #messages(id: string): ConversationMessage[] {
    return this.#db.prepare('SELECT body FROM request_messages WHERE ticket_id=? ORDER BY sequence').all(id).map((row, index) => {
      if (typeof row.body !== 'string') throw new Error('Unreadable conversation journal.');
      const message = parseConversationMessage(JSON.parse(row.body));
      if (message.sequence !== index + 1) throw new Error('Conversation journal sequence is invalid.');
      return message;
    });
  }
  #appendMessage(ticketId: string, message: ConversationMessage): void {
    const parsed = parseConversationMessage(message);
    if (parsed.sequence > CONVERSATION_LIMITS.messages) throw new Error('This conversation reached its message limit.');
    this.#db.prepare('INSERT INTO request_messages(ticket_id,sequence,id,body) VALUES(?,?,?,?)').run(ticketId, parsed.sequence, parsed.id, JSON.stringify(parsed));
  }
  #seedConversation(ticket: Ticket): void {
    if (this.#messages(ticket.id).length) return;
    const versions = [...ticket.history.map(text => parseTicket(text, reference)), ticket];
    for (const version of versions) {
      const sequence = this.#messages(ticket.id).length + 1;
      this.#appendMessage(ticket.id, { kind: 'user', id: version.request.requestId, sequence, at: version.createdAt,
        requestId: version.request.requestId, baseRevisionId: version.request.baseRevisionId, text: version.request.instruction,
        sources: version.request.sources ?? [], visual: version.request.conversationVisual ?? null,
        ...(version.request.evidencePins ? { evidencePins: [...version.request.evidencePins] } : {}) });
      if (version.result) this.#assistantMessage(version);
      if (version.decisionId && version.decisionAction) this.#decisionMessage(version);
    }
  }
  #conversation(id: string): RequestConversation {
    const ticket = this.#get(id);
    this.#seedConversation(ticket);
    const messages = this.#messages(id);
    return { version: 1, ticketId: id, sequence: messages.length, messages };
  }
  #assistantMessage(ticket: Ticket, clarification?: { question: string; options: string[] }): void {
    if (!ticket.result) return;
    const review = ticket.result.review;
    if (!object(review)) throw new Error('Invalid assistant review.');
    const messages = this.#messages(ticket.id);
    const clean = (value: unknown, fallback: string) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000) || fallback : fallback;
    const content: Extract<ConversationMessage, {kind: 'assistant'}>['content'] = clarification ? { kind: 'clarification', ...clarification }
      : ticket.result.status === 'ready' && typeof review.proposalRevisionId === 'string'
      ? { kind: 'proposal', text: clean(review.summary, 'Proposal ready for review.'), proposalName: ticket.request.proposalName, proposalRevisionId: review.proposalRevisionId }
      : { kind: 'explanation', text: clean(review.rationale, 'The agent needs more information.') };
    this.#appendMessage(ticket.id, { kind: 'assistant', id: `assistant:${createHash('sha256').update(ticket.request.requestId).digest('hex')}`, sequence: messages.length + 1, at: Date.now(),
      requestId: ticket.request.requestId, baseRevisionId: ticket.request.baseRevisionId, replyTo: ticket.request.requestId, content });
  }
  #decisionMessage(ticket: Ticket): void {
    const action = ticket.decisionAction;
    if (!ticket.decisionId || (action !== 'accept' && action !== 'reject' && action !== 'cancel' && action !== 'retry')) return;
    this.#appendMessage(ticket.id, { kind: 'decision', id: `decision:${createHash('sha256').update(ticket.id + ':' + ticket.decisionId).digest('hex')}`, sequence: this.#messages(ticket.id).length + 1,
      at: ticket.updatedAt, requestId: ticket.request.requestId, baseRevisionId: ticket.request.baseRevisionId, action, decisionId: ticket.decisionId });
  }
  get(id: string): TicketProjection { return this.#projection(this.#get(id)); }
  draft(id: string): RequestDraft | null {
    this.#assertOpen();
    const ticket = this.#get(id);
    const active = this.#attempts.get(id);
    const draft = this.#drafts.get(id);
    if (!draft || !active || active.controller.signal.aborted || ticket.state !== 'working'
        || draft.requestId !== ticket.request.requestId || draft.attempt !== ticket.attempts
        || active.requestId !== draft.requestId || active.attempt !== draft.attempt) return null;
    return { ...draft };
  }
  async refreshProposal(id: string): Promise<TicketProjection> { return this.#projection(await this.#refreshProposal(id)); }
  async #refreshProposal(id: string): Promise<Ticket> {
    for (;;) {
      this.#assertOpen();
      const ticket = this.#get(id);
      if ((ticket.state !== 'ready' && ticket.state !== 'needs-input') || ticket.result?.status !== 'ready') return ticket;
      const text = this.project(ticket.projectId);
      const [current, proposed] = await Promise.all([RoomRepository.restore(text), RoomRepository.restore(this.#projects.read(ticket.result.project))]);
      this.#assertOpen();
      if (this.project(ticket.projectId) !== text || JSON.stringify(this.#get(id)) !== JSON.stringify(ticket)) continue;
      const controller = new AbortController();
      this.#geometryDecisions.add(controller);
      let readiness: ProposalReadiness;
      try { readiness = await this.#geometryReadiness(ticket, current, proposed, controller.signal); }
      finally { this.#geometryDecisions.delete(controller); }
      this.#assertOpen();
      if (this.project(ticket.projectId) !== text || JSON.stringify(this.#get(id)) !== JSON.stringify(ticket)) continue;
      const next = assessedTicket(ticket, readiness);
      if (next !== ticket) this.#put(next);
      return next;
    }
  }
  async refreshProject(projectId: string): Promise<void> {
    const id = identifier(projectId);
    const maximum = this.#db.prepare('SELECT COALESCE(MAX(rowid),0) AS position FROM requests WHERE project_id=?').get(id)?.position;
    if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum)) throw new Error('Unreadable request store.');
    let after = 0;
    while (after < maximum) {
      const rows = this.#db.prepare("SELECT rowid AS position,id FROM requests WHERE project_id=? AND rowid>? AND rowid<=? AND state IN ('ready','needs-input') ORDER BY rowid LIMIT 64").all(id, after, maximum);
      if (!rows.length) return;
      for (const row of rows) {
        if (typeof row.id !== 'string' || typeof row.position !== 'number' || !Number.isSafeInteger(row.position)) throw new Error('Unreadable request store.');
        after = row.position;
        await this.#refreshProposal(row.id);
      }
    }
  }
  executions(id: string): StoredExecution[] {
    this.#get(id);
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
    const current = this.#projects.current(identifier(id));
    return current ? this.#projects.read(current) : null;
  }
  projects(): ReturnType<VersionedProjects['list']> { this.#assertOpen(); return this.#projects.list({ limit: 32 }); }
  hasProject(projectId: string): boolean { this.#assertOpen(); return this.#projects.current(identifier(projectId)) !== null; }
  scopePreview(projectId: string, baseRevisionId: string, query: unknown): ReturnType<ModelScopeStore['preview']> {
    this.#assertOpen();
    return this.#scopes.preview({ projectId: identifier(projectId), baseRevisionId, query: parseModelScopeQuery(query) });
  }
  savedScopes(projectId: string): ReturnType<ModelScopeStore['list']> {
    this.#assertOpen(); return this.#scopes.list(identifier(projectId));
  }
  saveModelScope(input: Parameters<ModelScopeStore['save']>[0]): ReturnType<ModelScopeStore['save']> {
    this.#assertOpen(); return this.#scopes.save({ ...input, projectId: identifier(input.projectId), query: parseModelScopeQuery(input.query) });
  }
  #assertSavedScope(projectId: string, scope: ScopedRequest | undefined): void {
    if (!scope?.savedScopeId) return;
    const saved = this.#scopes.load({ projectId, id: scope.savedScopeId });
    if (!isDeepStrictEqual(saved.query, scope.query)) throw new BacklogConflict('The saved scope query changed. Preview it again before submission.');
  }
  history(input: Parameters<VersionedProjects['history']>[0]): ReturnType<VersionedProjects['history']> {
    this.#assertOpen(); identifier(input.projectId);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error('History limit must be from 1 through 50.');
    return this.#projects.history(input);
  }
  #register(repository: RoomRepository): void {
    this.#db.prepare('INSERT INTO projects(id) VALUES(?)').run(repository.projectId);
    this.#projects.publish({ projectId: repository.projectId, expectedDocumentId: null, reference: this.#projects.put(repository),
      origin: 'imported', requestId: null, decisionId: null });
  }
  async importProject(text: unknown): Promise<string> {
    this.#assertOpen();
    const repository = await RoomRepository.restore(text);
    for (;;) {
      this.#assertOpen();
      const current = this.#projects.current(repository.projectId);
      if (current) {
        const authoritative = this.#projects.read(current);
        const existing = await RoomRepository.restore(authoritative);
        this.#assertOpen();
        if (this.#projects.current(repository.projectId)?.documentId !== current.documentId) continue;
        if (existing.root() !== repository.root()) throw new BacklogConflict('This project identity belongs to a different model.');
        return authoritative;
      }
      return this.#transaction(() => { this.#register(repository); return this.#projects.read(this.#requiredCurrent(repository.projectId)); });
    }
  }
  #requiredCurrent(projectId: string): RepositoryReference {
    const current = this.#projects.current(projectId);
    if (!current) throw new Error('Missing current project.');
    return current;
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
  listProjectSources(projectId: string, after: string | null, limit = 20): ReturnType<RequestSourceStore['projectPage']> {
    this.#assertOpen(); this.#requiredCurrent(identifier(projectId));
    return this.#sources.projectPage({ projectId, after, limit });
  }
  retainProjectSource(projectId: string, input: unknown): RequestSource {
    this.#assertOpen(); this.#requiredCurrent(identifier(projectId));
    const [source] = parseRequestSources([input]);
    if (!source) throw new Error('Choose one uploaded source.');
    return this.#sources.retainProject(projectId, source);
  }
  listEvidence(projectId: string, after: number | null, limit = 20): ReturnType<ProjectEvidenceStore['page']> {
    this.#assertOpen(); this.#requiredCurrent(identifier(projectId));
    return this.#evidence.page({ projectId, after: after ?? 0, limit });
  }
  async recordEvidence(projectId: string, input: unknown): Promise<EvidencePin> {
    this.#assertOpen(); identifier(projectId);
    const value = plainScopeData(input);
    if (!object(value)) throw new Error('Invalid project evidence command.');
    fields(value, ['commandId', 'entry']);
    const commandId = identifier(value.commandId);
    const repository = await RoomRepository.restore(this.#projects.read(this.#requiredCurrent(projectId)));
    this.#assertOpen();
    return this.#evidence.append({ repository, commandId, actor: 'preview-human', entry: parseEvidenceEntry(value.entry) });
  }
  #freezeEvidence(repository: RoomRepository, request: RequestInput): EvidenceReadSet | undefined {
    return request.evidencePins?.length ? this.#evidence.freezeReadSet({ repository,
      revisionId: request.baseRevisionId, target: request.target?.target ?? { kind: 'main' }, pins: request.evidencePins, subjects: [] }) : undefined;
  }
  #pinEvidence(requestId: string, evidence: EvidenceReadSet | undefined): void {
    if (evidence) this.#evidence.pinReadSet({ requestId, readSet: evidence });
  }
  #trustedGeometryEvidence(ticket: Ticket, proposed: RoomRepository): GeometryEvidence | undefined {
    const review = proposed.review(ticket.request.proposalName);
    const row = this.#db.prepare('SELECT body FROM request_geometry_evidence WHERE request_id=? AND ticket_id=? AND attempt=?')
      .get(ticket.request.requestId, ticket.id, ticket.attempts);
    if (review.geometryEvidence !== undefined || row) {
      if (!this.#geometry || !row || row.body !== review.geometryEvidence) throw new GeometryEvidenceConflict('Trusted geometry read evidence is missing or differs from this request attempt.');
    }
    return review.geometryEvidence === undefined ? undefined : readGeometryEvidence(review.geometryEvidence);
  }
  #proposalReadiness(ticket: Ticket, current: RoomRepository, proposed: RoomRepository): ProposalReadiness {
    const review = proposed.review(ticket.request.proposalName);
    const head = current.freezeDesignTarget(ticket.request.target?.target ?? { kind: 'main' }).revisionId;
    if (ticket.request.selectedObjectIds.length && !current.view(head).snapshot.entities.some(entity => ticket.request.selectedObjectIds.includes(entity.id))) {
      return { state: 'needs-input', error: 'Every originally selected native object disappeared. Start a fresh chat or select a new explicit context before revising.' };
    }
    try { this.#trustedGeometryEvidence(ticket, proposed); }
    catch (error) { return { state: 'needs-input', error: error instanceof Error ? error.message.slice(0, 1000) : 'Trusted geometry evidence is unavailable.' }; }
    if (!isDeepStrictEqual(review.evidence, ticket.evidence)) return { state: 'needs-input', error: 'Proposal evidence differs from the submitted evidence. Reopen this chat before deciding.' };
    if (ticket.evidence) {
      if (!isDeepStrictEqual(this.#evidence.readPinned({ projectId: ticket.projectId, requestId: ticket.request.requestId }), ticket.evidence)) {
        return { state: 'needs-input', error: 'The stored evidence binding is incomplete or changed.' };
      }
      const status = this.#evidence.verifyForReview({ repository: current, readSet: ticket.evidence, uses: review.evidenceUses ?? [] });
      if (!status.ready) return { state: 'needs-input', error: status.reasons.join(' ').slice(0, 1000) };
    }
    return proposalReadiness(current, proposed, ticket.request.proposalName, ticket.request.target);
  }
  #geometryNative(ticket: Ticket, repository: RoomRepository) {
    const target = ticket.request.target?.target ?? { kind: 'main' } satisfies NonNullable<Ticket['request']['target']>['target'];
    const revisionId = repository.freezeDesignTarget(target).revisionId;
    return geometryNativeInput({ snapshot: repository.view(revisionId).snapshot, revisionId, target,
      ...(ticket.scope ? { scope: ticket.scope } : {}) });
  }
  async #validateGeometry(ticket: Ticket, current: RoomRepository, proposed: RoomRepository, signal: AbortSignal): Promise<Awaited<ReturnType<typeof validateGeometryEvidence>> | undefined> {
    const review = proposed.review(ticket.request.proposalName);
    if (review.geometryEvidence === undefined) return;
    if (!this.#geometry) throw new GeometryEvidenceConflict('Geometry verification is unavailable.');
    return validateGeometryEvidence({ evidence: readGeometryEvidence(review.geometryEvidence), source: this.#geometry,
      native: this.#geometryNative(ticket, current), candidate: current.proposalSnapshot(proposed, ticket.request.proposalName, ticket.request.target), signal });
  }
  async #geometryReadiness(ticket: Ticket, current: RoomRepository, proposed: RoomRepository, signal: AbortSignal): Promise<ProposalReadiness> {
    const readiness = this.#proposalReadiness(ticket, current, proposed);
    if (readiness.state !== 'ready') return readiness;
    try { await this.#validateGeometry(ticket, current, proposed, signal); return readiness; }
    catch (error) { return { state: 'needs-input', error: error instanceof Error ? error.message.slice(0, 1000) : 'Geometry requires a new review.' }; }
  }
  async designCommand(projectId: string, action: 'baseline' | 'alternative', input: unknown): Promise<{ project: string; created: DesignTarget }> {
    this.#assertOpen(); identifier(projectId);
    const value = plainScopeData(input);
    if (!object(value)) throw new Error('Invalid design command.');
    fields(value, action === 'baseline' ? ['commandId', 'name', 'from'] : ['commandId', 'name', 'baselineId']);
    const commandId = identifier(value.commandId);
    if (typeof value.name !== 'string') throw new Error('Choose a design name.');
    const name = value.name;
    const from = action === 'baseline' ? parseFrozenDesignTarget(value.from) : null;
    const baselineId = action === 'alternative' ? identifier(value.baselineId) : null;
    const id = `${action}-` + createHash('sha256').update(`${projectId}\n${commandId}`).digest('hex').slice(0, 32);
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, actor: 'preview-human', name, from, baselineId })).digest('hex');
    const replay = (): DesignTarget | null => {
      const row = this.#db.prepare('SELECT fingerprint,result FROM project_design_commands WHERE project_id=? AND command_id=?').get(projectId, commandId);
      if (!row) return null;
      if (row.fingerprint !== fingerprint) throw new BacklogConflict('This design command already has different inputs.');
      if (typeof row.result !== 'string') throw new Error('Invalid design command receipt.');
      const created = parseDesignTarget(JSON.parse(row.result));
      if (created.kind === 'main' || created.kind !== action || created.id !== id) throw new Error('Corrupt design command receipt.');
      return created;
    };
    const previous = replay();
    if (previous) return { project: this.#projects.read(this.#requiredCurrent(projectId)), created: previous };
    const reference = this.#requiredCurrent(projectId);
    const repository = await RoomRepository.restore(this.#projects.read(reference));
    this.#assertOpen();
    const completed = replay();
    if (completed) return { project: this.#projects.read(this.#requiredCurrent(projectId)), created: completed };
    let candidate: RoomRepository;
    let created: DesignTarget;
    if (action === 'baseline') {
      if (!from || from.projectId !== projectId) throw new BacklogConflict('The baseline belongs to another project.');
      candidate = repository.captureBaseline({ id, name, from });
      created = parseDesignTarget({ kind: 'baseline', id });
    } else {
      if (!baselineId) throw new Error('Choose a fixed baseline.');
      candidate = repository.forkAlternative({ id, name, baselineId });
      created = parseDesignTarget({ kind: 'alternative', id });
    }
    this.#transaction(() => {
      const concurrent = replay();
      if (concurrent) { created = concurrent; return; }
      if (this.#requiredCurrent(projectId).documentId !== reference.documentId) throw new BacklogConflict('The project changed while saving the design. Refresh and try again.');
      this.#projects.publishMetadata({ projectId, expectedDocumentId: reference.documentId, reference: this.#projects.put(candidate) });
      this.#db.prepare('INSERT INTO project_design_commands(project_id,command_id,fingerprint,result) VALUES(?,?,?,?)')
        .run(projectId, commandId, fingerprint, JSON.stringify(created));
    });
    return { project: this.#projects.read(this.#requiredCurrent(projectId)), created };
  }
  list(projectId: string): TicketSummary[] {
    const titles = new Map<string, string>();
    for (const row of this.#db.prepare("SELECT m.ticket_id,json_extract(m.body,'$.text') AS title FROM request_messages m JOIN requests r ON r.id=m.ticket_id WHERE r.project_id=? AND m.sequence=1").all(identifier(projectId))) {
      if (typeof row.ticket_id !== 'string' || typeof row.title !== 'string') throw new Error('Invalid first conversation message.');
      titles.set(row.ticket_id, row.title.replace(/\s+/g, ' ').trim().slice(0, 80));
    }
    return this.#all(projectId).map(({ project: _project, fingerprint: _fingerprint, result: _result, decisionId: _id, decisionAction: _action, history: _history, activity: _activity, conversation: _conversation, ...summary }) => ({ ...summary, title: titles.get(summary.id) ?? summary.request.instruction.slice(0, 80) }));
  }
  async submit(project: unknown, input: unknown): Promise<TicketSummary> {
    this.#assertOpen();
    const repository = await RoomRepository.restore(project);
    this.#assertOpen();
    const bound = validateModelProposalRequest(repository, input);
    const request: RequestInput = { ...(bound.target ? { target: bound.target } : {}), ...(bound.evidencePins ? { evidencePins: bound.evidencePins } : {}), ...(bound.conversationVisual ? { conversationVisual: bound.conversationVisual } : {}), requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
      selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent,
      ...(bound.scopedRequest ? { scope: bound.scopedRequest } : {}),
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
    const selectedHead = bound.target ? current.freezeDesignTarget(bound.target.target).revisionId : current.head('main');
    if (selectedHead !== (bound.target?.revisionId ?? repository.head('main'))) throw new BacklogConflict(bound.target
      ? 'The selected design changed. Reopen that design before submitting.'
      : 'The accepted server model changed. Reopen the latest server project before submitting.');
    if (bound.scope && !isDeepStrictEqual(current.view(bound.baseRevisionId).snapshot, bound.base.snapshot)) {
      throw new BacklogConflict('The scoped request base is not the authoritative server revision.');
    }
    if (this.#all(repository.projectId).some((ticket) => ticket.request.proposalName === request.proposalName)) throw new BacklogConflict('Another ticket already uses this proposal name.');
    const pending = this.#db.prepare("SELECT COUNT(*) AS count FROM requests WHERE state IN ('queued','working')").get();
    if (pending && typeof pending.count === 'number' && pending.count >= 64) throw new Error('The pending request backlog is full. Finish or cancel existing work first.');
    const evidence = this.#freezeEvidence(current, request);
    this.#transaction(() => {
      if (this.#submission(request.requestId, fingerprint)) return;
      const latest = this.project(repository.projectId);
      if (latest !== currentText && latest !== body) throw new BacklogConflict('The accepted server model changed during submission. Refresh before submitting.');
      if (!latest) this.#register(repository);
      this.#assertSavedScope(repository.projectId, bound.scopedRequest);
      const ticket: Ticket = recordActivity({ id: request.requestId, projectId: repository.projectId, request, project: this.#projects.put(current), fingerprint,
        ...(evidence ? { evidence } : {}),
        ...(bound.scope ? { scope: bound.scope } : {}),
        state: 'queued', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), error: null, result: null, decisionId: null, decisionAction: null, history: [], activity: [] }, { stage: 'queued', message: 'Request saved to the server backlog. Waiting for an available agent and ChatGPT connection.' });
      if (request.sources) this.#sources.bind(repository.projectId, request.sources, request.requestId);
      this.#pinEvidence(request.requestId, evidence);
      this.#put(ticket);
      this.#seedConversation(ticket);
      this.#db.prepare('INSERT INTO submissions(id,ticket_id,fingerprint) VALUES(?,?,?)').run(request.requestId, ticket.id, fingerprint);
    });
    // Start after the acknowledgement can be sent; submission never awaits the worker.
    setImmediate(() => this.#pump());
    const summary = this.list(repository.projectId).find((item) => item.id === request.requestId);
    if (!summary) throw new Error('Missing request summary.');
    return summary;
  }
  async revise(id: string, project: unknown, input: unknown): Promise<TicketProjection> {
    this.#assertOpen();
    const ticket = this.#get(id);
    const repository = await RoomRepository.restore(project);
    this.#assertOpen();
    const bound = validateModelProposalRequest(repository, input);
    const request: RequestInput = { ...(bound.target ? { target: bound.target } : {}), ...(bound.evidencePins ? { evidencePins: bound.evidencePins } : {}), ...(bound.conversationVisual ? { conversationVisual: bound.conversationVisual } : {}), requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
      selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent,
      ...(bound.scopedRequest ? { scope: bound.scopedRequest } : {}),
      ...(bound.sources ? { sources: bound.sources } : {}), ...(bound.authoringScope ? { authoringScope: bound.authoringScope } : {}) };
    const body = repository.serialize();
    const fingerprint = createHash('sha256').update(JSON.stringify({ project: body, request })).digest('hex');
    const previous = this.#submission(request.requestId, fingerprint);
    if (previous) {
      if (previous.id !== ticket.id) throw new BacklogConflict('This request identity belongs to another ticket.');
      return this.#projection(previous);
    }
    if (!['ready', 'needs-input', 'failed'].includes(ticket.state)) throw new BacklogConflict('Only finished, unaccepted work can be revised.');
    if (ticket.history.length >= 8) throw new Error('This ticket has reached the eight-revision preview limit.');
    const currentText = this.project(ticket.projectId);
    if (!currentText) throw new Error('Missing project.');
    const current = await RoomRepository.restore(currentText);
    this.#assertOpen();
    const destination: WritableDesignTarget = ticket.request.target?.target ?? { kind: 'main' };
    const head = current.freezeDesignTarget(destination).revisionId;
    if (!sameDesignTarget(destination, request.target?.target ?? { kind: 'main' })) throw new BacklogConflict('A conversation cannot change its design destination. Start a new chat for another design.');
    if (repository.projectId !== ticket.projectId || repository.root() !== current.root()
        || repository.freezeDesignTarget(destination).revisionId !== head || request.baseRevisionId !== head) {
      throw new BacklogConflict('A revision must use the current accepted revision of this design.');
    }
    if (ticket.request.selectedObjectIds.length && !request.selectedObjectIds.length
        && !current.view(head).snapshot.entities.some(entity => ticket.request.selectedObjectIds.includes(entity.id))) {
      throw new BacklogConflict('Every originally selected native object disappeared. An empty rebase cannot silently replace those anchors; start a fresh chat.');
    }
    if (this.#all(ticket.projectId).some((other) => other.id !== ticket.id && other.request.proposalName === request.proposalName)) throw new BacklogConflict('Another ticket uses that proposal name.');
    const evidence = this.#freezeEvidence(current, request);
    this.#seedConversation(ticket);
    const archived = JSON.stringify({ ...ticket, history: [] });
    this.#transaction(() => {
      if (this.#submission(request.requestId, fingerprint)) return;
      if (this.project(ticket.projectId) !== currentText || !isDeepStrictEqual(this.#get(id), ticket)) throw new BacklogConflict('The request changed while revising. Refresh and try again.');
      this.#assertSavedScope(ticket.projectId, bound.scopedRequest);
      if (request.sources) this.#sources.bind(ticket.projectId, request.sources, request.requestId);
      this.#pinEvidence(request.requestId, evidence);
      const { scope: previousScope, evidence: previousEvidence, ...previousTicket } = ticket;
      const next: Ticket = recordActivity({ ...previousTicket, ...(bound.scope ? { scope: bound.scope } : {}), ...(evidence ? { evidence } : {}), project: this.#projects.put(current), request, fingerprint, history: [...ticket.history, archived], activity: [],
        state: 'queued', attempts: 0, result: null, error: null, decisionId: null, decisionAction: null, updatedAt: Date.now() }, { stage: 'queued', message: 'New revision queued. Earlier attempts remain in request history.' });
      this.#put(next);
      this.#appendMessage(id, { kind: 'user', id: request.requestId, sequence: this.#messages(id).length + 1, at: Date.now(), requestId: request.requestId, baseRevisionId: request.baseRevisionId, text: request.instruction, sources: request.sources ?? [], visual: request.conversationVisual ?? null,
        ...(request.evidencePins ? { evidencePins: [...request.evidencePins] } : {}) });
      this.#db.prepare('INSERT INTO submissions(id,ticket_id,fingerprint) VALUES(?,?,?)').run(request.requestId, ticket.id, fingerprint);
    });
    setImmediate(() => this.#pump());
    return this.get(id);
  }
  async appendMessage(id: string, input: unknown): Promise<TicketProjection> {
    this.#assertOpen();
    const reply = parseConversationReply(input);
    const fingerprint = createHash('sha256').update(JSON.stringify({ ticketId: id, reply })).digest('hex');
    const replay = this.#submission(reply.messageId, fingerprint);
    if (replay) { if (replay.id !== id) throw new BacklogConflict('Message belongs to another ticket.'); return this.get(id); }
    const ticket = this.#get(id);
    const conversation = this.#conversation(id);
    if (conversation.sequence !== reply.expectedSequence) throw new BacklogConflict('The conversation changed. Refresh before sending.');
    if (conversation.messages.length > CONVERSATION_LIMITS.messages - ((ticket.state === 'working' || ticket.state === 'queued') ? 4 : 3) || conversation.messages.filter(message => message.kind === 'user').length >= CONVERSATION_LIMITS.userTurns) throw new Error('This conversation reached its preview limit. Export its history before starting another request.');
    if (ticket.history.length >= 20) throw new Error('This ticket reached its twenty-turn history limit.');
    const currentText = this.project(ticket.projectId);
    if (!currentText) throw new Error('Missing accepted model.');
    const repository = await RoomRepository.restore(currentText);
    const target = ticket.request.target || repository.persistence().version === 3
      ? repository.freezeDesignTarget(ticket.request.target?.target ?? { kind: 'main' }) : undefined;
    if (reply.baseRevisionId !== (target?.revisionId ?? repository.head('main'))) throw new BacklogConflict('This design changed. Refresh before attaching or replying.');
    if (ticket.scope && ticket.request.baseRevisionId !== reply.baseRevisionId) throw new BacklogConflict('The scoped base changed. Start a fresh scope review before continuing.');
    if (reply.visual) {
      let snapshot = repository.view(reply.baseRevisionId).snapshot;
      if (reply.visual.snapshot.kind === 'proposal') {
        const visual = reply.visual.snapshot;
        const version = [...ticket.history.map(text => parseTicket(text, reference)), ticket].find(item => item.request.proposalName === visual.proposalName && object(item.result?.review) && item.result.review.proposalRevisionId === visual.revisionId);
        if (!version?.result) throw new BacklogConflict('Visual evidence refers to an unknown proposal.');
        const proposed = await RoomRepository.restore(this.#projects.read(version.result.project));
        snapshot = proposed.view(visual.revisionId).snapshot;
      } else if (reply.visual.snapshot.revisionId !== reply.baseRevisionId) throw new BacklogConflict('Accepted visual evidence is stale. Capture it again.');
      if (reply.visual.levelId && !snapshot.entities.some(entity => entity.id === reply.visual?.levelId && entity.type === 'Level')) throw new Error('Visual level context must name a Level.');
      if ([...reply.visual.selectedObjectIds, ...(reply.visual.levelId ? [reply.visual.levelId] : [])].some(id => !snapshot.entities.some(entity => entity.id === id))) throw new Error('Visual evidence references an unknown object.');
    }
    const earlierSources = conversation.messages.flatMap(message => message.kind === 'user' ? message.sources : []);
    for (const source of reply.sources) {
      const prior = earlierSources.find(item => item.id === source.id);
      if (prior && !isDeepStrictEqual(prior, source)) throw new BacklogConflict('Earlier source evidence cannot be replaced.');
    }
    const sources = [...new Map([...conversation.messages.flatMap(message => message.kind === 'user' ? message.sources : []), ...reply.sources].map(source => [source.id, source])).values()];
    if (sources.length) parseRequestSources(sources);
    const selected = reply.visual?.snapshot.kind === 'accepted' ? reply.visual.selectedObjectIds : ticket.request.selectedObjectIds;
    const bound = validateModelProposalRequest(repository, { requestId: reply.messageId, baseRevisionId: reply.baseRevisionId,
      ...(target ? { target } : {}),
      ...((reply.evidencePins ?? ticket.request.evidencePins) ? { evidencePins: reply.evidencePins ?? ticket.request.evidencePins } : {}),
      selectedObjectIds: selected, instruction: reply.text, visualIntent: { kind: 'selection' }, ...(sources.length ? { sources } : {}),
      ...(ticket.request.authoringScope ? { authoringScope: ticket.request.authoringScope } : {}), ...(ticket.request.scope ? { scope: ticket.request.scope } : {}) });
    const evidence = this.#freezeEvidence(repository, bound);
    this.#assertOpen();
    this.#transaction(() => {
      if (this.#submission(reply.messageId, fingerprint)) return;
      const latest = this.#get(id);
      if (this.project(ticket.projectId) !== currentText || latest.request.requestId !== ticket.request.requestId || latest.fingerprint !== ticket.fingerprint || this.#messages(id).length !== reply.expectedSequence) throw new BacklogConflict('The model or conversation changed while sending. Refresh and retry.');
      if (sources.length) this.#sources.bind(ticket.projectId, sources, reply.messageId);
      this.#pinEvidence(reply.messageId, evidence);
      const request: RequestInput = { ...(bound.target ? { target: bound.target } : {}), ...(bound.evidencePins ? { evidencePins: bound.evidencePins } : {}), requestId: bound.requestId, proposalName: bound.proposalName, baseRevisionId: bound.baseRevisionId,
        selectedObjectIds: bound.selectedObjectIds, instruction: bound.instruction, visualIntent: bound.visualIntent,
        ...(sources.length ? { sources } : {}), ...(ticket.request.authoringScope ? { authoringScope: ticket.request.authoringScope } : {}), ...(ticket.request.scope ? { scope: ticket.request.scope } : {}) };
      const { evidence: previousEvidence, ...previousTicket } = latest;
      const next = recordActivity({ ...previousTicket, ...(evidence ? { evidence } : {}), request, project: this.#projects.put(repository), fingerprint,
        history: [...latest.history, JSON.stringify({ ...latest, history: [] })], activity: [], state: 'queued', attempts: 0,
        result: null, error: null, decisionId: null, decisionAction: null }, { stage: 'queued', message: 'Reply saved. Earlier messages and proposals remain in the conversation.' });
      this.#put(next);
      if (ticket.state === 'working' || ticket.state === 'queued') {
        this.#appendMessage(id, { kind: 'assistant', id: `superseded:${createHash('sha256').update(ticket.request.requestId).digest('hex')}`, sequence: this.#messages(id).length + 1, at: Date.now(),
          requestId: ticket.request.requestId, baseRevisionId: ticket.request.baseRevisionId, replyTo: ticket.request.requestId,
          content: { kind: 'explanation', text: 'This turn was superseded by a later message. Its late result cannot change the conversation or accepted model.' } });
      }
      this.#appendMessage(id, { kind: 'user', id: reply.messageId, sequence: this.#messages(id).length + 1, at: Date.now(), requestId: reply.messageId,
        baseRevisionId: reply.baseRevisionId, text: reply.text, sources: reply.sources, visual: reply.visual,
        ...(reply.evidencePins ? { evidencePins: reply.evidencePins } : {}) });
      this.#db.prepare('INSERT INTO submissions(id,ticket_id,fingerprint) VALUES(?,?,?)').run(reply.messageId, id, fingerprint);
      this.#db.prepare('INSERT INTO request_continuations(request_id,ticket_id) VALUES(?,?)').run(reply.messageId, id);
    });
    this.#attempts.get(id)?.controller.abort();
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
    const current = this.#get(ticket.id);
    return current.state === 'working' && current.request.requestId === ticket.request.requestId && current.attempts === ticket.attempts;
  }
  async #run(ticket: Ticket, worker: ModelWorker, signal: AbortSignal): Promise<void> {
    let sequence = 0;
    const clearDraft = (): void => {
      const draft = this.#drafts.get(ticket.id);
      if (draft?.requestId === ticket.request.requestId && draft.attempt === ticket.attempts) this.#drafts.delete(ticket.id);
    };
    signal.addEventListener('abort', clearDraft, { once: true });
    let evidenceError: Error | null = null;
    let prepared: Awaited<ReturnType<RequestSourceStore['prepare']>> | null = null;
    const work: { task: Promise<void> | null } = { task: null };
    const trackedWorker: ModelWorker = { identity: worker.identity, run: (session) => {
      work.task = Promise.resolve().then(() => worker.run(session));
      return work.task;
    } };
    try {
      const repository = await RoomRepository.restore(this.#projects.read(ticket.project));
      if (!this.#isWorking(ticket) || signal.aborted) return;
      const current = ticket.evidence ? await RoomRepository.restore(this.#projects.read(this.#requiredCurrent(ticket.projectId))) : repository;
      if (!this.#isWorking(ticket) || signal.aborted) return;
      const context = ticket.evidence ? this.#evidence.reviewContext({ repository: current, readSet: ticket.evidence }) : undefined;
      if (ticket.request.sources) {
        this.#put(recordActivity(this.#get(ticket.id), { stage: 'inspecting', message: 'Preparing the attached reference files for the agent.' }));
        prepared = await this.#sources.prepare(ticket.projectId, ticket.request.sources, signal);
        if (!this.#isWorking(ticket) || signal.aborted) return;
      }
      const continuation = this.#db.prepare('SELECT request_id FROM request_continuations WHERE request_id=? AND ticket_id=?').get(ticket.request.requestId, ticket.id);
      const prior = continuation ? [...ticket.history].reverse().map(text => parseTicket(text, reference)).find(item => item.result?.status === 'ready' && isDeepStrictEqual(item.scope, ticket.scope)) : undefined;
      const privatePrior = prior?.state === 'completed' ? undefined : prior;
      const priorRepository = privatePrior?.result ? await RoomRepository.restore(this.#projects.read(privatePrior.result.project)) : null;
      const inherited = privatePrior && priorRepository ? this.#trustedGeometryEvidence(privatePrior, priorRepository) : undefined;
      const initialDraft = privatePrior && priorRepository ? repository.proposalSnapshot(priorRepository, privatePrior.request.proposalName, privatePrior.request.target) : undefined;
      const result = await prepareModelProposal(repository, ticket.request, trackedWorker, (event) => {
        if (this.#isWorking(ticket)) this.#put(recordActivity(this.#get(ticket.id), event));
      }, { signal, scripts: this.#scripts, conversation: this.#conversation(ticket.id),
        ...(this.#geometry ? { geometry: { source: this.#geometry, ...(inherited ? { inherited } : {}), current: async () => {
          const current = await RoomRepository.restore(this.#projects.read(this.#requiredCurrent(ticket.projectId)));
          signal.throwIfAborted();
          if (!this.#isWorking(ticket)) throw new GeometryEvidenceConflict('This request attempt was superseded.');
          return this.#geometryNative(ticket, current);
        } } } : {}),
        ...(context ? { evidenceContext: { ...context, entries: context.entries.map(item => item.entry) } } : {}),
        ...(initialDraft ? { initialDraft } : {}), ...(ticket.scope ? { scope: ticket.scope } : {}), ...(prepared ? { sourceInput: prepared } : {}), onPreview: snapshot => {
        if (snapshot === null) { clearDraft(); return; }
        const active = this.#attempts.get(ticket.id);
        if (signal.aborted || !this.#isWorking(ticket) || !active || active.requestId !== ticket.request.requestId || active.attempt !== ticket.attempts) return;
        this.#drafts.set(ticket.id, { ticketId: ticket.id, requestId: ticket.request.requestId,
          baseRevisionId: ticket.request.baseRevisionId, attempt: ticket.attempts, sequence: ++sequence, snapshot });
      }, onExecution: (record) => {
        try { this.#recordExecution(ticket, record); }
        catch (error) {
          evidenceError = error instanceof Error ? error : new Error('Execution evidence could not be saved.');
          this.#attempts.get(ticket.id)?.controller.abort();
          throw evidenceError;
        }
      } });
      if (evidenceError) throw evidenceError;
      if (inherited && result.status === 'ready' && result.review.geometryEvidence === undefined) throw new GeometryEvidenceConflict('Inherited geometry dependencies were not retained in the follow-up proposal.');
      if (!this.#isWorking(ticket)) return;
      let boundDocumentId: string | undefined;
      const saveResult = (): void => this.#transaction(() => {
      signal.throwIfAborted();
      if (!this.#isWorking(ticket)) throw new GeometryEvidenceConflict('This request attempt was superseded before binding.');
      if (boundDocumentId !== undefined && this.#requiredCurrent(ticket.projectId).documentId !== boundDocumentId) {
        throw new BacklogConflict('The accepted native model changed while binding geometry evidence. Revalidate the request.');
      }
      if (result.status === 'ready' && result.review.geometryEvidence !== undefined) {
        this.#db.prepare('INSERT INTO request_geometry_evidence(request_id,ticket_id,attempt,body) VALUES(?,?,?,?)')
          .run(ticket.request.requestId, ticket.id, ticket.attempts, result.review.geometryEvidence);
      }
      this.#put(recordActivity({ ...this.#get(ticket.id), state: result.status === 'ready' ? 'ready' : 'needs-input',
        error: null, updatedAt: Date.now(),
        result: { status: result.status, project: this.#projects.put(result.repository), review: result.review } },
        { stage: result.status === 'ready' ? 'ready' : 'needs-input', message: result.status === 'ready' ? 'Validated proposal is ready for your review. Nothing is accepted automatically.' : 'The agent needs clarification. Open the request to review its explanation.' }));
      this.#assistantMessage(this.#get(ticket.id), result.status === 'declined' ? result.clarification : undefined);
      });
      if (result.status === 'ready' && result.review.geometryEvidence !== undefined) {
        const source = this.#geometry;
        if (!source) throw new GeometryEvidenceConflict('Geometry verification is unavailable.');
        await publishWithGeometryGuard({ source, projectId: ticket.projectId, signal, commit: saveResult,
          validate: async () => {
            signal.throwIfAborted();
            const reference = this.#requiredCurrent(ticket.projectId);
            const current = await RoomRepository.restore(this.#projects.read(reference));
            const snapshot = await this.#validateGeometry(ticket, current, result.repository, signal);
            if (!snapshot) throw new GeometryEvidenceConflict('Required geometry receipts disappeared before proposal binding.');
            boundDocumentId = reference.documentId; return snapshot;
          } });
      } else saveResult();
      if (result.status === 'ready') await this.refreshProposal(ticket.id);
    } catch (error) {
      this.#attempts.get(ticket.id)?.controller.abort();
      if (!this.#isWorking(ticket)) return;
      const failure = evidenceError ?? error;
      this.#put(recordActivity({ ...this.#get(ticket.id), state: 'failed', error: failure instanceof Error ? failure.message.slice(0, 1000) : 'The agent could not finish this request.' }, { stage: 'failed', message: 'The agent could not complete this attempt. The accepted model is unchanged.' }));
    } finally {
      clearDraft(); signal.removeEventListener('abort', clearDraft);
      // Core drains script calls; retain the slot until provider cleanup also ends.
      if (work.task) await work.task.catch(() => {});
      await prepared?.dispose();
    }
  }
  async decide(id: string, input: unknown): Promise<{ ticket: TicketProjection; project: string }> {
    this.#assertOpen();
    if (!object(input) || Object.keys(input).length !== 3 || typeof input.action !== 'string') throw new Error('A decision requires action, decisionId and expectedRequestId.');
    const decisionId = identifier(input.decisionId);
    const expectedRequestId = identifier(input.expectedRequestId);
    const action = input.action;
    const ticket = this.#get(id);
    if (ticket.request.requestId !== expectedRequestId) throw new BacklogConflict('This ticket has a newer revision than the one you reviewed. Reopen it before deciding.');
    const expected = this.#requiredCurrent(ticket.projectId);
    const text = this.project(ticket.projectId);
    if (!text) throw new Error('The request project is missing.');
    if (ticket.decisionId === decisionId) {
      if (ticket.decisionAction !== action) throw new BacklogConflict('This decision identity was already used for another action.');
      return { ticket: this.#projection(ticket), project: text };
    }
    if (this.#conversation(id).sequence >= CONVERSATION_LIMITS.messages) throw new Error('This conversation reached its message limit.');
    if (action === 'retry') {
      if (ticket.state !== 'failed' || ticket.attempts >= 3) throw new BacklogConflict('Only failed work with fewer than three attempts can be retried.');
      const next = recordActivity({ ...ticket, state: 'queued', error: null, decisionId, decisionAction: action }, { stage: 'queued', message: 'Retry queued. Earlier attempt activity is retained.' });
      this.#transaction(() => { this.#put(next); this.#decisionMessage(next); }); setImmediate(() => this.#pump()); return { ticket: this.#projection(next), project: text };
    }
    if (action === 'cancel' || action === 'reject') {
      const allowed = action === 'cancel' ? ticket.state === 'queued' || ticket.state === 'working'
        : ticket.state === 'ready' || ticket.state === 'needs-input' || ticket.state === 'failed';
      if (!allowed) throw new BacklogConflict('This request can no longer receive that decision.');
      const next: Ticket = recordActivity({ ...ticket, state: action === 'cancel' ? 'cancelled' : 'rejected', decisionId, decisionAction: action }, { stage: action === 'cancel' ? 'cancelled' : 'rejected', message: action === 'cancel' ? 'Request cancelled. Late worker activity and results will be ignored.' : 'Proposal rejected. The accepted model is unchanged.' });
      this.#transaction(() => { this.#put(next); this.#decisionMessage(next); });
      const active = this.#attempts.get(id);
      if (action === 'cancel' && active?.requestId === ticket.request.requestId && active.attempt === ticket.attempts) active.controller.abort();
      return { ticket: this.#projection(next), project: text };
    }
    if (action !== 'accept' || (ticket.state !== 'ready' && ticket.state !== 'needs-input') || ticket.result?.status !== 'ready') throw new BacklogConflict('Only a ready proposal can be accepted.');
    const current = await RoomRepository.restore(text);
    const proposed = await RoomRepository.restore(this.#projects.read(ticket.result.project));
    this.#assertOpen();
    if (!isDeepStrictEqual(ticket.scope, proposed.review(ticket.request.proposalName).scope)) throw new BacklogConflict('The reviewed scope differs from the submitted scope. Reopen the request before deciding.');
    const readiness = this.#proposalReadiness(ticket, current, proposed);
    if (readiness.state === 'needs-input') throw new BacklogConflict(readiness.error);
    const candidate = await current.acceptFrom(proposed, ticket.request.proposalName, { decisionId, actor: 'preview-human' }, ticket.request.target);
    const accepted = await RoomRepository.restore(candidate.serialize());
    const acceptedText = accepted.serialize();
    const next: Ticket = recordActivity({ ...ticket, state: 'completed', decisionId, decisionAction: action }, { stage: 'completed', message: 'Proposal explicitly accepted and saved as the current model.' });
    const assessments: { before: Ticket; after: Ticket }[] = [];
    for (const other of this.#all(ticket.projectId)) {
      if (other.id === ticket.id || (other.state !== 'ready' && other.state !== 'needs-input') || other.result?.status !== 'ready') continue;
      const otherProposal = await RoomRepository.restore(this.#projects.read(other.result.project));
      const controller = new AbortController(); this.#geometryDecisions.add(controller);
      try { assessments.push({ before: other, after: assessedTicket(other, await this.#geometryReadiness(other, accepted, otherProposal, controller.signal)) }); }
      finally { this.#geometryDecisions.delete(controller); }
    }
    this.#assertOpen();
    let geometryProof: Awaited<ReturnType<typeof validateGeometryEvidence>> | undefined;
    const commit = (): void => this.#transaction(() => {
      // Async validation above may have overlapped another decision.
      const latest = this.#get(id);
      if (latest.decisionId === decisionId && latest.decisionAction === action) return;
      if (this.#requiredCurrent(ticket.projectId).documentId !== expected.documentId || JSON.stringify(latest) !== JSON.stringify(ticket)) throw new BacklogConflict('The model or ticket changed while reviewing. Refresh before deciding.');
      const finalReadiness = this.#proposalReadiness(ticket, current, proposed);
      if (finalReadiness.state === 'needs-input') throw new BacklogConflict(finalReadiness.error);
      this.#projects.publish({ projectId: ticket.projectId, expectedDocumentId: expected.documentId,
        reference: this.#projects.put(accepted), origin: 'accepted', requestId: ticket.request.requestId, decisionId,
        ...(ticket.request.target ? { target: ticket.request.target.target,
          expectedTargetRevisionId: current.freezeDesignTarget(ticket.request.target.target).revisionId } : {}) });
      if (geometryProof) this.#db.prepare('INSERT INTO request_geometry_acceptances(decision_id,request_id,ticket_id,body) VALUES(?,?,?,?)')
        .run(decisionId, ticket.request.requestId, ticket.id, JSON.stringify({ version: 1, catalogToken: geometryProof.catalogToken,
          verifiedCandidateSha256: geometryProof.verifiedCandidateSha256, finalReceipts: geometryProof.finalReceipts,
          finalMeasurements: geometryProof.finalMeasurements }));
      this.#put(next);
      this.#decisionMessage(next);
      for (const assessment of assessments) {
        if (assessment.after !== assessment.before && JSON.stringify(this.#get(assessment.before.id)) === JSON.stringify(assessment.before)) this.#put(assessment.after);
      }
    });
    const geometryEvidence = proposed.review(ticket.request.proposalName).geometryEvidence;
    if (geometryEvidence !== undefined) {
      const source = this.#geometry;
      if (!source) throw new BacklogConflict('Geometry verification is unavailable.');
      const controller = new AbortController();
      this.#geometryDecisions.add(controller);
      try {
        await publishWithGeometryGuard({ source, projectId: ticket.projectId, signal: controller.signal, commit,
          validate: async () => {
            this.#assertOpen();
            const readiness = this.#proposalReadiness(ticket, current, proposed);
            if (readiness.state !== 'ready') throw new BacklogConflict(readiness.error);
            const snapshot = await this.#validateGeometry(ticket, current, proposed, controller.signal);
            if (!snapshot) throw new GeometryEvidenceConflict('Required geometry receipts disappeared.');
            geometryProof = snapshot;
            return snapshot;
          } });
      } catch (error) {
        throw error instanceof BacklogConflict ? error : new BacklogConflict(error instanceof Error ? error.message : 'Geometry acceptance verification failed.');
      } finally { this.#geometryDecisions.delete(controller); }
    } else commit();
    return { ticket: this.get(id), project: this.project(ticket.projectId) ?? acceptedText };
  }
  #assertOpen(): void { if (this.#closed) throw new Error('The change request queue is closed.'); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controller of this.#geometryDecisions) controller.abort();
    this.#drafts.clear();
    if (this.#timer) clearInterval(this.#timer);
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
