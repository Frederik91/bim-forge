import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ChatGPTPlanConnection } from '../src/chatgpt-plan.ts';

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_CONTAINER = 'bim-preview-app';
const DEFAULT_STORAGE_FILE = '/var/lib/bim-forge/chatgpt/connection.json';

interface PairArguments {
  remote: string;
  port: number;
  container: string;
  storageFile: string;
  knownHosts: string | null;
}

interface CommandResult { stdout: string; stderr: string }
type RemoteOperation = 'host-id' | 'bootstrap' | 'import' | 'restart' | 'health';

function requiredValue(values: readonly string[], index: number, flag: string): string {
  const value = values[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseArguments(values: readonly string[]): PairArguments {
  let remote: string | null = null;
  let port = 22;
  let container = DEFAULT_CONTAINER;
  let storageFile = DEFAULT_STORAGE_FILE;
  let knownHosts: string | null = null;
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = requiredValue(values, index, flag ?? 'argument');
    if (flag === '--remote') remote = value;
    else if (flag === '--port') port = Number(value);
    else if (flag === '--container') container = value;
    else if (flag === '--storage-file') storageFile = value;
    else if (flag === '--known-hosts') knownHosts = value;
    else throw new Error(`Unknown pairing option: ${flag ?? '(missing)'}.`);
  }
  if (!remote || !/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+$/.test(remote)) throw new Error('--remote must use the form user@host.');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 through 65535.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container)) throw new Error('--container is invalid.');
  if (!/^\/[A-Za-z0-9_./-]+$/.test(storageFile) || storageFile.includes('..')) throw new Error('--storage-file must be a normalized absolute container path.');
  return { remote, port, container, storageFile, knownHosts };
}

function sshArguments(args: PairArguments, operation: RemoteOperation): string[] {
  const options = [
    '-F', 'none', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'HostKeyAlgorithms=ssh-ed25519', '-p', String(args.port),
  ];
  if (args.knownHosts) options.push('-o', `UserKnownHostsFile=${args.knownHosts}`);
  if (operation === 'restart') return [...options, args.remote, 'docker', 'restart', args.container];
  if (operation === 'health') {
    return [...options, args.remote, 'docker', 'exec', args.container, 'node', '/app/scripts/container-healthcheck.ts'];
  }
  return [...options, args.remote, 'docker', 'exec', '-i', args.container,
    'node', '/app/scripts/chatgpt-transfer.ts', operation, '--storage-file', args.storageFile];
}

function runSsh(args: PairArguments, operation: RemoteOperation, input: string | null): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArguments(args, operation), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill();
        reject(new Error('The remote pairing command returned too much output.'));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      const result = { stdout: Buffer.concat(stdout).toString('utf8').trim(), stderr: Buffer.concat(stderr).toString('utf8').trim() };
      if (code === 0) resolve(result);
      else reject(new Error(result.stderr || `The remote pairing command exited with code ${String(code)}.`));
    });
    child.stdin.end(input ?? undefined);
  });
}

async function waitForRemoteHealth(args: PairArguments): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await runSsh(args, 'health', null); return; }
    catch (error) { lastError = error; }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw lastError instanceof Error ? lastError : new Error('The remote preview did not become healthy after pairing.');
}

const args = parseArguments(process.argv.slice(2));
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-forge-chatgpt-pair-'));
try {
  const hostResult = await runSsh(args, 'host-id', null);
  const hostId = hostResult.stdout;
  if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId)) throw new Error('The remote runtime returned an invalid host identifier.');
  const connection = await ChatGPTPlanConnection.open({
    storageFile: path.join(temporaryDirectory, 'connection.json'),
    hostId,
  });
  const bootstrapResult = await runSsh(args, 'bootstrap', null);
  let bootstrap: unknown;
  try { bootstrap = JSON.parse(bootstrapResult.stdout); }
  catch { throw new Error('The remote runtime returned an invalid pairing bootstrap.'); }
  await connection.importPairingBootstrap(bootstrap);
  process.stdout.write('Opening ChatGPT in your browser. Complete consent to pair the preview server.\n');
  const session = await connection.signIn();
  const imported = await runSsh(args, 'import', JSON.stringify(connection.credentialTransfer()));
  await runSsh(args, 'restart', null);
  await waitForRemoteHealth(args);
  const restartedHost = (await runSsh(args, 'host-id', null)).stdout;
  if (restartedHost !== hostId) throw new Error('The remote preview host identity changed during pairing.');
  const account = session.account?.email ?? session.account?.name ?? 'connected account';
  process.stdout.write(`Paired ${account} with the remote BIM Forge preview.\n`);
  if (imported.stdout) process.stdout.write(`Remote status: ${imported.stdout}\n`);
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
