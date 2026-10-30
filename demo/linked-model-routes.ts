import type { IncomingMessage, ServerResponse } from 'node:http';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { LinkedTransformSchema, MAX_LINK_SOURCE_BYTES } from '../src/linked-model.ts';
import type { LinkedModelStore } from './linked-model-store.ts';
const uploads = new WeakMap<LinkedModelStore, number>();

/** Mount after the server host/security headers. authorize must enforce its existing same-origin rule for every method. */
export async function handleLinkedModelRoute(input: {
  request: IncomingMessage; response: ServerResponse; store: LinkedModelStore;
  hasProject: (id: string) => boolean; authorize: (request: IncomingMessage) => void;
}): Promise<boolean> {
  const { request, response, store } = input;
  const url = new URL(request.url ?? '/', 'http://localhost');
  const route = /^\/api\/projects\/([a-f0-9-]{36})\/ifc-links(?:\/(catalog|[a-f0-9-]{36})(?:\/(prepared|original|cancel|candidate|placement|versions)(?:\/([a-f0-9-]{36})\/(review|original|adopt))?)?)?$/.exec(url.pathname);
  if (!route) return false;
  let uploading = false;
  const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
  try {
    input.authorize(request);
    if (url.search) throw new Error('IFC endpoints do not accept query parameters.');
    const projectId = route[1] ?? ''; const id = route[2]; const resource = route[3];
    if (!input.hasProject(projectId)) { send(404, { error: 'Unknown project.' }); return true; }
    const versionId = route[4]; const versionResource = route[5];
    if (versionId && resource !== 'versions') throw new Error('Invalid IFC version route.');
    const json = async (): Promise<unknown> => {
      if (request.headers['content-type'] !== 'application/json') throw new Error('Expected application/json.');
      const chunks: Buffer[] = []; let size = 0; request.setTimeout(30000, () => request.destroy());
      for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > 4096) throw new Error('IFC command exceeds 4 KiB.'); chunks.push(bytes); }
      return JSON.parse(Buffer.concat(chunks).toString());
    };
    const download = (bytes: Buffer) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="original.ifc"', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); response.end(bytes);
    };
    if (id === 'catalog' && !resource && request.method === 'GET') send(200, store.catalog(projectId));
    else if (!id && request.method === 'GET') send(200, { links: store.list(projectId) });
    else if ((!id || (id !== 'catalog' && resource === 'candidate' && !versionId)) && request.method === 'POST') {
      if ((uploads.get(store) ?? 0) >= 2) { send(429, { error: 'Two IFC files are already uploading.' }); return true; }
      uploads.set(store, (uploads.get(store) ?? 0) + 1); uploading = true;
      if (request.headers['content-type'] !== 'application/x-step') throw new Error('Upload original IFC bytes as application/x-step.');
      const length = request.headers['content-length'];
      if (length && (!/^[0-9]+$/.test(length) || Number(length) > MAX_LINK_SOURCE_BYTES)) throw new Error('IFC source must be at most 2 MiB.');
      const header = request.headers['x-source-name'];
      if (typeof header !== 'string') throw new Error('IFC filename required.');
      const chunks: Buffer[] = []; let size = 0;
      request.setTimeout(30000, () => request.destroy());
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length;
        if (size > MAX_LINK_SOURCE_BYTES) throw new Error('IFC source must be at most 2 MiB.'); chunks.push(bytes);
      }
      if (request.aborted || response.destroyed) return true;
      const name = decodeURIComponent(header); const bytes = Buffer.concat(chunks);
      if (id) {
        const expected = request.headers['x-expected-generation'];
        if (typeof expected !== 'string' || !/^[0-9]{1,9}$/.test(expected)) throw new Error('Expected IFC generation required.');
        send(202, { link: store.prepareReplacement({ projectId, linkId: id, expectedGeneration: Number(expected), name, bytes }) });
      } else send(202, { link: store.attach({ projectId, name, bytes }) });
    } else if (id && resource === 'placement' && request.method === 'POST') {
      const value = await json();
      const schema = Type.Object({ expectedGeneration: Type.Integer({ minimum: 0 }), sourceToProjectMetres: LinkedTransformSchema }, { additionalProperties: false });
      if (!Check(schema, value)) throw new Error('Invalid IFC placement command.');
      send(200, store.place({ projectId, linkId: id, ...value }));
    } else if (id && resource === 'versions' && versionId) {
      // Authorize both the stable link and its exact version association before every access.
      if (!store.catalog(projectId).find(item => item.state.id === id)?.versions.some(version => version.job.id === versionId)) throw new Error('IFC version unavailable in this project.');
      if (versionResource === 'original' && request.method === 'GET') download(store.originalVersion(projectId, versionId));
      else if (versionResource === 'review' && request.method === 'GET') send(200, store.reviewCandidate(projectId, id, versionId));
      else if (versionResource === 'adopt' && request.method === 'POST') {
        const value = await json(); const schema = Type.Object({ expectedGeneration: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
        if (!Check(schema, value)) throw new Error('Invalid IFC adoption command.');
        send(200, store.adopt({ projectId, linkId: id, candidateId: versionId, ...value }));
      } else send(405, { error: 'Unsupported IFC version method.' });
    } else if (id && resource === 'cancel' && request.method === 'POST') send(200, { link: store.cancel(projectId, id) });
    else if (id && resource === 'prepared' && request.method === 'GET') send(200, store.prepared(projectId, id));
    else if (id && resource === 'original' && request.method === 'GET') {
      download(store.original(projectId, id));
    } else if (id && !resource && request.method === 'GET') send(200, { link: store.get(projectId, id) });
    else send(405, { error: 'Unsupported IFC method.' });
  } catch (error) { send(400, { error: error instanceof Error ? error.message : 'IFC reference unavailable.' }); }
  finally { if (uploading) uploads.set(store, (uploads.get(store) ?? 1) - 1); }
  return true;
}
