import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { evaluateAuthority, parseAuthorityInput } from './authority.ts';
import type { AuthorityInput } from './authority.ts';
import { assertRetainsHistory, copyPackageForFault, createPackage, importPackage, readCurrent, sha256, verifyPackage } from './package.ts';
import { parseManifest } from './protocol.ts';
import type { PackageManifest, Revision } from './protocol.ts';
import { runPackageCases } from './runner.ts';
import { parseFixture } from '../fixtures/fixture.ts';
import { parseLease, runPackageCrashCases } from './faults.ts';
import { parseCopyExport, verifyCopyExport } from './exports.ts';
import { pendingStorageObservations } from './scenarios.ts';
import { encodeHistory, readHistory, readHistoryV1 } from './history.ts';
import { canonical } from '../storage/contract.ts';

async function temporary(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'w6-package-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return root;
}

// Transport fixtures only. These opaque bytes are deliberately not a replacement for W0's BIM fixture.
function fixture(): { manifest: PackageManifest; objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  const artifacts: PackageManifest['artifacts'] = [];
  const artifact = (role: PackageManifest['artifacts'][number]['role'], value: string): string => {
    const bytes = Buffer.from(value);
    const hash = sha256(bytes);
    objects.set(hash, bytes);
    artifacts.push({ sha256: hash, byteLength: bytes.byteLength, role, mediaType: 'text/plain' });
    return hash;
  };
  const interpretation: Revision['interpretation'] = {
    schema: { version: 'test-schema-1', sha256: artifact('schema', 'opaque schema descriptor 1') },
    dictionary: { version: 'test-dictionary-1', sha256: artifact('dictionary', 'opaque dictionary descriptor 1') },
    canonicalization: { version: 'test-canonical-1', sha256: artifact('canonicalization', 'opaque canonical descriptor 1') },
    kernel: { version: 'test-kernel-1', sha256: artifact('kernel', 'opaque kernel descriptor 1') },
  };
  const modelSha256 = artifact('model', 'opaque test model revision 1');
  artifact('linked-model', 'opaque linked model retained by transport test');
  artifact('review', 'simulated discipline test evidence');
  artifact('validation', 'transport test validation descriptor');
  return { objects, manifest: { format: 'bim-forge-w6-package-v1', projectId: 'transport-test-project', artifacts,
    revisions: [{ revisionId: 'r1', parents: [], modelSha256, interpretation, requiredArtifacts: artifacts.map((item) => item.sha256) }],
    branches: [{ name: 'accepted', revisionId: 'r1' }],
  } };
}

function upgradedFixture(previous: ReturnType<typeof fixture>): ReturnType<typeof fixture> {
  const objects = new Map(previous.objects);
  const artifacts = [...previous.manifest.artifacts];
  const interpretation: Revision['interpretation'] = {
    schema: { version: 'test-schema-2', sha256: sha256('schema 2') },
    dictionary: { version: 'test-dictionary-2', sha256: sha256('dictionary 2') },
    canonicalization: { version: 'test-canonical-2', sha256: sha256('canonicalization 2') },
    kernel: { version: 'test-kernel-2', sha256: sha256('kernel 2') },
  };
  for (const role of ['schema', 'dictionary', 'canonicalization', 'kernel'] satisfies (keyof Revision['interpretation'])[]) {
    const bytes = Buffer.from(`${role} 2`);
    objects.set(sha256(bytes), bytes);
    artifacts.push({ role, sha256: sha256(bytes), byteLength: bytes.byteLength, mediaType: 'text/plain' });
  }
  const model = Buffer.from('opaque test model revision 2');
  objects.set(sha256(model), model);
  artifacts.push({ role: 'model', sha256: sha256(model), byteLength: model.byteLength, mediaType: 'text/plain' });
  return { objects, manifest: { ...previous.manifest, artifacts,
    revisions: [...previous.manifest.revisions, { revisionId: 'r2', parents: ['r1'], interpretation,
      modelSha256: sha256(model), requiredArtifacts: artifacts.map((item) => item.sha256) }],
    branches: [{ name: 'accepted', revisionId: 'r2' }, { name: 'company-b/local', revisionId: 'r1' }],
  } };
}

function replaceModel(input: ReturnType<typeof fixture>, revisionId: string, bytes: Buffer): ReturnType<typeof fixture> {
  const revision = input.manifest.revisions.find((item) => item.revisionId === revisionId);
  assert.ok(revision);
  const objects = new Map(input.objects);
  objects.set(sha256(bytes), bytes);
  return { objects, manifest: { ...input.manifest,
    artifacts: input.manifest.artifacts.map((artifact) => artifact.sha256 === revision.modelSha256
      ? { ...artifact, sha256: sha256(bytes), byteLength: bytes.byteLength, mediaType: 'application/json' } : artifact),
    revisions: input.manifest.revisions.map((item) => item.revisionId === revisionId ? { ...item,
      modelSha256: sha256(bytes), requiredArtifacts: item.requiredArtifacts.map((hash) => hash === revision.modelSha256 ? sha256(bytes) : hash) } : item),
  } };
}

test('portable copy preserves exact old bytes and changed interpretation pins without source access', async (t) => {
  const root = await temporary(t);
  const original = fixture();
  const next = upgradedFixture(original);
  const source = path.join(root, 'source');
  const upgraded = path.join(root, 'upgraded');
  const destination = path.join(root, 'destination');
  await createPackage({ root: source, ...original });
  await createPackage({ root: upgraded, ...next });
  await importPackage({ source, destination });
  await importPackage({ source: upgraded, destination });
  await rm(source, { recursive: true });
  await rm(upgraded, { recursive: true });
  const restored = await readCurrent(destination);
  assert.ok(restored);
  assert.deepEqual(restored.manifest, next.manifest);
  for (const [hash, bytes] of original.objects) assert.deepEqual(await readFile(path.join(restored.root, 'objects', hash)), bytes);
});

for (const kind of ['missing', 'corrupt'] satisfies ('missing' | 'corrupt')[]) {
  test(`${kind} transfer leaves the last complete revision readable`, async (t) => {
    const root = await temporary(t);
    const initial = fixture();
    const next = upgradedFixture(initial);
    const source = path.join(root, 'source');
    const upgraded = path.join(root, 'upgraded');
    const broken = path.join(root, 'broken');
    const destination = path.join(root, 'destination');
    await createPackage({ root: source, ...initial });
    await createPackage({ root: upgraded, ...next });
    const before = await importPackage({ source, destination });
    const newRevision = next.manifest.revisions.find((revision) => revision.revisionId === 'r2');
    assert.ok(newRevision);
    await copyPackageForFault({ source: upgraded, destination: broken, hash: newRevision.modelSha256, kind });
    await assert.rejects(importPackage({ source: broken, destination }));
    assert.equal((await readCurrent(destination))?.manifestSha256, before.manifestSha256);
    assert.deepEqual(await readdir(path.join(destination, 'packages')), [before.manifestSha256]);
  });
}

test('an identical retry reuses the immutable package and cannot rewrite a revision', async (t) => {
  const root = await temporary(t);
  const initial = fixture();
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  await createPackage({ root: source, ...initial });
  const first = await importPackage({ source, destination });
  const retry = await importPackage({ source, destination });
  assert.equal(first.manifestSha256, retry.manifestSha256);
  assert.deepEqual(await readdir(path.join(destination, 'packages')), [first.manifestSha256]);
  const next = upgradedFixture(initial);
  const changed: PackageManifest = { ...next.manifest, revisions: next.manifest.revisions.map((revision) =>
    revision.revisionId === 'r1' ? { ...revision, interpretation: { ...revision.interpretation,
      schema: { ...revision.interpretation.schema, version: 'silently rewritten schema' } } } : revision) };
  const changedRoot = path.join(root, 'rewritten');
  await createPackage({ root: changedRoot, manifest: changed, objects: next.objects });
  await assert.rejects(importPackage({ source: changedRoot, destination }), /Historical revision rewritten/);
  assert.equal((await readCurrent(destination))?.manifestSha256, first.manifestSha256);
});

test('packages reject incomplete ancestry, duplicate identities, bad hashes and missing interpretation artifacts', () => {
  const initial = fixture();
  const revision = initial.manifest.revisions[0];
  assert.ok(revision);
  assert.throws(() => parseManifest({ ...initial.manifest, revisions: [{ ...revision, parents: ['unknown'] }] }), /ancestry/);
  assert.throws(() => parseManifest({ ...initial.manifest, revisions: [revision, revision] }), /Duplicate/);
  assert.throws(() => parseManifest({ ...initial.manifest, artifacts: initial.manifest.artifacts.map((item) => ({ ...item, sha256: '../outside' })) }), /Invalid/);
  assert.throws(() => parseManifest({ ...initial.manifest, revisions: [{ ...revision,
    requiredArtifacts: revision.requiredArtifacts.filter((hash) => hash !== revision.interpretation.schema.sha256) }] }), /pinned schema/);
});

test('portable exchange retains both divergent contributions and their common ancestry', () => {
  const original = fixture();
  const next = upgradedFixture(original);
  const r2 = next.manifest.revisions.find((revision) => revision.revisionId === 'r2');
  assert.ok(r2);
  const divergent = parseManifest({ ...next.manifest,
    revisions: [...next.manifest.revisions, { ...r2, revisionId: 'r3-company-b', parents: ['r1'] }],
    branches: [...next.manifest.branches.filter((branch) => branch.name !== 'company-b/local'),
      { name: 'company-b/local', revisionId: 'r3-company-b' }],
  });
  assertRetainsHistory({ previous: next.manifest, next: divergent });
  assert.deepEqual(divergent.revisions.map((revision) => [revision.revisionId, revision.parents]),
    [['r1', []], ['r2', ['r1']], ['r3-company-b', ['r1']]]);
  assert.throws(() => assertRetainsHistory({ previous: divergent, next: next.manifest }), /omitted/);
});

test('an object symlink cannot import bytes from outside the package', async (t) => {
  const root = await temporary(t);
  const initial = fixture();
  const source = path.join(root, 'source');
  await createPackage({ root: source, ...initial });
  const artifact = initial.manifest.artifacts[0];
  assert.ok(artifact);
  const target = path.join(source, 'objects', artifact.sha256);
  const outside = path.join(root, 'outside');
  await writeFile(outside, await readFile(target));
  await rm(target);
  await symlink(outside, target);
  await assert.rejects(verifyPackage(source));
});

test('W0 fixture identities, relationships and properties remain queryable from retained bytes after source removal', async (t) => {
  const root = await temporary(t);
  const bytes = await readFile(new URL('../fixtures/tiny-building.json', import.meta.url));
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  const expected = parseFixture(raw);
  const initial = fixture();
  const oldModel = initial.manifest.revisions[0]?.modelSha256;
  assert.ok(oldModel);
  initial.objects.set(sha256(bytes), bytes);
  initial.manifest.artifacts = initial.manifest.artifacts.map((artifact) => artifact.sha256 === oldModel
    ? { ...artifact, sha256: sha256(bytes), byteLength: bytes.byteLength, mediaType: 'application/json' } : artifact);
  initial.manifest.revisions = initial.manifest.revisions.map((revision) => ({ ...revision, modelSha256: sha256(bytes),
    requiredArtifacts: revision.requiredArtifacts.map((hash) => hash === oldModel ? sha256(bytes) : hash) }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'independent');
  await createPackage({ root: source, ...initial });
  await importPackage({ source, destination });
  await rm(source, { recursive: true });
  const retained = await readCurrent(destination);
  assert.ok(retained);
  const restoredRaw: unknown = JSON.parse((await readFile(path.join(retained.root, 'objects', sha256(bytes)))).toString('utf8'));
  const restored = parseFixture(restoredRaw);
  assert.deepEqual(restored, expected);
  assert.ok(restored.entities.some((entity) => entity.id === 'shared-wall' && entity.properties.x === 6));
  assert.ok(restored.relationships.some((relationship) => relationship.id === 'door-wall' && relationship.target === 'shared-wall'));
});

function authority(): AuthorityInput {
  const candidateSha256 = sha256('resolved wall and duct candidate');
  return parseAuthorityInput({ proposalId: 'wall-duct-resolution', candidateSha256, expectedHead: 'r1', actualHead: 'r1',
    requiredDisciplines: ['architecture', 'mechanical'], conflicts: [{ conflictId: 'wall-duct', resolvedByCandidateSha256: candidateSha256 }],
    actors: [{ actorId: 'simulated-architect', kind: 'simulated-test-actor', disciplines: ['architecture'] },
      { actorId: 'simulated-mechanical', kind: 'simulated-test-actor', disciplines: ['mechanical'] }],
    decisions: [{ actorId: 'simulated-architect', discipline: 'architecture', proposalId: 'wall-duct-resolution', candidateSha256,
      decision: 'approve', evidenceSha256: sha256('simulated architecture decision') },
    { actorId: 'simulated-mechanical', discipline: 'mechanical', proposalId: 'wall-duct-resolution', candidateSha256,
      decision: 'approve', evidenceSha256: sha256('simulated mechanical decision') }],
  });
}

test('discipline eligibility needs distinct current decisions and a resolved candidate', () => {
  const input = authority();
  assert.equal(evaluateAuthority(input).kind, 'eligible');
  assert.equal(evaluateAuthority({ ...input, decisions: input.decisions.slice(0, 1) }).kind, 'blocked');
  assert.equal(evaluateAuthority({ ...input, conflicts: [{ conflictId: 'wall-duct', resolvedByCandidateSha256: null }] }).kind, 'blocked');
  assert.equal(evaluateAuthority({ ...input, actualHead: 'r2-racing-head' }).kind, 'blocked');
  assert.equal(evaluateAuthority({ ...input, decisions: input.decisions.map((decision) => ({ ...decision, candidateSha256: sha256('stale') })) }).kind, 'blocked');
  assert.equal(evaluateAuthority({ ...input, actors: [] }).kind, 'blocked');
  assert.equal(evaluateAuthority({ ...input, actors: [{ actorId: 'host', kind: 'simulated-test-actor', disciplines: ['architecture', 'mechanical'] }],
    decisions: input.decisions.map((decision) => ({ ...decision, actorId: 'host' })) }).kind, 'blocked');
  assert.equal(evaluateAuthority({ ...input, decisions: input.decisions.map((decision) => ({ ...decision, evidenceSha256: sha256('same-evidence') })) }).kind, 'blocked');
});

test('partial runner records uncovered database cases as false and refuses to overwrite the run', async (t) => {
  const root = await temporary(t);
  const original = fixture();
  const next = upgradedFixture(original);
  await createPackage({ root: path.join(root, 'before'), ...original });
  await createPackage({ root: path.join(root, 'after'), ...next });
  const input = { sourcePackage: path.join(root, 'before'), upgradedPackage: path.join(root, 'after'),
    outputRoot: path.join(root, 'evidence'), runId: 'transport-test-run' };
  const observations = await runPackageCases(input);
  assert.ok(observations.filter((item) => item.caseId.startsWith('package-') || item.caseId === 'immutable-history-package' || item.caseId === 'portable-independent-copy').every((item) => item.passed));
  const database = observations.filter((item) => item.caseId.includes('database') || item.caseId === 'discipline-atomic-acceptance' || item.caseId === 'pinned-historical-query');
  assert.equal(database.length, 7);
  assert.ok(database.every((item) => !item.passed && item.observed.startsWith('Not executed:')));
  await assert.rejects(runPackageCases(input), /EEXIST/);
});

test('a fresh actual process exports every retained model and its bytes without access to the source root', async (t) => {
  const root = await temporary(t);
  const originalBytes = await readFile(new URL('../fixtures/tiny-building.json', import.meta.url));
  const initial = replaceModel(fixture(), 'r1', originalBytes);
  const sourceRaw: unknown = JSON.parse(originalBytes.toString('utf8'));
  const originalModel = parseFixture(sourceRaw);
  const changedModel = { ...originalModel, entities: originalModel.entities.map((item) => item.id === 'chair-a'
    ? { ...item, properties: { ...item.properties, x: 2.25 } } : item) };
  const next = replaceModel(upgradedFixture(initial), 'r2', Buffer.from(JSON.stringify(changedModel)));
  const source = path.join(root, 'source');
  const upgraded = path.join(root, 'upgraded');
  const destination = path.join(root, 'retained');
  await createPackage({ root: source, ...initial });
  await createPackage({ root: upgraded, ...next });
  await importPackage({ source, destination });
  const current = await importPackage({ source: upgraded, destination });
  await rename(source, source + '-offline');
  await rename(upgraded, upgraded + '-offline');
  const output = path.join(root, 'fresh-process-export.json');
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./exports.ts', import.meta.url)), destination, output]);
  const exported = await verifyCopyExport(output);
  assert.equal(exported.manifestSha256, current.manifestSha256);
  assert.deepEqual(exported.models.map((item) => item.fixture), [originalModel, changedModel]);
  assert.throws(() => parseCopyExport({ ...exported, manifestSha256: sha256('forged manifest') }), /manifest bytes/);
  assert.throws(() => parseCopyExport({ ...exported, models: exported.models.map((item) => ({ ...item, bytesBase64: Buffer.from('{}').toString('base64') })) }));
});

test('schema shape, owner dictionary and serialization upgrades keep the original reader and bytes usable', async () => {
  const raw: unknown = JSON.parse(await readFile(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8'));
  const fixture = parseFixture(raw);
  const before = encodeHistory(fixture, 'v1');
  const beforeHash = sha256(before);
  const after = encodeHistory(fixture, 'v2');
  assert.notEqual(beforeHash, sha256(after));
  assert.equal(canonical(readHistoryV1(before)), canonical(fixture));
  assert.equal(canonical(readHistory(before)), canonical(fixture));
  assert.equal(canonical(readHistory(after)), canonical(fixture));
  assert.throws(() => readHistoryV1(after), /original format/);
  assert.equal(sha256(before), beforeHash);
  assert.ok(after.toString('utf8').includes('mechanicalDiscipline'));
  assert.ok(before.toString('utf8').includes('mechanicalOwner'));
  assert.ok(pendingStorageObservations().some((item) => item.caseId === 'pinned-historical-query' && !item.passed));
});

test('leased actual SIGKILL cases retain complete pointers and never qualify pending database cases', async (t) => {
  const leaseFile = process.env.QVM_W6_LEASE_FILE;
  if (!leaseFile) { t.skip('Main must supply QVM_W6_LEASE_FILE before terminating the dedicated package writer. Database cases remain unqualified.'); return; }
  const rawLease: unknown = JSON.parse(await readFile(leaseFile, 'utf8'));
  const lease = parseLease(rawLease);
  await mkdir(lease.artifactRoot, { recursive: true });
  // Retain actual process logs outside the auto-cleaned unit-test temporary roots.
  const root = await mkdtemp(path.join(lease.artifactRoot, 'w6-process-evidence-'));
  const initial = fixture();
  const next = upgradedFixture(initial);
  await createPackage({ root: path.join(root, 'source'), ...initial });
  await createPackage({ root: path.join(root, 'upgraded'), ...next });
  const observations = await runPackageCrashCases({ sourcePackage: path.join(root, 'source'),
    upgradedPackage: path.join(root, 'upgraded'), outputRoot: path.join(root, 'runs'), runId: 'leased-package-crashes' }, lease);
  assert.equal(observations.length, 2);
  for (const observation of observations) {
    assert.equal(observation.passed, true, observation.observed);
    const stage = observation.caseId.replace('package-process-', '');
    const log: unknown = JSON.parse(await readFile(path.join(root, 'runs', 'leased-package-crashes', stage, 'process.json'), 'utf8'));
    assert.ok(typeof log === 'object' && log !== null && 'signal' in log && log.signal === 'SIGKILL');
  }
  const pending = pendingStorageObservations();
  assert.equal(pending.length, 7);
  assert.ok(pending.every((observation) => !observation.passed && observation.observed.startsWith('Not executed:')));
  await writeFile(path.join(root, 'pending-storage-observations.json'), JSON.stringify(pending, null, 2), { flag: 'wx' });
  t.diagnostic(`Retained process and pending-coverage evidence: ${root}`);
});
