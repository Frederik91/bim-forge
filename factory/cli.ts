import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { listRuns, recoverInterrupted, runFixturePlan } from './runner.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'data-dir': { type: 'string' }, fixture: { type: 'string' }, 'plan-fixture': { type: 'string' },
    'timeout-ms': { type: 'string', default: '600000' }, retry: { type: 'boolean', default: false },
  } });
  if (positionals.length !== 1 || !['run', 'status', 'recover'].includes(positionals[0]) || !values['data-dir']) {
    throw new Error('Usage: npm run factory -- run|status|recover --data-dir <outside-checkout> [--fixture <issue.json> --plan-fixture <plan.json>]');
  }
  const dataDir = path.resolve(values['data-dir']);
  if (positionals[0] === 'status') console.log(JSON.stringify(listRuns(dataDir), null, 2));
  else if (positionals[0] === 'recover') console.log(JSON.stringify(recoverInterrupted(repoRoot, dataDir), null, 2));
  else {
    if (!values.fixture || !values['plan-fixture']) throw new Error('This release supports fixture runs only; both fixture files are required');
    const readFixture = (file: string): unknown => {
      if (fs.statSync(file).size > 131072) throw new Error('Fixture file too large');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
      const result = await runFixturePlan({ repoRoot, dataDir,
        issue: readFixture(values.fixture), plan: readFixture(values['plan-fixture']),
        sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
        timeoutMs: Number(values['timeout-ms']), retry: values.retry, signal: controller.signal,
      });
      console.log(JSON.stringify({ ...result, artifacts: path.join(dataDir, result.id) }, null, 2));
      if (!['succeeded', 'needs-input'].includes(result.status)) process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
