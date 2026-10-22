import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { runPlan } from './runner.ts';
import { createCodexPlanner } from './codex-planner.mjs';

const repository = 'Frederik91/bim-forge';
const apiRoot = `https://api.github.com/repos/${repository}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function github(endpoint: string): Promise<unknown> {
  const response = await fetch(`${apiRoot}/${endpoint}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bim-forge-private-planner' },
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GitHub intake failed: HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 262144) throw new Error('GitHub response exceeds intake limit');
  return JSON.parse(text);
}

export function issueSnapshot(value: unknown, number: number) {
  if (!isRecord(value) || value.pull_request || value.number !== number || value.state !== 'open'
      || typeof value.title !== 'string' || typeof value.body !== 'string'
      || typeof value.updated_at !== 'string' || !value.body.trim()) throw new Error('Expected an open issue with a written scope');
  return { repository, number, title: value.title, body: value.body, updatedAt: value.updated_at, approved: true };
}

export function createPauseCheck(fetchIssues: (endpoint: string) => Promise<unknown> = github) {
  let expiresAt = 0;
  let paused = false;
  return async ({ fresh = false }: { fresh?: boolean } = {}): Promise<boolean> => {
    if (fresh || Date.now() >= expiresAt) {
      const issues = await fetchIssues('issues?state=open&labels=loop-pause-all&per_page=1');
      if (!Array.isArray(issues)) throw new Error('Cannot verify repository pause signal');
      paused = issues.length > 0;
      expiresAt = Date.now() + 60000;
    }
    return paused;
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    issue: { type: 'string' }, 'data-dir': { type: 'string' }, 'approve-scope': { type: 'boolean', default: false },
    'timeout-ms': { type: 'string', default: '600000' }, retry: { type: 'boolean', default: false },
  } });
  if (!values['approve-scope']) throw new Error('A trusted operator must explicitly select and approve this planning scope with --approve-scope');
  if (!/^[1-9]\d*$/.test(values.issue ?? '') || !values['data-dir']) throw new Error('Supply --issue <number> and --data-dir <outside-checkout>');
  const issueNumber = Number(values.issue);
  if (!Number.isSafeInteger(issueNumber)) throw new Error('Invalid issue number');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Live planning requires a clean, pinned checkout');
  const sourceRevision = git('rev-parse', 'HEAD');
  const pauseCheck = createPauseCheck();
  if (await pauseCheck({ fresh: true })) throw new Error('Repository pause signal is active');
  const issue = issueSnapshot(await github(`issues/${issueNumber}`), issueNumber);
  const policy: unknown = JSON.parse(fs.readFileSync(path.join(repoRoot, 'policy', 'gate.json'), 'utf8'));
  const context = { issue, sourceRevision,
    repositoryPaths: git('ls-tree', '-r', '--name-only', 'HEAD').split('\n'),
    readme: fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'),
    instructions: fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8'),
    policy,
    factorySources: Object.fromEntries(['runner.ts', 'codex-planner.mjs', 'live.ts', 'plan.mjs', 'cli.ts'].map((file) => [
      `factory/${file}`, fs.readFileSync(path.join(repoRoot, 'factory', file), 'utf8'),
    ])),
  };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const result = await runPlan({ repoRoot, dataDir: path.resolve(values['data-dir']), issue, sourceRevision,
      planner: createCodexPlanner(context), pauseCheck, signal: controller.signal,
      timeoutMs: Number(values['timeout-ms']), retry: values.retry,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!['succeeded', 'needs-input'].includes(result.status)) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(errorMessage(error)); process.exitCode = 1; });
}
