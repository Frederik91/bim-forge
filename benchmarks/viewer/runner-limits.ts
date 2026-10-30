import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Candidate } from './metrics.ts';

function killTree(roots: number[]): void {
  if (process.platform === 'win32') {
    for (const pid of roots) {
      try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, stdio: 'ignore', windowsHide: true }); }
      catch (error) {
        try { process.kill(pid, 0); } catch { continue; }
        throw error;
      }
    }
    return;
  }
  // Chromium may detach its own process group during launch. Capture descendants
  // before killing the worker, including when launch has not returned a browser PID.
  const parents = new Map<number, number>();
  if (process.platform === 'linux') {
    for (const entry of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        const parent = /^PPid:\s+(\d+)/m.exec(readFileSync('/proc/' + entry + '/status', 'utf8'));
        if (parent) parents.set(Number(entry), Number(parent[1]));
      } catch { /* A process can exit while the snapshot is read. */ }
    }
  } else {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 });
    for (const row of rows.trim().split('\n')) {
      const [pid, parent] = row.trim().split(/\s+/).map(Number);
      if (pid > 0 && parent >= 0) parents.set(pid, parent);
    }
  }
  const descendants = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of parents) if (descendants.has(parent) && !descendants.has(pid)) { descendants.add(pid); changed = true; }
  }
  function kill(pid: number): void {
    try { process.kill(pid, 'SIGKILL'); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error; }
  }
  for (const pid of [...descendants].reverse()) kill(pid);
  for (const pid of roots) kill(-pid);
}

export async function runCandidateProcess(options: {
  candidate: Candidate | 'production-individual' | 'production-retained'; output: string; timeoutMs: number; executable: string; args: string[];
}): Promise<boolean> {
  const started = Date.now();
  let phase = 'launch'; let stdout = ''; let stderr = ''; let completed = false;
  const roots = new Set<number>();
  const worker = spawn(options.executable, options.args, { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  if (worker.pid) roots.add(worker.pid);
  worker.stdout?.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-65536); process.stdout.write(String(chunk)); });
  worker.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-65536); });
  worker.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    if ('phase' in message && typeof message.phase === 'string') { phase = message.phase; completed = phase === 'completed'; }
    if ('browserPid' in message && typeof message.browserPid === 'number' && Number.isSafeInteger(message.browserPid) && message.browserPid > 0) roots.add(message.browserPid);
  });
  return new Promise<boolean>(resolve => {
    let settled = false;
    async function finish(error: string | null): Promise<void> {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const cleanupErrors: string[] = [];
      try { killTree([...roots]); } catch (failure) { cleanupErrors.push(String(failure)); }
      worker.stdout?.destroy(); worker.stderr?.destroy();
      if (worker.connected) worker.disconnect();
      worker.unref();
      try {
        await fs.writeFile(path.join(options.output, options.candidate + '-stdout.txt'), stdout);
        await fs.writeFile(path.join(options.output, options.candidate + '-stderr.txt'), stderr);
        if (error || cleanupErrors.length) {
          await fs.writeFile(path.join(options.output, options.candidate + '-failure.json'), JSON.stringify({
            status: 'failed', qualified: false, phase, error: error ?? 'Candidate cleanup failed',
            timeoutMs: options.timeoutMs, elapsedMs: Date.now() - started, cleanupErrors,
          }, null, 2) + '\n');
        }
      } catch (failure) { process.stderr.write('Cannot retain candidate evidence: ' + String(failure) + '\n'); resolve(false); return; }
      resolve(error === null && cleanupErrors.length === 0);
    }
    const timer = setTimeout(() => { void finish('Candidate lifecycle timeout'); }, Math.max(1, options.timeoutMs - (Date.now() - started)));
    worker.once('error', error => { void finish(error.message); });
    worker.once('exit', (code, signal) => { void finish(code === 0 && completed ? null : 'Candidate exited before successful close: ' + String(code ?? signal)); });
  });
}
