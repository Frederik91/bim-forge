import type { TaskAgentAnchor, TaskAgentDescriptor, TaskAgentHit, TaskAgentIdentity } from './spatial-task-layer.ts';

const key = (identity: TaskAgentIdentity): string => identity.kind === 'task' ? identity.ticketId : identity.draftId;
const stateLabel: Readonly<Record<TaskAgentDescriptor['state'], string>> = { unsent: 'Unsent draft', queued: 'Queued', working: 'Working', 'needs-input': 'Needs input', ready: 'Ready for review', completed: 'Accepted', failed: 'Failed', cancelled: 'Cancelled', rejected: 'Rejected' };
function control(text: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', action); return node;
}

/** DOM presentation only: the controller owns identities and drafts; the viewer owns projection. */
export class SpatialWorkspacePresentation {
  readonly #stage: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #labels = document.createElement('div');
  readonly #list = document.createElement('section');
  readonly #notice = document.createElement('p');
  readonly #return: HTMLButtonElement;
  readonly #rebind: HTMLButtonElement;
  readonly #open: (identity: TaskAgentIdentity) => void;
  readonly #labelNodes = new Map<string, HTMLButtonElement>();
  readonly #candidates = new Map<string, readonly TaskAgentIdentity[]>();
  #descriptors: readonly TaskAgentDescriptor[] = [];
  #signature = '';
  #anchor: { x: number; y: number } | null = null;
  #positionKey = '';
  #positioned = false;
  #chooser: readonly TaskAgentIdentity[] | undefined;

  constructor(options: { stage: HTMLElement; panel: HTMLElement; open: (identity: TaskAgentIdentity) => void; returnToTask: () => void; rebind: () => void }) {
    this.#stage = options.stage; this.#panel = options.panel; this.#open = options.open;
    this.#stage.classList.add('spatial-workspace-stage'); this.#stage.append(this.#panel);
    this.#panel.classList.add('spatial-conversation');
    this.#labels.className = 'spatial-task-labels'; this.#labels.setAttribute('aria-label', 'Spatial task agents');
    this.#list.className = 'spatial-task-list'; this.#list.id = 'spatial-task-list'; this.#list.hidden = true; this.#list.setAttribute('aria-label', 'Tasks at this place');
    const launcher = control('Tasks', () => { this.#list.hidden = !this.#list.hidden; launcher.setAttribute('aria-expanded', String(!this.#list.hidden)); this.#chooser = undefined; this.#renderList(); });
    launcher.className = 'spatial-task-launcher'; launcher.setAttribute('aria-controls', this.#list.id); launcher.setAttribute('aria-expanded', 'false');
    const tools = document.createElement('div'); tools.className = 'spatial-conversation-tools';
    this.#return = control('Return to task', options.returnToTask); this.#return.id = 'spatial-return-task';
    this.#rebind = control('Refresh draft context', options.rebind); this.#rebind.id = 'spatial-refresh-context'; this.#rebind.hidden = true;
    const expand = control('Expand conversation', () => { const expanded = this.#panel.dataset.expanded !== 'true'; this.#panel.dataset.expanded = String(expanded); expand.textContent = expanded ? 'Short conversation' : 'Expand conversation'; this.#position(); });
    expand.id = 'spatial-expand-conversation';
    tools.append(this.#return, expand, this.#rebind); this.#notice.className = 'spatial-placement-notice'; this.#notice.setAttribute('role', 'status'); this.#notice.hidden = true;
    this.#panel.insertBefore(tools, this.#panel.children[1] ?? null); tools.after(this.#notice);
    this.#stage.append(this.#labels, this.#list);
    (this.#stage.querySelector('.model-card-heading') ?? this.#stage).append(launcher);
    new ResizeObserver(() => this.#position()).observe(this.#stage);
  }
  update(descriptors: readonly TaskAgentDescriptor[], notice: string, canReturn: boolean, needsRebind: boolean): void {
    this.#notice.textContent = notice; this.#notice.hidden = !notice; this.#rebind.hidden = !needsRebind; this.#return.disabled = !canReturn;
    const signature = JSON.stringify(descriptors); if (signature === this.#signature) { this.#position(); return; }
    this.#signature = signature; this.#descriptors = descriptors; this.#labels.replaceChildren(); this.#labelNodes.clear();
    for (const descriptor of descriptors) {
      if (descriptor.placement.kind === 'unplaced') continue;
      const label = control(`${descriptor.selected ? 'Selected · ' : ''}${descriptor.title} · ${stateLabel[descriptor.state]}`, () => { const candidates = this.#candidates.get(key(descriptor.identity)); if (candidates && candidates.length > 1) this.pick({ kind: 'chooser', candidates }); else this.#open(descriptor.identity); });
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
      const node = control(`${descriptor.selected ? 'Selected · ' : ''}${descriptor.title} · ${stateLabel[descriptor.state]}${descriptor.placement.kind === 'unplaced' ? ' · Unplaced' : ''}`, () => { this.#list.hidden = true; this.#open(descriptor.identity); });
      node.dataset.taskId = key(descriptor.identity); this.#list.append(node);
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
  #position(): void {
    const width = this.#stage.clientWidth; const height = this.#stage.clientHeight;
    const positionKey = `${width}:${height}:${this.#panel.dataset.expanded}`;
    if (this.#positioned && positionKey === this.#positionKey && this.#panel.contains(document.activeElement)) return;
    this.#positionKey = positionKey; this.#positioned = true;
    const panelWidth = Math.min(358, Math.max(0, width - 16));
    const panelHeight = Math.min(720, height * (this.#panel.dataset.expanded === 'true' ? .88 : width < 600 ? .44 : .66));
    this.#panel.style.height = `${panelHeight}px`;
    const left = this.#anchor && width > 600 ? this.#anchor.x + 65 : width - panelWidth - 12;
    const top = this.#anchor && width > 600 ? this.#anchor.y - panelHeight / 2 : height - panelHeight - 12;
    this.#panel.style.left = `${Math.max(8, Math.min(width - panelWidth - 8, left))}px`;
    this.#panel.style.top = `${Math.max(8, Math.min(height - panelHeight - 8, top))}px`;
  }
}
