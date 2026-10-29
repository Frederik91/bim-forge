import { LinkedModelClient } from './linked-model-client.ts';
import type { LinkedDisplay } from './linked-model-render.ts';
import type { LinkedCatalogItem, LinkedJob, LinkedPrepared, LinkedReview, LinkedSelection } from '../src/linked-model.ts';
import { assertLinkedDisplayOccurrence, linkedSelectionKey } from '../src/linked-model.ts';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.textContent = text; return node; }
function readableProperties(value: unknown): HTMLElement {
  const list = element('dl'); let rows = 0;
  const visit = (item: unknown, label: string, depth: number): void => {
    if (rows >= 128) return;
    if (item !== null && typeof item === 'object') {
      if (depth > 5) { list.append(element('dt', label), element('dd', 'Expand source details for nested values.')); rows++; return; }
      const entries: [string, unknown][] = Object.entries(item);
      for (const [key, child] of entries) { if (rows >= 128) break; visit(child, label ? `${label} · ${key}` : key, depth + 1); }
    } else { list.append(element('dt', label || 'Value'), element('dd', String(item ?? 'Not supplied').slice(0, 512))); rows++; }
  };
  visit(value, '', 0); if (!rows) list.append(element('dd', 'No original properties supplied.'));
  if (rows >= 128) list.append(element('dd', 'Showing the first 128 property values. Full source details are available below.'));
  list.style.overflowWrap = 'anywhere'; return list;
}
export class LinkedModelPanel {
  private readonly input: { host: HTMLElement; client: LinkedModelClient; changed: (links: LinkedDisplay[]) => void; reference: (selection: LinkedSelection) => void; selected: (selection: LinkedSelection | null) => void };
  private projectId: string | null = null;
  private controller = new AbortController();
  private readonly prepared = new Map<string, LinkedPrepared>();
  private readonly hidden = new Set<string>();
  private readonly artifactErrors = new Map<string, string>();
  private links: LinkedJob[] = [];
  private catalog: LinkedCatalogItem[] = [];
  private readonly reviews = new Map<string, LinkedReview>();
  private readonly preparedGeneration = new Map<string, number>();
  private selection: LinkedSelection | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private busy = false;
  private signature = '';
  private message = '';
  private pollError = '';
  constructor(input: LinkedModelPanel['input']) {
    this.input = input; this.timer = setInterval(() => { void this.refresh(); }, 500);
    this.render();
  }
  setProject(projectId: string | null): void {
    if (this.projectId === projectId) return;
    this.controller.abort(); this.controller = new AbortController(); this.projectId = projectId;
    this.prepared.clear(); this.preparedGeneration.clear(); this.reviews.clear(); this.catalog = []; this.artifactErrors.clear(); this.links = []; this.hidden.clear(); this.selection = null; this.message = ''; this.pollError = ''; this.signature = '';
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
      if (signal.aborted || projectId !== this.projectId) return;
      this.links = links; this.pollError = '';
      try {
        const catalog = await this.input.client.catalog(projectId, signal);
        if (signal.aborted || projectId !== this.projectId) return; this.catalog = catalog;
      } catch (error) { if (!signal.aborted) this.pollError = error instanceof Error ? error.message : 'IFC version history unavailable.'; }
      const readyIds = new Set(links.filter(link => link.kind === 'ready').map(link => link.id)); let removed = false;
      for (const [id, prepared] of this.prepared) {
        const link = links.find(link => link.id === id); const generation = this.catalog.find(item => item.state.id === id)?.state.generation;
        if (!readyIds.has(id) || prepared.manifest.source.originalSha256 !== link?.source.originalSha256 || generation !== this.preparedGeneration.get(id)) {
          this.prepared.delete(id); this.preparedGeneration.delete(id); removed = true;
        }
      }
      for (const id of this.artifactErrors.keys()) if (!readyIds.has(id)) this.artifactErrors.delete(id);
      if (removed) {
        if (this.selection && !this.prepared.has(this.selection.occurrence.id)) { this.selection = null; this.input.selected(null); }
        this.publish();
      }
      this.render();
      await Promise.all(links.filter(link => link.kind === 'ready' && !this.prepared.has(link.id)).map(async link => {
        try {
          const prepared = await this.input.client.prepared(projectId, link.id, signal);
          if (signal.aborted || projectId !== this.projectId) return;
          assertLinkedDisplayOccurrence(link.id, prepared);
          if (link.occurrence !== link.id) throw new Error('IFC job ID must match its source occurrence ID.');
          if (prepared.manifest.source.originalSha256 !== link.source.originalSha256 || prepared.manifest.source.namespace !== link.source.namespace || prepared.manifest.source.revision !== link.source.revision) throw new Error('IFC version changed during loading. Refreshing current geometry.');
          const state = this.catalog.find(item => item.state.id === link.id)?.state;
          if (state && JSON.stringify(state.sourceToProjectMetres) !== JSON.stringify(prepared.manifest.occurrence.sourceToProjectMetres)) throw new Error('IFC placement changed during loading. Refreshing current geometry.');
          const generation = state?.generation;
          if (generation !== undefined) this.preparedGeneration.set(link.id, generation);
          this.prepared.set(link.id, prepared); this.artifactErrors.delete(link.id); this.publish(); this.render();
        } catch (error) {
          if (!signal.aborted && projectId === this.projectId) { this.artifactErrors.set(link.id, error instanceof Error ? error.message : 'IFC artifacts unavailable.'); this.render(); }
        }
      }));
    } catch (error) { if (!signal.aborted) { this.pollError = error instanceof Error ? error.message : 'IFC references unavailable.'; this.render(); } }
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
    const signature = JSON.stringify([this.projectId, this.links, this.catalog, [...this.reviews], this.selection, [...this.hidden], this.message, this.pollError, [...this.prepared.keys()], [...this.artifactErrors]]);
    if (signature === this.signature) return; this.signature = signature;
    const root = element('section'); root.setAttribute('aria-label', 'Read-only IFC references');
    root.append(element('h3', 'IFC references'), element('p', 'Read-only source context · IFC4 metre/mm · up to 2 MiB. Derived meshes do not change the native model.'));
    const upload = element('input'); upload.type = 'file'; upload.accept = '.ifc'; upload.disabled = !this.projectId; upload.setAttribute('aria-label', 'Attach IFC reference');
    upload.addEventListener('change', () => { const file = upload.files?.[0]; if (file) void this.action((project, signal) => this.input.client.attach(project, file, signal)); }); root.append(upload);
    const status = element('p', this.pollError || this.message); status.setAttribute('role', 'status'); root.append(status);
    for (const link of this.links) {
      const section = element('section'); section.append(element('h4', link.name), element('p', link.kind === 'running' ? `Converting · ${link.progress}` : link.kind === 'failed' ? `Failed · ${link.error}` : link.kind));
      const catalog = this.catalog.find(item => item.state.id === link.id);
      if (catalog) {
        section.append(element('p', `${catalog.versions.length}/${catalog.revisionLimit} retained source versions · generation ${catalog.state.generation}. Originals and historical references are retained.`));
        const replace = element('input'); replace.type = 'file'; replace.accept = '.ifc'; replace.setAttribute('aria-label', `Prepare replacement for ${link.name}`);
        replace.disabled = catalog.versions.length >= catalog.revisionLimit || catalog.versions.some(version => version.job.kind === 'queued' || version.job.kind === 'running');
        replace.addEventListener('change', () => { const file = replace.files?.[0]; if (file) void this.action((project, signal) => this.input.client.replace(project, link.id, catalog.state.generation, file, signal)); });
        section.append(element('p', 'Prepare a replacement, inspect its changes, then adopt it explicitly.'), replace);
        const history = element('details'); history.append(element('summary', 'Source versions and candidate changes'));
        for (const version of catalog.versions) {
          const job = version.job; const item = element('section');
          item.append(element('h5', `${job.name} · ${version.current ? 'Current' : version.adopted ? 'Historical' : 'Candidate'} · ${job.kind}`));
          item.append(element('p', `Source ${job.source.originalSha256.slice(0, 12)} · ${new Date(job.createdAt).toLocaleString()}`));
          if (job.kind === 'failed') item.append(element('p', `Preparation failed: ${job.error}. Current geometry is preserved.`));
          if (job.kind === 'queued' || job.kind === 'running') {
            const cancel = element('button', 'Cancel candidate'); cancel.type = 'button'; cancel.addEventListener('click', () => { void this.action((project, signal) => this.input.client.cancel(project, job.id, signal)); }); item.append(cancel);
          }
          const source = element('a', 'Download this original'); source.href = this.input.client.versionOriginalUrl(link.projectId, link.id, job.id); source.download = job.name; item.append(source);
          if (job.kind === 'ready' && !version.current && !version.adopted) {
            const review = element('button', 'Review candidate changes'); review.type = 'button';
            review.addEventListener('click', () => { void this.action(async (project, signal) => {
              const result = await this.input.client.review(project, link.id, job.id, signal); if (!signal.aborted) this.reviews.set(job.id, result);
            }); }); item.append(review);
            const result = this.reviews.get(job.id);
            if (result) {
              const delta = result.delta;
              item.append(element('p', `${delta.added.length} added · ${delta.removed.length} removed · ${delta.moved.length} moved · ${delta.geometry.length} geometry · ${delta.properties.length} properties · ${delta.ambiguous.length} ambiguous identities`));
              for (const [kind, ids] of Object.entries(delta)) if (Array.isArray(ids) && ids.length) item.append(element('p', `${kind}: ${ids.join(', ')}`));
              item.append(element('p', delta.correspondence === 'global-id-only' ? 'Cross-version GlobalIds are hints. Changed identities need explicit revalidation; no objects are remapped.' : 'Original source bytes are identical.'));
              for (const loss of result.losses) item.append(element('p', loss));
              const adopt = element('button', 'Adopt reviewed IFC version'); adopt.type = 'button';
              adopt.disabled = result.generation !== catalog.state.generation || result.expectedGeneration !== catalog.state.generation;
              if (adopt.disabled) item.append(element('p', 'Current placement or version changed. Prepare a fresh candidate.'));
              adopt.addEventListener('click', () => { void this.action((project, signal) => this.input.client.adopt(project, link.id, job.id, result.generation, signal)); }); item.append(adopt);
            }
          }
          history.append(item);
        }
        section.append(history);
        if (catalog.state.currentVersionId) section.append(this.placement(link, catalog));
      }
      const artifactError = this.artifactErrors.get(link.id);
      if (artifactError) { const error = element('p', `Artifacts unavailable · ${artifactError}`); error.setAttribute('role', 'status'); section.append(error); }
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
          const properties = readableProperties(object?.properties ?? []);
          properties.style.maxHeight = '22rem'; properties.style.overflow = 'auto'; properties.style.whiteSpace = 'pre-wrap'; properties.style.overflowWrap = 'anywhere';
          const details = element('details'); details.append(element('summary', 'Source binding, units, relationships and conversion losses'));
          const inventory = element('pre', JSON.stringify({ properties: object?.properties ?? [], reference: selection, units: prepared.index.units, relationships: prepared.index.relationships,
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
  private placement(link: LinkedJob, catalog: LinkedCatalogItem): HTMLElement {
    const details = element('details'); details.append(element('summary', 'Occurrence placement in project'));
    const matrix = catalog.state.sourceToProjectMetres;
    if (Math.abs(matrix[2]?.[0] ?? 0) > 1e-7 || Math.abs(matrix[2]?.[1] ?? 0) > 1e-7 || Math.abs((matrix[2]?.[2] ?? 0) - 1) > 1e-7) {
      details.append(element('p', 'This occurrence has a 3D rotation. Placement is read-only in this panel.')); return details;
    }
    const form = element('form'); const fields = [matrix[0]?.[3] ?? 0, matrix[1]?.[3] ?? 0, matrix[2]?.[3] ?? 0, Math.atan2(matrix[1]?.[0] ?? 0, matrix[0]?.[0] ?? 1) * 180 / Math.PI].map((value, index) => {
      const name = ['X metres', 'Y metres', 'Z metres', 'Rotation degrees'][index] ?? '';
      const label = element('label', name); const input = element('input'); input.type = 'number'; input.step = 'any'; input.required = true; input.value = String(value);
      input.setAttribute('aria-label', `${link.name} ${name}`); label.append(input); form.append(label); return input;
    });
    const save = element('button', 'Apply occurrence placement'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', event => {
      event.preventDefault(); const [x = NaN, y = NaN, z = NaN, degrees = NaN] = fields.map(field => field.valueAsNumber);
      if (![x, y, z, degrees].every(Number.isFinite)) return;
      const angle = degrees * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
      void this.action((project, signal) => this.input.client.place(project, link.id, catalog.state.generation, [[c, -s, 0, x], [s, c, 0, y], [0, 0, 1, z], [0, 0, 0, 1]], signal));
    });
    details.append(element('p', 'Changes this occurrence only. Source bytes and product placements remain unchanged.'), form); return details;
  }
  dispose(): void { clearInterval(this.timer); this.controller.abort(); this.input.changed([]); this.input.selected(null); this.input.host.replaceChildren(); }
}
