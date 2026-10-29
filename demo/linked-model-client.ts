import { MAX_LINK_SOURCE_BYTES, parseLinkedCatalog, parseLinkedReview, parseLinkedJob, parseLinkedPrepared } from '../src/linked-model.ts';
import type { LinkedJob, LinkedPrepared } from '../src/linked-model.ts';

export class LinkedModelClient {
  private url(projectId: string, suffix = ''): string { return `/api/projects/${encodeURIComponent(projectId)}/ifc-links${suffix}`; }
  private async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(url, { ...init, credentials: 'same-origin' });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string' ? value.error : 'IFC operation failed.');
    return value;
  }
  async list(projectId: string, signal: AbortSignal): Promise<LinkedJob[]> {
    const value = await this.json(this.url(projectId), { signal });
    if (typeof value !== 'object' || value === null || !('links' in value) || !Array.isArray(value.links) || value.links.length > 8) throw new Error('Invalid IFC job collection.');
    return value.links.map(parseLinkedJob);
  }
  async attach(projectId: string, file: File, signal: AbortSignal): Promise<void> {
    if (file.size < 1 || file.size > MAX_LINK_SOURCE_BYTES) throw new Error('Choose an IFC file up to 2 MiB.');
    await this.json(this.url(projectId), { method: 'POST', headers: { 'Content-Type': 'application/x-step', 'X-Source-Name': encodeURIComponent(file.name) }, body: file, signal });
  }
  async cancel(projectId: string, id: string, signal: AbortSignal): Promise<void> { await this.json(this.url(projectId, `/${encodeURIComponent(id)}/cancel`), { method: 'POST', signal }); }
  async prepared(projectId: string, id: string, signal: AbortSignal): Promise<LinkedPrepared> { return parseLinkedPrepared(await this.json(this.url(projectId, `/${encodeURIComponent(id)}/prepared`), { signal })); }
  originalUrl(projectId: string, id: string): string { return this.url(projectId, `/${encodeURIComponent(id)}/original`); }
  async catalog(projectId: string, signal: AbortSignal) { return parseLinkedCatalog(await this.json(this.url(projectId, '/catalog'), { signal })); }
  async replace(projectId: string, linkId: string, expectedGeneration: number, file: File, signal: AbortSignal): Promise<void> {
    if (file.size < 1 || file.size > MAX_LINK_SOURCE_BYTES) throw new Error('Choose an IFC file up to 2 MiB.');
    await this.json(this.url(projectId, `/${encodeURIComponent(linkId)}/candidate`), { method: 'POST',
      headers: { 'Content-Type': 'application/x-step', 'X-Source-Name': encodeURIComponent(file.name), 'X-Expected-Generation': String(expectedGeneration) }, body: file, signal });
  }
  private versionUrl(projectId: string, linkId: string, versionId: string, resource: string): string {
    return this.url(projectId, `/${encodeURIComponent(linkId)}/versions/${encodeURIComponent(versionId)}/${resource}`);
  }
  async review(projectId: string, linkId: string, versionId: string, signal: AbortSignal) {
    return parseLinkedReview(await this.json(this.versionUrl(projectId, linkId, versionId, 'review'), { signal }));
  }
  async adopt(projectId: string, linkId: string, versionId: string, expectedGeneration: number, signal: AbortSignal): Promise<void> {
    await this.json(this.versionUrl(projectId, linkId, versionId, 'adopt'), { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedGeneration }) });
  }
  async place(projectId: string, linkId: string, expectedGeneration: number, sourceToProjectMetres: number[][], signal: AbortSignal): Promise<void> {
    await this.json(this.url(projectId, `/${encodeURIComponent(linkId)}/placement`), { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedGeneration, sourceToProjectMetres }) });
  }
  versionOriginalUrl(projectId: string, linkId: string, versionId: string): string { return this.versionUrl(projectId, linkId, versionId, 'original'); }
}
