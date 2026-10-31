import { createRoot } from 'react-dom/client';
import { parseRequestConversation } from '../src/request-conversation.ts';
import type { ConversationMessage, ConversationVisual, RequestConversation } from '../src/request-conversation.ts';
import type { RequestActivity } from '../src/request-activity.ts';
import type { RequestState } from './change-requests.ts';
import { anchoredChatScrollTop, canDecideProposal, chatDomKey, matchingProposalReview, shouldFollowChat, visibleChatAnchor } from './request-chat-status.ts';
import type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';
import { renderRequestChat } from './request-chat-react.tsx';
import type { RequestChatRenderActions } from './request-chat-react.tsx';
export type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';

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
  conversation: RequestConversation; projectId: string; title: string; state: string; requestState: RequestState;
  /** Validated, deduplicated current and archived activity supplied by the parent. */
  activity: readonly RequestActivity[];
}

/** Presentation adapter: the parent retains conversation, transport and review authority. */
export class RequestChat {
  readonly #host: HTMLElement;
  readonly #root: ReturnType<typeof createRoot>;
  readonly #renderActions: RequestChatRenderActions;
  #conversation: RequestConversation | null = null;
  #projectId = ''; #title = ''; #state = '';
  #requestState: RequestState = 'queued';
  #activity: readonly RequestActivity[] = [];
  #review: RequestChatProposalReview | null = null;
  #offline = false; #disabled = false; #signature = '';
  #renderedConversationKey: string | null = null;
  #following = true; #pendingBottomFollow = false;
  readonly #resizeObserver: ResizeObserver;

  constructor(host: HTMLElement, actions: RequestChatActions) {
    this.#host = host; this.#root = createRoot(host);
    this.#renderActions = { ...actions,
      interact: (message, action) => {
        const current = this.#conversation?.messages.find(item => item.id === message.id);
        if (!this.#disabled && !this.#offline && current?.requestId === message.requestId
            && current.baseRevisionId === message.baseRevisionId) action();
      },
      decide: (message, action) => {
        if (this.#conversation?.messages.some(item => item.id === message.id)
            && canDecideProposal({ message, review: this.#review, action, disabled: this.#disabled, offline: this.#offline })) actions.decision(action, message.id);
      },
      showDelta: message => {
        if (!this.#disabled && !this.#offline && this.#conversation?.messages.some(item => item.id === message.id)
            && matchingProposalReview(message, this.#review)) actions.delta(message.id);
      },
    };
    this.#resizeObserver = new ResizeObserver(() => this.#finishBottomFollow()); this.#resizeObserver.observe(host);
    host.addEventListener('scroll', () => {
      if (!host.clientHeight) return;
      this.#following = this.#atBottom(); if (!this.#following) this.#pendingBottomFollow = false;
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
  setDisabled(disabled: boolean): void { this.#disabled = disabled; this.#render(); }

  #atBottom(): boolean { return this.#host.scrollHeight - this.#host.clientHeight - this.#host.scrollTop <= 24; }
  #finishBottomFollow(): void {
    if (!this.#pendingBottomFollow || !this.#host.clientHeight) return;
    this.#pendingBottomFollow = false; this.#host.scrollTop = this.#host.scrollHeight;
  }
  #messageElements(): HTMLLIElement[] { return Array.from(this.#host.querySelectorAll('li')).filter(item => item.dataset.messageId !== undefined); }
  #keyMessage(item: HTMLElement, messageId: string): void {
    Array.from(item.querySelectorAll('details')).forEach((details, index) => {
      details.dataset.detailKey ??= chatDomKey(messageId, 'detail', index);
      const summary = details.querySelector('summary'); if (summary) summary.dataset.focusKey = `summary:${details.dataset.detailKey}`;
    });
    Array.from(item.querySelectorAll('button, a, summary')).forEach((control, index) => {
      if (!(control instanceof HTMLElement)) return;
      control.dataset.localFocusKey ??= control.dataset.focusKey ?? `${control.tagName}:${index}`;
      control.dataset.focusKey = chatDomKey(messageId, 'control', control.dataset.localFocusKey);
    });
  }
  #render(): void {
    const signature = JSON.stringify([this.#conversation, this.#projectId, this.#title, this.#state, this.#requestState, this.#activity, this.#review, this.#offline, this.#disabled]);
    if (signature === this.#signature) return; this.#signature = signature;
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
    renderRequestChat(this.#root, { conversation: this.#conversation, projectId: this.#projectId, title: this.#title, state: this.#state,
      requestState: this.#requestState, activity: this.#activity, review: this.#review, offline: this.#offline, disabled: this.#disabled }, this.#renderActions);
    const root = this.#host.querySelector('#request-chat');
    if (!(root instanceof HTMLElement)) throw new Error('The request conversation did not mount.');
    for (const item of this.#messageElements()) this.#keyMessage(item, item.dataset.messageId ?? '');
    if (sameConversation) for (const details of root.querySelectorAll('details')) if (details.dataset.detailKey && expanded.has(details.dataset.detailKey)) details.open = true;
    if (focusInside && sameConversation) {
      const target = Array.from(root.querySelectorAll('[data-focus-key]')).find(control => control instanceof HTMLElement && control.dataset.focusKey === focusKey);
      if (target instanceof HTMLElement && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({ preventScroll: true });
      else { const fallback = this.#messageElements().find(item => item.dataset.messageId === focusedMessageId) ?? root; fallback.tabIndex = -1; fallback.focus({ preventScroll: true }); }
    }
    this.#following = follow; this.#pendingBottomFollow = follow && nextConversationKey !== null;
    if (this.#pendingBottomFollow) this.#finishBottomFollow();
    else {
      const anchored = anchor ? this.#messageElements().find(item => item.dataset.messageId === anchor.messageId) : undefined;
      this.#host.scrollTop = anchor && anchored ? anchoredChatScrollTop({ scrollTop: this.#host.scrollTop, previousOffset: anchor.offset,
        currentOffset: anchored.getBoundingClientRect().top - viewportTop }) : scrollTop;
    }
    this.#renderedConversationKey = nextConversationKey;
  }
}
