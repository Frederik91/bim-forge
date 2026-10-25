import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRetainsHistory, copyPackageForFault, importPackage, readCurrent, readRegularFile, sha256, verifyPackage } from './package.ts';
import { parseObservations, parseRunnerInput } from './protocol.ts';
import type { Observation, RunnerInput } from './protocol.ts';
import { pendingStorageObservations } from './scenarios.ts';

export async function runPackageCases(input: RunnerInput): Promise<Observation[]> {
  // Exclusive run directory creation prevents overwriting an earlier attempt or evidence.
  const runRoot = path.resolve(input.outputRoot, input.runId);
  await mkdir(input.outputRoot, { recursive: true });
  await mkdir(runRoot);
  const observations: Observation[] = [];
  const record = async (definition: Pick<Observation, 'experimentId' | 'caseId' | 'expected'>, operation: () => Promise<string>, limitations: string[]): Promise<void> => {
    try { observations.push({ ...definition, observed: await operation(), passed: true, limitations }); }
    catch (error) { observations.push({ ...definition, observed: error instanceof Error ? error.message : String(error), passed: false, limitations }); }
    // Preserve progress even if a later setup operation fails. This is not a terminal W0 record.
    await writeFile(path.join(runRoot, 'observations-progress.json'), JSON.stringify(observations, null, 2));
  };
  const copyRoot = path.join(runRoot, 'independent-artifacts');
  await record({ experimentId: 'EX-09', caseId: 'immutable-history-package',
    expected: 'All old revision metadata, interpretation pins and artifact bytes survive a package containing upgraded revisions.' }, async () => {
    const before = await verifyPackage(input.sourcePackage);
    const after = await verifyPackage(input.upgradedPackage);
    assertRetainsHistory({ previous: before.manifest, next: after.manifest });
    const oldIds = new Set(before.manifest.revisions.map((revision) => revision.revisionId));
    const additions = after.manifest.revisions.filter((revision) => !oldIds.has(revision.revisionId));
    for (const role of ['schema', 'dictionary', 'canonicalization', 'kernel'] satisfies (keyof (typeof additions)[number]['interpretation'])[]) {
      assert.ok(additions.some((revision) => before.manifest.revisions.some((old) =>
        revision.interpretation[role].version !== old.interpretation[role].version
        && revision.interpretation[role].sha256 !== old.interpretation[role].sha256)), `No changed ${role} version and bytes exercised.`);
    }
    await importPackage({ source: before.root, destination: copyRoot });
    const imported = await importPackage({ source: after.root, destination: copyRoot });
    for (const artifact of before.manifest.artifacts) {
      assert.deepEqual(await readRegularFile(path.join(imported.root, 'objects', artifact.sha256)),
        await readRegularFile(path.join(before.root, 'objects', artifact.sha256)));
    }
    await writeFile(path.join(runRoot, 'history-delta.json'), JSON.stringify({ previous: before.manifest,
      next: imported.manifest, previousManifestSha256: before.manifestSha256, nextManifestSha256: imported.manifestSha256 }, null, 2), { flag: 'wx' });
    return `Retained ${before.manifest.revisions.length} old revisions and ${before.manifest.artifacts.length} exact artifacts; ${additions.length} new revisions exercised all four changed pins.`;
  }, ['This verifies pinned bytes and metadata. Historical model interpretation and geometry-engine execution still require W0/W5 integration.']);
  for (const kind of ['missing', 'corrupt'] satisfies ('missing' | 'corrupt')[]) {
    await record({ experimentId: 'EX-11', caseId: `package-${kind}-artifact`,
      expected: `A ${kind} required artifact prevents complete-copy publication and leaves the previous complete package readable.` }, async () => {
      const faultDestination = path.join(runRoot, `retained-${kind}`);
      await importPackage({ source: input.sourcePackage, destination: faultDestination });
      const previous = await readCurrent(faultDestination);
      assert.ok(previous, 'A complete baseline import is required.');
      const source = await verifyPackage(input.upgradedPackage);
      const oldHashes = new Set(previous.manifest.artifacts.map((item) => item.sha256));
      const artifact = source.manifest.artifacts.find((item) => item.role === 'model' && !oldHashes.has(item.sha256));
      assert.ok(artifact);
      const brokenRoot = path.join(runRoot, `transfer-${kind}`);
      await copyPackageForFault({ source: input.upgradedPackage, destination: brokenRoot, hash: artifact.sha256, kind });
      await assert.rejects(importPackage({ source: brokenRoot, destination: faultDestination }));
      const retained = await readCurrent(faultDestination);
      assert.equal(retained?.manifestSha256, previous.manifestSha256);
      return `Rejected ${kind} artifact ${artifact.sha256}; independently reverified retained manifest ${previous.manifestSha256}.`;
    }, ['This checks the complete-copy pointer on disk. It does not query a PostgreSQL accepted head.']);
  }
  await record({ experimentId: 'EX-12', caseId: 'portable-independent-copy',
    expected: 'Two artifact roots retain identical bytes, revision ancestry and branch data after repeated portable package import.' }, async () => {
    const source = await verifyPackage(input.upgradedPackage);
    const destination = path.join(runRoot, 'second-independent-artifacts');
    const first = await importPackage({ source: source.root, destination });
    const retry = await importPackage({ source: source.root, destination });
    assert.equal(first.manifestSha256, retry.manifestSha256);
    assert.deepEqual(retry.manifest, source.manifest);
    await writeFile(path.join(runRoot, 'copy-verification.json'), JSON.stringify({ source: source.manifestSha256,
      restored: retry.manifestSha256, branches: retry.manifest.branches, revisions: retry.manifest.revisions.map(({ revisionId, parents }) => ({ revisionId, parents })) }, null, 2), { flag: 'wx' });
    return `Verified independent artifact copy ${retry.manifestSha256} and an identical retry.`;
  }, ['No database, authentication independence, semantic reconciliation or network service is exercised by this case.']);
  observations.push(...pendingStorageObservations());
  const validated = parseObservations(observations);
  const bytes = JSON.stringify(validated, null, 2) + '\n';
  await writeFile(path.join(runRoot, 'observations.json'), bytes, { flag: 'wx' });
  await writeFile(path.join(runRoot, 'observations.sha256'), sha256(bytes) + '\n', { flag: 'wx' });
  return validated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2];
  if (!filename || process.argv.length !== 3) throw new Error('Usage: node experiments/recovery/runner.ts <input.json>');
  const raw: unknown = JSON.parse(await readFile(filename, 'utf8'));
  const observations = await runPackageCases(parseRunnerInput(raw));
  process.stdout.write(JSON.stringify(observations, null, 2) + '\n');
  // Uncovered cases stay false so this partial runner cannot produce a green qualification.
  if (observations.some((observation) => !observation.passed)) process.exitCode = 1;
}
