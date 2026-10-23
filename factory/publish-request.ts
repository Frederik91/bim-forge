import { createHash } from 'node:crypto';

export const REPOSITORY = 'Frederik91/bim-forge';
export const BOT = 'bim-forge-factory-frederik91[bot]';

export interface PublicationIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

export interface PublicationFile {
  path: string;
  content: string;
}

export interface PublicationProposal {
  readonly version: 1;
  readonly repository: typeof REPOSITORY;
  readonly issue: number;
  readonly issueUpdatedAt: string;
  readonly issueSha256: string;
  readonly baseSha: string;
  readonly title: string;
  body: string;
  files: PublicationFile[];
}

export interface ApprovedPackage {
  readonly proposal: PublicationProposal;
  readonly digest: string;
  readonly branch: string;
}

interface ObjectFrame {
  readonly object: boolean;
  key: boolean;
  readonly seen: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function cleanText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value) <= maximum && Buffer.from(value).toString('utf8') === value
    && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

function containsCredential(value: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,})/.test(value);
}

const roomDemoPaths = new Set([
  'GLOSSARY.md', 'demo/index.html', 'demo/room.css', 'demo/room-app.ts',
  'demo/room-store.ts', 'demo/server.ts', 'demo/server.test.ts',
  'src/room-model.ts', 'src/room-model.test.ts',
]);

export const issueFingerprint = (issue: PublicationIssue): string => createHash('sha256').update(JSON.stringify({
  number: issue.number, title: issue.title, body: issue.body,
})).digest('hex');

function assertNoDuplicateFields(json: string): void {
  const objects: ObjectFrame[] = [];
  for (const [token] of json.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)) {
    if (token === '{' || token === '[') objects.push({ object: token === '{', key: token === '{', seen: new Set() });
    else if (token === '}' || token === ']') objects.pop();
    else if (token === ':' && objects.at(-1)?.object) {
      const object = objects.at(-1);
      if (!object) throw new Error('Publication JSON contains an invalid object boundary');
      object.key = false;
    } else if (token === ',' && objects.at(-1)?.object) {
      const object = objects.at(-1);
      if (!object) throw new Error('Publication JSON contains an invalid object boundary');
      object.key = true;
    }
    else if (token.startsWith('"') && objects.at(-1)?.key) {
      const parsed: unknown = JSON.parse(token);
      if (typeof parsed !== 'string') throw new Error('Publication JSON contains an invalid field');
      const object = objects.at(-1);
      if (!object) throw new Error('Publication JSON contains an invalid object boundary');
      if (object.seen.has(parsed)) throw new Error('Publication JSON contains a duplicate field');
      object.seen.add(parsed);
    }
  }
}

function parsePublicationFile(value: unknown): PublicationFile {
  if (!exactKeys(value, ['path', 'content']) || typeof value.path !== 'string' || value.path.length > 160
      || (!/^(?:docs\/[a-z0-9][a-z0-9\/-]*\.md|factory\/[a-z0-9][a-z0-9.-]*\.ts|src\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.ts|package\.json)$/.test(value.path)
        && !roomDemoPaths.has(value.path))
      || value.path.includes('//') || /(?:^|\/)(?:agents|claude|skill)\.md$/i.test(value.path)
      || !cleanText(value.content, 64 * 1024)
      || Buffer.from(value.content).toString('utf8') !== value.content) {
    throw new Error('Publication contains an unsupported path, content, duplicate, or operation');
  }
  return { path: value.path, content: value.content };
}

export function approvePackage(bytes: unknown, approvedSha256: unknown): ApprovedPackage {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024
      || typeof approvedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(approvedSha256)) {
    throw new Error('Invalid publication approval or package size');
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== approvedSha256) throw new Error('Publication approval does not match the exact package bytes');
  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(json);
  assertNoDuplicateFields(json);
  if (!exactKeys(parsed, ['version', 'repository', 'issue', 'issueUpdatedAt', 'issueSha256', 'baseSha', 'title', 'body', 'files'])
      || parsed.version !== 1 || parsed.repository !== REPOSITORY
      || typeof parsed.issue !== 'number' || !Number.isSafeInteger(parsed.issue) || parsed.issue < 1
      || typeof parsed.issueUpdatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(parsed.issueUpdatedAt)
      || typeof parsed.issueSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.issueSha256)
      || typeof parsed.baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(parsed.baseSha)
      || !cleanText(parsed.title, 120) || /[\r\n]/.test(parsed.title) || !cleanText(parsed.body, 16 * 1024)
      || !Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 12) {
    throw new Error('Invalid publication package');
  }
  const files = parsed.files.map(parsePublicationFile);
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new Error('Publication contains an unsupported path, content, duplicate, or operation');
    paths.add(file.path);
  }
  if (files.some((file) => [...paths].some((candidate) => candidate.startsWith(`${file.path}/`)))) {
    throw new Error('Publication has conflicting file and directory paths');
  }
  const proposal: PublicationProposal = {
    version: 1,
    repository: REPOSITORY,
    issue: parsed.issue,
    issueUpdatedAt: parsed.issueUpdatedAt,
    issueSha256: parsed.issueSha256,
    baseSha: parsed.baseSha,
    title: parsed.title,
    body: parsed.body,
    files,
  };
  if (containsCredential(JSON.stringify(proposal))) throw new Error('Publication may contain credential material');
  return { proposal, digest, branch: `factory/publish/issue-${proposal.issue}-${digest.slice(0, 20)}` };
}

function emptyActorLists(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((actors) => Array.isArray(actors) && actors.length === 0);
}

export function assertHumanGate(repository: unknown, protection: unknown, codeowners: unknown): void {
  const reviews = isRecord(protection) && isRecord(protection.required_pull_request_reviews)
    ? protection.required_pull_request_reviews : undefined;
  const checks = isRecord(protection) && isRecord(protection.required_status_checks)
    ? protection.required_status_checks : undefined;
  const bypass = reviews?.bypass_pull_request_allowances;
  const checkEntries = checks?.checks;
  const hasTrustedCheck = Array.isArray(checkEntries) && checkEntries.some((check) => isRecord(check)
    && check.context === 'Policy and repository checks' && check.app_id === 15368);
  if (!isRecord(repository) || repository.full_name !== REPOSITORY || repository.archived !== false
      || repository.allow_auto_merge !== false || !reviews
      || typeof reviews.required_approving_review_count !== 'number'
      || reviews.required_approving_review_count < 1 || !Number.isInteger(reviews.required_approving_review_count)
      || reviews.require_code_owner_reviews !== true || reviews.dismiss_stale_reviews !== true
      || (bypass !== undefined && !emptyActorLists(bypass))
      || !checks || checks.strict !== true || !hasTrustedCheck || !isRecord(protection)
      || !isRecord(protection.enforce_admins) || protection.enforce_admins.enabled !== true
      || !isRecord(protection.required_conversation_resolution) || protection.required_conversation_resolution.enabled !== true
      || !isRecord(protection.required_linear_history) || protection.required_linear_history.enabled !== true
      || !isRecord(protection.allow_force_pushes) || protection.allow_force_pushes.enabled !== false
      || !isRecord(protection.allow_deletions) || protection.allow_deletions.enabled !== false) {
    throw new Error('Required human review or trusted CI protections are missing');
  }
  if (typeof codeowners !== 'string') throw new Error('CODEOWNERS does not require the expected human maintainer');
  const ownership = codeowners.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const owner = ownership[0];
  if (ownership.length !== 1 || owner === undefined || !/^\*\s+@Frederik91$/.test(owner)) {
    throw new Error('CODEOWNERS does not require the expected human maintainer');
  }
}

function globRegex(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (glob.slice(index, index + 3) === '**/') { pattern += '(?:.*/)?'; index += 2; }
    else if (glob.slice(index, index + 2) === '**') { pattern += '.*'; index += 1; }
    else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${pattern}$`, 'i');
}

export function assertChangePolicy(proposal: PublicationProposal, policy: unknown): void {
  if (!isRecord(policy) || policy.version !== 1 || !isRecord(policy.autoMerge) || policy.autoMerge.enabled !== false
      || typeof policy.maxAutomatedPublicationFiles !== 'number' || !Number.isInteger(policy.maxAutomatedPublicationFiles)
      || policy.maxAutomatedPublicationFiles < 1 || policy.maxAutomatedPublicationFiles > 12
      || typeof policy.maxAttemptsPerIssue !== 'number' || !Number.isInteger(policy.maxAttemptsPerIssue)
      || policy.maxAttemptsPerIssue < 1 || policy.maxAttemptsPerIssue > 3
      || !Array.isArray(policy.denylist) || !policy.denylist.every((glob) => typeof glob === 'string')
      || proposal.files.length > policy.maxAutomatedPublicationFiles) {
    throw new Error('Publication exceeds the pinned repository policy');
  }
  const denylist = policy.denylist.filter((glob): glob is string => typeof glob === 'string');
  if (proposal.files.some(({ path }) => denylist.some((glob) => globRegex(glob).test(path)))) {
    throw new Error('Publication touches a protected path');
  }
}
