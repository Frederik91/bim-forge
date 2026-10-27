import { CONVERSATION_LIMITS, parseRequestConversation } from '../src/request-conversation.ts';
import type { ConversationMessage, ConversationVisual, RequestConversation } from '../src/request-conversation.ts';
import { ACTIVITY_STAGES } from '../src/request-activity.ts';
import type { RequestActivity } from '../src/request-activity.ts';
import type { RequestState } from './change-requests.ts';
import { renderSourceContext } from './request-source-ui.ts';
import { visualLabel } from './request-chat-evidence.ts';
import { anchoredChatScrollTop, canDecideProposal, chatDomKey, chatRequestStatus, groupTurnActivity, matchingProposalReview, shouldFollowChat, visibleChatAnchor } from './request-chat-status.ts';
import type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';
export type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text;
  if (className) result.className = className; return result;
}

export function conversationFromTicket(ticket: unknown): RequestConversation {
  if (!ticket || typeof ticket !== 'object' || !('conversation' in ticket)) throw new Error('This server does not provide request conversations. Reconnect before replying.');
  return parseRequestConversation(ticket.conversation);
}

export interface RequestChatActions {
  answer: (text: string) => void; proposal: (message: ConversationMessage) => void;
  inspect: (visual: ConversationVisual) => void;
  decision: (action: RequestChatDecision, messageId: string) => void;
  delta: (messageId: string) => void;
}

export interface RequestChatInput {
  conversation: RequestConversation;
  projectId: string;
  title: string;
  state: string;
  requestState: RequestState;
  /** Validated, deduplicated current and archived activity supplied by the parent. */
  activity: readonly RequestActivity[];
}

export class RequestChat {
  readonly #host: HTMLElement;
  readonly #actions: RequestChatActions;
  #conversation: RequestConversation | null = null;
  #projectId = '';
  #title = '';
  #state = '';
  #requestState: RequestState = 'queued';
  #activity: readonly RequestActivity[] = [];
  #review: RequestChatProposalReview | null = null;
  #offline = false;
  #disabled = false;
  #signature = '';
  #renderedConversationKey: string | null = null;
  #following = true;
  #pendingBottomFollow = false;
  readonly #resizeObserver: ResizeObserver;

  constructor(host: HTMLElement, actions: RequestChatActions) {
    this.#host = host; this.#actions = actions;
    this.#resizeObserver = new ResizeObserver(() => this.#finishBottomFollow());
    this.#resizeObserver.observe(host);
    host.addEventListener('scroll', () => {
      if (!host.clientHeight) return;
      this.#following = this.#atBottom();
      if (!this.#following) this.#pendingBottomFollow = false;
    });
    this.#render();
  }

  get conversation(): RequestConversation | null { return this.#conversation; }
  show(input: RequestChatInput): void {
    const previousRequestId = this.#conversation?.messages.findLast(message => message.kind === 'user')?.requestId;
    const nextRequestId = input.conversation.messages.findLast(message => message.kind === 'user')?.requestId;
    if (this.#conversation?.ticketId !== input.conversation.ticketId || this.#projectId !== input.projectId || previousRequestId !== nextRequestId) this.#review = null;
    this.#conversation = input.conversation; this.#projectId = input.projectId; this.#title = input.title; this.#state = input.state;
    this.#requestState = input.requestState; this.#activity = input.activity; this.#render();
  }
  close(): void { this.#conversation = null; this.#review = null; this.#activity = []; this.#render(); }
  setOffline(offline: boolean): void { this.#offline = offline; this.#render(); }
  setProposalReview(view: RequestChatProposalReview | null): void { this.#review = view; this.#render(); }
  setDisabled(disabled: boolean): void {
    this.#disabled = disabled;
    for (const button of this.#host.querySelectorAll('button')) button.disabled = disabled || this.#offline;
  }

  #control(text: string, action: () => void, key = text): HTMLButtonElement {
    const button = node('button', text, 'button outline'); button.type = 'button';
    button.dataset.focusKey = key;
    button.addEventListener('click', () => { if (!button.disabled && !this.#disabled && !this.#offline) action(); });
    return button;
  }

  #atBottom(): boolean { return this.#host.scrollHeight - this.#host.clientHeight - this.#host.scrollTop <= 24; }

  #finishBottomFollow(): void {
    if (!this.#pendingBottomFollow || !this.#host.clientHeight) return;
    this.#pendingBottomFollow = false;
    this.#host.scrollTop = this.#host.scrollHeight;
  }

  #messageElements(): HTMLLIElement[] {
    return Array.from(this.#host.querySelectorAll('li')).filter(item => item.dataset.messageId !== undefined);
  }

  #keyMessage(item: HTMLElement, messageId: string): void {
    Array.from(item.querySelectorAll('details')).forEach((details, index) => {
      details.dataset.detailKey ??= chatDomKey(messageId, 'detail', index);
      const summary = details.querySelector('summary');
      if (summary) summary.dataset.focusKey = `summary:${details.dataset.detailKey}`;
    });
    Array.from(item.querySelectorAll('button, a, summary')).forEach((control, index) => {
      if (control instanceof HTMLElement) control.dataset.focusKey = chatDomKey(messageId, 'control', control.dataset.focusKey ?? `${control.tagName}:${index}`);
    });
  }

  #render(): void {
    const signature = JSON.stringify([this.#conversation, this.#projectId, this.#title, this.#state, this.#requestState, this.#activity, this.#review, this.#offline]);
    if (signature === this.#signature) return;
    this.#signature = signature;
    const scrollTop = this.#host.scrollTop;
    const nextConversationKey = this.#conversation ? `${this.#projectId}:${this.#conversation.ticketId}` : null;
    const sameConversation = this.#renderedConversationKey === nextConversationKey;
    const follow = shouldFollowChat({ previousConversationKey: this.#renderedConversationKey, nextConversationKey,
      scrollTop, scrollHeight: this.#host.scrollHeight, clientHeight: this.#host.clientHeight, previouslyFollowing: this.#following });
    const viewportTop = this.#host.getBoundingClientRect().top + this.#host.clientTop;
    const anchor = !follow && this.#host.clientHeight ? visibleChatAnchor(this.#messageElements().map(item => {
      const bounds = item.getBoundingClientRect(); return { messageId: item.dataset.messageId ?? '', top: bounds.top, bottom: bounds.bottom };
    }), { top: viewportTop, bottom: viewportTop + this.#host.clientHeight }) : null;
    const active = this.#host.ownerDocument.activeElement;
    const focusInside = active instanceof HTMLElement && this.#host.contains(active);
    const focusKey = focusInside ? active.dataset.focusKey : undefined;
    const focusedMessageId = focusInside ? active.closest('[data-message-id]')?.getAttribute('data-message-id') : null;
    const expanded = new Set(Array.from(this.#host.querySelectorAll('details')).flatMap(details => details.open && details.dataset.detailKey ? [details.dataset.detailKey] : []));
    const root = node('section', undefined, 'request-chat'); root.id = 'request-chat';
    root.setAttribute('aria-label', 'Request conversation');
    if (this.#conversation) {
      const header = node('header'); const title = node('h3', 'Chat'); title.title = this.#title;
      header.append(title, node('span', this.#state, 'pill'),
        node('span', `${this.#conversation.messages.filter(message => message.kind === 'user').length}/${CONVERSATION_LIMITS.userTurns} turns`, 'chat-turn-count'));
      root.append(header);
      const activity = groupTurnActivity(this.#conversation, this.#activity);
      const latestUser = this.#conversation.messages.findLast(message => message.kind === 'user');
      const transcript = node('ol', undefined, 'request-chat-transcript'); transcript.id = 'request-chat-transcript';
      for (const message of this.#conversation.messages) {
        const item = this.#message(message);
        if (message.kind === 'user') item.append(this.#turnActivity(message, activity.get(message.requestId) ?? []));
        this.#keyMessage(item, message.id);
        transcript.append(item);
      }
      root.append(transcript, this.#status(latestUser ? activity.get(latestUser.requestId) ?? [] : []));
    } else {
      const welcome = node('div', undefined, 'chat-welcome');
      welcome.append(node('span', '✦', 'chat-welcome-mark'), node('h3', 'What would you like to change?'),
        node('p', 'Describe an idea, paste a plan, or reference an item in the model. Your AI will prepare a proposal to review.'));
      root.append(welcome);
      if (this.#offline) root.append(this.#status([]));
    }
    this.#host.replaceChildren(root); this.setDisabled(this.#disabled);
    if (sameConversation) {
      for (const details of root.querySelectorAll('details')) if (details.dataset.detailKey && expanded.has(details.dataset.detailKey)) details.open = true;
    }
    if (focusInside && sameConversation) {
      const target = Array.from(root.querySelectorAll('[data-focus-key]')).find(control => control instanceof HTMLElement && control.dataset.focusKey === focusKey);
      if (target instanceof HTMLElement && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({ preventScroll: true });
      else {
        const fallback = this.#messageElements().find(item => item.dataset.messageId === focusedMessageId) ?? root;
        fallback.tabIndex = -1; fallback.focus({ preventScroll: true });
      }
    }
    this.#following = follow;
    this.#pendingBottomFollow = follow && nextConversationKey !== null;
    if (this.#pendingBottomFollow) this.#finishBottomFollow();
    else {
      const anchored = anchor ? this.#messageElements().find(item => item.dataset.messageId === anchor.messageId) : undefined;
      this.#host.scrollTop = anchor && anchored ? anchoredChatScrollTop({ scrollTop: this.#host.scrollTop, previousOffset: anchor.offset,
        currentOffset: anchored.getBoundingClientRect().top - viewportTop }) : scrollTop;
    }
    this.#renderedConversationKey = nextConversationKey;
  }

  #status(activity: readonly RequestActivity[]): HTMLElement {
    const status = chatRequestStatus({ requestState: this.#requestState, offline: this.#offline, activity });
    const region = node('div', undefined, 'request-chat-status'); region.dataset.status = status.kind;
    region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite');
    region.append(node('strong', status.label));
    if (status.detail) region.append(node('span', status.detail));
    return region;
  }

  #turnActivity(message: ConversationMessage, activity: readonly RequestActivity[]): HTMLElement {
    const details = node('details', undefined, 'request-chat-activity'); details.dataset.detailKey = `activity:${message.id}`;
    details.append(node('summary', `Activity · ${activity.length}`));
    if (!activity.length) details.append(node('p', 'No activity was reported for this turn.'));
    else {
      const list = node('ol');
      for (const event of activity) {
        const item = node('li'); item.dataset.activitySequence = String(event.sequence);
        item.append(node('strong', ACTIVITY_STAGES[event.stage]), node('p', event.message),
          node('small', `Attempt ${event.attempt} · #${event.sequence} · ${new Date(event.at).toLocaleString()}`));
        list.append(item);
      }
      details.append(list);
    }
    details.append(node('p', `#${message.sequence} · ${new Date(message.at).toLocaleString()} · Message ${message.id} · Request ${message.requestId} · Base revision ${message.baseRevisionId}`));
    return details;
  }

  #visualEvidence(visual: ConversationVisual): HTMLElement {
    const details = node('details', undefined, 'request-chat-visual');
    details.append(node('summary', visualLabel(visual)), node('p', `Selected IDs: ${visual.selectedObjectIds.join(', ') || 'None'}`));
    for (const annotation of visual.annotations) details.append(node('p', annotation.kind === 'pin'
      ? `● ${annotation.label}: ${annotation.position.join(', ')} m`
      : `↗ ${annotation.label}: ${annotation.from.join(', ')} → ${annotation.to.join(', ')} m`));
    details.append(this.#control('Inspect bound snapshot', () => this.#actions.inspect(visual))); return details;
  }

  #proposalCard(message: ConversationMessage): HTMLElement {
    const card = node('section', undefined, 'request-chat-proposal');
    if (message.kind !== 'assistant' || message.content.kind !== 'proposal') return card;
    const content = message.content;
    const review = matchingProposalReview(message, this.#review);
    const heading = node('header', undefined, 'request-chat-proposal-heading');
    heading.append(node('h4', 'Proposal'));
    if (review) heading.append(node('span', review.status, 'request-chat-review-status'));
    card.append(heading, node('p', review?.summary ?? content.text, 'request-chat-outcome'));
    const technical = node('details', undefined, 'request-chat-technical'); technical.dataset.detailKey = `proposal:${message.id}`;
    technical.append(node('summary', 'Proposal details'));
    const details = node('dl', undefined, 'request-chat-review-details');
    if (review) {
      for (const [label, text] of [['Rationale', review.rationale], ['Constraints', review.constraints], ['Uncertainty', review.uncertainty]]) {
        details.append(node('dt', label), node('dd', text));
      }
      if (content.text.trim() !== review.summary.trim()) details.append(node('dt', 'Agent note'), node('dd', content.text));
      if (review.target) details.append(node('dt', 'Target identity'), node('dd', review.target.target.kind === 'main'
        ? 'Main design' : `Alternative ${review.target.target.id}`), node('dt', 'Target revision'), node('dd', review.target.revisionId));
    }
    for (const [label, text] of [['Message', message.id], ['Sequence', String(message.sequence)], ['Request', message.requestId], ['Base revision', message.baseRevisionId],
      ['Proposal revision', content.proposalRevisionId], ['Proposal name', content.proposalName]]) {
      details.append(node('dt', label), node('dd', text));
    }
    technical.append(details);
    if (!review) {
      card.append(this.#control('Inspect proposal', () => this.#actions.proposal(message), 'inspect-proposal'), technical);
      return card;
    }
    const targetLabel = review.targetLabel?.trim() || (review.target?.target.kind === 'main' ? 'Main design'
      : review.target?.target.kind === 'alternative' ? 'selected alternative' : 'selected design');
    card.append(node('p', `Target: ${targetLabel}`, 'request-chat-target'));
    if (review.evidenceUses?.length) {
      const choices = node('details'); choices.dataset.detailKey = `evidence:${message.id}`;
      choices.append(node('summary', `Evidence choices for this proposal · ${review.evidenceUses.length}`),
        node('p', 'These are design assumptions for your review. Conflicting source history remains unchanged.'));
      for (const use of review.evidenceUses) choices.append(node('p', use.rationale),
        node('small', `${use.subject.anchor.entityId} · ${use.subject.property.definitionId} · ${use.pin.entryId} · SHA-256 ${use.pin.hash}`));
      const assumptions = node('dd'); assumptions.append(choices);
      details.append(node('dt', 'Source assumptions'), assumptions);
    }
    const actions = node('div', undefined, 'ticket-actions');
    const delta = this.#control(review.delta ? 'Hide changes' : 'View changes', () => {
      if (matchingProposalReview(message, this.#review)) this.#actions.delta(message.id);
    }, 'delta');
    delta.setAttribute('aria-pressed', String(review.delta)); actions.append(delta);
    const decisions: readonly [RequestChatDecision, string][] = [['accept', `Accept into ${targetLabel}`], ['revise', 'Request revision'], ['reject', 'Reject proposal']];
    for (const [action, label] of decisions) {
      if (!canDecideProposal({ message, review, action, disabled: false, offline: false })) continue;
      actions.append(this.#control(label, () => {
        if (canDecideProposal({ message, review: this.#review, action, disabled: this.#disabled, offline: this.#offline })) this.#actions.decision(action, message.id);
      }, action));
    }
    card.append(actions, node('p', 'Only explicit acceptance applies changes.', 'chat-turn-count'), technical);
    return card;
  }

  #message(message: ConversationMessage): HTMLElement {
    const item = node('li', undefined, `request-chat-message request-chat-${message.kind}`); item.dataset.messageId = message.id;
    const header = node('header', undefined, 'request-chat-message-heading');
    const timestamp = node('time', new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    timestamp.dateTime = new Date(message.at).toISOString(); timestamp.title = new Date(message.at).toLocaleString();
    header.append(node('strong', message.kind === 'user' ? 'You' : message.kind === 'assistant' ? 'Assistant' : 'Review decision'), timestamp);
    item.append(header);
    if (message.kind === 'user') {
      item.append(node('p', message.text)); const sources = node('section');
      renderSourceContext(sources, this.#projectId, { sources: message.sources }, true); item.append(sources);
      if (message.evidencePins?.length) {
        const pins = node('details'); pins.dataset.detailKey = `evidence-pins:${message.id}`;
        pins.append(node('summary', `Bound evidence records · ${message.evidencePins.length}`));
        for (const pin of message.evidencePins) pins.append(node('p', `${pin.entryId} · SHA-256 ${pin.hash}`));
        item.append(pins);
      }
      if (message.visual) {
        const evidence = this.#visualEvidence(message.visual); evidence.dataset.detailKey = `visual:${message.id}`; item.append(evidence);
      }
    } else if (message.kind === 'decision') item.append(node('p', `Recorded: ${message.action}.`));
    else {
      const content = message.content;
      if (content.kind === 'clarification') {
        item.append(node('p', content.question)); const choices = node('div', undefined, 'ticket-actions');
        for (const option of content.options) choices.append(this.#control(option, () => this.#actions.answer(option)));
        item.append(choices);
      } else if (content.kind === 'proposal') { item.append(this.#proposalCard(message)); return item; }
      else item.append(node('p', content.text));
    }
    if (message.kind !== 'user') {
      const metadata = node('details', undefined, 'request-chat-technical'); metadata.dataset.detailKey = `message:${message.id}`;
      metadata.append(node('summary', 'Message details'), node('p', `#${message.sequence} · ${new Date(message.at).toLocaleString()}`),
        node('p', `Message ${message.id} · Request ${message.requestId} · Base revision ${message.baseRevisionId}`));
      if (message.kind === 'decision') metadata.append(node('p', `Decision ${message.decisionId}`));
      item.append(metadata);
    }
    return item;
  }
}
