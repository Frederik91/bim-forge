import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { MAX_EVIDENCE_ENTRY_BYTES, MAX_EVIDENCE_PAGE, parseEvidenceEntry, parseEvidencePin } from '../src/model-evidence.ts';
import type { EvidenceEntry, EvidencePin } from '../src/model-evidence.ts';
import { parseRequestSources } from '../src/request-sources.ts';
import type { RequestSource } from '../src/request-sources.ts';

const uuid = Type.String({ pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' });
const identity = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' });
const sequence = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const exact = { additionalProperties: false };
const sourcePage = Type.Object({ sources: Type.Array(Type.Unknown(), { maxItems: 20 }), next: Type.Union([uuid, Type.Null()]) }, exact);
const evidencePage = Type.Object({ entries: Type.Array(Type.Object({ entry: Type.Unknown(), pin: Type.Unknown() }, exact),
  { maxItems: MAX_EVIDENCE_PAGE }), next: Type.Union([sequence, Type.Null()]) }, exact);
const sourceReply = Type.Object({ source: Type.Unknown() }, exact);
const pinReply = Type.Object({ pin: Type.Unknown() }, exact);

export interface SourceMetadataPage { sources: RequestSource[]; next: string | null }
export interface EvidenceHistoryRecord { entry: EvidenceEntry; pin: EvidencePin }
export interface EvidenceHistoryPage { entries: EvidenceHistoryRecord[]; next: number | null }

export class ProjectEvidenceError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 404 ? 'Project evidence or source is unavailable (HTTP 404).'
      : status === 429 || status === 503 ? `Project evidence is busy (HTTP ${status}). Retry shortly.`
      : `Project evidence request failed (HTTP ${status}). Retry or refresh the project.`);
    this.name = 'ProjectEvidenceError'; this.status = status;
  }
}

function projectPath(projectId: string): string {
  if (!Check(identity, projectId)) throw new Error('Invalid project identity.');
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function privateSourceHref(projectId: string, sourceId: string): string {
  if (!Check(uuid, sourceId)) throw new Error('Invalid private source UUID.');
  return `${projectPath(projectId)}/sources/${sourceId}`;
}

export function parseSourceDescriptor(value: unknown): RequestSource {
  const source = parseRequestSources([value])[0];
  if (!source) throw new Error('Invalid source descriptor.');
  return source;
}

export function parseSourceMetadataPage(value: unknown): SourceMetadataPage {
  if (!Check(sourcePage, value)) throw new Error('Invalid bounded project source page.');
  // A project page is not a request attachment group (four files / 12 MiB).
  const sources = value.sources.map(parseSourceDescriptor);
  if (new Set(sources.map(source => source.id)).size !== sources.length
      || sources.some((source, index) => index > 0 && source.id <= (sources[index - 1]?.id ?? ''))
      || value.next !== null && (!sources.length || sources.at(-1)?.id !== value.next)) {
    throw new Error('Invalid project source page order or cursor.');
  }
  return { sources, next: value.next };
}

export function parseEvidenceHistoryPage(value: unknown, projectId: string): EvidenceHistoryPage {
  projectPath(projectId);
  if (!Check(evidencePage, value)) throw new Error('Invalid bounded project evidence page.');
  const entries = value.entries.map(item => {
    const entry = parseEvidenceEntry(item.entry); const pin = parseEvidencePin(item.pin);
    if (entry.anchor.projectId !== projectId || pin.entryId !== entry.id) throw new Error('Evidence does not match its project or pin.');
    return { entry, pin };
  });
  if (new Set(entries.map(item => item.entry.id)).size !== entries.length || value.next !== null && !entries.length) {
    throw new Error('Invalid evidence page identities or cursor.');
  }
  return { entries, next: value.next };
}

async function boundedJson(response: Response, maximum: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing project evidence response.');
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = ''; let bytes = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) throw new Error('Project evidence response exceeds its metadata limit.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode()); return value;
  } finally { await reader.cancel(); reader.releaseLock(); }
}

/** Transport/codec boundary only. No model state or accepted fact authority. */
export class ProjectEvidenceClient {
  readonly #fetch: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.#fetch = fetcher; }

  async #request(path: string, maximum: number, signal?: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await this.#fetch(path, { method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      ...(signal ? { signal } : {}), ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }) });
    if (!response.ok) { await response.body?.cancel(); throw new ProjectEvidenceError(response.status); }
    return boundedJson(response, maximum);
  }

  async sources(projectId: string, after: string | null = null, signal?: AbortSignal): Promise<SourceMetadataPage> {
    if (after !== null && !Check(uuid, after)) throw new Error('Invalid source page cursor.');
    const page = parseSourceMetadataPage(await this.#request(`${projectPath(projectId)}/project-sources${after === null ? '' : `?after=${after}`}`,
      32 * 1024, signal));
    if (after !== null && page.sources.some(source => source.id <= after)) throw new Error('Source page cursor did not advance.');
    return page;
  }

  async evidence(projectId: string, after: number | null = null, signal?: AbortSignal): Promise<EvidenceHistoryPage> {
    if (after !== null && !Check(sequence, after)) throw new Error('Invalid evidence page cursor.');
    const page = parseEvidenceHistoryPage(await this.#request(`${projectPath(projectId)}/evidence${after === null ? '' : `?after=${after}`}`,
      MAX_EVIDENCE_PAGE * (MAX_EVIDENCE_ENTRY_BYTES + 1024), signal), projectId);
    if (page.next !== null && page.next <= (after ?? 0)) throw new Error('Evidence page cursor did not advance.');
    return page;
  }

  async retain(projectId: string, source: RequestSource, signal?: AbortSignal): Promise<RequestSource> {
    const descriptor = parseSourceDescriptor(source);
    const value = await this.#request(`${projectPath(projectId)}/project-sources`, 4096, signal, { source: descriptor });
    if (!Check(sourceReply, value)) throw new Error('Invalid retained source response.');
    const retained = parseSourceDescriptor(value.source);
    if (retained.id !== descriptor.id || retained.name !== descriptor.name || retained.sha256 !== descriptor.sha256
        || retained.byteLength !== descriptor.byteLength || retained.mediaType !== descriptor.mediaType) throw new Error('Retained source identity changed.');
    return retained;
  }

  async append(projectId: string, commandId: string, entry: EvidenceEntry, signal?: AbortSignal): Promise<EvidencePin> {
    const parsed = parseEvidenceEntry(entry);
    if (!Check(identity, commandId) || parsed.anchor.projectId !== projectId) throw new Error('Invalid evidence command context.');
    const value = await this.#request(`${projectPath(projectId)}/evidence`, 4096, signal, { commandId, entry: parsed });
    if (!Check(pinReply, value)) throw new Error('Invalid evidence command response.');
    const pin = parseEvidencePin(value.pin);
    if (pin.entryId !== parsed.id) throw new Error('Evidence command returned a different entry.');
    return pin;
  }
}
