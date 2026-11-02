import type { TaskAgentAnchor, TaskAgentDescriptor, TaskAgentHit, TaskAgentIdentity } from './spatial-task-layer.ts';
import { taskAgentStatusLabel } from './spatial-task-layer.ts';
import { setChatIcon } from './chat-icons.ts';

const key = (identity: TaskAgentIdentity): string => identity.kind === 'task' ? identity.ticketId : identity.draftId;
type PanelLayout = { kind: 'automatic' } | { kind: 'manual'; width: number; height: number; right: number; top: number };
function control(text: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', action); return node;
}

/** DOM presentation only: the controller owns identities and drafts; the viewer owns projection. */
export class SpatialWorkspacePresentation {
  readonly #stage: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #labels = document.createElement('div');
  readonly #list = document.createElement('section');
  readonly #notice = document.createElement('details');
  readonly #noticeText = document.createElement('p');
  readonly #noticeSummary = document.createElement('summary');
  readonly #return: HTMLButtonElement;
  readonly #rebind: HTMLButtonElement;
  readonly #delete: HTMLButtonElement;
  readonly #remove: (identity: TaskAgentIdentity) => void;
  readonly #expand: HTMLButtonElement;
  readonly #size = document.createElement('span');
  #layout: PanelLayout = { kind: 'automatic' };
  readonly #open: (identity: TaskAgentIdentity) => void;
  readonly #labelNodes = new Map<string, HTMLButtonElement>();
  readonly #candidates = new Map<string, readonly TaskAgentIdentity[]>();
  #descriptors: readonly TaskAgentDescriptor[] = [];
  #signature = '';
  #anchor: { x: number; y: number } | null = null;
  #positionKey = '';
  #positioned = false;
  #chooser: readonly TaskAgentIdentity[] | undefined;

  constructor(options: { stage: HTMLElement; panel: HTMLElement; open: (identity: TaskAgentIdentity) => void; returnToTask: () => void; rebind: () => void; remove: (identity: TaskAgentIdentity) => void }) {
    this.#stage = options.stage; this.#panel = options.panel; this.#open = options.open;
    this.#remove = options.remove;
    this.#stage.classList.add('spatial-workspace-stage'); this.#stage.append(this.#panel);
    this.#panel.classList.add('spatial-conversation');
    this.#labels.className = 'spatial-task-labels'; this.#labels.setAttribute('aria-label', 'Spatial task agents');
    this.#list.className = 'spatial-task-list'; this.#list.id = 'spatial-task-list'; this.#list.hidden = true; this.#list.setAttribute('aria-label', 'Tasks at this place');
    const launcher = control('Tasks', () => { this.#list.hidden = !this.#list.hidden; launcher.setAttribute('aria-expanded', String(!this.#list.hidden)); this.#chooser = undefined; this.#renderList(); });
    launcher.className = 'spatial-task-launcher'; launcher.setAttribute('aria-controls', this.#list.id); launcher.setAttribute('aria-expanded', 'false');
    const tools = document.createElement('div'); tools.className = 'spatial-conversation-tools'; tools.id = 'spatial-chat-options'; tools.popover = 'auto'; tools.setAttribute('aria-label', 'Conversation options');
    this.#return = control('Return to task', options.returnToTask); this.#return.id = 'spatial-return-task';
    this.#rebind = control('Refresh draft context', options.rebind); this.#rebind.id = 'spatial-refresh-context'; this.#rebind.hidden = true;
    this.#expand = control('Expand conversation', () => {
      const expanded = this.#panel.dataset.expanded !== 'true';
      if (this.#layout.kind === 'manual') this.#layout = { ...this.#currentLayout(), height: Math.min(720, this.#stage.clientHeight * (expanded ? .88 : this.#stage.clientWidth < 600 ? .44 : .66)) };
      this.#panel.dataset.expanded = String(expanded); this.#expand.textContent = expanded ? 'Short conversation' : 'Expand conversation'; this.#position();
    });
    this.#expand.id = 'spatial-expand-conversation';
    this.#delete = control('Delete agent', () => { const selected = this.#descriptors.find(item => item.selected); if (selected) this.#remove(selected.identity); });
    this.#delete.id = 'spatial-delete-agent';
    tools.append(this.#return, this.#expand, this.#rebind, this.#delete);
    const heading = this.#panel.querySelector('.workspace-panel-heading');
    const more = control('', () => {}); more.id = 'spatial-chat-options-toggle'; setChatIcon(more, 'Conversation options', 'more'); more.setAttribute('popovertarget', tools.id);
    more.addEventListener('click', () => {
      const box = more.getBoundingClientRect();
      tools.style.left = `${Math.max(8, Math.min(innerWidth - 248, box.right - 240))}px`;
      tools.style.top = `${Math.min(box.bottom + 4, Math.max(8, innerHeight - 360))}px`;
    });
    tools.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('button')) tools.hidePopover(); });
    const close = this.#panel.querySelector('#workspace-context-close');
    heading?.insertBefore(more, close); heading?.append(tools);
    const chats = this.#panel.querySelector<HTMLButtonElement>('#chat-switcher-button');
    const create = this.#panel.querySelector<HTMLButtonElement>('#new-chat');
    if (chats) { chats.textContent = 'Chats'; const count = document.createElement('span'); count.id = 'chat-count'; count.className = 'sr-only'; chats.append(count); tools.prepend(chats); }
    if (create) { setChatIcon(create, 'New task', 'new'); heading?.insertBefore(create, more); }
    this.#notice.className = 'spatial-placement-notice'; this.#notice.setAttribute('role', 'status'); this.#notice.hidden = true;
    this.#notice.append(this.#noticeSummary, this.#noticeText);
    this.#panel.insertBefore(this.#notice, this.#panel.children[1] ?? null);
    this.#installMove(); this.#installResize();
    this.#stage.append(this.#labels, this.#list);
    (this.#stage.querySelector('.model-card-heading') ?? this.#stage).append(launcher);
    new ResizeObserver(() => this.#position()).observe(this.#stage);
  }
  update(descriptors: readonly TaskAgentDescriptor[], notice: string, canReturn: boolean, needsRebind: boolean): void {
    this.#noticeText.textContent = notice; this.#noticeSummary.textContent = notice.startsWith('Connection unavailable') ? 'Offline · check connection' : notice.includes('Showing proposal geometry') ? 'Proposal view' : 'Check context';
    this.#noticeSummary.title = notice; this.#notice.hidden = !notice; this.#rebind.hidden = !needsRebind; this.#return.disabled = !canReturn;
    this.#delete.hidden = !descriptors.some(item => item.selected);
    const signature = JSON.stringify(descriptors); if (signature === this.#signature) { this.#position(); return; }
    this.#signature = signature; this.#descriptors = descriptors; this.#labels.replaceChildren(); this.#labelNodes.clear();
    for (const descriptor of descriptors) {
      if (descriptor.placement.kind === 'unplaced') continue;
      const label = control(`${descriptor.selected ? 'Selected · ' : ''}${descriptor.title} · ${taskAgentStatusLabel(descriptor)}`, () => { const candidates = this.#candidates.get(key(descriptor.identity)); if (candidates && candidates.length > 1) this.pick({ kind: 'chooser', candidates }); else this.#open(descriptor.identity); });
      label.className = 'spatial-task-label'; label.dataset.taskId = key(descriptor.identity); label.hidden = true;
      this.#labels.append(label); this.#labelNodes.set(key(descriptor.identity), label);
    }
    if (!this.#list.hidden) this.#renderList(this.#chooser); this.#position();
  }
  pick(hit: Exclude<TaskAgentHit, { kind: 'none' }>): void {
    if (hit.kind === 'task') this.#open(hit.identity);
    else { this.#chooser = hit.candidates; this.#list.hidden = false; this.#renderList(hit.candidates); this.#list.querySelector('button')?.focus({ preventScroll: true }); }
  }
  #renderList(candidates?: readonly TaskAgentIdentity[]): void {
    this.#list.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = candidates ? 'Choose a task at this place' : 'Tasks in this project'; this.#list.append(heading);
    for (const descriptor of this.#descriptors.filter(item => !candidates || candidates.some(candidate => key(candidate) === key(item.identity)))) {
      const node = control(`${descriptor.selected ? 'Selected · ' : ''}${descriptor.title} · ${taskAgentStatusLabel(descriptor)}${descriptor.placement.kind === 'unplaced' ? ' · Unplaced' : ''}`, () => { this.#list.hidden = true; this.#open(descriptor.identity); });
      node.dataset.taskId = key(descriptor.identity);
      const row = document.createElement('div'); row.className = 'spatial-task-row';
      const remove = control('Delete', () => this.#remove(descriptor.identity));
      remove.setAttribute('aria-label', `Delete agent: ${descriptor.title}`); remove.dataset.deleteAgent = key(descriptor.identity);
      row.append(node, remove); this.#list.append(row);
    }
    if (!this.#descriptors.length) { const empty = document.createElement('p'); empty.textContent = 'Start a conversation in the model.'; this.#list.append(empty); }
    this.#list.append(control('Close task list', () => { this.#list.hidden = true; }));
  }
  anchors(anchors: readonly TaskAgentAnchor[], bounds: DOMRect): void {
    const stage = this.#stage.getBoundingClientRect(); this.#anchor = null;
    for (const anchor of anchors) {
      const label = this.#labelNodes.get(key(anchor.identity)); if (!label) continue;
      label.hidden = anchor.kind !== 'visible'; if (anchor.kind !== 'visible') continue;
      if (anchor.candidates.length > 1) {
        if (anchor.candidates[0] && key(anchor.identity) !== key(anchor.candidates[0])) { label.hidden = true; continue; }
        label.textContent = `${anchor.candidates.length} tasks here · Choose conversation`;
      }
      const x = anchor.x + bounds.left - stage.left; const y = anchor.y + bounds.top - stage.top;
      label.dataset.anchorX = String(anchor.x); label.dataset.anchorY = String(anchor.y);
      label.dataset.bodyX = String(anchor.bodyX); label.dataset.bodyY = String(anchor.bodyY);
      label.style.width = 'max-content'; label.style.maxWidth = `${Math.max(0, stage.width - 16)}px`;
      const box = label.getBoundingClientRect();
      label.style.left = `${Math.max(8, Math.min(stage.width - box.width - 8, x - box.width / 2))}px`;
      label.style.top = `${Math.max(8, Math.min(stage.height - box.height - 8, y - 58))}px`;
      label.dataset.candidates = String(anchor.candidates.length);
      this.#candidates.set(key(anchor.identity), anchor.candidates);
      if (this.#descriptors.some(item => item.selected && anchor.candidates.some(candidate => key(item.identity) === key(candidate)))) this.#anchor = { x, y };
    }
    this.#position();
  }
  clearAnchors(): void { this.#anchor = null; for (const label of this.#labelNodes.values()) label.hidden = true; this.#position(); }
  #currentLayout(): Extract<PanelLayout, { kind: 'manual' }> {
    const stage = this.#stage.getBoundingClientRect(); const panel = this.#panel.getBoundingClientRect();
    return { kind: 'manual', width: panel.width, height: panel.height, right: stage.right - panel.right, top: panel.top - stage.top };
  }
  #installMove(): void {
    const heading = this.#panel.querySelector<HTMLElement>('.workspace-panel-heading'); if (!heading) return;
    const handle = control('', () => {}); handle.id = 'spatial-move-conversation'; handle.className = 'icon-button'; handle.setAttribute('aria-label', 'Move assistant');
    handle.title = 'Drag the header to move. Arrow keys move; Shift uses larger steps. Home returns to the lower right.';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'path'); lines.setAttribute('d', 'M3 8h10M8 3v10M3 8l2-2M3 8l2 2M13 8l-2-2M13 8l-2 2M8 3L6 5M8 3l2 2M8 13l-2-2M8 13l2-2'); icon.append(lines); handle.append(icon);
    heading.insertBefore(handle, heading.querySelector('button'));
    let gesture: { pointer: number; x: number; y: number; layout: Extract<PanelLayout, { kind: 'manual' }> } | null = null;
    heading.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
      const button = event.target.closest('button'); if (button && button !== handle) return;
      event.preventDefault(); event.stopPropagation(); handle.focus({ preventScroll: true });
      gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, layout: this.#currentLayout() };
      heading.setPointerCapture(event.pointerId); heading.dataset.dragging = 'true';
    });
    heading.addEventListener('pointermove', event => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      this.#layout = { ...gesture.layout, right: gesture.layout.right + gesture.x - event.clientX, top: gesture.layout.top + event.clientY - gesture.y };
      this.#position();
    });
    const stop = (): void => {
      if (!gesture) return;
      const pointer = gesture.pointer; gesture = null; delete heading.dataset.dragging;
      if (heading.hasPointerCapture(pointer)) heading.releasePointerCapture(pointer);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) heading.addEventListener(event, stop);
    window.addEventListener('blur', stop);
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopPropagation(); this.#layout = gesture.layout; stop(); this.#position(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const layout = this.#currentLayout(); const step = event.shiftKey ? 32 : 16;
      this.#layout = event.key === 'Home' ? { ...layout, right: 12, top: this.#stage.clientHeight - layout.height - 12 }
        : { ...layout, right: layout.right + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0), top: layout.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) };
      this.#position();
    });
  }
  #installResize(): void {
    const footer = document.createElement('div'); footer.className = 'spatial-conversation-resize';
    const handle = control('Resize', () => {}); handle.id = 'spatial-resize-conversation'; handle.setAttribute('aria-label', 'Resize assistant');
    handle.title = 'Drag to resize. Arrow keys adjust size; Shift uses larger steps. Home restores the default.';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true');
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'path'); lines.setAttribute('d', 'M3 3v10h10M3 8l5 5M3 3l10 10'); icon.append(lines); handle.prepend(icon);
    const help = document.createElement('span'); help.id = 'spatial-resize-help'; help.className = 'sr-only';
    help.textContent = 'Drag the lower left corner. Left makes the assistant wider; right makes it narrower. Down makes it taller; up makes it shorter. Hold Shift for larger steps. Home restores the default size.';
    handle.setAttribute('aria-describedby', help.id); this.#size.className = 'spatial-conversation-size'; this.#size.setAttribute('aria-live', 'polite');
    footer.append(handle, this.#size, help); this.#panel.append(footer);
    const chrome = new ResizeObserver(() => this.#position());
    for (const node of this.#panel.querySelectorAll('.workspace-panel-heading, .spatial-conversation-tools, .spatial-placement-notice, .spatial-conversation-resize, .chat-toolbar, #chat-switcher, .composer-input-row')) chrome.observe(node);
    let gesture: { pointer: number; x: number; y: number; layout: Extract<PanelLayout, { kind: 'manual' }> } | null = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); event.stopPropagation(); handle.focus({ preventScroll: true });
      gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, layout: this.#currentLayout() };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      this.#layout = { ...gesture.layout, width: gesture.layout.width + gesture.x - event.clientX, height: gesture.layout.height + event.clientY - gesture.y };
      this.#position();
    });
    const stop = (event: PointerEvent): void => {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      gesture = null; if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop); handle.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', () => { if (gesture) { const pointer = gesture.pointer; gesture = null; if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer); } });
    handle.addEventListener('keydown', event => {
      if (event.key === 'Home') { event.preventDefault(); this.#layout = { kind: 'automatic' }; this.#panel.dataset.expanded = 'false'; this.#expand.textContent = 'Expand conversation'; this.#position(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 32 : 16; const layout = this.#currentLayout();
      this.#layout = { ...layout, width: layout.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        height: layout.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) };
      this.#position();
    });
  }
  #minimumHeight(): { panel: number; content: number; composer: number; toolbar: number; heading: number; footer: number } {
    const content = this.#panel.querySelector('#workspace-context-content');
    const workspace = this.#panel.querySelector('.chat-workspace');
    const composer = this.#panel.querySelector<HTMLElement>('.chat-composer-form');
    const row = composer?.querySelector('.composer-input-row');
    const fixed = [...this.#panel.children].reduce((height, node) => height + (node === content ? 0 : node.getBoundingClientRect().height), 0);
    const toolbar = [...workspace?.children ?? []].reduce((height, node) => height + (node === composer || node.id === 'request-chat-mount' ? 0 : node.getBoundingClientRect().height), 0);
    const style = composer ? getComputedStyle(composer) : null;
    // Include everything above the actual input, even when its scrollport is currently clipped.
    const inputHeight = composer && row ? row.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + composer.scrollTop
      + (Number.parseFloat(style?.paddingBottom ?? '') || 0) + (Number.parseFloat(style?.borderBottomWidth ?? '') || 0) : 0;
    const essential = Math.max(76, Math.ceil(inputHeight));
    const minimumContent = Math.ceil(toolbar + essential + 96);
    return { panel: Math.ceil(fixed + minimumContent), content: minimumContent, composer: essential, toolbar,
      heading: this.#panel.querySelector('.workspace-panel-heading')?.getBoundingClientRect().height ?? 0,
      footer: this.#panel.querySelector('.spatial-conversation-resize')?.getBoundingClientRect().height ?? 0 };
  }
  #position(): void {
    const width = this.#stage.clientWidth; const height = this.#stage.clientHeight;
    const maxWidth = Math.max(0, width - 16); const maxHeight = Math.max(0, Math.min(height - 16, height * .88));
    const panelWidth = Math.min(maxWidth, this.#layout.kind === 'manual' ? Math.max(280, this.#layout.width) : 358);
    this.#panel.style.width = `${panelWidth}px`;
    const minimum = this.#minimumHeight();
    const positionKey = `${width}:${height}:${this.#panel.dataset.expanded}:${JSON.stringify(this.#layout)}:${minimum.panel}:${minimum.content}:${minimum.composer}:${minimum.heading}:${minimum.footer}`;
    if (this.#positioned && positionKey === this.#positionKey && this.#panel.contains(document.activeElement)) return;
    this.#positionKey = positionKey; this.#positioned = true;
    const desiredHeight = this.#layout.kind === 'manual' ? this.#layout.height : Math.min(720, height * (this.#panel.dataset.expanded === 'true' ? .88 : width < 600 ? .44 : .66));
    const panelHeight = Math.min(maxHeight, Math.max(minimum.panel, desiredHeight));
    const fallback = minimum.panel > maxHeight;
    if (!fallback && this.#panel.dataset.scrollFallback === 'true') this.#panel.scrollTop = 0;
    this.#panel.dataset.scrollFallback = String(fallback);
    this.#panel.style.setProperty('--spatial-composer-min-height', `${minimum.composer}px`);
    this.#panel.style.setProperty('--spatial-chat-fixed-height', `${minimum.toolbar}px`);
    this.#panel.style.setProperty('--spatial-chat-content-min-height', `${minimum.content}px`);
    this.#panel.style.setProperty('--spatial-sticky-heading-height', `${minimum.heading}px`);
    this.#panel.style.setProperty('--spatial-sticky-footer-height', `${minimum.footer}px`);
    this.#panel.style.width = `${panelWidth}px`; this.#panel.style.height = `${panelHeight}px`; this.#panel.style.maxHeight = `${maxHeight}px`;
    this.#size.textContent = `${Math.round(panelWidth)} × ${Math.round(panelHeight)} px`;
    const left = this.#layout.kind === 'manual' ? width - this.#layout.right - panelWidth : this.#anchor && width > 600 ? this.#anchor.x + 65 : width - panelWidth - 12;
    const top = this.#layout.kind === 'manual' ? this.#layout.top : this.#anchor && width > 600 ? this.#anchor.y - panelHeight / 2 : height - panelHeight - 12;
    this.#panel.style.left = `${Math.max(8, Math.min(width - panelWidth - 8, left))}px`;
    this.#panel.style.top = `${Math.max(8, Math.min(height - panelHeight - 8, top))}px`;
  }
}
