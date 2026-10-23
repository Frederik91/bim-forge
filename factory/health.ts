import { pathToFileURL } from 'node:url';

export type RunHealthStatus = 'running' | 'succeeded' | 'needs-input' | 'failed'
  | 'timed-out' | 'cancelled' | 'interrupted' | 'blocked';

export interface RunHealthSummary {
  total: number;
  byStatus: Record<RunHealthStatus, number>;
  attentionRequired: boolean;
}

const STATUSES: readonly RunHealthStatus[] = Object.freeze([
  'running',
  'succeeded',
  'needs-input',
  'failed',
  'timed-out',
  'cancelled',
  'interrupted',
  'blocked',
]);
const ATTENTION = new Set<RunHealthStatus>([
  'needs-input', 'failed', 'timed-out', 'interrupted', 'blocked',
]);
const MAX_RECORDS = 1000;
const MAX_BYTES = 64 * 1024;
const INVALID = 'Invalid run records';

function isRunHealthStatus(value: unknown): value is RunHealthStatus {
  return value === 'running' || value === 'succeeded' || value === 'needs-input'
    || value === 'failed' || value === 'timed-out' || value === 'cancelled'
    || value === 'interrupted' || value === 'blocked';
}

export function summarizeRunHealth(runs: unknown): RunHealthSummary {
  if (!Array.isArray(runs) || runs.length > MAX_RECORDS) {
    throw new TypeError(INVALID);
  }

  const byStatus: Record<RunHealthStatus, number> = {
    running: 0,
    succeeded: 0,
    'needs-input': 0,
    failed: 0,
    'timed-out': 0,
    cancelled: 0,
    interrupted: 0,
    blocked: 0,
  };
  let attentionRequired = false;

  for (const run of runs) {
    if (run === null || typeof run !== 'object' || Array.isArray(run)) {
      throw new TypeError(INVALID);
    }
    const status = Reflect.get(run, 'status');
    if (!isRunHealthStatus(status)) {
      throw new TypeError(INVALID);
    }
    byStatus[status] += 1;
    if (ATTENTION.has(status)) attentionRequired = true;
  }

  return { total: runs.length, byStatus, attentionRequired };
}

async function main(): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      if (!Buffer.isBuffer(chunk)) throw new TypeError(INVALID);
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw new TypeError(INVALID);
      chunks.push(chunk);
    }
    const input = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const result = summarizeRunHealth(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${INVALID}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
