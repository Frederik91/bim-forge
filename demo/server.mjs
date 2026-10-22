import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RoomRepository } from '../src/room-model.mjs';
import { createOpenAIModelWorker, ModelWorkerError, prepareModelProposal } from '../src/model-proposal.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([
  ['/', ['demo/index.html', 'text/html; charset=utf-8']],
  ['/room-app.mjs', ['demo/room-app.mjs', 'text/javascript; charset=utf-8']],
  ['/room-store.mjs', ['demo/room-store.mjs', 'text/javascript; charset=utf-8']],
  ['/room.css', ['demo/room.css', 'text/css; charset=utf-8']],
  ['/src/room-model.mjs', ['src/room-model.mjs', 'text/javascript; charset=utf-8']],
]);
const MAX_REQUEST_BYTES = 384 * 1024;

function send(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

async function readJson(request) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Use application/json for proposal requests.');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('Proposal request exceeds the bounded request size.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Proposal request is not valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'project') || !Object.hasOwn(value, 'request')) {
    throw new Error('Proposal request must contain exactly project and request.');
  }
  return value;
}

export function createDemoServer({ modelWorker = null } = {}) {
  return http.createServer(async (request, response) => {
    const allowedHost = /^127\.0\.0\.1(?::[0-9]{1,5})?$|^localhost(?::[0-9]{1,5})?$/;
    if (!allowedHost.test(request.headers.host ?? '')) { response.writeHead(403); response.end('Loopback access only.'); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.url === '/api/proposals') {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end('Proposal endpoint requires POST.'); return; }
      if (!modelWorker) { send(response, 503, { error: 'No server-side model worker is configured.' }); return; }
      try {
        const payload = await readJson(request);
        const repository = await RoomRepository.restore(payload.project);
        const result = await prepareModelProposal(repository, payload.request, modelWorker);
        send(response, 200, { status: result.status, project: result.repository.serialize(), review: result.review });
      } catch (error) {
        const status = error instanceof ModelWorkerError ? 502 : 400;
        send(response, status, { error: error instanceof Error ? error.message : 'Proposal request failed.' });
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Unsupported method.'); return;
    }
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404); response.end('Not found.'); return; }
    try {
      const bytes = await fs.readFile(path.join(root, asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(500); response.end('Demo asset unavailable.'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 through 65535.');
  const modelWorker = process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
    ? createOpenAIModelWorker({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL })
    : null;
  const server = createDemoServer({ modelWorker });
  server.on('error', () => { console.error('The local demo could not start. Check whether its port is already in use.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`BIM Forge room demo: http://127.0.0.1:${port}`));
}
