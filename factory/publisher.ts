import { createHash } from 'node:crypto';
import {
  approvePackage, assertHumanGate, assertChangePolicy, issueFingerprint, BOT, REPOSITORY,
  type PublicationProposal,
} from './publish-request.ts';
import type { PublisherRequest } from './publisher-identity.ts';

type AuditRecorder = (event: Record<string, unknown>) => Promise<unknown> | unknown;

interface PublishApprovedOptions {
  readonly bytes: unknown;
  readonly approvedSha256: unknown;
  readonly request: PublisherRequest;
  readonly record?: AuditRecorder;
  readonly isLocallyPaused?: () => Promise<boolean> | boolean;
  readonly hasPendingDraftIntent?: boolean;
}

interface GitTreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
}

interface GitCommit {
  readonly tree: { readonly sha: string };
  readonly parents?: { readonly sha: string }[];
  readonly message?: string;
}

export interface PublicationResult extends Record<string, unknown> {
  readonly status: 'published';
  readonly digest: string;
  readonly issue: number;
  readonly branch: string;
  readonly commitSha: string;
  readonly pullRequestUrl: string;
  readonly reused: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
}

function parseJsonRecord(text: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  return value;
}

function policyAttemptLimit(policy: unknown): number {
  if (!isRecord(policy) || typeof policy.maxAttemptsPerIssue !== 'number'
      || !Number.isInteger(policy.maxAttemptsPerIssue)) {
    throw new Error('Pinned policy is invalid');
  }
  return policy.maxAttemptsPerIssue;
}

function blobSha(content: string): string {
  const body = Buffer.from(content);
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

function parseCommit(value: unknown): GitCommit {
  if (!isRecord(value) || !isRecord(value.tree) || typeof value.tree.sha !== 'string'
      || !/^[a-f0-9]{40}$/.test(value.tree.sha)) {
    throw new Error('GitHub returned an invalid commit tree');
  }
  const parents = value.parents;
  if (parents !== undefined && (!Array.isArray(parents) || !parents.every((parent) => isRecord(parent)
    && typeof parent.sha === 'string'))) {
    throw new Error('GitHub returned an invalid commit');
  }
  return {
    tree: { sha: value.tree.sha },
    ...(Array.isArray(parents) ? { parents: parents.map((parent) => ({ sha: String(parent.sha) })) } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

function validatePackageChange(proposal: PublicationProposal, baselineText: string): void {
  const packageChange = proposal.files.find((file) => file.path === 'package.json');
  if (!packageChange) return;
  const baseline = parseJsonRecord(baselineText, 'Pinned package');
  const candidate = parseJsonRecord(packageChange.content, 'Candidate package');
  const baselineScripts = isRecord(baseline.scripts) ? baseline.scripts : undefined;
  const candidateScripts = isRecord(candidate.scripts) ? candidate.scripts : undefined;
  const baselineValidate = baselineScripts?.validate;
  const baselineTest = baselineScripts?.test;
  const candidateValidate = candidateScripts?.validate;
  const candidateTest = candidateScripts?.test;
  const addedTests = typeof baselineTest === 'string' && typeof candidateTest === 'string'
    && candidateTest.startsWith(`${baselineTest} `)
    ? candidateTest.slice(baselineTest.length).trim().split(/\s+/)
    : [];
  const supported = addedTests.length > 0 && addedTests.every((file) => /^factory\/[a-z0-9.-]+\.test\.ts$/.test(file)
    || ((/^src\/[a-z0-9]+(?:-[a-z0-9]+)*\.test\.ts$/.test(file) || file === 'demo/server.test.ts')
      && proposal.files.some((item) => item.path === file)
      && proposal.files.some((item) => item.path === file.replace(/\.test\.ts$/, '.ts'))));
  if (typeof baselineValidate !== 'string' || candidateValidate !== baselineValidate
      || !candidateScripts || Object.keys(candidateScripts).some((name) => /^(?:pre|post)/.test(name))
      || !supported) {
    throw new Error('Publication would replace a validator or add unsupported lifecycle commands');
  }
}

export async function publishApproved({
  bytes,
  approvedSha256,
  request,
  record,
  isLocallyPaused = () => false,
  hasPendingDraftIntent = false,
}: PublishApprovedOptions): Promise<PublicationResult> {
  const { proposal, digest, branch } = approvePackage(bytes, approvedSha256);
  if (!record) throw new Error('Publication requires an audit recorder');
  const audit = async (event: Record<string, unknown>): Promise<void> => { await record(event); };
  const readText = async (filePath: string): Promise<string> => {
    const file = await request('GET', `/contents/${filePath}?ref=${proposal.baseSha}`);
    if (!isRecord(file) || file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error('Pinned control file is unavailable');
    }
    const contents = Buffer.from(file.content, 'base64');
    if (contents.length > 64 * 1024) throw new Error('Pinned control file is too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(contents);
  };
  const codeowners = await readText('.github/CODEOWNERS');
  const policy: unknown = JSON.parse(await readText('policy/gate.json'));
  assertChangePolicy(proposal, policy);
  if (proposal.files.some((file) => file.path === 'package.json')) {
    validatePackageChange(proposal, await readText('package.json'));
  }
  const preflight = async (): Promise<void> => {
    if (await isLocallyPaused()) throw new Error('Publisher is locally paused');
    const main = await request('GET', '/git/ref/heads/main');
    if (!isRecord(main) || !isRecord(main.object) || main.object.type !== 'commit' || main.object.sha !== proposal.baseSha) {
      throw new Error('Approved main revision is stale');
    }
    const repository = await request('GET', '/');
    const protection = await request('GET', '/branches/main/protection');
    assertHumanGate(repository, protection, codeowners);
    const rulesets = await request('GET', '/rulesets?includes_parents=true&per_page=100');
    if (!Array.isArray(rulesets) || rulesets.length >= 100
        || rulesets.some((rule) => !isRecord(rule) || rule.enforcement !== 'disabled')) {
      throw new Error('Unsupported repository rulesets require operator review');
    }
    const issue = await request('GET', `/issues/${proposal.issue}`);
    if (!isRecord(issue) || issue.number !== proposal.issue || issue.state !== 'open' || issue.pull_request
        || issue.updated_at !== proposal.issueUpdatedAt || typeof issue.title !== 'string' || typeof issue.body !== 'string'
        || issueFingerprint({ number: proposal.issue, title: issue.title, body: issue.body }) !== proposal.issueSha256) {
      throw new Error('Approved issue is closed, changed, or not an issue');
    }
    const paused = await request('GET', '/issues?state=open&labels=loop-pause-all&per_page=1');
    if (!Array.isArray(paused) || paused.length) throw new Error('Repository pause signal is active or unknown');
    const state = await readText('STATE.md');
    const flags = [...state.matchAll(/^\s*paused:\s*(true|false)\s*$/gm)];
    if (flags.length !== 1 || flags[0]?.[1] !== 'false') throw new Error('Repository pause state is active or unknown');
  };
  await preflight();
  await audit({
    stage: 'approved', digest, issue: proposal.issue, baseSha: proposal.baseSha, branch,
    attemptLimit: policyAttemptLimit(policy), paths: proposal.files.map((file) => file.path),
  });
  const mutate = async (resource: string, body: unknown): Promise<unknown> => {
    await preflight();
    await audit({ stage: 'write-intent', resource, digest, branch });
    const response = await request('POST', resource, body);
    await audit({ stage: 'write-observed', resource, digest, branch });
    return response;
  };
  const readCommit = async (sha: unknown): Promise<GitCommit> => {
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('GitHub returned an invalid commit');
    return parseCommit(await request('GET', `/git/commits/${sha}`));
  };
  const readTree = async (sha: string): Promise<Map<string, GitTreeEntry>> => {
    const tree = await request('GET', `/git/trees/${sha}?recursive=1`);
    if (!isRecord(tree) || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 5000) {
      throw new Error('Cannot verify the complete Git tree');
    }
    const entries = new Map<string, GitTreeEntry>();
    for (const entry of tree.tree) {
      if (!isRecord(entry) || typeof entry.path !== 'string' || entries.has(entry.path)
          || typeof entry.sha !== 'string' || !/^[a-f0-9]{40}$/.test(entry.sha)
          || typeof entry.mode !== 'string' || typeof entry.type !== 'string') {
        throw new Error('Invalid Git tree inventory');
      }
      entries.set(entry.path, { path: entry.path, sha: entry.sha, mode: entry.mode, type: entry.type });
    }
    return entries;
  };
  const base = await readCommit(proposal.baseSha);
  const expected = await readTree(base.tree.sha);
  for (const file of proposal.files) {
    const previous = expected.get(file.path);
    if (previous && (previous.type !== 'blob' || previous.mode !== '100644')) {
      throw new Error('Unsupported existing file mode or object');
    }
    if ([...expected.keys()].some((candidate) => candidate !== file.path && candidate.toLowerCase() === file.path.toLowerCase())) {
      throw new Error('Publication path has a case collision');
    }
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = expected.get(segments.slice(0, index).join('/'));
      if (ancestor && ancestor.type !== 'tree') throw new Error('Publication parent is not a directory');
    }
    const sha = blobSha(file.content);
    if (previous?.sha === sha) throw new Error('Publication includes an unchanged file');
    expected.set(file.path, { path: file.path, type: 'blob', mode: '100644', sha });
  }
  const leaves = (inventory: Map<string, GitTreeEntry>): string => [...inventory.values()]
    .filter((entry) => entry.type !== 'tree')
    .map(({ path: entryPath, mode, type, sha }) => JSON.stringify([entryPath, mode, type, sha])).sort().join('\n');
  const expectedLeaves = leaves(expected);
  const message = `${proposal.title}\n\nBIM Forge publication ${digest}`;
  const verifyCommit = async (sha: unknown): Promise<void> => {
    const commit = await readCommit(sha);
    if (commit.parents?.length !== 1 || commit.parents[0]?.sha !== proposal.baseSha || commit.message !== message
        || leaves(await readTree(commit.tree.sha)) !== expectedLeaves) {
      throw new Error('Existing publication branch does not match the approved package');
    }
  };
  const refResource = `/git/ref/heads/${branch}`;
  let ref: unknown = await request('GET', refResource, undefined, true);
  let reused = Boolean(ref);
  if (!ref) {
    if (hasPendingDraftIntent) throw new Error('Previous publication is uncertain; the approved branch is missing');
    const tree = await mutate('/git/trees', { base_tree: base.tree.sha,
      tree: proposal.files.map(({ path: filePath, content }) => ({ path: filePath, mode: '100644', type: 'blob', content })) });
    if (!isRecord(tree) || typeof tree.sha !== 'string' || !/^[a-f0-9]{40}$/.test(tree.sha)
        || leaves(await readTree(tree.sha)) !== expectedLeaves) {
      throw new Error('Created tree differs from approved content');
    }
    const commit = await mutate('/git/commits', { message, tree: tree.sha, parents: [proposal.baseSha] });
    if (!isRecord(commit)) throw new Error('GitHub returned an invalid commit');
    await verifyCommit(commit.sha);
    try { await mutate('/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha }); }
    catch (error) { if (errorStatus(error) !== 422) throw error; }
    ref = await request('GET', refResource);
  }
  if (!isRecord(ref) || !isRecord(ref.object) || ref.object.type !== 'commit' || typeof ref.object.sha !== 'string') {
    throw new Error('Publication branch is not a commit');
  }
  const commitSha = ref.object.sha;
  await verifyCommit(commitSha);
  await preflight();
  const body = `${proposal.body}\n\n<details>\n<summary>Publication identity</summary>\n\nRelated issue: #${proposal.issue}\nPublication approval: \`${digest}\`\nSource revision: \`${proposal.baseSha}\`\nHuman approval required. No automatic merge.\n\n</details>\n`;
  const query = `/pulls?state=all&head=${encodeURIComponent(`Frederik91:${branch}`)}&per_page=100`;
  const findPr = async (): Promise<unknown> => {
    const matches = await request('GET', query);
    if (!Array.isArray(matches) || matches.length > 1) throw new Error('Ambiguous publication PR state');
    return matches[0];
  };
  let pr: unknown = await findPr();
  if (pr) reused = true;
  else {
    if (hasPendingDraftIntent) throw new Error('Previous draft creation is uncertain; operator reconciliation is required');
    try {
      pr = await mutate('/pulls', {
        title: proposal.title, body, base: 'main', head: branch, draft: true, maintainer_can_modify: false,
      });
    } catch (error) {
      if (errorStatus(error) !== 422) throw error;
      pr = await findPr();
      reused = true;
    }
  }
  if (!isRecord(pr) || typeof pr.number !== 'number' || !Number.isSafeInteger(pr.number)) {
    throw new Error('Publication did not return a PR');
  }
  const pullRequestNumber = pr.number;
  pr = await request('GET', `/pulls/${pullRequestNumber}`);
  const url = `https://github.com/${REPOSITORY}/pull/${pullRequestNumber}`;
  if (!isRecord(pr) || pr.state !== 'open' || pr.draft !== true || !isRecord(pr.user)
      || pr.user.login !== BOT || pr.user.type !== 'Bot' || !isRecord(pr.base) || pr.base.ref !== 'main'
      || !isRecord(pr.base.repo) || pr.base.repo.full_name !== REPOSITORY || !isRecord(pr.head)
      || pr.head.ref !== branch || !isRecord(pr.head.repo) || pr.head.repo.full_name !== REPOSITORY
      || pr.head.sha !== commitSha || pr.title !== proposal.title || pr.body !== body
      || pr.html_url !== url || pr.auto_merge) {
    throw new Error('Publication PR does not match the approved draft');
  }
  await audit({ stage: 'draft-observed', digest, branch, commitSha, pullRequestUrl: url });
  await preflight();
  return { status: 'published', digest, issue: proposal.issue, branch, commitSha, pullRequestUrl: url, reused };
}
