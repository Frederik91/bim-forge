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
export interface TaskAcknowledgement { readonly ticket: BacklogItem; readonly preserveDraft: boolean }
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
  readonly #responseOrders = new WeakMap<object, { project: number; order: number }>();
  readonly #appliedOrders = new Map<string, number>();
  readonly #summaryOrders = new Map<string, number>();
  readonly #conversationBindings = new Map<string, { sequence: number; requestId: string }>();
  #responseOrder = 0;
  #projectSnapshot: { order: number; project: string | null } | null = null;
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
    this.#ticketId = null; this.#draftId = 'new'; this.#tickets = []; this.#conversation = null; this.#inspection = null; this.#offline = false;
    this.#scopes.clear(); this.#appliedOrders.clear(); this.#summaryOrders.clear(); this.#conversationBindings.clear(); this.#projectSnapshot = null; this.#emit();
  }
  #selectTask(ticketId: string | null): boolean {
    if (ticketId === this.#ticketId) return false;
    this.#ticketId = ticketId; this.#taskGeneration += 1; this.#conversation = null; this.#inspection = null; this.#offline = false; return true;
  }
  selectTask(ticketId: string | null): void { if (this.#selectTask(ticketId)) this.#emit(); }
  startTask(draftId = `draft-${globalThis.crypto.randomUUID()}`): void {
    this.#draftId = draftId; this.#ticketId = null; this.#taskGeneration += 1; this.#conversation = null; this.#inspection = null; this.#offline = false; this.#emit();
  }
  saveDraft(key: string, draft: Draft): void { this.#drafts.set(key, draft); this.#emit(); }
  deleteDraft(key: string): void { this.#drafts.delete(key); this.#emit(); }
  getDraft(key: string): Draft | undefined { return this.#drafts.get(key); }
  #stamp(value: object, order = ++this.#responseOrder): void {
    this.#responseOrders.set(value, { project: this.#projectGeneration, order });
  }
  #requireOrder(ticketId: string, order: number): void {
    if (order < (this.#appliedOrders.get(ticketId) ?? 0)) throw new StaleTaskResponse();
  }
  parseTicket(value: unknown): BacklogItem {
    const ticket = freezeData(parseBacklogItem(value, this.#scopes));
    const source = isRecord(value) ? this.#responseOrders.get(value) : undefined;
    if (source) this.#responseOrders.set(ticket, source);
    return ticket;
  }
  #storeTicket(ticket: BacklogItem): void {
    if (ticket.projectId !== this.#projectId) throw new Error('Task project mismatch.');
    if (!this.#responseOrders.has(ticket)) this.#stamp(ticket);
    const source = this.#responseOrders.get(ticket);
    if (!source || source.project !== this.#projectGeneration) throw new StaleTaskResponse();
    const known = this.#conversationBindings.get(ticket.id);
    const current = this.#tickets.find(item => item.id === ticket.id);
    if (!known && source && source.order < (this.#summaryOrders.get(ticket.id) ?? 0) && current?.request.requestId !== ticket.request.requestId) throw new StaleTaskResponse();
    if (known && ticket.request.requestId !== known.requestId) throw new StaleTaskResponse();
    this.#requireOrder(ticket.id, source.order); this.#appliedOrders.set(ticket.id, source.order);
    this.#tickets = [...this.#tickets.filter(item => item.id !== ticket.id), ticket];
  }
  updateTicket(ticket: BacklogItem): void { this.#storeTicket(ticket); this.#emit(); }
  setOffline(offline: boolean): void { this.#offline = offline; this.#emit(); }
  #confirmDetail(value: unknown): { ticket: BacklogItem; conversation: RequestConversation } {
    const ticket = this.parseTicket(value); const conversation = conversationFromTicket(value);
    if (ticket.projectId !== this.#projectId || conversation.ticketId !== ticket.id) throw new Error('Conversation project or ticket mismatch.');
    const source = this.#responseOrders.get(ticket);
    if (source && source.project !== this.#projectGeneration) throw new StaleTaskResponse();
    const known = this.#conversationBindings.get(ticket.id);
    const current = this.#tickets.find(item => item.id === ticket.id);
    if (!known && source && source.order < (this.#summaryOrders.get(ticket.id) ?? 0) && current?.request.requestId !== ticket.request.requestId) throw new StaleTaskResponse();
    if (conversation.messages.findLast(message => message.kind === 'user')?.requestId !== ticket.request.requestId) throw new Error('Conversation turn differs from its request binding.');
    if (known && (conversation.sequence < known.sequence || conversation.sequence === known.sequence && ticket.request.requestId !== known.requestId)) throw new StaleTaskResponse();
    if (!source && isRecord(value)) { this.#stamp(value); this.#stamp(ticket, this.#responseOrder); }
    // Transcript sequence proves a newer turn even when request dispatch order disagrees.
    if (source && source.order < (this.#appliedOrders.get(ticket.id) ?? 0)) {
      if (conversation.sequence <= (known?.sequence ?? 0)) throw new StaleTaskResponse();
      if (isRecord(value)) this.#stamp(value);
      this.#stamp(ticket, this.#responseOrder);
    }
    this.#conversationBindings.set(ticket.id, { sequence: conversation.sequence, requestId: ticket.request.requestId });
    this.#storeTicket(ticket); return { ticket, conversation };
  }
  #receiveTask(value: unknown): void {
    const previous = this.#tickets.find(ticket => ticket.id === this.#ticketId);
    const { ticket, conversation } = this.#confirmDetail(value);
    if (previous?.id === ticket.id && lifecycleChanged(previous, ticket)) this.#inspection = null;
    this.#selectTask(ticket.id); this.#conversation = freezeData(conversation); this.#offline = false;
  }
  receiveTask(value: unknown): void { this.#receiveTask(value); this.#emit(); }
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
    const generation = this.generation; const order = ++this.#responseOrder;
    const value = this.#record(await this.#json(`/api/change-requests/${encodeURIComponent(ticketId)}`));
    this.requireCurrent(generation);
    if (!isRecord(value.ticket) || value.ticket.id !== ticketId) throw new Error('Task identity mismatch.');
    if (isRecord(value.ticket)) this.#stamp(value.ticket, order);
    if (this.#ticketId === ticketId) this.receiveTask(value.ticket);
    else { this.#confirmDetail(value.ticket); this.#emit(); }
    return value;
  }
  async openTask(ticketId: string): Promise<Record<string, unknown>> { this.selectTask(ticketId); return this.readTask(ticketId); }
  async readDraft(ticketId: string) {
    const generation = this.generation; const order = ++this.#responseOrder;
    const value = this.#record(await this.#json(`/api/change-requests/${encodeURIComponent(ticketId)}/draft`));
    this.requireCurrent(generation); this.#requireOrder(ticketId, order);
    if (!Object.hasOwn(value, 'draft')) throw new Error('Invalid live draft response.');
    return parseRequestDraft(value.draft);
  }
  async refresh(): Promise<{ tickets: readonly BacklogItem[]; project: string | null }> {
    const generation = this.generation; const projectId = this.#projectId; const order = ++this.#responseOrder;
    if (!projectId) throw new Error('Open a project first.');
    const value = this.#record(await this.#json(`/api/projects/${encodeURIComponent(projectId)}/change-requests`));
    this.requireCurrent(generation, true);
    if (!Array.isArray(value.tickets) || (value.project !== null && typeof value.project !== 'string')) throw new Error('Invalid project backlog.');
    const tickets = value.tickets.map(item => { if (isRecord(item)) this.#stamp(item, order); return this.parseTicket(item); });
    if (tickets.some(item => item.projectId !== projectId)) throw new Error('Backlog contains a different project.');
    // Summaries have no transcript sequence, so changed known tasks require a detail read.
    for (const ticket of tickets) {
      const current = this.#tickets.find(item => item.id === ticket.id);
      if (current && this.#conversationBindings.has(ticket.id) && lifecycleChanged(current, ticket) && order >= (this.#appliedOrders.get(ticket.id) ?? 0)) {
        try { await this.readTask(ticket.id); } catch (error) { if (!(error instanceof StaleTaskResponse)) throw error; }
      }
    }
    this.requireCurrent(generation, true);
    const remaining = new Map(this.#tickets.map(ticket => [ticket.id, ticket]));
    const merged: BacklogItem[] = [];
    for (const ticket of tickets) {
      const current = remaining.get(ticket.id); remaining.delete(ticket.id);
      if (Math.max(this.#appliedOrders.get(ticket.id) ?? 0, this.#summaryOrders.get(ticket.id) ?? 0) > order || current && this.#conversationBindings.has(ticket.id) && lifecycleChanged(current, ticket)) { if (current) merged.push(current); }
      else { merged.push(ticket); this.#summaryOrders.set(ticket.id, order); }
    }
    for (const ticket of remaining.values()) {
      if (Math.max(this.#appliedOrders.get(ticket.id) ?? 0, this.#summaryOrders.get(ticket.id) ?? 0) > order) merged.push(ticket);
      else this.#summaryOrders.set(ticket.id, order);
    }
    this.#tickets = merged;
    if (!this.#projectSnapshot || order >= this.#projectSnapshot.order) this.#projectSnapshot = { order, project: value.project };
    this.#emit(); return { tickets: [...this.#tickets], project: this.#projectSnapshot.project };
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
    this.requireCurrent(generation);
    const order = ++this.#responseOrder;
    if (isRecord(value.ticket)) this.#stamp(value.ticket, order);
    this.#stamp(ticket, order);
    if (isRecord(value.ticket) && Object.hasOwn(value.ticket, 'conversation')) this.#receiveTask(value.ticket);
    else { this.#storeTicket(ticket); this.#selectTask(ticket.id); }
    this.#pending.delete(key); if (!preserveDraft) this.#drafts.delete(key); this.#emit();
    return { ...value, preserveDraft };
  }
  async submit(content: TaskSubmission): Promise<TaskAcknowledgement> {
    const { baseRevisionId: _base, target: _target, ...intent } = content.request;
    const value = await this.#send(this.key, JSON.stringify(intent), () => ({ path: '/api/change-requests', sources: content.request.sources ?? [],
      body: JSON.stringify({ ...content, request: { ...content.request, requestId: globalThis.crypto.randomUUID() } }) }));
    return { ticket: this.parseTicket(value.ticket), preserveDraft: value.preserveDraft === true };
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
    const order = ++this.#responseOrder;
    if (isRecord(value.ticket)) {
      this.#stamp(value.ticket, order);
      if (Object.hasOwn(value.ticket, 'conversation')) {
        if (this.#ticketId === input.ticketId) this.#receiveTask(value.ticket); else this.#confirmDetail(value.ticket);
      }
    }
    this.#appliedOrders.set(input.ticketId, Math.max(order, this.#appliedOrders.get(input.ticketId) ?? 0));
    this.#projectSnapshot = { order, project: value.project };
    if (this.#ticketId === input.ticketId) this.#inspection = null;
    this.#emit();
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
function lifecycleChanged(previous: BacklogItem, next: BacklogItem): boolean {
  return previous.request.requestId !== next.request.requestId || previous.state !== next.state
    || previous.attempts !== next.attempts || previous.error !== next.error;
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
