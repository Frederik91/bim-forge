import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';
import { CodexAccountConnection, CodexAppServerError } from '../src/codex-app-server.ts';
import { ChangeRequests, BacklogConflict } from './change-requests.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { MAX_SOURCE_BYTES, sourceMediaType, sourceName } from '../src/request-sources.ts';
import { parseModelScopeQuery } from '../src/model-scope-contract.ts';
import { ScopeStoreConflict } from './model-scope-store.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map<string, readonly [string, string]>([
  ['/', ['demo/index.html', 'text/html; charset=utf-8']],
  ['/room-app.mjs', ['dist/demo/room-app.mjs', 'text/javascript; charset=utf-8']],
  ['/room.css', ['demo/room.css', 'text/css; charset=utf-8']],
]);
const MAX_REQUEST_BYTES = 384 * 1024;
const disconnected = Object.freeze({ status: 'disconnected', connected: false, account: null, models: Object.freeze([]), selectedModel: null });

export type DemoRuntimeMode = 'local' | 'remote';
export type DemoListenTarget = Readonly<{ kind: 'tcp'; host: '127.0.0.1'; port: number }>
  | Readonly<{ kind: 'socket'; path: string }>;

export interface DemoServerConfig {
  runtimeMode: DemoRuntimeMode;
  publicOrigin: string | null;
  codexHome: string | undefined;
  workingDirectory: string | undefined;
  listen: DemoListenTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function send(response: http.ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
  response.end(bytes);
}

async function readJson(request: http.IncomingMessage, maxBytes = MAX_REQUEST_BYTES): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Use application/json for proposal requests.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error('Request exceeds the bounded request size.');
    chunks.push(bytes);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Proposal request is not valid JSON.'); }
  return value;
}

function sameOriginRequest(request: http.IncomingMessage, publicOrigin: string | null): void {
  const origin = request.headers.origin;
  const expectedOrigin = publicOrigin ?? `http://${request.headers.host}`;
  if (publicOrigin && request.method !== 'GET' && origin !== expectedOrigin) throw new Error('A same-origin browser request is required.');
  if (origin && origin !== expectedOrigin) throw new Error('Cross-origin requests are not allowed.');
  const site = request.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw new Error('Cross-site requests are not allowed.');
}

function proposalPayload(value: unknown): { project: unknown; request: unknown } {
  if (!isRecord(value)
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'project') || !Object.hasOwn(value, 'request')) {
    throw new Error('Proposal request must contain exactly project and request.');
  }
  return { project: value.project, request: value.request };
}

export interface DemoServerOptions {
  modelWorker?: ModelWorker | null;
  codex?: Pick<CodexAccountConnection, 'publicSession' | 'startDeviceLogin' | 'cancelDeviceLogin' | 'refreshModels' | 'selectModel' | 'signOut' | 'modelWorker'> | null;
  runtimeMode?: DemoRuntimeMode;
  publicOrigin?: string | null;
  backlogFile?: string;
}

function sessionPayload(codex: DemoServerOptions['codex']): unknown { return codex?.publicSession() ?? disconnected; }

function validatedPublicOrigin(value: string): string {
  let origin: URL;
  try { origin = new URL(value); } catch { throw new Error('BIM_FORGE_PUBLIC_ORIGIN must be a valid HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.origin !== value || origin.username || origin.password) {
    throw new Error('BIM_FORGE_PUBLIC_ORIGIN must be an exact HTTPS origin without a path.');
  }
  return origin.origin;
}

export function parseDemoServerConfig(environment: NodeJS.ProcessEnv = process.env): DemoServerConfig {
  const runtimeMode = environment.BIM_FORGE_RUNTIME ?? 'local';
  if (runtimeMode !== 'local' && runtimeMode !== 'remote') throw new Error('BIM_FORGE_RUNTIME must be local or remote.');
  if (runtimeMode === 'remote') {
    const publicOrigin = environment.BIM_FORGE_PUBLIC_ORIGIN ? validatedPublicOrigin(environment.BIM_FORGE_PUBLIC_ORIGIN) : null;
    if (!publicOrigin) throw new Error('BIM_FORGE_PUBLIC_ORIGIN is required for the remote runtime.');
    const socketPath = environment.BIM_FORGE_SOCKET;
    if (!socketPath || !/^\/run\/bim-preview\/[A-Za-z0-9_.-]+\.sock$/.test(socketPath)) {
      throw new Error('BIM_FORGE_SOCKET must be a socket below /run/bim-preview.');
    }
    const codexHome = environment.CODEX_HOME;
    if (!codexHome || !/^\/var\/lib\/bim-forge\/codex$/.test(codexHome)) {
      throw new Error('CODEX_HOME must be /var/lib/bim-forge/codex.');
    }
    const workingDirectory = environment.BIM_FORGE_AGENT_WORKDIR;
    if (!workingDirectory || !/^\/tmp\/bim-forge-agent$/.test(workingDirectory)) {
      throw new Error('BIM_FORGE_AGENT_WORKDIR must be /tmp/bim-forge-agent.');
    }
    return { runtimeMode, publicOrigin, codexHome, workingDirectory, listen: { kind: 'socket', path: socketPath } };
  }
  const port = Number(environment.PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 through 65535.');
  return {
    runtimeMode, publicOrigin: null, codexHome: environment.CODEX_HOME,
    workingDirectory: environment.BIM_FORGE_AGENT_WORKDIR,
    listen: { kind: 'tcp', host: '127.0.0.1', port },
  };
}

export type DemoServer = http.Server & { closeModelWorkers(): Promise<void> };

export async function createDemoServer({
  modelWorker = null,
  codex = null,
  runtimeMode = 'local',
  publicOrigin = null,
  backlogFile = ':memory:',
}: DemoServerOptions = {}): Promise<DemoServer> {
  const expectedHost = publicOrigin ? new URL(validatedPublicOrigin(publicOrigin)).host : null;
  const backlog = await ChangeRequests.open(backlogFile, () => modelWorker ?? (codex?.publicSession().connected ? codex.modelWorker() : null));
  let sourceUploads = 0;
  const server = http.createServer(async (request, response) => {
    const allowedHost = /^127\.0\.0\.1(?::[0-9]{1,5})?$|^localhost(?::[0-9]{1,5})?$/;
    const requestHost = request.headers.host ?? '';
    if (expectedHost ? requestHost !== expectedHost : !allowedHost.test(requestHost)) {
      response.writeHead(403); response.end('Unrecognized preview host.'); return;
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.url === '/api/health') {
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end('Health endpoint requires GET.'); return; }
      send(response, 200, { status: 'ok', runtimeMode, chatgptConnected: Boolean(codex?.publicSession().connected) });
      return;
    }
    if (request.url === '/api/auth/session') {
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end('Session endpoint requires GET.'); return; }
      send(response, 200, sessionPayload(codex));
      return;
    }
    if (request.url === '/api/auth/qr') {
      if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
      const session = codex?.publicSession();
      if (session?.status !== 'pending' || session.device.expiresAt <= Date.now()) {
        response.writeHead(404); response.end(); return;
      }
      try {
        const svg = await QRCode.toString(session.device.verificationUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 192 });
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': Buffer.byteLength(svg) });
        response.end(svg);
      } catch { send(response, 503, { error: 'The sign-in QR code is unavailable. Use the OpenAI link below.' }); }
      return;
    }
    if (request.url === '/api/auth/start' || request.url === '/api/auth/models'
        || request.url === '/api/auth/model' || request.url === '/api/auth/cancel' || request.url === '/api/auth/signout') {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end('Authentication endpoint requires POST.'); return; }
      if (!codex) { send(response, 503, { error: 'ChatGPT sign-in is unavailable.' }); return; }
      try {
        sameOriginRequest(request, publicOrigin);
        let session: object;
        if (request.url === '/api/auth/start') session = await codex.startDeviceLogin();
        else if (request.url === '/api/auth/cancel') session = await codex.cancelDeviceLogin();
        else if (request.url === '/api/auth/models') session = await codex.refreshModels();
        else if (request.url === '/api/auth/signout') session = await codex.signOut();
        else {
          const value = await readJson(request, 1024);
          if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.model !== 'string') {
            throw new Error('Model selection must contain exactly one model identifier.');
          }
          session = await codex.selectModel(value.model);
        }
        send(response, 200, session);
      } catch (error) {
        send(response, error instanceof CodexAppServerError ? 502 : 400, { error: error instanceof Error ? error.message : 'ChatGPT connection failed.' });
      }
      return;
    }
    if (request.url === '/api/change-requests') {
      if (request.method !== 'POST') { send(response, 405, { error: 'Submit a change request with POST.' }); return; }
      try {
        sameOriginRequest(request, publicOrigin);
        const payload = proposalPayload(await readJson(request));
        send(response, 202, { ticket: await backlog.submit(payload.project, payload.request) });
      } catch (error) {
        send(response, error instanceof BacklogConflict ? 409 : 400, { error: error instanceof Error ? error.message : 'Change request failed.' });
      }
      return;
    }
    let projectUrl: URL;
    try { projectUrl = new URL(request.url ?? '/', 'http://localhost'); }
    catch { send(response, 400, { error: 'Invalid request URL.' }); return; }
    const scopeRoute = /^\/api\/projects\/([^/]+)\/(scope-preview|scopes)$/.exec(projectUrl.pathname);
    if (scopeRoute) {
      try {
        sameOriginRequest(request, publicOrigin);
        if (projectUrl.search) throw new Error('Scope endpoints do not accept query parameters.');
        const projectId = decodeURIComponent(scopeRoute[1] ?? '');
        if (!backlog.hasProject(projectId)) { send(response, 404, { error: 'Unknown project.' }); return; }
        if (scopeRoute[2] === 'scope-preview') {
          if (request.method !== 'POST') { send(response, 405, { error: 'Scope preview requires POST.' }); return; }
          const value = await readJson(request, 32 * 1024);
          if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'query') || typeof value.baseRevisionId !== 'string') {
            throw new Error('Scope preview requires exactly baseRevisionId and query.');
          }
          send(response, 200, backlog.scopePreview(projectId, value.baseRevisionId, value.query));
        } else if (request.method === 'GET') send(response, 200, { scopes: backlog.savedScopes(projectId) });
        else if (request.method === 'POST') {
          const value = await readJson(request, 32 * 1024);
          if (!isRecord(value) || Object.keys(value).length !== 4 || typeof value.id !== 'string' || typeof value.name !== 'string'
              || !Object.hasOwn(value, 'query') || (value.expectedVersion !== null && typeof value.expectedVersion !== 'string')) {
            throw new Error('Saving a scope requires exactly id, name, query and expectedVersion.');
          }
          send(response, 200, { scope: backlog.saveModelScope({ projectId, id: value.id, name: value.name,
            query: parseModelScopeQuery(value.query), expectedVersion: value.expectedVersion }) });
        } else send(response, 405, { error: 'Saved scopes require GET or POST.' });
      } catch (error) {
        send(response, error instanceof ScopeStoreConflict ? error.code === 'not-found' ? 404 : 409 : error instanceof BacklogConflict ? 409 : 400,
          { error: error instanceof Error ? error.message : 'Scope unavailable.' });
      }
      return;
    }
    const savedProjectRoute = /^\/api\/projects\/([^/]+)(\/history)?$/.exec(projectUrl.pathname);
    if (projectUrl.pathname === '/api/projects' || savedProjectRoute) {
      try {
        sameOriginRequest(request, publicOrigin);
        if (!savedProjectRoute) {
          if (projectUrl.search) throw new Error('The project collection does not accept query parameters.');
          if (request.method === 'GET') send(response, 200, { projects: backlog.projects() });
          else if (request.method === 'POST') {
            const value = await readJson(request);
            if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.project !== 'string') throw new Error('Project import requires exactly one portable project string.');
            send(response, 200, { project: await backlog.importProject(value.project) });
          } else send(response, 405, { error: 'Projects require GET or POST.' });
        } else {
          if (request.method !== 'GET') { send(response, 405, { error: 'Saved projects and history require GET.' }); return; }
          const projectId = decodeURIComponent(savedProjectRoute[1] ?? '');
          if (!backlog.project(projectId)) { send(response, 404, { error: 'Unknown project.' }); return; }
          if (savedProjectRoute[2]) {
            const query = projectUrl.searchParams;
            if ([...query.keys()].some((key) => key !== 'before' && key !== 'limit') || query.getAll('before').length > 1
                || query.getAll('limit').length > 1) throw new Error('Unsupported history query.');
            const limitText = query.get('limit') ?? '20';
            if (!/^[1-9][0-9]?$/.test(limitText)) throw new Error('History limit must be from 1 through 50.');
            send(response, 200, backlog.history({ projectId, before: query.get('before'), limit: Number(limitText) }));
          } else {
            if (projectUrl.search) throw new Error('Saved projects do not accept query parameters.');
            send(response, 200, { project: backlog.project(projectId) });
          }
        }
      } catch (error) {
        send(response, error instanceof BacklogConflict ? 409 : 400, { error: error instanceof Error ? error.message : 'Project unavailable.' });
      }
      return;
    }
    const sourceRoute = /^\/api\/projects\/([a-f0-9-]{36})\/sources\/([a-f0-9-]{36})$/.exec(request.url ?? '');
    if (sourceRoute) {
      if (request.method === 'POST' && sourceUploads >= 2) { send(response, 429, { error: 'Two files are already uploading. Try again shortly.' }); return; }
      const uploading = request.method === 'POST';
      if (uploading) sourceUploads++;
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.once('aborted', abort);
      const disconnectedUpload = () => { if (!response.writableEnded) abort(); };
      response.once('close', disconnectedUpload);
      try {
        sameOriginRequest(request, publicOrigin);
        const projectId = sourceRoute[1] ?? ''; const id = sourceRoute[2] ?? '';
        if (request.method === 'POST') {
          const mediaType = sourceMediaType(request.headers['content-type']);
          const header = request.headers['x-source-name'];
          const name = sourceName(typeof header === 'string' ? decodeURIComponent(header) : undefined);
          const declared = request.headers['content-length'];
          if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_SOURCE_BYTES)) throw new Error('Source files must be at most 6 MiB.');
          const chunks: Buffer[] = []; let size = 0;
          request.setTimeout(30000, () => { abort(); request.destroy(); });
          for await (const chunk of request) {
            controller.signal.throwIfAborted();
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > MAX_SOURCE_BYTES) throw new Error('Source files must be at most 6 MiB.');
            chunks.push(bytes);
          }
          const source = await backlog.addSource({ projectId, id, name, mediaType, bytes: Buffer.concat(chunks), signal: controller.signal });
          send(response, 201, { source });
        } else if (request.method === 'GET') {
          const { source, bytes } = backlog.source(projectId, id);
          response.writeHead(200, { 'Content-Type': source.mediaType, 'Content-Length': bytes.length,
            'Content-Disposition': `${source.mediaType.startsWith('image/') ? 'inline' : 'attachment'}; filename="source"; filename*=UTF-8''${encodeURIComponent(source.name).replace(/'/g, '%27')}` });
          response.end(bytes);
        } else send(response, 405, { error: 'Source files require GET or POST.' });
      } catch (error) {
        if (!controller.signal.aborted) send(response, request.method === 'GET' ? 404 : 400, { error: request.method === 'GET' ? 'Source file is unavailable in this project.' : error instanceof Error ? error.message : 'Source upload failed.' });
      } finally {
        if (uploading) sourceUploads--;
        request.removeListener('aborted', abort); response.removeListener('close', disconnectedUpload);
      }
      return;
    }
    const projectRoute = /^\/api\/projects\/([^/]+)\/change-requests$/.exec(request.url ?? '');
    const ticketRoute = /^\/api\/change-requests\/([^/]+)(\/decision|\/revision)?$/.exec(request.url ?? '');
    if (projectRoute || ticketRoute) {
      try {
        sameOriginRequest(request, publicOrigin);
        if (projectRoute) {
          if (request.method !== 'GET') { send(response, 405, { error: 'The backlog requires GET.' }); return; }
          const id = decodeURIComponent(projectRoute[1] ?? '');
          await backlog.refreshProject(id);
          send(response, 200, { tickets: backlog.list(id), project: backlog.project(id) });
        } else if (ticketRoute) {
          const id = decodeURIComponent(ticketRoute[1] ?? '');
          if (ticketRoute[2] === '/revision') {
            if (request.method !== 'POST') { send(response, 405, { error: 'A revision requires POST.' }); return; }
            const payload = proposalPayload(await readJson(request));
            send(response, 202, { ticket: await backlog.revise(id, payload.project, payload.request) });
          } else if (ticketRoute[2]) {
            if (request.method !== 'POST') { send(response, 405, { error: 'A decision requires POST.' }); return; }
            send(response, 200, await backlog.decide(id, await readJson(request, 2048)));
          } else {
            if (request.method !== 'GET') { send(response, 405, { error: 'A request requires GET.' }); return; }
            send(response, 200, { ticket: { ...await backlog.refreshProposal(id), executions: backlog.executions(id) } });
          }
        }
      } catch (error) { send(response, error instanceof BacklogConflict ? 409 : 400, { error: error instanceof Error ? error.message : 'Backlog unavailable.' }); }
      return;
    }
    if (!request.method || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Unsupported method.'); return;
    }
    if (!request.url) { response.writeHead(404); response.end('Not found.'); return; }
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404); response.end('Not found.'); return; }
    try {
      const bytes = await fs.readFile(path.join(root, asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(500); response.end('Demo asset unavailable.'); }
  });
  server.on('close', () => {
    void backlog.close().catch(() => {
      console.error('The BIM Forge request workers could not shut down cleanly.'); process.exitCode = 1;
    });
  });
  return Object.assign(server, { closeModelWorkers: () => backlog.close() });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = parseDemoServerConfig();
  const connectionOptions = {
    ...(config.codexHome ? { codexHome: config.codexHome } : {}),
    ...(config.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
  };
  const codex = await CodexAccountConnection.open(connectionOptions);
  const backlogDirectory = config.codexHome ?? path.join(root, '.bim-preview');
  await fs.mkdir(backlogDirectory, { recursive: true, mode: 0o700 });
  const server = await createDemoServer({ codex, runtimeMode: config.runtimeMode, publicOrigin: config.publicOrigin,
    backlogFile: path.join(backlogDirectory, 'bim-change-requests.sqlite') });
  server.on('close', () => { void server.closeModelWorkers().finally(() => codex.close()).catch(() => {}); });
  server.on('error', () => { console.error('The BIM Forge preview runtime could not start.'); process.exitCode = 1; });
  const listen = config.listen;
  if (listen.kind === 'socket') {
    await fs.mkdir(path.dirname(listen.path), { recursive: true, mode: 0o770 });
    await fs.rm(listen.path, { force: true });
    server.listen(listen.path, () => {
      void fs.chmod(listen.path, 0o770).then(() => {
        console.log(`BIM Forge remote preview runtime: ${listen.path}`);
      }).catch(() => {
        console.error('The BIM Forge preview socket could not be protected.');
        server.close();
        process.exitCode = 1;
      });
    });
  } else {
    server.listen(listen.port, listen.host, () => {
      console.log(`BIM Forge room demo: http://${listen.host}:${listen.port}`);
    });
  }
}
