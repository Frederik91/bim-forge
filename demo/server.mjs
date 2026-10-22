import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RoomRepository } from '../src/room-model.ts';
import { ChatGPTPlanConnection, ChatGPTPlanError } from '../src/chatgpt-plan.mjs';
import { createChatGPTPlanModelWorker, ModelWorkerError, prepareModelProposal } from '../src/model-proposal.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([
  ['/', ['demo/index.html', 'text/html; charset=utf-8']],
  ['/room-app.mjs', ['dist/demo/room-app.mjs', 'text/javascript; charset=utf-8']],
  ['/room.css', ['demo/room.css', 'text/css; charset=utf-8']],
]);
const MAX_REQUEST_BYTES = 384 * 1024;
const disconnected = Object.freeze({ connected: false, sharing: false, account: null, models: Object.freeze([]), selectedModel: null });

function send(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

async function readJson(request, maxBytes = MAX_REQUEST_BYTES) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Use application/json for proposal requests.');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request exceeds the bounded request size.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Proposal request is not valid JSON.'); }
  return value;
}

function localRequest(request) {
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) throw new Error('Cross-origin local requests are not allowed.');
  const site = request.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw new Error('Cross-site local requests are not allowed.');
}

function proposalPayload(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'project') || !Object.hasOwn(value, 'request')) {
    throw new Error('Proposal request must contain exactly project and request.');
  }
  return value;
}

export function createDemoServer({ modelWorker = null, chatgpt = null } = {}) {
  return http.createServer(async (request, response) => {
    const allowedHost = /^127\.0\.0\.1(?::[0-9]{1,5})?$|^localhost(?::[0-9]{1,5})?$/;
    if (!allowedHost.test(request.headers.host ?? '')) { response.writeHead(403); response.end('Loopback access only.'); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.url === '/api/auth/session') {
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end('Session endpoint requires GET.'); return; }
      send(response, 200, chatgpt?.publicSession() ?? disconnected);
      return;
    }
    if (request.url === '/api/auth/start' || request.url === '/api/auth/models'
        || request.url === '/api/auth/model' || request.url === '/api/auth/signout') {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end('Authentication endpoint requires POST.'); return; }
      if (!chatgpt) { send(response, 503, { error: 'ChatGPT sign-in is unavailable.' }); return; }
      try {
        localRequest(request);
        let session;
        if (request.url === '/api/auth/start') session = await chatgpt.signIn();
        else if (request.url === '/api/auth/models') session = await chatgpt.refreshModels();
        else if (request.url === '/api/auth/signout') session = await chatgpt.signOut();
        else {
          const value = await readJson(request, 1024);
          if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== 1 || typeof value.model !== 'string') {
            throw new Error('Model selection must contain exactly one model identifier.');
          }
          session = await chatgpt.selectModel(value.model);
        }
        send(response, 200, session);
      } catch (error) {
        send(response, error instanceof ChatGPTPlanError ? 502 : 400, { error: error instanceof Error ? error.message : 'ChatGPT connection failed.' });
      }
      return;
    }
    if (request.url === '/api/proposals') {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end('Proposal endpoint requires POST.'); return; }
      try {
        localRequest(request);
        let worker = modelWorker;
        if (!worker && chatgpt) {
          const session = chatgpt.publicSession();
          if (!session.sharing) { send(response, 401, { error: 'Connect a ChatGPT plan before preparing a proposal.' }); return; }
          worker = createChatGPTPlanModelWorker({ getAccessToken: () => chatgpt.getAccessToken(), model: chatgpt.selectedModel() });
        }
        if (!worker) { send(response, 503, { error: 'No server-side model worker is configured.' }); return; }
        const payload = proposalPayload(await readJson(request));
        const repository = await RoomRepository.restore(payload.project);
        const result = await prepareModelProposal(repository, payload.request, worker);
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
  const chatgpt = await ChatGPTPlanConnection.open();
  const server = createDemoServer({ chatgpt });
  server.on('error', () => { console.error('The local demo could not start. Check whether its port is already in use.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`BIM Forge room demo: http://127.0.0.1:${port}`));
}
