import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../demo/server.ts';
import type { DemoServer, DemoServerOptions } from '../demo/server.ts';
import { CodexAccountConnection } from '../src/codex-app-server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = '.bim-forge-local-preview.json';
const markerContents = '{"application":"bim-forge-local-preview","version":1}\n';
const lockName = '.preview-running';
const databaseName = 'bim-change-requests.sqlite';
const execute = promisify(execFile);

export interface SpatialPreviewConfig {
  readonly dataDirectory: string;
  readonly port: number;
  readonly ifcSpool?: string;
  readonly offline: boolean;
}

type PreviewConnection = NonNullable<DemoServerOptions['codex']> & { close(): void | Promise<void> };
export interface SpatialPreviewDependencies { readonly connection?: PreviewConnection | null }

export function parseSpatialPreviewConfig(args: readonly string[]): SpatialPreviewConfig {
  let dataDirectory: string | undefined;
  let port = 4188;
  let ifcSpool: string | undefined;
  let offline = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !['--data-dir', '--port', '--ifc-spool', '--offline'].includes(flag) || seen.has(flag)) {
      throw new Error('Use each of --data-dir, --port, --ifc-spool and --offline at most once. See --help.');
    }
    seen.add(flag);
    if (flag === '--offline') { offline = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--data-dir') dataDirectory = value;
    else if (flag === '--ifc-spool') ifcSpool = value;
    else {
      if (!/^[0-9]+$/.test(value)) throw new Error('Preview port must be an integer from 1 through 65535.');
      port = Number(value);
    }
  }
  if (!dataDirectory) throw new Error('Provide --data-dir with an absolute new preview directory.');
  const config = { dataDirectory, port, offline, ...(ifcSpool ? { ifcSpool } : {}) };
  validateConfig(config);
  return config;
}

function absoluteDirectory(value: string, label: string): void {
  if (!value || value.includes('\0') || !path.isAbsolute(value) || path.dirname(path.resolve(value)) === path.resolve(value)) {
    throw new Error(`${label} must be an absolute directory below the filesystem root.`);
  }
}

function validateConfig(config: SpatialPreviewConfig): void {
  absoluteDirectory(config.dataDirectory, 'Preview data path');
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('Preview port must be an integer from 1 through 65535.');
  }
  if (config.ifcSpool !== undefined) absoluteDirectory(config.ifcSpool, 'IFC spool');
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

// Resolve existing ancestors as well, so a new leaf below a junction cannot alias the account home.
async function canonicalPath(value: string): Promise<string> {
  try { return await fs.realpath(value); }
  catch (error) {
    if (!missing(error)) throw error;
    const parent = path.dirname(value);
    if (parent === value) throw error;
    return path.join(await canonicalPath(parent), path.basename(value));
  }
}

async function claimDirectory(config: SpatialPreviewConfig): Promise<{ directory: string; release(): Promise<void> }> {
  const directory = await canonicalPath(path.resolve(config.dataDirectory));
  const accountHome = await canonicalPath(path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')));
  if (contains(accountHome, directory) || contains(directory, accountHome)) {
    throw new Error('Preview data must be separate from the existing AI account home. Choose a new dedicated directory.');
  }
  if (config.ifcSpool) {
    const spool = await canonicalPath(config.ifcSpool);
    if (contains(directory, spool) || contains(spool, directory)
        || contains(accountHome, spool) || contains(spool, accountHome)) {
      throw new Error('IFC spool must be an existing dedicated directory separate from preview data and the AI account home.');
    }
    if (!(await fs.stat(spool)).isDirectory()) throw new Error('IFC spool must be an existing dedicated directory.');
  }
  await fs.mkdir(path.dirname(directory), { recursive: true });
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(path.join(directory, marker), markerContents, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    const state = await fs.lstat(config.dataDirectory);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error('Preview data must be a real owned directory, not a file or link.');
    let contents: string;
    try {
      const markerPath = path.join(directory, marker);
      const markerState = await fs.lstat(markerPath);
      if (!markerState.isFile() || markerState.isSymbolicLink()) throw new Error('Invalid marker.');
      contents = await fs.readFile(markerPath, 'utf8');
    } catch { throw new Error('Refusing existing unowned preview data. Choose a new directory; do not mark or copy an existing model database.'); }
    if (contents !== markerContents) throw new Error('Preview ownership marker is not recognized. Choose a new directory.');
  }
  const allowed = new Set([marker, lockName, databaseName, `${databaseName}-wal`, `${databaseName}-shm`, 'ifc-links', 'agent-workspace']);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!allowed.has(entry.name) || entry.isSymbolicLink()
        || (['ifc-links', 'agent-workspace'].includes(entry.name) ? !entry.isDirectory() : !entry.isFile())) {
      throw new Error('Preview data contains foreign files or links. Choose a new dedicated directory.');
    }
  }
  const lockPath = path.join(directory, lockName);
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Preview directory is already locked. Stop its previous preview first. After a crash, verify that process stopped before removing .preview-running.');
    }
    throw error;
  }
  try { await lock.writeFile(`${JSON.stringify({ pid: process.pid })}\n`); }
  finally { await lock.close(); }
  return { directory, release: () => fs.unlink(lockPath) };
}

async function artifactIdentity(): Promise<{ sourceRevision: string | null; sourceDirty: boolean | null; buildSha256: string }> {
  const files = ['demo/index.html', 'demo/room.css', 'demo/request-chat.css', 'dist/demo/room-app.mjs', 'dist/demo/canvas-studio.css'];
  const hash = createHash('sha256');
  for (const file of files) {
    let bytes: Buffer;
    try { bytes = await fs.readFile(path.join(root, file)); }
    catch { throw new Error(`Preview asset unavailable: ${file}. Run npm ci --ignore-scripts and npm run build:demo in this checkout before starting.`); }
    hash.update(file); hash.update('\0'); hash.update(bytes); hash.update('\0');
  }
  let sourceRevision: string | null = null;
  let sourceDirty: boolean | null = null;
  try {
    sourceRevision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    sourceDirty = (await execute('git', ['status', '--porcelain'], { cwd: root })).stdout.trim().length > 0;
  } catch { /* A source archive still has the exact static-asset hash. */ }
  return { sourceRevision, sourceDirty, buildSha256: hash.digest('hex') };
}

async function closeServer(server: DemoServer): Promise<void> {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await server.closeModelWorkers();
}

export async function startSpatialPreview(config: SpatialPreviewConfig, dependencies: SpatialPreviewDependencies = {}) {
  validateConfig(config);
  const identity = await artifactIdentity();
  const owned = await claimDirectory(config);
  let connection: PreviewConnection | null = null;
  let server: DemoServer | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try { if (server) await closeServer(server); }
      finally {
        try { await connection?.close(); }
        finally { await owned.release(); }
      }
    })();
    return closing;
  };
  try {
    connection = dependencies.connection !== undefined ? dependencies.connection : config.offline ? null
      : await CodexAccountConnection.open({ workingDirectory: path.join(owned.directory, 'agent-workspace') });
    server = await createDemoServer({ codex: connection, backlogFile: path.join(owned.directory, databaseName),
      ...(config.ifcSpool ? { linkedModelSpool: config.ifcSpool, linkedModelRoot: path.join(owned.directory, 'ifc-links') } : {}) });
    const listeningServer = server;
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { listeningServer.removeListener('listening', ready); reject(error); };
      const ready = () => { listeningServer.removeListener('error', failed); resolve(); };
      listeningServer.once('error', failed); listeningServer.once('listening', ready);
      listeningServer.listen(config.port, '127.0.0.1');
    });
    const receipt = Object.freeze({ event: 'ready', pid: process.pid, url: `http://127.0.0.1:${config.port}`,
      dataDirectory: owned.directory, ifcConfigured: Boolean(config.ifcSpool), aiConnected: Boolean(connection?.publicSession().connected), ...identity });
    return { receipt, close };
  } catch (error) {
    await close();
    if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
      throw new Error(`Preview port ${config.port} is already in use. Choose another --port; the existing process was left running.`);
    }
    throw error;
  }
}

export async function runSpatialPreview(args: readonly string[], dependencies: SpatialPreviewDependencies = {}) {
  const preview = await startSpatialPreview(parseSpatialPreviewConfig(args), dependencies);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void preview.close().then(() => {
      process.stdout.write(`${JSON.stringify({ event: 'stopped', pid: process.pid })}\n`);
    }).catch(() => {
      process.stderr.write('Local preview cleanup failed. Check its process before restarting.\n'); process.exitCode = 1;
    }).finally(() => { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); });
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  process.stdout.write(`${JSON.stringify(preview.receipt)}\n`);
  return preview;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).length === 1 && process.argv[2] === '--help') {
    process.stdout.write('Local spatial preview: node scripts/serve-spatial-preview.ts --data-dir <absolute-new-directory> [--port 4188] [--ifc-spool <absolute-dedicated-spool>] [--offline]\nStop with Ctrl+C. Existing AI account is used normally unless --offline is set. Never use an existing model directory.\n');
  } else {
    try { await runSpatialPreview(process.argv.slice(2)); }
    catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Local preview startup failed.'}\n`); process.exitCode = 1; }
  }
}
