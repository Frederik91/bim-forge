import type { ConversationVisual } from '../src/request-conversation.ts';
import { conversationMarkups } from './request-chat-evidence.ts';
import { spatialMarkupDescription } from '../src/spatial-markup.ts';

export type ComposerAction = 'files' | 'floor' | 'evidence' | 'reference' | 'view' | 'markup' | 'scope' | 'options';
export const COMPOSER_ACTIONS: readonly { id: ComposerAction; label: string; description: string }[] = [
  { id: 'files', label: 'Attach files', description: 'Images, plans and documents' },
  { id: 'floor', label: 'Reconstruct a floor plan', description: 'Attach a plan, confirm a known dimension, review an AI proposal' },
  { id: 'evidence', label: 'Use project evidence', description: 'Retained sources and model-linked claims' },
  { id: 'reference', label: 'Reference a model item', description: 'Search the model with @' },
  { id: 'view', label: 'Attach current view', description: 'Selection and marked location · 2D or 3D' },
  { id: 'markup', label: 'Draw in 3D', description: 'Outline an area with lines, rectangles or circles' },
  { id: 'scope', label: 'Choose model scope', description: 'Rooms, levels, types and parameters' },
  { id: 'options', label: 'Request options', description: 'Layout reconstruction and advanced details' },
];
type Query = { kind: 'mention' | 'command'; start: number; end: number; text: string };
export function composerQuery(text: string, caret: number): Query | null {
  const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { kind: match[1] === '@' ? 'mention' : 'command', start: caret - (match[2]?.length ?? 0) - 1, end: caret, text: match[2] ?? '' };
}
export function matchingCommands(query: string) {
  return COMPOSER_ACTIONS.filter(action => `${action.id} ${action.label}`.toLowerCase().includes(query.toLowerCase()));
}
export interface ModelMention { id: string; name: string; type: string }
interface Choice { id: string; label: string; detail: string; choose: () => boolean }
interface ComposerUi { root: HTMLElement; input: HTMLTextAreaElement; add: HTMLButtonElement; menu: HTMLElement; visual: HTMLElement; form: HTMLFormElement }
interface ComposerActions { items: () => readonly ModelMention[]; files?: () => readonly { id: string; name: string }[];
  file?: (id: string) => boolean; action: (action: ComposerAction) => boolean; mention: (id: string) => boolean;
  remove: (id: string | null) => void; changed: () => void }

export class RequestComposer {
  readonly #ui: ComposerUi;
  readonly #actions: ComposerActions;
  #choices: Choice[] = [];
  #active = 0;
  #query: Query | null = null;
  #disabled = true;

  constructor(ui: ComposerUi, actions: ComposerActions) {
    this.#ui = ui; this.#actions = actions;
    ui.add.addEventListener('click', () => {
      if (!ui.menu.hidden && !this.#query) { this.close(); return; }
      this.#query = null; this.#showActions();
    });
    ui.input.addEventListener('input', () => { this.refresh(); this.#suggest(); actions.changed(); });
    ui.input.addEventListener('click', () => this.#suggest());
    ui.root.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (!ui.menu.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); ui.input.focus(); return; }
      if (!ui.menu.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key) && this.#choices.length) {
        event.preventDefault(); this.#active = (this.#active + (event.key === 'ArrowDown' ? 1 : -1) + this.#choices.length) % this.#choices.length; this.#highlight(); return;
      }
      if (!ui.menu.hidden && event.key === 'Enter' && this.#choices.length) {
        event.preventDefault(); this.#choose(this.#choices[this.#active]); return;
      }
      if (event.target === ui.input && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const submit = ui.form.querySelector('button[type="submit"]');
        if (submit instanceof HTMLButtonElement && !submit.disabled) ui.form.requestSubmit(submit);
      }
    });
    document.addEventListener('pointerdown', event => { if (event.target instanceof Node && !ui.root.contains(event.target)) this.close(); });
    ui.root.addEventListener('focusout', event => { if (event.relatedTarget instanceof Node && !ui.root.contains(event.relatedTarget)) this.close(); });
    window.addEventListener('resize', () => this.close());
  }

  refresh(): void {
    const input = this.#ui.input; input.style.height = 'auto'; input.style.height = `${Math.min(160, Math.max(48, input.scrollHeight))}px`;
  }
  setDisabled(disabled: boolean): void {
    this.#disabled = disabled; this.#ui.add.disabled = disabled;
    for (const control of this.#ui.visual.querySelectorAll('button')) control.disabled = disabled;
    if (disabled) this.close();
  }
  close(): void {
    if (this.#ui.menu.matches(':popover-open')) this.#ui.menu.hidePopover();
    this.#ui.menu.hidden = true; this.#query = null;
    this.#ui.add.setAttribute('aria-expanded', 'false'); this.#ui.input.setAttribute('aria-expanded', 'false'); this.#ui.input.removeAttribute('aria-activedescendant');
  }
  setVisual(visual: ConversationVisual | null): void {
    const host = this.#ui.visual; host.replaceChildren(); host.hidden = !visual;
    if (!visual) return;
    const add = (label: string, remove: () => void) => {
      const chip = document.createElement('span'); chip.className = 'composer-context-chip';
      const text = document.createElement('span'); text.textContent = label;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '×'; button.setAttribute('aria-label', `Remove ${label}`); button.disabled = this.#disabled;
      button.addEventListener('click', remove); chip.append(text, button); host.append(chip);
    };
    const markups = conversationMarkups(visual);
    const description = markups.length === 1 && markups[0] ? spatialMarkupDescription(markups[0]) : markups.length ? `${markups.length} markup shapes` : 'view';
    add(`${visual.view === '2d' ? '2D' : '3D'} ${description} · ${visual.snapshot.revisionId.slice(0, 7)}`, () => this.#actions.remove(null));
    const items = this.#actions.items();
    for (const id of visual.selectedObjectIds) add(`@${items.find(item => item.id === id)?.name ?? id}`, () => this.#actions.remove(id));
  }
  #suggest(): void {
    if (this.#disabled || this.#ui.input.selectionStart !== this.#ui.input.selectionEnd) { this.close(); return; }
    this.#query = composerQuery(this.#ui.input.value, this.#ui.input.selectionStart);
    if (!this.#query) { this.close(); return; }
    if (this.#query.kind === 'command') { this.#showActions(); return; }
    const query = this.#query.text.toLowerCase();
    const files = (this.#actions.files?.() ?? []).filter(file => file.name.toLowerCase().includes(query)).map(file => ({
      id: `file-${file.id}`, label: `@${file.name}`, detail: 'Project file', choose: () => this.#actions.file?.(file.id) ?? false,
    }));
    const items = this.#actions.items().filter(item => `${item.name} ${item.type} ${item.id}`.toLowerCase().includes(query)).map(item => ({
      id: item.id, label: `@${item.name}`, detail: `${item.type} · ${item.id}`, choose: () => this.#actions.mention(item.id),
    }));
    this.#show([...files, ...items].slice(0, 8), 'Model items and project files');
  }
  #showActions(): void {
    this.#show(matchingCommands(this.#query?.text ?? '').map(action => ({ id: action.id, label: this.#query ? `/${action.id}` : action.label,
      detail: action.description, choose: () => {
        if (action.id !== 'reference') return this.#actions.action(action.id);
        const input = this.#ui.input;
        const prefix = input.selectionStart && !/\s/.test(input.value[input.selectionStart - 1] ?? '') ? ' @' : '@';
        input.setRangeText(prefix, input.selectionStart, input.selectionEnd, 'end'); input.focus(); this.#suggest(); return true;
      },
    })), this.#query ? 'Chat shortcuts' : 'Add to this chat');
  }
  #show(choices: Choice[], label: string): void {
    this.#choices = choices; this.#active = 0;
    const menu = this.#ui.menu; menu.replaceChildren(); menu.setAttribute('aria-label', label);
    if (!choices.length) { const empty = document.createElement('p'); empty.textContent = 'No matches. Try another name, or Escape to continue writing.'; menu.append(empty); }
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.id = `composer-choice-${choice.id}`; button.tabIndex = -1; button.setAttribute('role', 'option');
      const title = document.createElement('strong'); title.textContent = choice.label;
      const detail = document.createElement('small'); detail.textContent = choice.detail;
      button.append(title, detail); button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => this.#choose(choice)); menu.append(button);
    }
    menu.hidden = false; menu.showPopover();
    const bounds = this.#ui.root.getBoundingClientRect(); menu.style.left = `${Math.max(8, bounds.left)}px`; menu.style.width = `${Math.min(bounds.width, window.innerWidth - 16)}px`;
    menu.style.top = `${Math.max(8, bounds.top - menu.getBoundingClientRect().height - 8)}px`;
    this.#ui.add.setAttribute('aria-expanded', String(!this.#query)); this.#ui.input.setAttribute('aria-expanded', String(Boolean(this.#query))); this.#highlight();
  }
  #highlight(): void {
    for (const [index, button] of [...this.#ui.menu.querySelectorAll('button')].entries()) button.setAttribute('aria-selected', String(index === this.#active));
    const choice = this.#choices[this.#active];
    if (choice) this.#ui.input.setAttribute('aria-activedescendant', `composer-choice-${choice.id}`);
  }
  #choose(choice: Choice | undefined): void {
    if (!choice || this.#disabled) return;
    const query = this.#query; const input = this.#ui.input; const before = input.value; const caret = input.selectionStart;
    // Remove a shortcut before invoking a native picker so its user activation is retained.
    if (query) input.setRangeText(query.kind === 'mention' ? `${choice.label} ` : '', query.start, query.end, 'end');
    this.close();
    if (!choice.choose()) { input.value = before; input.setSelectionRange(caret, caret); }
    if (query?.kind === 'mention' || !['files', 'scope', 'options'].includes(choice.id)) input.focus();
    this.refresh(); this.#actions.changed();
  }
}
