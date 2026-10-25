import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile, link, unlink } from 'node:fs/promises';
import { relative, resolve, dirname, isAbsolute } from 'node:path';
import { Check } from 'typebox/value';
import { Type } from 'typebox';
import { parseRun } from './schema.ts';
import type { Run } from './schema.ts';

export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export async function bindingFor(root: string, path: string): Promise<{ commit: string; path: string; sha256: string }> {
  root = resolve(root);
  const commit = execFileSync('git', ['-c', `safe.directory=${root}`, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const bytes = await readFile(resolve(root, path));
  const committed = execFileSync('git', ['-c', `safe.directory=${root}`, 'show', `${commit}:${path}`], { cwd: root });
  if (!bytes.equals(committed)) throw new Error(`Uncommitted binding ${path}`);
  return { commit, path, sha256: sha256(bytes) };
}

function inside(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (isAbsolute(path) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Artifact path must stay within its evidence root.');
  return target;
}

export async function describeArtifact(root: string, path: string, mediaType: string): Promise<Run['evidence'][number]> {
  const bytes = await readFile(inside(root, path));
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes), mediaType };
}

export async function verifyRun(run: Run, roots: { repository: string; evidence: string }): Promise<void> {
  roots = { ...roots, repository: resolve(roots.repository), evidence: resolve(roots.evidence) };
  parseRun(run);
  for (const binding of [run.design, run.definition]) {
    const bytes = execFileSync('git', ['-c', `safe.directory=${roots.repository}`, 'show', `${binding.commit}:${binding.path}`], { cwd: roots.repository });
    if (sha256(bytes) !== binding.sha256) throw new Error('Historical design or definition hash mismatch.');
  }
  const registryBytes = execFileSync('git', ['-c', `safe.directory=${roots.repository}`, 'show', `${run.definition.commit}:${run.definition.path}`], { cwd: roots.repository, encoding: 'utf8' });
  const registry: unknown = JSON.parse(registryBytes.replace(/^\uFEFF/, ''));
  const registrySchema = Type.Object({ experiments: Type.Array(Type.Object({ id: Type.String(), assertions: Type.Array(Type.String()) })) });
  if (!Check(registrySchema, registry)) throw new Error('Invalid bound experiment registry.');
  const definition = registry.experiments.find(item => item.id === run.experimentId);
  if (definition === undefined) throw new Error('Experiment is absent from the bound registry.');
  if (run.coverage.length !== definition.assertions.length || definition.assertions.some(assertion => !run.coverage.some(item => item.assertion === assertion))) throw new Error('Coverage must account for every bound definition assertion.');
  for (const artifact of run.evidence) {
    const target = inside(roots.evidence, artifact.path);
    const bytes = await readFile(target);
    if ((await stat(target)).size !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error('Artifact integrity mismatch.');
  }
}

export async function publishRun(input: unknown, roots: { repository: string; evidence: string; results: string }): Promise<string> {
  const run = parseRun(input);
  await verifyRun(run, roots);
  const directory = resolve(roots.results, run.experimentId, run.runId);
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  const temporary = resolve(directory, '.result.pending');
  const target = resolve(directory, 'result.json');
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { flag: 'wx' });
  const summary = `# ${run.experimentId}: ${run.runId}\n\nOutcome: ${run.conclusion}. Execution: ${run.executionStatus}.\n\n${run.hypothesis}\n\nVariant: ${run.variant}.\n\n${run.observations.map(item => `- ${item.caseId}: ${item.passed ? 'passed' : 'failed'}; expected ${item.expected}; observed ${item.observed}`).join('\n')}\n\nLimitations:\n\n${run.limitations.map(item => `- ${item}`).join('\n') || '- None declared.'}\n`;
  await writeFile(resolve(directory, '.summary.pending'), summary, { flag: 'wx' });
  await rename(resolve(directory, '.summary.pending'), resolve(directory, 'summary.md'));
  await link(temporary, target);
  await unlink(temporary);
  return target;
}
