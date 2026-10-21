import { pathToFileURL } from 'node:url';

const STATUSES = Object.freeze([
  'running',
  'succeeded',
  'needs-input',
  'failed',
  'timed-out',
  'cancelled',
  'interrupted',
  'blocked',
]);
const ATTENTION = new Set([
  'needs-input', 'failed', 'timed-out', 'interrupted', 'blocked',
]);
const MAX_RECORDS = 1000;
const MAX_BYTES = 64 * 1024;
const INVALID = 'Invalid run records';

export function summarizeRunHealth(runs) {
  if (!Array.isArray(runs) || runs.length > MAX_RECORDS) {
    throw new TypeError(INVALID);
  }

  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  let attentionRequired = false;

  for (const run of runs) {
    if (run === null || typeof run !== 'object' || Array.isArray(run)) {
      throw new TypeError(INVALID);
    }
    const status = run.status;
    if (!STATUSES.includes(status)) {
      throw new TypeError(INVALID);
    }
    byStatus[status] += 1;
    if (ATTENTION.has(status)) attentionRequired = true;
  }

  return { total: runs.length, byStatus, attentionRequired };
}

async function main() {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
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
