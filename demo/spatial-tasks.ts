import { parseFrozenDesignTarget } from '../src/design-targets.ts';
import type { FrozenDesignTarget } from '../src/design-targets.ts';
import { MAX_EVIDENCE_PINS, parseEvidencePin } from '../src/model-evidence.ts';
import type { EvidencePin } from '../src/model-evidence.ts';
import { identifier } from '../src/room-model.ts';
import type { FrozenModelScope, ScopedRequest } from '../src/model-scope-contract.ts';
import { parseConversationReply, parseRequestConversation } from '../src/request-conversation.ts';
import type { ConversationReply, RequestConversation } from '../src/request-conversation.ts';
import { parseRequestDraft } from '../src/request-draft.ts';
import type { RequestState } from './change-requests.ts';
import { parseSourceContext } from './request-source-ui.ts';
import type { RequestSourceContext } from './request-source-ui.ts';
import { requestScopeContext, reviewScopeContext } from './model-scope-client.ts';
import type { RequestSource } from '../src/request-sources.ts';
import type { validateModelProposalRequest } from '../src/model-proposal.ts';
import { matchingProposalReview } from './request-chat-status.ts';
import type { RequestChatProposalReview } from './request-chat-status.ts';

type SubmissionRequest = Pick<ReturnType<typeof validateModelProposalRequest>, 'proposalName' | 'baseRevisionId' | 'instruction' | 'target'>
  & { selectedObjectIds: readonly string[]; visualIntent: unknown; scope?: ScopedRequest; authoringScope?: string; sources?: readonly RequestSource[]; evidencePins?: readonly EvidencePin[]; conversationVisual?: ConversationReply['visual'] };
export interface TaskSubmission { project: string; request: SubmissionRequest }
export interface TaskGeneration { readonly project: number; readonly task: number }
export interface TaskProjection<Draft> {
  readonly projectId: string | null;
  readonly ticketId: string | null;
  readonly draftId: string;
  readonly tickets: readonly Readonly<BacklogItem>[];
  readonly conversation: RequestConversation | null;
  readonly inspection: RequestChatProposalReview | null;
  readonly offline: boolean;
  readonly drafts: ReadonlyMap<string, Draft>;
}
export class StaleTaskResponse extends Error {
  constructor() { super('The workspace changed while this response arrived. Reopen the task to inspect the saved result.'); }
}

/** Owns task I/O and local drafts. The server remains the only queue and decision authority. */
export class SpatialTasks<Draft> {
  readonly #fetch: typeof fetch;
  readonly #retain: (projectId: string, sources: readonly RequestSource[]) => Promise<void>;
  readonly #drafts = new Map<string, Draft>();
  readonly #scopes = new Map<string, { projectId: string; scope: FrozenModelScope }>();
  readonly #pending = new Map<string, { path: string; body: string; signature: string; sources: readonly RequestSource[] }>();
  readonly #observers = new Set<(projection: TaskProjection<Draft>) => void>();
  readonly #reading = new Set<string>();
  #projectId: string | null = null;
  #ticketId: string | null = null;
  #draftId = 'new';
  #tickets: BacklogItem[] = [];
  #conversation: RequestConversation | null = null;
  #inspection: RequestChatProposalReview | null = null;
  #projection: TaskProjection<Draft> | null = null;
  #offline = false;
  #projectGeneration = 0;
  #taskGeneration = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: { fetch?: typeof fetch; retainSources?: (projectId: string, sources: readonly RequestSource[]) => Promise<void> } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#retain = options.retainSources ?? (async () => {});
  }
  get projection(): TaskProjection<Draft> {
    this.#projection ??= Object.freeze({ projectId: this.#projectId, ticketId: this.#ticketId, draftId: this.#draftId,
      tickets: Object.freeze([...this.#tickets]), conversation: this.#conversation, inspection: this.#inspection,
      offline: this.#offline, drafts: new Map(this.#drafts) });
    return this.#projection;
  }
  get key(): string { return `${this.#projectId ?? 'none'}:${this.#ticketId ?? this.#draftId}`; }
  get generation(): TaskGeneration { return { project: this.#projectGeneration, task: this.#taskGeneration }; }
  isCurrent(generation: TaskGeneration, projectOnly = false): boolean {
    return generation.project === this.#projectGeneration && (projectOnly || generation.task === this.#taskGeneration);
  }
  requireCurrent(generation: TaskGeneration, projectOnly = false): void {
    if (!this.isCurrent(generation, projectOnly)) throw new StaleTaskResponse();
  }
  observeWorkspace(observer: (projection: TaskProjection<Draft>) => void): () => void {
    this.#observers.add(observer); observer(this.projection); return () => this.#observers.delete(observer);
  }
  #emit(): void { this.#projection = null; for (const observer of this.#observers) observer(this.projection); }
  setProject(projectId: string | null): void {
    if (projectId === this.#projectId) return;
    this.#projectId = projectId; this.#projectGeneration += 1; this.#taskGeneration += 1;
    this.#ticketId = null; this.#draftId = 'new'; this.#tickets = []; this.#conversation = null; this.#inspection = null; this.#offline = false; this.#scopes.clear(); this.#emit();
  }
  selectTask(ticketId: string | null): void {
    if (ticketId === this.#ticketId) return;
    this.#ticketId = ticketId; this.#taskGeneration += 1; this.#conversation = null; this.#inspection = null; this.#offline = false; this.#emit();
  }
  startTask(draftId = `draft-${globalThis.crypto.randomUUID()}`): void {
    this.#draftId = draftId; this.#ticketId = null; this.#taskGeneration += 1; this.#conversation = null; this.#inspection = null; this.#offline = false; this.#emit();
  }
  saveDraft(key: string, draft: Draft): void { this.#drafts.set(key, draft); this.#emit(); }
  deleteDraft(key: string): void { this.#drafts.delete(key); this.#emit(); }
  getDraft(key: string): Draft | undefined { return this.#drafts.get(key); }
  parseTicket(value: unknown): BacklogItem { return freezeData(parseBacklogItem(value, this.#scopes)); }
  updateTicket(ticket: BacklogItem): void {
    if (ticket.projectId !== this.#projectId) throw new Error('Task project mismatch.');
    this.#tickets = [...this.#tickets.filter(item => item.id !== ticket.id), ticket]; this.#emit();
  }
  setOffline(offline: boolean): void { this.#offline = offline; this.#emit(); }
  receiveTask(value: unknown): void {
    const ticket = this.parseTicket(value); const conversation = conversationFromTicket(value);
    if (ticket.projectId !== this.#projectId || conversation.ticketId !== ticket.id) throw new Error('Conversation project or ticket mismatch.');
    this.selectTask(ticket.id); this.#conversation = freezeData(conversation); this.#offline = false;
    this.updateTicket(ticket);
  }
  inspectProposal(view: RequestChatProposalReview | null): void {
    if (view) {
      const message = this.#conversation?.messages.find(item => item.id === view.messageId);
      if (!message || !matchingProposalReview(message, view)) throw new Error('Inspect this exact task proposal before deciding.');
    }
    this.#inspection = view ? freezeData({ ...view }) : null; this.#emit();
  }
  #record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new Error('Missing task response.');
    return value;
  }
  async #json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.#fetch(path, init);
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error(`The request service returned unreadable data (HTTP ${response.status}). Retry the same submission safely.`); }
    if (!response.ok) {
      const message = isRecord(value) && typeof value.error === 'string' ? value.error : `Request service failed (HTTP ${response.status}).`;
      if (response.status === 409) throw new TaskConflict(message);
      throw new Error(message);
    }
    return value;
  }
  async readTask(ticketId: string): Promise<Record<string, unknown>> {
    const generation = this.generation;
    const value = this.#record(await this.#json(`/api/change-requests/${encodeURIComponent(ticketId)}`));
    this.requireCurrent(generation);
    const ticket = this.parseTicket(value.ticket);
    if (ticket.id !== ticketId || ticket.projectId !== this.#projectId) throw new Error('Task identity mismatch.');
    this.updateTicket(ticket);
    if (this.#ticketId === ticketId) this.receiveTask(value.ticket);
    return value;
  }
  async openTask(ticketId: string): Promise<Record<string, unknown>> { this.selectTask(ticketId); return this.readTask(ticketId); }
  async readDraft(ticketId: string) {
    const generation = this.generation;
    const value = this.#record(await this.#json(`/api/change-requests/${encodeURIComponent(ticketId)}/draft`));
    this.requireCurrent(generation);
    if (!Object.hasOwn(value, 'draft')) throw new Error('Invalid live draft response.');
    return parseRequestDraft(value.draft);
  }
  async refresh(): Promise<{ tickets: readonly BacklogItem[]; project: string | null }> {
    const generation = this.generation; const projectId = this.#projectId;
    if (!projectId) throw new Error('Open a project first.');
    const value = this.#record(await this.#json(`/api/projects/${encodeURIComponent(projectId)}/change-requests`));
    this.requireCurrent(generation, true);
    if (!Array.isArray(value.tickets) || (value.project !== null && typeof value.project !== 'string')) throw new Error('Invalid project backlog.');
    const tickets = value.tickets.map(item => this.parseTicket(item));
    if (tickets.some(item => item.projectId !== projectId)) throw new Error('Backlog contains a different project.');
    this.#tickets = tickets; this.#emit(); return { tickets, project: value.project };
  }
  async #send(key: string, signature: string, initial: () => { path: string; body: string; sources: readonly RequestSource[] }): Promise<Record<string, unknown>> {
    const generation = this.generation; const projectId = this.#projectId;
    if (!projectId) throw new Error('Open a project before sending.');
    const envelope = this.#pending.get(key) ?? { ...initial(), signature }; this.#pending.set(key, envelope);
    await this.#retain(projectId, envelope.sources);
    this.requireCurrent(generation);
    let value: Record<string, unknown>;
    try { value = this.#record(await this.#json(envelope.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: envelope.body })); }
    catch (error) { if (error instanceof TaskConflict) this.#pending.delete(key); throw error; }
    const ticket = this.parseTicket(value.ticket);
    if (ticket.projectId !== projectId) throw new Error('Submission acknowledgement project mismatch.');
    const preserveDraft = envelope.signature !== signature;
    this.#pending.delete(key);
    this.requireCurrent(generation);
    if (!preserveDraft) this.#drafts.delete(key);
    this.selectTask(ticket.id); this.updateTicket(ticket);
    this.receiveTask(value.ticket); return { ...value, preserveDraft };
  }
  async submit(content: TaskSubmission): Promise<Record<string, unknown>> {
    const { baseRevisionId: _base, target: _target, ...intent } = content.request;
    return this.#send(this.key, JSON.stringify(intent), () => ({ path: '/api/change-requests', sources: content.request.sources ?? [],
      body: JSON.stringify({ ...content, request: { ...content.request, requestId: globalThis.crypto.randomUUID() } }) }));
  }
  async append(content: Omit<ConversationReply, 'messageId' | 'sources' | 'evidencePins' | 'scope'> & { sources: readonly RequestSource[]; evidencePins?: readonly EvidencePin[] }): Promise<Record<string, unknown>> {
    const ticketId = this.#ticketId;
    if (!ticketId) throw new Error('Open the conversation before replying.');
    const { expectedSequence: _sequence, baseRevisionId: _base, ...intent } = content;
    return this.#send(this.key, JSON.stringify(intent), () => {
      const body = parseConversationReply({ ...content, messageId: globalThis.crypto.randomUUID() });
      return { path: `/api/change-requests/${encodeURIComponent(ticketId)}/messages`, body: JSON.stringify(body), sources: body.sources };
    });
  }
  async decide(input: { ticketId: string; action: string; expectedRequestId: string }): Promise<Record<string, unknown>> {
    const generation = this.generation;
    const value = this.#record(await this.#json(`/api/change-requests/${encodeURIComponent(input.ticketId)}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: input.action, expectedRequestId: input.expectedRequestId, decisionId: globalThis.crypto.randomUUID() }),
    }));
    this.requireCurrent(generation);
    if (typeof value.project !== 'string') throw new Error('Missing accepted server project.');
    return value;
  }
  async poll(kind: 'backlog' | 'conversation' | 'activity', update: () => Promise<void>): Promise<void> {
    const key = `${this.#projectGeneration}:${this.#taskGeneration}:${kind}`;
    if (this.#reading.has(key)) return;
    this.#reading.add(key);
    try { await update(); } finally { this.#reading.delete(key); }
  }
  startPolling(update: () => void, milliseconds = 2000): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = setInterval(update, milliseconds);
  }
  dispose(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null; this.#projectGeneration += 1; this.#taskGeneration += 1; this.#observers.clear();
  }
}
export class TaskConflict extends Error {}

function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw new Error(`Missing request ${field}.`);
  return value;
}
function conversationFromTicket(value: unknown): RequestConversation {
  if (!isRecord(value)) throw new Error('Missing conversation.');
  return parseRequestConversation(value.conversation);
}
export interface BacklogItem {
  id: string; projectId: string; title: string; state: RequestState; createdAt: number; updatedAt: number; attempts: number; error: string | null;
  request: { requestId: string; proposalName: string; instruction: string; baseRevisionId: string; target?: FrozenDesignTarget; evidencePins?: readonly EvidencePin[]; selectedObjectIds: readonly string[]; scope?: ScopedRequest } & RequestSourceContext;
  scope?: FrozenModelScope;
}
function parseBacklogItem(value: unknown, ticketScopes: Map<string, { projectId: string; scope: FrozenModelScope }>): BacklogItem {
  if (!isRecord(value) || !isRecord(value.request) || typeof value.id !== 'string' || typeof value.projectId !== 'string'
      || typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number' || typeof value.attempts !== 'number' || (value.error !== null && typeof value.error !== 'string')) throw new Error('Invalid backlog item.');
  const state = value.state;
  if (state !== 'queued' && state !== 'working' && state !== 'needs-input' && state !== 'ready'
      && state !== 'completed' && state !== 'rejected' && state !== 'cancelled' && state !== 'failed') throw new Error('Invalid backlog state.');
  const requestId = requiredText(value.request, 'requestId');
  const baseRevisionId = requiredText(value.request, 'baseRevisionId');
  const target = Object.hasOwn(value.request, 'target') ? parseFrozenDesignTarget(value.request.target) : null;
  if (target && (target.projectId !== value.projectId || target.revisionId !== baseRevisionId)) throw new Error('Request design target does not match its project and base.');
  let evidencePins: EvidencePin[] | undefined;
  if (Object.hasOwn(value.request, 'evidencePins')) {
    if (!Array.isArray(value.request.evidencePins) || value.request.evidencePins.length > MAX_EVIDENCE_PINS) throw new Error('Invalid request evidence selection.');
    evidencePins = value.request.evidencePins.map(parseEvidencePin);
    if (new Set(evidencePins.map(pin => pin.entryId)).size !== evidencePins.length) throw new Error('Duplicate request evidence selection.');
  }
  if (!Array.isArray(value.request.selectedObjectIds) || value.request.selectedObjectIds.length > 100) throw new Error('Invalid saved request selection.');
  const selectedObjectIds = value.request.selectedObjectIds.map(identifier);
  const requestScope = requestScopeContext(value.request);
  const frozen = reviewScopeContext(value).scope ?? (isRecord(value.result) && isRecord(value.result.review) ? reviewScopeContext(value.result.review).scope : undefined);
  if (frozen) {
    if (frozen.baseRevisionId !== baseRevisionId || !requestScope.scope || JSON.stringify(frozen.query) !== JSON.stringify(requestScope.scope.query)) throw new Error('Frozen scope does not match this request binding.');
    ticketScopes.set(requestId, { projectId: value.projectId, scope: frozen });
  }
  const cached = ticketScopes.get(requestId);
  const scope = cached?.projectId === value.projectId && cached.scope.baseRevisionId === baseRevisionId
    && requestScope.scope && JSON.stringify(cached.scope.query) === JSON.stringify(requestScope.scope.query) ? cached.scope : undefined;
  const first = typeof value.title === 'string' ? value.title : Object.hasOwn(value, 'conversation') ? conversationFromTicket(value).messages.find(message => message.kind === 'user')?.text ?? '' : requiredText(value.request, 'instruction');
  if (!first.trim() || first.length > 1000) throw new Error('Invalid chat title.');
  return { id: value.id, projectId: value.projectId, title: first.replace(/\s+/g, ' ').trim().slice(0, 80), state, createdAt: value.createdAt, updatedAt: value.updatedAt, attempts: value.attempts, error: value.error,
    ...(scope ? { scope } : {}),
    request: { requestId, proposalName: requiredText(value.request, 'proposalName'), instruction: requiredText(value.request, 'instruction'), baseRevisionId,
      ...(target ? { target } : {}), ...(evidencePins ? { evidencePins } : {}), selectedObjectIds, ...parseSourceContext(value.request), ...requestScope } };
}
