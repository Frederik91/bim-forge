import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_LINK_SOURCE_BYTES } from '../src/linked-model.ts';
import type { LinkedModelStore } from './linked-model-store.ts';

/** Mount after the server host/security headers. authorize must enforce its existing same-origin rule for every method. */
export async function handleLinkedModelRoute(input: {
  request: IncomingMessage; response: ServerResponse; store: LinkedModelStore;
  hasProject: (id: string) => boolean; authorize: (request: IncomingMessage) => void;
}): Promise<boolean> {
  const { request, response, store } = input;
  const url = new URL(request.url ?? '/', 'http://localhost');
  const route = /^\/api\/projects\/([a-f0-9-]{36})\/ifc-links(?:\/([a-f0-9-]{36})(?:\/(prepared|original|cancel))?)?$/.exec(url.pathname);
  if (!route) return false;
  const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
  try {
    input.authorize(request);
    if (url.search) throw new Error('IFC endpoints do not accept query parameters.');
    const projectId = route[1] ?? ''; const id = route[2]; const resource = route[3];
    if (!input.hasProject(projectId)) { send(404, { error: 'Unknown project.' }); return true; }
    if (!id && request.method === 'GET') send(200, { links: store.list(projectId) });
    else if (!id && request.method === 'POST') {
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
      send(202, { link: store.attach({ projectId, name: decodeURIComponent(header), bytes: Buffer.concat(chunks) }) });
    } else if (id && resource === 'cancel' && request.method === 'POST') send(200, { link: store.cancel(projectId, id) });
    else if (id && resource === 'prepared' && request.method === 'GET') send(200, store.prepared(projectId, id));
    else if (id && resource === 'original' && request.method === 'GET') {
      const bytes = store.original(projectId, id);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="original.ifc"', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); response.end(bytes);
    } else if (id && !resource && request.method === 'GET') send(200, { link: store.get(projectId, id) });
    else send(405, { error: 'Unsupported IFC method.' });
  } catch (error) { send(400, { error: error instanceof Error ? error.message : 'IFC reference unavailable.' }); }
  return true;
}
