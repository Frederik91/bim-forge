import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePlan } from './plan.mjs';
import { approvePackage, assertChangePolicy, issueFingerprint, REPOSITORY } from './publish-request.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === keys.slice().sort().join(',');
const profiles = [
  { paths: ['factory/health.mjs', 'factory/health.test.mjs'], exportName: 'summarizeRunHealth',
    errorText: 'Invalid run records', label: 'run-health utility' },
  { paths: ['factory/schedule-check.mjs', 'factory/schedule-check.test.mjs'], exportName: 'checkSchedule',
    errorText: 'Invalid schedule snapshot', label: 'schedule snapshot checker' },
].map((profile) => Object.freeze({ ...profile, paths: Object.freeze(profile.paths) }));

export function codingProfile(paths) {
  const profile = Array.isArray(paths) && profiles.find((item) =>
    JSON.stringify(item.paths.slice().sort()) === JSON.stringify(paths.slice().sort()));
  if (profile) return profile;
  const ordered = Array.isArray(paths) ? paths.slice().sort() : [];
  if (ordered.length === 2 && /^src\/[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/.test(ordered[0])
      && ordered[1] === ordered[0].replace(/\.mjs$/, '.test.mjs')) {
    return Object.freeze({ paths: Object.freeze(ordered), exportName: 'evaluate',
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

export function readCodingSpec(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 256 * 1024) throw new Error('Coding scope exceeds its limit');
  const spec = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!exact(spec, ['version', 'repository', 'issue', 'baseSha', 'plan', 'paths', 'acceptanceCases'])
      || spec.version !== 1 || spec.repository !== REPOSITORY || !/^[a-f0-9]{40}$/.test(spec.baseSha)
      || !exact(spec.issue, ['number', 'title', 'body', 'updated_at'])
      || !Number.isSafeInteger(spec.issue.number) || spec.issue.number < 1
      || typeof spec.issue.title !== 'string' || !spec.issue.title.trim()
      || typeof spec.issue.body !== 'string' || !spec.issue.body.trim()
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(spec.issue.updated_at)
      || !Array.isArray(spec.paths) || spec.paths.length < 1 || spec.paths.length > 4
      || new Set(spec.paths).size !== spec.paths.length
      || spec.paths.some((file) => !/^(?:factory|src)\/[a-z0-9][a-z0-9.-]*\.mjs$/.test(file))
      || !Array.isArray(spec.acceptanceCases) || spec.acceptanceCases.length < 1 || spec.acceptanceCases.length > 32
      || spec.acceptanceCases.some((item) => !exact(item, ['mode', 'name', 'input', 'output']) || !['cli', 'api'].includes(item.mode)
        || typeof item.name !== 'string' || typeof item.input !== 'string' || Buffer.byteLength(item.input) > 128 * 1024
        || (item.output !== null && (typeof item.output !== 'object' || Array.isArray(item.output))))) throw new Error('Invalid coding scope');
  validatePlan(spec.plan);
  const profile = codingProfile(spec.paths);
  if (spec.plan.changeClass !== 'read-only' || spec.plan.questions.length
      || JSON.stringify(spec.plan.paths.slice().sort()) !== JSON.stringify(spec.paths.slice().sort())) {
    throw new Error('Coding requires an approved ready read-only plan matching the exact paths');
  }
  if (profile.paths[0].startsWith('src/') && (new Set(spec.acceptanceCases.map((item) => item.name)).size !== spec.acceptanceCases.length
      || ['cli', 'api'].some((mode) => [true, false].some((valid) => !spec.acceptanceCases.some((item) =>
        item.mode === mode && (item.output !== null) === valid))))) {
    throw new Error('Application scope requires distinct valid and invalid CLI and API cases');
  }
  return spec;
}

export function prepareCodingPackage(spec, answer, policy, baselinePackage) {
  if (!exact(answer, ['summary', 'files', 'questions']) || typeof answer.summary !== 'string'
      || answer.summary.length < 1 || answer.summary.length > 4000 || !Array.isArray(answer.questions)
      || answer.questions.length || !Array.isArray(answer.files)
      || JSON.stringify(answer.files.map((file) => file?.path).sort()) !== JSON.stringify(spec.paths.slice().sort())) {
    throw new Error('Coding answer is incomplete, needs input or changes unapproved paths');
  }
  const proposal = { version: 1, repository: REPOSITORY, issue: spec.issue.number,
    issueUpdatedAt: spec.issue.updated_at, issueSha256: issueFingerprint(spec.issue), baseSha: spec.baseSha,
    title: spec.issue.title.slice(0, 110), body: answer.summary, files: answer.files };
  const first = Buffer.from(JSON.stringify(proposal));
  approvePackage(first, sha256(first));
  const tests = spec.paths.filter((file) => file.endsWith('.test.mjs'));
  if (tests.length) {
    const manifest = JSON.parse(baselinePackage);
    if (typeof manifest.scripts?.test !== 'string' || !manifest.scripts.test.startsWith('node --test ')) {
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

export function materializeCodingFiles(candidate, proposal) {
  const root = fs.realpathSync(candidate);
  const directories = new Set();
  for (const file of proposal.files) {
    if (file.path === 'package.json') continue;
    if (!/^(?:factory|src)\/[a-z0-9][a-z0-9.-]*\.mjs$/.test(file.path)) throw new Error('Unsupported coding path');
    const parent = path.join(root, file.path.split('/')[0]);
    let directory;
    try { directory = fs.lstatSync(parent); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
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
