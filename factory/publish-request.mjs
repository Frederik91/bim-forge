import { createHash } from 'node:crypto';

export const REPOSITORY = 'Frederik91/bim-forge';
export const BOT = 'bim-forge-factory-frederik91[bot]';
export const issueFingerprint = (issue) => createHash('sha256').update(JSON.stringify({
  number: issue.number, title: issue.title, body: issue.body,
})).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
const cleanText = (value, maximum) => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value) <= maximum && Buffer.from(value).toString('utf8') === value &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const containsCredential = (value) => /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,})/.test(value);
const roomDemoPaths = new Set([
  'GLOSSARY.md', 'demo/index.html', 'demo/room.css', 'demo/room-app.ts',
  'demo/room-store.ts', 'demo/server.ts', 'demo/server.test.mjs',
  'src/room-model.ts',
]);

export function approvePackage(bytes, approvedSha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || !/^[a-f0-9]{64}$/.test(approvedSha256 ?? '')) {
    throw new Error('Invalid publication approval or package size');
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== approvedSha256) throw new Error('Publication approval does not match the exact package bytes');
  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const proposal = JSON.parse(json);
  const objects = [];
  for (const [token] of json.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)) {
    if (token === '{' || token === '[') objects.push({ object: token === '{', key: token === '{', seen: new Set() });
    else if (token === '}' || token === ']') objects.pop();
    else if (token === ':' && objects.at(-1)?.object) objects.at(-1).key = false;
    else if (token === ',' && objects.at(-1)?.object) objects.at(-1).key = true;
    else if (token.startsWith('"') && objects.at(-1)?.key) {
      const key = JSON.parse(token); const object = objects.at(-1);
      if (object.seen.has(key)) throw new Error('Publication JSON contains a duplicate field');
      object.seen.add(key);
    }
  }
  if (!exactKeys(proposal, ['version', 'repository', 'issue', 'issueUpdatedAt', 'issueSha256', 'baseSha', 'title', 'body', 'files']) ||
      proposal.version !== 1 || proposal.repository !== REPOSITORY ||
      !Number.isSafeInteger(proposal.issue) || proposal.issue < 1 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(proposal.issueUpdatedAt ?? '') ||
      !/^[a-f0-9]{64}$/.test(proposal.issueSha256 ?? '') ||
      !/^[a-f0-9]{40}$/.test(proposal.baseSha) ||
      !cleanText(proposal.title, 120) || /[\r\n]/.test(proposal.title) || !cleanText(proposal.body, 16 * 1024) ||
      !Array.isArray(proposal.files) || proposal.files.length < 1 || proposal.files.length > 12) {
    throw new Error('Invalid publication package');
  }
  const paths = new Set();
  for (const file of proposal.files) {
    if (!exactKeys(file, ['path', 'content']) || typeof file.path !== 'string' || file.path.length > 160 ||
        (!/^(?:docs\/[a-z0-9][a-z0-9\/-]*\.md|factory\/[a-z0-9][a-z0-9.-]*\.mjs|src\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.mjs|package\.json)$/.test(file.path)
          && !roomDemoPaths.has(file.path)) ||
        file.path.includes('//') || /(?:^|\/)(?:agents|claude|skill)\.md$/i.test(file.path) ||
        paths.has(file.path) || !cleanText(file.content, 64 * 1024) ||
        Buffer.from(file.content).toString('utf8') !== file.content) {
      throw new Error('Publication contains an unsupported path, content, duplicate, or operation');
    }
    paths.add(file.path);
  }
  if (proposal.files.some((file) => [...paths].some((path) => path.startsWith(`${file.path}/`)))) {
    throw new Error('Publication has conflicting file and directory paths');
  }
  if (containsCredential(JSON.stringify(proposal))) throw new Error('Publication may contain credential material');
  return { proposal, digest, branch: `factory/publish/issue-${proposal.issue}-${digest.slice(0, 20)}` };
}

export function assertHumanGate(repository, protection, codeowners) {
  const reviews = protection?.required_pull_request_reviews;
  const checks = protection?.required_status_checks;
  const bypass = reviews?.bypass_pull_request_allowances;
  if (repository?.full_name !== REPOSITORY || repository.archived !== false || repository.allow_auto_merge !== false ||
      reviews?.required_approving_review_count < 1 || !Number.isInteger(reviews?.required_approving_review_count) ||
      reviews?.require_code_owner_reviews !== true || reviews?.dismiss_stale_reviews !== true ||
      (bypass && Object.values(bypass).some((actors) => !Array.isArray(actors) || actors.length !== 0)) ||
      checks?.strict !== true || !checks.checks?.some((check) => check.context === 'Policy and repository checks' && check.app_id === 15368) ||
      protection.enforce_admins?.enabled !== true || protection.required_conversation_resolution?.enabled !== true ||
      protection.required_linear_history?.enabled !== true || protection.allow_force_pushes?.enabled !== false ||
      protection.allow_deletions?.enabled !== false) {
    throw new Error('Required human review or trusted CI protections are missing');
  }
  const ownership = codeowners.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (ownership.length !== 1 || !/^\*\s+@Frederik91$/.test(ownership[0])) {
    throw new Error('CODEOWNERS does not require the expected human maintainer');
  }
}

export function assertChangePolicy(proposal, policy) {
  if (policy?.version !== 1 || policy.autoMerge?.enabled !== false ||
      !Number.isInteger(policy.maxChangedFiles) || policy.maxChangedFiles < 1 || policy.maxChangedFiles > 12 ||
      !Number.isInteger(policy.maxAttemptsPerIssue) || policy.maxAttemptsPerIssue < 1 || policy.maxAttemptsPerIssue > 3 ||
      !Array.isArray(policy.denylist) || policy.denylist.some((glob) => typeof glob !== 'string') ||
      proposal.files.length > policy.maxChangedFiles) throw new Error('Publication exceeds the pinned repository policy');
  const globRegex = (glob) => {
    let pattern = '^';
    for (let index = 0; index < glob.length; index += 1) {
      const char = glob[index];
      if (glob.slice(index, index + 3) === '**/') { pattern += '(?:.*/)?'; index += 2; }
      else if (glob.slice(index, index + 2) === '**') { pattern += '.*'; index += 1; }
      else if (char === '*') pattern += '[^/]*';
      else if (char === '?') pattern += '[^/]';
      else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
    return new RegExp(`${pattern}$`, 'i');
  };
  if (proposal.files.some(({ path }) => policy.denylist.some((glob) => globRegex(glob).test(path)))) {
    throw new Error('Publication touches a protected path');
  }
}
