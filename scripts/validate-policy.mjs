import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const policyPath = path.join(root, 'policy', 'gate.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

const requiredArrays = ['denylist', 'humanReviewRequired', 'autoMergeAllowlist'];
for (const key of requiredArrays) {
  if (!Array.isArray(policy[key]) || policy[key].some((value) => typeof value !== 'string')) {
    throw new Error(`policy.${key} must be an array of strings`);
  }
}

if (policy.version !== 1) throw new Error('Unsupported policy version');
if (!Number.isInteger(policy.maxChangedFiles) || policy.maxChangedFiles < 1) {
  throw new Error('policy.maxChangedFiles must be a positive integer');
}
if (!Number.isInteger(policy.maxAttemptsPerIssue) || policy.maxAttemptsPerIssue < 1) {
  throw new Error('policy.maxAttemptsPerIssue must be a positive integer');
}
if (policy.autoMerge?.enabled !== false) throw new Error('Auto-merge must remain disabled in the bootstrap');

const globToRegExp = (glob) => {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*' && glob[index + 2] === '/') {
      pattern += '(?:.*/)?';
      index += 2;
      continue;
    }
    if (char === '*' && glob[index + 1] === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`, 'i');
};

const matches = (file, globs) => globs.some((glob) => globToRegExp(glob).test(file.replaceAll('\\', '/')));
const changedFilesIndex = process.argv.indexOf('--changed-files');
const changedFiles = changedFilesIndex === -1
  ? []
  : process.argv.slice(changedFilesIndex + 1).join(' ').split(/\s+/).filter(Boolean);

if (changedFiles.length > policy.maxChangedFiles) {
  throw new Error(`Changed file count ${changedFiles.length} exceeds max ${policy.maxChangedFiles}`);
}

const denied = changedFiles.filter((file) => matches(file, policy.denylist));
if (denied.length > 0) throw new Error(`Protected paths changed: ${denied.join(', ')}`);

console.log(`Policy valid. ${changedFiles.length} changed file(s) checked.`);
