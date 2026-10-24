import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RoomRepository } from '../src/room-model.ts';
import { CodexAccountConnection, CodexAppServerError } from '../src/codex-app-server.ts';
import { ModelWorkerError, prepareModelProposal } from '../src/model-proposal.ts';
import type { ModelWorker } from '../src/model-proposal.ts';

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

export function createDemoServer({
  modelWorker = null,
  codex = null,
  runtimeMode = 'local',
  publicOrigin = null,
}: DemoServerOptions = {}): http.Server {
  const expectedHost = publicOrigin ? new URL(validatedPublicOrigin(publicOrigin)).host : null;
  return http.createServer(async (request, response) => {
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
    if (request.url === '/api/proposals') {
      if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end('Proposal endpoint requires POST.'); return; }
      try {
        sameOriginRequest(request, publicOrigin);
        let worker: ModelWorker | null = modelWorker;
        if (!worker && codex) {
          if (!codex.publicSession().connected) { send(response, 401, { error: 'Connect a ChatGPT plan before preparing a proposal.' }); return; }
          worker = codex.modelWorker();
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = parseDemoServerConfig();
  const connectionOptions = {
    ...(config.codexHome ? { codexHome: config.codexHome } : {}),
    ...(config.workingDirectory ? { workingDirectory: config.workingDirectory } : {}),
  };
  const codex = await CodexAccountConnection.open(connectionOptions);
  const server = createDemoServer({ codex, runtimeMode: config.runtimeMode, publicOrigin: config.publicOrigin });
  server.on('close', () => codex.close());
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
