import {
  MAX_REQUEST_SOURCES, MAX_REQUEST_SOURCE_BYTES, MAX_SOURCE_BYTES,
  parseAuthoringScope, parseRequestSources, sourceMediaType, sourceName,
} from '../src/request-sources.ts';
import type { AuthoringScope, RequestSource, SourceMediaType } from '../src/request-sources.ts';

export interface RequestSourceContext { sources?: readonly RequestSource[]; authoringScope?: AuthoringScope }

export function parseSourceContext(value: unknown): RequestSourceContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source context.');
  return {
    ...('sources' in value ? { sources: parseRequestSources(value.sources) } : {}),
    ...('authoringScope' in value ? { authoringScope: parseAuthoringScope(value.authoringScope) } : {}),
  };
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function sourceUrl(projectId: string, id: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(id)}`;
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function sourceLink(projectId: string, source: RequestSource): HTMLAnchorElement {
  const link = node('a', source.name, 'source-download');
  link.href = sourceUrl(projectId, source.id);
  link.download = source.name;
  return link;
}

function referenceDetails(source: RequestSource): HTMLElement {
  const details = node('details', undefined, 'source-reference');
  details.append(node('summary', `SHA-256 ${source.sha256.slice(0, 12)}…`),
    node('p', `Source ${source.id}`), node('code', source.sha256));
  return details;
}

export function renderSourceContext(host: HTMLElement, projectId: string, context: RequestSourceContext, previews = false): void {
  host.replaceChildren();
  host.hidden = !context.sources?.length && !context.authoringScope;
  if (context.authoringScope) host.append(node('p', context.authoringScope === 'building-reconstruction'
    ? 'Whole-building reconstruction · levels, rooms, stairs and roof proposed for review.'
    : 'One-storey reconstruction · walls, rooms and openings; other levels retained.', 'source-scope-note'));
  if (!context.sources?.length) return;
  host.append(node('h3', 'Request sources'));
  const list = node('ul', undefined, 'source-list');
  for (const source of context.sources) {
    const item = node('li', undefined, 'source-item');
    if (previews && source.mediaType.startsWith('image/')) {
      const image = node('img', undefined, 'source-preview');
      image.src = sourceUrl(projectId, source.id); image.alt = `Source preview: ${source.name}`;
      image.loading = 'lazy'; item.append(image);
    }
    const copy = node('div', undefined, 'source-copy');
    copy.append(sourceLink(projectId, source), node('small', `${source.mediaType} · ${sizeLabel(source.byteLength)}`), referenceDetails(source));
    item.append(copy); list.append(item);
  }
  host.append(list);
}

type UploadState = { kind: 'pending' } | { kind: 'uploading'; controller: AbortController }
  | { kind: 'failed'; message: string } | { kind: 'ready'; source: RequestSource };
type PickedSource = { kind: 'picked'; id: string; name: string; file: File; mediaType: SourceMediaType; previewUrl: string | null; upload: UploadState };
type SourceEntry = PickedSource | { kind: 'retained'; source: RequestSource };

export function admitSourceFiles(files: readonly File[], existing: { count: number; bytes: number }) {
  if (existing.count + files.length > MAX_REQUEST_SOURCES) throw new Error('Choose at most four source files.');
  if (existing.bytes + files.reduce((sum, file) => sum + file.size, 0) > MAX_REQUEST_SOURCE_BYTES) throw new Error('Sources must total at most 12 MiB.');
  return files.map(file => {
    if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('Each source must contain between 1 byte and 6 MiB.');
    const name = sourceName(file.name);
    const extension = name.split('.').pop()?.toLowerCase();
    const mediaType = sourceMediaType(extension === 'md' ? 'text/markdown' : extension === 'txt' ? 'text/plain' : file.type);
    return { file, name, mediaType };
  });
}

function reference(entry: SourceEntry): RequestSource | null {
  return entry.kind === 'retained' ? entry.source : entry.upload.kind === 'ready' ? entry.upload.source : null;
}

export class RequestSourcePicker {
  #entries: SourceEntry[] = [];
  #projectId: string | null = null;
  #disabled = true;
  #draining = false;
  #error = '';
  #draftKey = '';
  readonly #drafts = new Map<string, { entries: SourceEntry[]; error: string }>();
  readonly #ui: { input: HTMLInputElement; list: HTMLElement; status: HTMLElement; error: HTMLElement };
  readonly #changed: () => void;

  constructor(ui: { input: HTMLInputElement; list: HTMLElement; status: HTMLElement; error: HTMLElement; paste: HTMLTextAreaElement }, changed: () => void) {
    this.#ui = ui; this.#changed = changed;
    ui.input.addEventListener('change', () => {
      const files = Array.from(ui.input.files ?? []); ui.input.value = '';
      this.addFiles(files);
      if (files.length) ui.paste.focus();
    });
    ui.paste.addEventListener('paste', event => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length || this.#disabled) return;
      // Leave mixed text/file paste to the browser's native text insertion.
      if (!event.clipboardData?.getData('text/plain')) event.preventDefault();
      this.addFiles(files);
    });
  }

  chooseFiles(): boolean {
    if (this.#ui.input.disabled) {
      this.#error = 'Remove an attachment before adding more files.'; this.#render(); return false;
    }
    this.#ui.input.click(); return true;
  }

  addFiles(files: readonly File[]): void {
    if (this.#disabled || !this.#projectId || !files.length) return;
    try {
        const admitted = admitSourceFiles(files, { count: this.#entries.length,
          bytes: this.#entries.reduce((sum, entry) => sum + (entry.kind === 'picked' ? entry.file.size : entry.source.byteLength), 0) });
        const entries = admitted.map(({ file, name, mediaType }): PickedSource => ({
          kind: 'picked', id: crypto.randomUUID(), file, name, mediaType,
          previewUrl: mediaType.startsWith('image/') ? URL.createObjectURL(file) : null, upload: { kind: 'pending' },
        }));
        this.#entries.push(...entries); this.#error = ''; this.#render();
        void this.#drainUploads();
    } catch (error) {
        this.#error = error instanceof Error ? error.message : 'These files could not be attached.';
        this.#render();
    }
  }

  get hasSources(): boolean { return this.#entries.length > 0; }
  hasDraft(key: string): boolean { return key === this.#draftKey ? this.hasSources : Boolean(this.#drafts.get(key)?.entries.length); }
  get hasAnySources(): boolean { return this.hasSources || [...this.#drafts].some(([key, draft]) => key !== this.#draftKey && draft.entries.length > 0); }
  get ready(): boolean { return this.#entries.every(entry => reference(entry) !== null); }
  get uploading(): boolean { return this.#entries.some(entry => entry.kind === 'picked' && (entry.upload.kind === 'uploading' || entry.upload.kind === 'pending')); }
  get sources(): readonly RequestSource[] {
    return this.#entries.map(entry => {
      const source = reference(entry);
      if (!source) throw new Error('Finish or retry source uploads before sending this request.');
      return source;
    });
  }

  setDisabled(disabled: boolean): void {
    this.#disabled = disabled;
    this.#ui.input.disabled = disabled || this.#entries.length >= MAX_REQUEST_SOURCES;
    for (const button of this.#ui.list.querySelectorAll('button')) button.disabled = disabled;
  }

  setProject(projectId: string | null): void {
    if (projectId === this.#projectId) return;
    this.#drafts.set(this.#draftKey, { entries: this.#entries, error: this.#error });
    this.#projectId = projectId; this.#draftKey = `${projectId}:new`;
    const draft = this.#drafts.get(this.#draftKey);
    this.#entries = draft?.entries ?? []; this.#error = draft?.error ?? ''; this.#render();
  }

  switchDraft(key: string): void {
    if (key === this.#draftKey) return;
    this.#drafts.set(this.#draftKey, { entries: this.#entries, error: this.#error });
    this.#draftKey = key; const draft = this.#drafts.get(key);
    this.#entries = draft?.entries ?? []; this.#error = draft?.error ?? ''; this.#render(); void this.#drainUploads();
  }

  restore(projectId: string, sources: readonly RequestSource[]): void {
    this.clear(); this.#projectId = projectId;
    this.#entries = sources.map(source => ({ kind: 'retained', source })); this.#render();
  }

  clear(): void {
    for (const entry of this.#entries) this.#release(entry);
    this.#entries = []; this.#drafts.delete(this.#draftKey); this.#error = ''; this.#ui.input.value = ''; this.#render();
  }

  releasePreviews(): void {
    for (const entry of new Set([...this.#entries, ...[...this.#drafts.values()].flatMap(draft => draft.entries)])) {
      if (entry.kind === 'picked' && entry.previewUrl) { URL.revokeObjectURL(entry.previewUrl); entry.previewUrl = null; }
    }
  }

  #release(entry: SourceEntry): void {
    if (entry.kind !== 'picked') return;
    if (entry.upload.kind === 'uploading') entry.upload.controller.abort();
    if (entry.previewUrl) { URL.revokeObjectURL(entry.previewUrl); entry.previewUrl = null; }
  }

  async #drainUploads(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (true) {
        const entry = this.#entries.find((item): item is PickedSource => item.kind === 'picked' && item.upload.kind === 'pending');
        if (!entry) break;
        await this.#upload(entry);
      }
    } finally { this.#draining = false; }
  }

  async #upload(entry: PickedSource): Promise<void> {
    const projectId = this.#projectId;
    if (!projectId || !this.#entries.includes(entry) || entry.upload.kind === 'uploading' || entry.upload.kind === 'ready') return;
    const entries = this.#entries;
    const controller = new AbortController(); entry.upload = { kind: 'uploading', controller }; this.#render();
    try {
      const response = await fetch(sourceUrl(projectId, entry.id), {
        method: 'POST', headers: { 'Content-Type': entry.mediaType, 'X-Source-Name': encodeURIComponent(entry.name) },
        body: entry.file, signal: controller.signal,
      });
      if (!response.ok) {
        let message = `Upload failed (HTTP ${response.status}). Retry this file.`;
        try {
          const failure: unknown = await response.json();
          if (failure && typeof failure === 'object' && 'error' in failure && typeof failure.error === 'string') {
            const detail = failure.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
            if (detail) message = detail;
          }
        } catch { /* Non-JSON responses retain the HTTP fallback. */ }
        throw new Error(message);
      }
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('source' in value)) throw new Error('Upload returned an invalid source reference.');
      const source = parseRequestSources([value.source])[0];
      if (!source || source.id !== entry.id || source.name !== entry.name || source.mediaType !== entry.mediaType || source.byteLength !== entry.file.size) throw new Error('Upload returned a different source reference.');
      if (!controller.signal.aborted && entries.includes(entry)) {
        entry.upload = { kind: 'ready', source };
        if (entry.previewUrl) { URL.revokeObjectURL(entry.previewUrl); entry.previewUrl = null; }
      }
    } catch (error) {
      if (!controller.signal.aborted && entries.includes(entry)) entry.upload = { kind: 'failed', message: error instanceof Error ? error.message : 'Upload interrupted. Retry this file.' };
    } finally {
      if (this.#entries === entries && entries.includes(entry)) this.#render(); else this.#changed();
    }
  }

  #render(): void {
    this.#ui.list.replaceChildren();
    for (const entry of this.#entries) {
      const source = reference(entry); const name = entry.kind === 'picked' ? entry.name : entry.source.name;
      const item = node('li', undefined, 'source-item');
      const imageUrl = source?.mediaType.startsWith('image/') && this.#projectId ? sourceUrl(this.#projectId, source.id)
        : entry.kind === 'picked' ? entry.previewUrl : null;
      if (imageUrl) { const image = node('img', undefined, 'source-preview'); image.src = imageUrl; image.alt = `Source preview: ${name}`; item.append(image); }
      const copy = node('div', undefined, 'source-copy');
      copy.append(source && this.#projectId ? sourceLink(this.#projectId, source) : node('strong', name));
      const state = source ? `Uploaded · ${sizeLabel(source.byteLength)}` : entry.kind === 'picked' && entry.upload.kind === 'failed' ? entry.upload.message
        : entry.kind === 'picked' && entry.upload.kind === 'pending' ? 'Waiting to upload…' : 'Uploading…';
      copy.append(node('small', state));
      const actions = node('div', undefined, 'source-actions');
      if (entry.kind === 'picked' && entry.upload.kind === 'failed') {
        const retry = node('button', 'Retry upload', 'text-button'); retry.type = 'button'; retry.setAttribute('aria-label', `Retry upload of ${name}`);
        retry.addEventListener('click', () => { entry.upload = { kind: 'pending' }; this.#render(); void this.#drainUploads(); }); actions.append(retry);
      }
      const remove = node('button', 'Remove', 'text-button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${name} from this request`);
      remove.addEventListener('click', () => {
        this.#release(entry); this.#entries = this.#entries.filter(item => item !== entry); this.#error = ''; this.#render();
        const composer = document.getElementById('request-text'); if (composer instanceof HTMLTextAreaElement) composer.focus();
      });
      actions.append(remove); item.append(copy, actions); this.#ui.list.append(item);
    }
    this.#ui.status.textContent = this.uploading ? 'Uploading sources before submission…' : !this.ready ? 'Retry or remove failed uploads before sending.'
      : this.hasSources ? `${this.#entries.length} of 4 files ready` : '';
    this.#ui.status.hidden = !this.hasSources;
    this.#ui.list.setAttribute('aria-busy', String(this.uploading));
    this.#ui.error.textContent = this.#error; this.#ui.error.hidden = !this.#error;
    this.setDisabled(this.#disabled); this.#changed();
  }
}
