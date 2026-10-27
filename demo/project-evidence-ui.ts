import { MAX_EVIDENCE_PINS, parseEvidencePin } from '../src/model-evidence.ts';
import type { EvidenceEntry, EvidencePin } from '../src/model-evidence.ts';
import { parseRequestSources } from '../src/request-sources.ts';
import type { RequestSource } from '../src/request-sources.ts';
import { admitSourceFiles, uploadSourceFile } from './request-source-ui.ts';
import { ProjectEvidenceClient, privateSourceHref } from './project-evidence-client.ts';
import type { EvidenceHistoryRecord } from './project-evidence-client.ts';

export interface ProjectEvidenceContext {
  projectId: string;
  bindingId?: string;
  target: EvidenceEntry['anchor']['target'];
  revisionId: string;
  selectedObject: { id: string; name: string } | null;
  entityName?: (id: string) => string | undefined;
}
export interface ProjectEvidencePanelOptions {
  useSources: (sources: readonly RequestSource[], context: ProjectEvidenceContext | null, signal: AbortSignal) => void | Promise<void>;
  useEvidence: (pins: readonly EvidencePin[], context: ProjectEvidenceContext | null, signal: AbortSignal) => void | Promise<void>;
  selectEntity?: (anchor: EvidenceEntry['anchor']) => void | Promise<void>;
  client?: ProjectEvidenceClient;
}
type PageState<T, Cursor> = { items: T[]; next: Cursor | null; loaded: boolean; loading: boolean; error: string };
type PendingFile = { kind: 'picked'; file: File; id: string } | { kind: 'uploaded'; source: RequestSource };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function targetLabel(target: ProjectEvidenceContext['target']): string {
  return target.kind === 'main' ? 'main' : `${target.kind} ${target.id}`;
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Project evidence is unavailable. Retry shortly.'; }
function page<T, Cursor>(): PageState<T, Cursor> { return { items: [], next: null, loaded: false, loading: false, error: '' }; }
function propertyLabel(id: string): string {
  const label = id.replace(/[-_:]+/g, ' '); return label.charAt(0).toUpperCase() + label.slice(1);
}
function claimLabel(assertion: EvidenceEntry['assertion']): string {
  if (!('value' in assertion)) return assertion.kind === 'unknown' ? 'Value unknown' : 'Recorded choice';
  const value = assertion.value;
  switch (value.kind) {
    case 'length': case 'duration': return `${value.value} ${value.unit}`;
    case 'angle': return `${value.value}°`;
    case 'number': return String(value.value);
    case 'boolean': return value.value ? 'Yes' : 'No';
    case 'text': return value.value || '(empty text)';
    default: { const exhaustive: never = value; return exhaustive; }
  }
}

/** Presentation of loaded history and explicit chat context. Parent owns model authority. */
export class ProjectEvidencePanel {
  readonly #mount: HTMLElement;
  readonly #options: ProjectEvidencePanelOptions;
  readonly #client: ProjectEvidenceClient;
  #context: ProjectEvidenceContext | null = null;
  #controller = new AbortController();
  #sources = page<RequestSource, string>();
  #evidence = page<EvidenceHistoryRecord, number>();
  #chosenSources: RequestSource[] = [];
  #chosenPins: EvidencePin[] = [];
  #pending: PendingFile | null = null;
  #fileBusy = false;
  #contextBusy = false;
  #notice = '';
  #disposed = false;

  constructor(mount: HTMLElement, options: ProjectEvidencePanelOptions) {
    this.#mount = mount; this.#options = options; this.#client = options.client ?? new ProjectEvidenceClient(); this.#render();
  }
  get selectedSourceDescriptors(): readonly RequestSource[] { return structuredClone(this.#chosenSources); }
  get selectedEvidencePins(): readonly EvidencePin[] { return structuredClone(this.#chosenPins); }
  setSelection(input: { sources: readonly RequestSource[]; pins: readonly EvidencePin[] }): void {
    if (input.pins.length > MAX_EVIDENCE_PINS) throw new Error('Choose at most 32 evidence pins for chat.');
    const pins = input.pins.map(parseEvidencePin);
    if (new Set(pins.map(pin => pin.entryId)).size !== pins.length) throw new Error('Choose each evidence record only once.');
    const sources = input.sources.length ? parseRequestSources([...input.sources]) : [];
    this.#chosenSources = sources; this.#chosenPins = pins; this.#render();
  }

  async show(context: ProjectEvidenceContext): Promise<void> { await this.bind(context); }
  update(context: ProjectEvidenceContext | null): Promise<void> { return this.bind(context); }
  async bind(context: ProjectEvidenceContext | null, reload = false): Promise<void> {
    if (this.#disposed) return;
    const previous = this.#context;
    if (!reload && context && previous && context.projectId === previous.projectId && context.bindingId === previous.bindingId && context.revisionId === previous.revisionId
        && targetLabel(context.target) === targetLabel(previous.target)) {
      this.#context = { ...context }; this.#render(); return;
    }
    this.#controller.abort(); this.#controller = new AbortController();
    this.#context = context ? { ...context } : null;
    this.#sources = page(); this.#evidence = page(); this.#chosenSources = []; this.#chosenPins = [];
    this.#pending = null; this.#fileBusy = false; this.#contextBusy = false; this.#notice = '';
    this.#render();
    if (context) await Promise.all([this.#loadSources(), this.#loadEvidence()]);
  }
  dispose(): void {
    this.#controller.abort(); this.#disposed = true; this.#context = null;
    this.#chosenSources = []; this.#chosenPins = []; this.#pending = null;
    this.#sources = page(); this.#evidence = page(); this.#mount.replaceChildren();
  }

  async #loadSources(): Promise<void> {
    const context = this.#context; const state = this.#sources; const signal = this.#controller.signal;
    if (!context || state.loading || state.loaded && state.next === null) return;
    state.loading = true; state.error = ''; this.#render();
    try {
      const result = await this.#client.sources(context.projectId, state.next, signal);
      if (signal.aborted) return;
      if (result.sources.some(source => state.items.some(item => item.id === source.id))) throw new Error('Source paging repeated a record. Refresh project history.');
      state.items.push(...result.sources); state.next = result.next; state.loaded = true;
    } catch (error) { if (!signal.aborted) state.error = message(error); }
    finally { if (!signal.aborted) { state.loading = false; this.#render(); } }
  }
  async #loadEvidence(): Promise<void> {
    const context = this.#context; const state = this.#evidence; const signal = this.#controller.signal;
    if (!context || state.loading || state.loaded && state.next === null) return;
    state.loading = true; state.error = ''; this.#render();
    try {
      const result = await this.#client.evidence(context.projectId, state.next, signal);
      if (signal.aborted) return;
      if (result.entries.some(record => state.items.some(item => item.entry.id === record.entry.id))) throw new Error('Evidence paging repeated a record. Refresh project history.');
      state.items.push(...result.entries); state.next = result.next; state.loaded = true;
    } catch (error) { if (!signal.aborted) state.error = message(error); }
    finally { if (!signal.aborted) { state.loading = false; this.#render(); } }
  }

  #button(label: string, key: string, action: () => void | Promise<void>, disabled = false): HTMLButtonElement {
    const button = node('button', label, 'text-button'); button.type = 'button'; button.dataset.evidenceKey = key; button.disabled = disabled;
    button.addEventListener('click', () => { void this.#act(action); }); return button;
  }
  async #act(action: () => void | Promise<void>): Promise<void> {
    const signal = this.#controller.signal;
    try { await action(); } catch (error) { if (!signal.aborted) { this.#notice = message(error); this.#render(); } }
  }
  async #use(kind: 'sources' | 'evidence'): Promise<void> {
    if (this.#contextBusy || !this.#context) return;
    const signal = this.#controller.signal; this.#contextBusy = true; this.#notice = ''; this.#render();
    try {
      if (kind === 'sources') await this.#options.useSources(this.selectedSourceDescriptors, this.#context, signal);
      else await this.#options.useEvidence(this.selectedEvidencePins, this.#context, signal);
      if (!signal.aborted) this.#notice = 'Chosen context sent to chat. Historical records still require applicability checks and review.';
    } catch (error) { if (!signal.aborted) this.#notice = message(error); }
    finally { if (!signal.aborted) { this.#contextBusy = false; this.#render(); } }
  }

  async refresh(): Promise<void> {
    const context = this.#context;
    if (!context || this.#disposed) return;
    await this.bind(context, true);
  }
  async #upload(): Promise<void> {
    const pending = this.#pending; const context = this.#context;
    if (!pending || pending.kind !== 'picked' || !context || this.#fileBusy) return;
    const signal = this.#controller.signal; this.#fileBusy = true; this.#notice = ''; this.#render();
    try {
      const source = await uploadSourceFile({ projectId: context.projectId, id: pending.id, file: pending.file, signal });
      if (!signal.aborted) { this.#pending = { kind: 'uploaded', source }; this.#notice = 'Uploaded privately. Choose Retain in project to add it to project sources.'; }
    } catch (error) { if (!signal.aborted) this.#notice = message(error); }
    finally { if (!signal.aborted) { this.#fileBusy = false; this.#render(); } }
  }
  async #retain(): Promise<void> {
    const pending = this.#pending; const context = this.#context;
    if (!pending || pending.kind !== 'uploaded' || !context || this.#fileBusy) return;
    const signal = this.#controller.signal; this.#fileBusy = true; this.#notice = ''; this.#render();
    try {
      await this.#client.retain(context.projectId, pending.source, signal);
      if (!signal.aborted) {
        this.#pending = null; this.#sources = page(); this.#notice = 'Source retained in project. Choose it explicitly for chat.';
        await this.#loadSources();
      }
    } catch (error) { if (!signal.aborted) this.#notice = message(error); }
    finally { if (!signal.aborted) { this.#fileBusy = false; this.#render(); } }
  }

  #paging<T, Cursor>(host: HTMLElement, state: PageState<T, Cursor>, noun: string, load: () => Promise<void>): void {
    host.setAttribute('aria-busy', String(state.loading));
    const status = node('p', state.loading ? `Loading ${noun}…` : state.error ? state.error
      : state.loaded ? `${state.items.length} ${noun} loaded. ${state.next === null ? 'End of available history at this fetch.' : 'More project history is available.'}` : `${noun} not loaded.`);
    status.setAttribute('role', state.error ? 'alert' : 'status'); status.tabIndex = -1; status.dataset.evidenceKey = `status-${noun}`; host.append(status);
    if (state.loading || state.error || !state.loaded || state.next !== null) {
      host.append(this.#button(state.error ? `Retry ${noun}` : `Load more ${noun}`, `more-${noun}`, load, state.loading));
    }
  }
  #choice(label: string, key: string, checked: boolean, choose: (checked: boolean) => void, visibleLabel = label): HTMLElement {
    const wrapper = node('label', undefined, 'source-actions'); const input = node('input'); input.type = 'checkbox';
    input.checked = checked; input.disabled = this.#contextBusy; input.dataset.evidenceKey = key;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => { void this.#act(() => choose(input.checked)); });
    wrapper.append(input, node('span', visibleLabel)); return wrapper;
  }
  #sourceLink(projectId: string, sourceId: string, label: string): HTMLAnchorElement {
    const link = node('a', label, 'source-download'); link.href = privateSourceHref(projectId, sourceId); return link;
  }
  #reference(id: string, hash?: string): HTMLElement {
    const loaded = this.#evidence.items.find(record => record.entry.id === id);
    const host = node('p', `${id}${hash ? ` · SHA-256 ${hash}` : ''}`);
    if (loaded && (!hash || loaded.pin.hash === hash)) {
      host.append(this.#button(`Inspect record ${id}`, `inspect-${id}`, () => {
        const card = Array.from(this.#mount.querySelectorAll<HTMLElement>('[data-entry-id]')).find(item => item.dataset.entryId === id);
        card?.focus(); card?.scrollIntoView({ block: 'nearest' });
      }));
    } else host.append(node('small', 'Referenced record is not in loaded history. Load more or request its exact pin; availability is unverified.'));
    return host;
  }
  #record(record: EvidenceHistoryRecord, context: ProjectEvidenceContext): HTMLElement {
    const { entry, pin } = record; const card = node('li', undefined, 'source-item card'); card.tabIndex = -1; card.dataset.entryId = entry.id;
    const copy = node('div', undefined, 'source-copy');
    const displayName = context.entityName?.(entry.anchor.entityId);
    const assertion = entry.assertion;
    copy.append(node('h4', `${displayName || entry.anchor.entityId} · ${propertyLabel(entry.property.definitionId)}`),
      node('p', `${claimLabel(assertion)} · ${assertion.kind}`),
      node('p', 'Historical record; current applicability and acceptance are not established.'));
    const provenance = node('details', undefined, 'source-reference');
    provenance.append(node('summary', 'Provenance and history'), node('p', `Record ${entry.id} · Property ${entry.property.definitionId}`),
      node('p', `Anchor object ${entry.anchor.entityId}${displayName ? ` · Current display name: ${displayName}` : ''}`),
      node('p', `Project ${entry.anchor.projectId} · Target ${targetLabel(entry.anchor.target)}`),
      node('p', `Revision ${entry.anchor.revisionId} · Body SHA-256 ${entry.anchor.bodyHash}`),
      node('p', `Record SHA-256 ${pin.hash} · Value kind ${entry.property.valueKind}`));
    if ('value' in assertion) provenance.append(node('p', `Raw claimed value: ${JSON.stringify(assertion.value)}`));
    if ('rationale' in assertion) provenance.append(node('p', `Rationale: ${assertion.rationale}`));
    if (assertion.kind === 'unknown') provenance.append(node('p', `Unknown: ${assertion.reason}`));
    if ('citations' in assertion) for (const citation of assertion.citations) {
      const source = this.#sources.items.find(item => item.id === citation.sourceId && item.sha256 === citation.sha256);
      const citationCopy = node('p');
      citationCopy.append(this.#sourceLink(context.projectId, citation.sourceId, source?.name ?? 'Source file (metadata not loaded)'),
        node('span', ` · ${citation.locator.length > 240 ? `${citation.locator.slice(0, 240)}…` : citation.locator}`));
      if (!source) citationCopy.append(node('small', 'Source metadata not loaded or hash differs; authorized download may be unavailable.'));
      copy.append(citationCopy);
      provenance.append(node('p', `Citation: ${citation.locator} · Source ${citation.sourceId} · Source SHA-256 ${citation.sha256}`));
    }
    if (entry.predecessor) provenance.append(node('strong', 'Corrects record'), this.#reference(entry.predecessor.entryId, entry.predecessor.hash));
    for (const correction of this.#evidence.items.filter(item => item.entry.predecessor?.entryId === entry.id && item.entry.predecessor.hash === pin.hash)) {
      provenance.append(node('strong', 'Correction in loaded history'), this.#reference(correction.entry.id, correction.pin.hash));
    }
    if ('basis' in assertion) for (const basis of assertion.basis) provenance.append(node('strong', 'Basis'), this.#reference(basis.entryId, basis.hash));
    if (assertion.kind === 'resolution') {
      provenance.append(node('p', `Recorded resolution selected ${assertion.selectedEntryId}; no automatic global resolution is performed.`));
      for (const id of assertion.candidateIds) provenance.append(this.#reference(id));
    }
    copy.append(provenance);
    const actions = node('div', undefined, 'source-actions');
    actions.append(this.#choice(`Choose record ${entry.id} for chat`, `pin-${entry.id}`, this.#chosenPins.some(item => item.entryId === pin.entryId), checked => {
      if (checked && this.#chosenPins.length >= MAX_EVIDENCE_PINS) throw new Error('Choose at most 32 evidence pins for chat.');
      this.#chosenPins = checked ? [...this.#chosenPins, pin] : this.#chosenPins.filter(item => item.entryId !== pin.entryId); this.#render();
    }, 'Choose record for chat'));
    if (this.#options.selectEntity) actions.append(this.#button('Inspect anchor object', `anchor-${entry.id}`, () => this.#options.selectEntity?.(structuredClone(entry.anchor))));
    card.append(copy, actions); return card;
  }

  #render(): void {
    if (this.#disposed) return;
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && this.#mount.contains(active) ? active.dataset.evidenceKey : undefined;
    const panel = node('section', undefined, 'project-evidence-panel'); panel.tabIndex = -1; panel.setAttribute('aria-label', 'Project sources and evidence history');
    panel.append(node('h2', 'Project sources and evidence'));
    const context = this.#context;
    if (!context) panel.append(node('p', 'Choose a project to inspect retained sources and evidence history.', 'source-scope-note'));
    else {
      const displayed = node('details', undefined, 'source-reference');
      displayed.append(node('summary', 'Displayed context'), node('p', `Displaying ${context.projectId} · ${targetLabel(context.target)} · Revision ${context.revisionId}`));
      panel.append(node('p', context.selectedObject ? `Current selection: ${context.selectedObject.name} (${context.selectedObject.id})` : 'Current selection: none'),
        node('p', 'Project-wide history, without selection filtering. Loaded records are not a current fact set.', 'source-scope-note'));
      panel.append(displayed);
      panel.append(this.#button('Refresh project history', 'refresh', () => this.refresh(), this.#fileBusy || this.#contextBusy));
      const sources = node('section'); sources.setAttribute('aria-label', 'Retained project sources'); sources.append(node('h3', 'Retained sources'));
      const list = node('ul', undefined, 'source-list');
      for (const source of this.#sources.items) {
        const item = node('li', undefined, 'source-item'); const copy = node('div', undefined, 'source-copy');
        const link = this.#sourceLink(context.projectId, source.id, source.name); link.download = source.name;
        const details = node('details', undefined, 'source-reference');
        details.append(node('summary', 'Details'), node('p', `Source ${source.id}`), node('p', `SHA-256 ${source.sha256}`));
        copy.append(link, node('small', `${source.mediaType} · ${source.byteLength} bytes`), details);
        item.append(copy, this.#choice(`Choose ${source.name} for chat`, `source-${source.id}`, this.#chosenSources.some(item => item.id === source.id), checked => {
          this.#chosenSources = checked ? parseRequestSources([...this.#chosenSources, source]) : this.#chosenSources.filter(item => item.id !== source.id); this.#render();
        })); list.append(item);
      }
      sources.append(list); this.#paging(sources, this.#sources, 'sources', () => this.#loadSources());
      sources.append(this.#button(`Use chosen files in chat (${this.#chosenSources.length})`, 'use-sources', () => this.#use('sources'), this.#contextBusy));
      const input = node('input'); input.type = 'file'; input.accept = '.png,.jpg,.jpeg,.webp,.pdf,.txt,.md';
      input.setAttribute('aria-label', 'Add a private project source file'); input.dataset.evidenceKey = 'file'; input.disabled = this.#fileBusy || this.#pending !== null;
      input.addEventListener('change', () => {
        const file = input.files?.[0]; if (!file) return;
        void this.#act(async () => {
          admitSourceFiles([file], { count: 0, bytes: 0 }); this.#pending = { kind: 'picked', file, id: crypto.randomUUID() }; await this.#upload();
        });
      }); sources.append(input);
      if (this.#pending) {
        sources.append(node('p', this.#pending.kind === 'uploaded' ? `Uploaded: ${this.#pending.source.name}. Awaiting explicit retention.` : `File: ${this.#pending.file.name}`),
          this.#pending.kind === 'uploaded'
            ? this.#button('Retain in project', 'retain', () => this.#retain(), this.#fileBusy)
            : this.#button('Retry private upload', 'upload', () => this.#upload(), this.#fileBusy),
          this.#button('Discard pending file', 'discard', () => { this.#pending = null; this.#notice = ''; this.#render(); }, this.#fileBusy));
      }
      if (this.#fileBusy) { const status = node('p', 'Saving source metadata or uploading privately…'); status.setAttribute('role', 'status'); sources.append(status); }
      const history = node('section'); history.setAttribute('aria-label', 'Project evidence history'); history.append(node('h3', 'Evidence history'));
      const records = node('ul', undefined, 'source-list');
      for (const record of this.#evidence.items) records.append(this.#record(record, context));
      history.append(records); this.#paging(history, this.#evidence, 'records', () => this.#loadEvidence());
      history.append(this.#button(`Use chosen records in chat (${this.#chosenPins.length})`, 'use-evidence', () => this.#use('evidence'), this.#contextBusy));
      panel.append(sources, history);
    }
    const notice = node('p', this.#notice); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); panel.append(notice);
    this.#mount.replaceChildren(panel);
    if (focusKey) {
      const elements = Array.from(panel.querySelectorAll<HTMLElement>('[data-evidence-key]'));
      const fallback = focusKey.startsWith('more-') ? `status-${focusKey.slice(5)}` : 'file';
      (elements.find(item => item.dataset.evidenceKey === focusKey)
        ?? elements.find(item => item.dataset.evidenceKey === fallback) ?? panel).focus();
    }
  }
}
