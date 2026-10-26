import { CONVERSATION_LIMITS, parseRequestConversation } from '../src/request-conversation.ts';
import type { ConversationMessage, ConversationVisual, RequestConversation } from '../src/request-conversation.ts';
import { renderSourceContext } from './request-source-ui.ts';
import { visualLabel } from './request-chat-evidence.ts';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); if (text !== undefined) result.textContent = text;
  if (className) result.className = className; return result;
}

function control(text: string, action: () => void): HTMLButtonElement {
  const button = node('button', text, 'button outline'); button.type = 'button';
  button.addEventListener('click', action); return button;
}

export function conversationFromTicket(ticket: unknown): RequestConversation {
  if (!ticket || typeof ticket !== 'object' || !('conversation' in ticket)) throw new Error('This server does not provide request conversations. Reconnect before replying.');
  return parseRequestConversation(ticket.conversation);
}

interface ChatActions {
  close: () => void; answer: (text: string) => void; proposal: (message: ConversationMessage) => void;
  inspect: (visual: ConversationVisual) => void; attach: () => void; remove: () => void;
}

export class RequestChat {
  readonly #host: HTMLElement;
  readonly #actions: ChatActions;
  #conversation: RequestConversation | null = null;
  #projectId = '';
  #title = '';
  #state = '';
  #visual: ConversationVisual | null = null;
  #disabled = false;
  #signature = '';

  constructor(host: HTMLElement, actions: ChatActions) {
    this.#host = host; this.#actions = actions;
    host.id = 'request-chat-mount'; this.#render();
  }

  get conversation(): RequestConversation | null { return this.#conversation; }
  show(input: { conversation: RequestConversation; projectId: string; title: string; state: string }): void {
    this.#conversation = input.conversation; this.#projectId = input.projectId; this.#title = input.title; this.#state = input.state; this.#render();
  }
  close(): void { this.#conversation = null; this.#visual = null; this.#signature = ''; this.#render(); }
  setVisual(visual: ConversationVisual | null): void { this.#visual = visual; this.#render(); }
  setDisabled(disabled: boolean): void { this.#disabled = disabled; for (const button of this.#host.querySelectorAll('button')) button.disabled = disabled; }

  #render(): void {
    const signature = JSON.stringify([this.#conversation, this.#projectId, this.#title, this.#state, this.#visual]);
    if (signature === this.#signature) return;
    this.#signature = signature;
    const root = node('section', undefined, 'request-chat'); root.id = 'request-chat';
    root.setAttribute('aria-label', 'Request conversation');
    if (this.#conversation) {
      const header = node('header'); header.append(node('h3', this.#title), node('span', this.#state, 'pill'), control('New request', this.#actions.close)); root.append(header);
      const transcript = node('ol', undefined, 'request-chat-transcript'); transcript.id = 'request-chat-transcript';
      for (const message of this.#conversation.messages) transcript.append(this.#message(message));
      root.append(transcript, node('p', `${this.#conversation.messages.filter(message => message.kind === 'user').length}/${CONVERSATION_LIMITS.userTurns} messages sent · Up to ${CONVERSATION_LIMITS.sourceFiles} source files and 12 MiB across this conversation. Every reply continues this request. Proposals need an explicit review decision.`, 'editor-help'));
    } else root.append(node('p', 'Start a request, then continue the conversation here.', 'editor-help'));
    const attachments = node('div', undefined, 'request-chat-attachments');
    attachments.append(control('Attach current selection / marker', this.#actions.attach));
    if (this.#visual) {
      attachments.append(this.#visualEvidence(this.#visual), control('Remove visual attachment', this.#actions.remove));
    } else attachments.append(node('small', 'Optional: select an object or mark a location in 2D or 3D, then attach it.'));
    root.append(attachments); this.#host.replaceChildren(root); this.setDisabled(this.#disabled);
  }

  #visualEvidence(visual: ConversationVisual): HTMLElement {
    const details = node('details', undefined, 'request-chat-visual'); details.open = true;
    details.append(node('summary', visualLabel(visual)), node('p', `Selected IDs: ${visual.selectedObjectIds.join(', ') || 'None'}`));
    for (const annotation of visual.annotations) details.append(node('p', annotation.kind === 'pin'
      ? `● ${annotation.label}: ${annotation.position.join(', ')} m`
      : `↗ ${annotation.label}: ${annotation.from.join(', ')} → ${annotation.to.join(', ')} m`));
    details.append(control('Inspect bound snapshot', () => this.#actions.inspect(visual))); return details;
  }

  #message(message: ConversationMessage): HTMLElement {
    const item = node('li', undefined, `request-chat-message request-chat-${message.kind}`); item.dataset.messageId = message.id;
    item.append(node('strong', message.kind === 'user' ? 'You' : message.kind === 'assistant' ? 'Assistant' : 'Review decision'),
      node('small', `#${message.sequence} · ${new Date(message.at).toLocaleString()} · base ${message.baseRevisionId.slice(0, 10)}`));
    if (message.kind === 'user') {
      item.append(node('p', message.text)); const sources = node('section');
      renderSourceContext(sources, this.#projectId, { sources: message.sources }, true); item.append(sources);
      if (message.visual) item.append(this.#visualEvidence(message.visual));
    } else if (message.kind === 'decision') item.append(node('p', `Recorded: ${message.action}. Decision ${message.decisionId}.`));
    else {
      const content = message.content;
      if (content.kind === 'clarification') {
        item.append(node('p', content.question)); const choices = node('div', undefined, 'ticket-actions');
        for (const option of content.options) choices.append(control(option, () => this.#actions.answer(option)));
        item.append(choices);
      } else {
        item.append(node('p', content.text));
        if (content.kind === 'proposal') item.append(control(`Review proposal · ${content.proposalRevisionId.slice(0, 10)}`, () => this.#actions.proposal(message)));
      }
    }
    return item;
  }
}
