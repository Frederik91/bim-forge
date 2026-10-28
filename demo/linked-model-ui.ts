import { LinkedModelClient } from './linked-model-client.ts';
import type { LinkedDisplay } from './linked-model-render.ts';
import type { LinkedJob, LinkedPrepared, LinkedSelection } from '../src/linked-model.ts';
import { linkedSelectionKey } from '../src/linked-model.ts';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.textContent = text; return node; }
export class LinkedModelPanel {
  private readonly input: { host: HTMLElement; client: LinkedModelClient; changed: (links: LinkedDisplay[]) => void; reference: (selection: LinkedSelection) => void; selected: (selection: LinkedSelection | null) => void };
  private projectId: string | null = null;
  private controller = new AbortController();
  private readonly prepared = new Map<string, LinkedPrepared>();
  private readonly hidden = new Set<string>();
  private links: LinkedJob[] = [];
  private selection: LinkedSelection | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private busy = false;
  private signature = '';
  private message = '';
  constructor(input: LinkedModelPanel['input']) {
    this.input = input; this.timer = setInterval(() => { void this.refresh(); }, 500);
    this.render();
  }
  setProject(projectId: string | null): void {
    if (this.projectId === projectId) return;
    this.controller.abort(); this.controller = new AbortController(); this.projectId = projectId;
    this.prepared.clear(); this.links = []; this.hidden.clear(); this.selection = null; this.message = ''; this.signature = '';
    this.input.changed([]); this.input.selected(null); this.render(); void this.refresh();
  }
  select(selection: LinkedSelection | null): void {
    if (selection && ![...this.prepared.values()].some(prepared => prepared.manifest.occurrence.id === selection.occurrence.id
      && prepared.index.objects.some(object => linkedSelectionKey({ kind: 'ifc-reference', source: object.ref, occurrence: prepared.manifest.occurrence }) === linkedSelectionKey(selection)))) return;
    this.selection = selection; this.input.selected(selection); this.signature = ''; this.render();
  }
  private publish(): void { this.input.changed([...this.prepared].map(([id, prepared]) => ({ id, prepared, visible: !this.hidden.has(id) }))); }
  async refresh(): Promise<void> {
    if (this.busy || !this.projectId) return;
    this.busy = true; const projectId = this.projectId; const signal = this.controller.signal;
    try {
      const links = await this.input.client.list(projectId, signal);
      const ready: [string, LinkedPrepared][] = [];
      for (const link of links) if (link.kind === 'ready' && !this.prepared.has(link.id)) ready.push([link.id, await this.input.client.prepared(projectId, link.id, signal)]);
      if (signal.aborted || projectId !== this.projectId) return;
      this.links = links; for (const [id, prepared] of ready) this.prepared.set(id, prepared);
      if (ready.length) this.publish(); this.render();
    } catch (error) { if (!signal.aborted) { this.message = error instanceof Error ? error.message : 'IFC references unavailable.'; this.render(); } }
    finally { this.busy = false; }
  }
  private async action(work: (projectId: string, signal: AbortSignal) => Promise<void>): Promise<void> {
    if (!this.projectId) return;
    const projectId = this.projectId; const signal = this.controller.signal;
    try { await work(projectId, signal); if (!signal.aborted) this.message = ''; }
    catch (error) { if (!signal.aborted) this.message = error instanceof Error ? error.message : 'IFC operation failed.'; }
    if (!signal.aborted) { this.signature = ''; this.render(); await this.refresh(); }
  }
  private render(): void {
    const signature = JSON.stringify([this.projectId, this.links, this.selection, [...this.hidden], this.message, [...this.prepared.keys()]]);
    if (signature === this.signature) return; this.signature = signature;
    const root = element('section'); root.setAttribute('aria-label', 'Read-only IFC references');
    root.append(element('h3', 'IFC references'), element('p', 'Read-only source context · IFC4 metre/mm · up to 2 MiB. Derived meshes do not change the native model.'));
    const upload = element('input'); upload.type = 'file'; upload.accept = '.ifc'; upload.disabled = !this.projectId; upload.setAttribute('aria-label', 'Attach IFC reference');
    upload.addEventListener('change', () => { const file = upload.files?.[0]; if (file) void this.action((project, signal) => this.input.client.attach(project, file, signal)); }); root.append(upload);
    const status = element('p', this.message); status.setAttribute('role', 'status'); root.append(status);
    for (const link of this.links) {
      const section = element('section'); section.append(element('h4', link.name), element('p', link.kind === 'running' ? `Converting · ${link.progress}` : link.kind === 'failed' ? `Failed · ${link.error}` : link.kind));
      if (link.kind === 'queued' || link.kind === 'running') {
        const cancel = element('button', 'Cancel conversion'); cancel.type = 'button'; cancel.addEventListener('click', () => { void this.action((project, signal) => this.input.client.cancel(project, link.id, signal)); }); section.append(cancel);
      }
      const original = element('a', 'Download authoritative original'); original.href = this.input.client.originalUrl(link.projectId, link.id); original.download = 'original.ifc'; section.append(original);
      const prepared = this.prepared.get(link.id);
      if (prepared) {
        const label = element('label', ' Show linked geometry '); const visible = element('input'); visible.type = 'checkbox'; visible.checked = !this.hidden.has(link.id);
        visible.addEventListener('change', () => { if (visible.checked) this.hidden.delete(link.id); else { this.hidden.add(link.id); if (this.selection?.occurrence.id === link.id) this.select(null); } this.publish(); }); label.prepend(visible); section.append(label);
        const objects = new Map(prepared.index.objects.map(object => [object.ref.globalId, object])); const visited = new Set<string>(); const tree = element('ul'); tree.setAttribute('aria-label', `${link.name} spatial hierarchy`);
        const add = (id: string, list: HTMLUListElement, depth: number) => {
          const object = objects.get(id); if (!object || visited.has(id) || depth > 32) return; visited.add(id);
          const item = element('li'); const button = element('button', `${object.name ?? object.ifcClass} · ${object.ifcClass}`); button.type = 'button';
          button.addEventListener('click', () => this.select({ kind: 'ifc-reference', source: object.ref, occurrence: prepared.manifest.occurrence })); item.append(button);
          const children = element('ul'); for (const edge of prepared.index.spatial) if (edge.parent === id) add(edge.child, children, depth + 1);
          if (children.children.length) item.append(children); list.append(item);
        };
        for (const id of objects.keys()) if (!prepared.index.spatial.some(edge => edge.child === id)) add(id, tree, 0);
        for (const id of objects.keys()) add(id, tree, 0); section.append(tree);
        if (this.selection?.occurrence.id === link.id) {
          const selection = this.selection; const object = objects.get(selection.source.globalId);
          const inspector = element('section'); inspector.setAttribute('aria-label', 'Original IFC properties and conversion losses');
          inspector.append(element('h4', `${object?.name ?? object?.ifcClass ?? 'Source object'} · original properties`),
            element('p', 'Properties belong to this source object. Type properties remain on the type object.'));
          const properties = element('pre', JSON.stringify(object?.properties ?? [], null, 2));
          properties.style.maxHeight = '22rem'; properties.style.overflow = 'auto'; properties.style.whiteSpace = 'pre-wrap'; properties.style.overflowWrap = 'anywhere';
          const details = element('details'); details.append(element('summary', 'Source binding, units, relationships and conversion losses'));
          const inventory = element('pre', JSON.stringify({ reference: selection, units: prepared.index.units, relationships: prepared.index.relationships,
            georeferencing: prepared.index.georeferencing, diagnostics: prepared.manifest.diagnostics, losses: prepared.manifest.losses }, null, 2));
          inventory.style.maxHeight = '22rem'; inventory.style.overflow = 'auto'; inventory.style.whiteSpace = 'pre-wrap'; inventory.style.overflowWrap = 'anywhere'; details.append(inventory);
          inspector.append(properties, details);
          const reference = element('button', 'Reference in request'); reference.type = 'button'; reference.addEventListener('click', () => this.input.reference(selection)); section.append(inspector, reference);
        }
      }
      root.append(section);
    }
    this.input.host.replaceChildren(root);
  }
  dispose(): void { clearInterval(this.timer); this.controller.abort(); this.input.changed([]); this.input.selected(null); this.input.host.replaceChildren(); }
}
