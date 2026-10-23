import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlan, type PlanningPlan } from './plan.ts';
import {
  approvePackage, assertChangePolicy, issueFingerprint, REPOSITORY,
  type PublicationFile, type PublicationProposal,
} from './publish-request.ts';

export interface CodingIssue {
  number: number;
  title: string;
  body: string;
  updated_at: string;
}

export interface CodingAcceptanceCase {
  readonly mode: 'cli' | 'api';
  readonly name: string;
  readonly input: string;
  readonly output: Record<string, unknown> | null;
}

export interface CodingSpec {
  readonly version: 1;
  readonly repository: typeof REPOSITORY;
  readonly issue: CodingIssue;
  readonly baseSha: string;
  readonly plan: PlanningPlan;
  readonly paths: string[];
  readonly acceptanceCases: CodingAcceptanceCase[];
}

export interface CodingProfile {
  readonly paths: readonly string[];
  readonly exportName: string;
  readonly errorText: string;
  readonly label: string;
}

export interface CodingAnswer {
  readonly summary: string;
  readonly files: PublicationFile[];
  readonly questions: readonly string[];
}

export interface PreparedCodingPackage {
  readonly proposal: PublicationProposal;
  readonly bytes: Buffer;
  readonly digest: string;
}

export const sha256 = (bytes: string | NodeJS.ArrayBufferView): string => createHash('sha256').update(bytes).digest('hex');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

const profiles: readonly CodingProfile[] = [
  { paths: ['factory/health.ts', 'factory/health.test.ts'], exportName: 'summarizeRunHealth',
    errorText: 'Invalid run records', label: 'run-health utility' },
  { paths: ['factory/schedule-check.ts', 'factory/schedule-check.test.ts'], exportName: 'checkSchedule',
    errorText: 'Invalid schedule snapshot', label: 'schedule snapshot checker' },
].map((profile) => Object.freeze({ ...profile, paths: Object.freeze(profile.paths) }));
const fixedProfilePaths = new Set(profiles.flatMap((profile) => profile.paths));

export function codingProfile(paths: unknown): CodingProfile {
  const supplied = isStringArray(paths) ? paths : [];
  const profile = profiles.find((item) => JSON.stringify([...item.paths].sort()) === JSON.stringify([...supplied].sort()));
  if (profile) return profile;
  const source = supplied.find((file) => /^src\/[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/.test(file));
  const test = source?.replace(/\.ts$/, '.test.ts');
  if (supplied.length === 2 && source !== undefined && test !== undefined && supplied.includes(test)) {
    return Object.freeze({ paths: Object.freeze([source, test]), exportName: 'evaluate',
      errorText: 'Invalid application input', label: 'read-only application module' });
  }
  throw new Error('Unsupported fixed coding profile');
}

export const codingSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'files', 'questions'], properties: {
    summary: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } } } },
  },
};

function parseAcceptanceCase(value: unknown): CodingAcceptanceCase {
  if (!exact(value, ['mode', 'name', 'input', 'output']) || (value.mode !== 'cli' && value.mode !== 'api')
      || typeof value.name !== 'string' || typeof value.input !== 'string' || Buffer.byteLength(value.input) > 128 * 1024
      || (value.output !== null && !isRecord(value.output))) {
    throw new Error('Invalid coding scope');
  }
  return { mode: value.mode, name: value.name, input: value.input, output: value.output };
}

export function readCodingSpec(bytes: unknown): CodingSpec {
  if (!Buffer.isBuffer(bytes) || bytes.length > 256 * 1024) throw new Error('Coding scope exceeds its limit');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!exact(parsed, ['version', 'repository', 'issue', 'baseSha', 'plan', 'paths', 'acceptanceCases'])
      || parsed.version !== 1 || parsed.repository !== REPOSITORY
      || typeof parsed.baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(parsed.baseSha)
      || !exact(parsed.issue, ['number', 'title', 'body', 'updated_at'])
      || typeof parsed.issue.number !== 'number' || !Number.isSafeInteger(parsed.issue.number) || parsed.issue.number < 1
      || typeof parsed.issue.title !== 'string' || !parsed.issue.title.trim()
      || typeof parsed.issue.body !== 'string' || !parsed.issue.body.trim()
      || typeof parsed.issue.updated_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(parsed.issue.updated_at)
      || !isStringArray(parsed.paths) || parsed.paths.length < 1 || parsed.paths.length > 4
      || new Set(parsed.paths).size !== parsed.paths.length
      || parsed.paths.some((file) => !/^(?:factory|src)\/[a-z0-9][a-z0-9.-]*\.ts$/.test(file) && !fixedProfilePaths.has(file))
      || !Array.isArray(parsed.acceptanceCases) || parsed.acceptanceCases.length < 1 || parsed.acceptanceCases.length > 32) {
    throw new Error('Invalid coding scope');
  }
  const acceptanceCases = parsed.acceptanceCases.map(parseAcceptanceCase);
  const plan = validatePlan(parsed.plan);
  const profile = codingProfile(parsed.paths);
  if (plan.changeClass !== 'read-only' || plan.questions.length
      || JSON.stringify([...plan.paths].sort()) !== JSON.stringify([...parsed.paths].sort())) {
    throw new Error('Coding requires an approved ready read-only plan matching the exact paths');
  }
  const acceptanceModes: ('cli' | 'api')[] = ['cli', 'api'];
  if (profile.paths[0]?.startsWith('src/') && (new Set(acceptanceCases.map((item) => item.name)).size !== acceptanceCases.length
      || acceptanceModes.some((mode) => [true, false].some((valid) => !acceptanceCases.some((item) =>
        item.mode === mode && (item.output !== null) === valid))))) {
    throw new Error('Application scope requires distinct valid and invalid CLI and API cases');
  }
  return {
    version: 1,
    repository: REPOSITORY,
    issue: { number: parsed.issue.number, title: parsed.issue.title, body: parsed.issue.body, updated_at: parsed.issue.updated_at },
    baseSha: parsed.baseSha,
    plan,
    paths: [...parsed.paths],
    acceptanceCases,
  };
}

function parseCodingAnswer(value: unknown, paths: readonly string[]): CodingAnswer {
  if (!exact(value, ['summary', 'files', 'questions']) || typeof value.summary !== 'string'
      || value.summary.length < 1 || value.summary.length > 4000 || !Array.isArray(value.questions)
      || value.questions.length || !Array.isArray(value.files)) {
    throw new Error('Coding answer is incomplete, needs input or changes unapproved paths');
  }
  const files: PublicationFile[] = value.files.map((file) => {
    if (!exact(file, ['path', 'content']) || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new Error('Coding answer is incomplete, needs input or changes unapproved paths');
    }
    return { path: file.path, content: file.content };
  });
  if (JSON.stringify(files.map((file) => file.path).sort()) !== JSON.stringify([...paths].sort())) {
    throw new Error('Coding answer is incomplete, needs input or changes unapproved paths');
  }
  return { summary: value.summary, files, questions: [] };
}

export function prepareCodingPackage(
  spec: CodingSpec,
  answerValue: unknown,
  policy: unknown,
  baselinePackage: unknown,
): PreparedCodingPackage {
  const answer = parseCodingAnswer(answerValue, spec.paths);
  const proposal: PublicationProposal = {
    version: 1,
    repository: REPOSITORY,
    issue: spec.issue.number,
    issueUpdatedAt: spec.issue.updated_at,
    issueSha256: issueFingerprint(spec.issue),
    baseSha: spec.baseSha,
    title: spec.issue.title.slice(0, 110),
    body: answer.summary,
    files: [...answer.files],
  };
  const first = Buffer.from(JSON.stringify(proposal));
  approvePackage(first, sha256(first));
  const tests = spec.paths.filter((file) => file.endsWith('.test.ts'));
  if (tests.length) {
    if (typeof baselinePackage !== 'string') throw new Error('Pinned test command is unsupported');
    const manifest: unknown = JSON.parse(baselinePackage);
    if (!isRecord(manifest) || !isRecord(manifest.scripts) || typeof manifest.scripts.test !== 'string'
        || !manifest.scripts.test.startsWith('node --test ')) {
      throw new Error('Pinned test command is unsupported');
    }
    manifest.scripts.test += ` ${tests.join(' ')}`;
    proposal.files.push({ path: 'package.json', content: `${JSON.stringify(manifest, null, 2)}\n` });
  }
  assertChangePolicy(proposal, policy);
  const bytes = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`);
  approvePackage(bytes, sha256(bytes));
  return { proposal, bytes, digest: sha256(bytes) };
}

export function materializeCodingFiles(candidate: string, proposal: PublicationProposal): void {
  const root = fs.realpathSync(candidate);
  const directories = new Set<string>();
  for (const file of proposal.files) {
    if (file.path === 'package.json') continue;
    if (!/^(?:factory|src)\/[a-z0-9][a-z0-9.-]*\.ts$/.test(file.path) && !fixedProfilePaths.has(file.path)) {
      throw new Error('Unsupported coding path');
    }
    const parent = path.join(root, file.path.split('/')[0] ?? '');
    let directory: fs.Stats | undefined;
    try { directory = fs.lstatSync(parent); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    if (!directory) {
      if (path.basename(parent) !== 'src' || fs.readdirSync(root).some((name) => name.toLowerCase() === 'src')) {
        throw new Error('Candidate parent is not a regular directory');
      }
      directories.add(parent);
      continue;
    }
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Candidate parent is not a regular directory');
    const target = path.join(root, file.path);
    if (fs.readdirSync(path.dirname(target)).some((name) => name.toLowerCase() === path.basename(target).toLowerCase())) {
      throw new Error('The first coding worker supports additions only');
    }
  }
  for (const directory of directories) fs.mkdirSync(directory, { mode: 0o755 });
  for (const file of proposal.files) {
    const target = path.join(root, file.path);
    if (file.path === 'package.json') {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Invalid candidate manifest');
      fs.writeFileSync(target, file.content, { mode: 0o644 });
    } else fs.writeFileSync(target, file.content, { flag: 'wx', mode: 0o644 });
  }
}
