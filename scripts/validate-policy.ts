import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

interface GatePolicy {
  readonly version: 1;
  readonly maxAutomatedPublicationFiles: number;
  readonly maxAttemptsPerIssue: number;
  readonly denylist: string[];
  readonly humanReviewRequired: string[];
  readonly autoMergeAllowlist: string[];
  readonly autoMerge: { readonly enabled: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`policy.${key} must be an array of strings`);
  }
  return value;
}

function readPolicy(filename: string): GatePolicy {
  const parsed: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!isRecord(parsed) || parsed.version !== 1) throw new Error('Unsupported policy version');
  if (typeof parsed.maxAutomatedPublicationFiles !== 'number'
      || !Number.isInteger(parsed.maxAutomatedPublicationFiles) || parsed.maxAutomatedPublicationFiles < 1) {
    throw new Error('policy.maxAutomatedPublicationFiles must be a positive integer');
  }
  if (typeof parsed.maxAttemptsPerIssue !== 'number'
      || !Number.isInteger(parsed.maxAttemptsPerIssue) || parsed.maxAttemptsPerIssue < 1) {
    throw new Error('policy.maxAttemptsPerIssue must be a positive integer');
  }
  if (!isRecord(parsed.autoMerge) || parsed.autoMerge.enabled !== false) {
    throw new Error('Auto-merge must remain disabled in the bootstrap');
  }
  return {
    version: 1,
    maxAutomatedPublicationFiles: parsed.maxAutomatedPublicationFiles,
    maxAttemptsPerIssue: parsed.maxAttemptsPerIssue,
    denylist: stringList(parsed.denylist, 'denylist'),
    humanReviewRequired: stringList(parsed.humanReviewRequired, 'humanReviewRequired'),
    autoMergeAllowlist: stringList(parsed.autoMergeAllowlist, 'autoMergeAllowlist'),
    autoMerge: { enabled: false },
  };
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
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
}

function matches(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(file.replaceAll('\\', '/')));
}

const root = process.cwd();
const policy = readPolicy(path.join(root, 'policy', 'gate.json'));
const changedFilesIndex = process.argv.indexOf('--changed-files');
const changedFiles = changedFilesIndex === -1
  ? []
  : process.argv.slice(changedFilesIndex + 1).join(' ').split(/\s+/).filter(Boolean);
const denied = changedFiles.filter((file) => matches(file, policy.denylist));
if (denied.length > 0) throw new Error(`Protected paths changed: ${denied.join(', ')}`);

console.log(`Policy valid. ${changedFiles.length} changed file(s) checked.`);
