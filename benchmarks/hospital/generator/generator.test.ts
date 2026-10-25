import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset, KINDS, cohortUpperBounds, loadProfile, parseOptions } from './profile.ts';
import type { Kind } from './profile.ts';
import { Graph } from './graph.ts';
import { copyLine, entityLine, entityRow, propertyCount, propertiesFor } from './rows.ts';
import { decodeCopyLine, runChecks } from './check.ts';

function graph(scale: string, seed?: string): Graph {
  const loaded = loadProfile('benchmarks/hospital/profile.json');
  return new Graph(new Dataset(loaded.profile, loaded.sha256,
    parseOptions(seed === undefined ? ['--scale', scale] : ['--scale', scale, '--seed', seed])));
}

test('full admission retains the declared 35-kind inventory and parameter count without materializing IDs', () => {
  const full = graph('full');
  assert.equal(full.dataset.entityCount, 6_777_445);
  assert.equal(full.dataset.range('stud').count, 1_400_000);
  assert.equal(full.dataset.range('connectionPort').count, 3_000_000);
  assert.equal(full.dataset.parameterCount, 1_500_000);
  assert.equal(full.dataset.ranges.size, 35);
  assert.equal(full.portGroups.reduce((sum, group) => sum + group.count, 0), 3_000_000);
  assert.equal(full.portGroups.reduce((sum, group) => sum + group.pairs, 0), 1_500_000);
  assert.equal(full.portGroups.length, 2000);
  const edgeCount = full.rules.reduce((sum, rule) => sum + rule.source.count, 0)
    + full.dataset.range('wall').count + full.dataset.range('connectionPort').count
    + full.portGroups.reduce((sum, group) => sum + group.pairs, 0)
    + full.dataset.parameterCount + full.externalOwners.count * 2;
  assert.equal(edgeCount, 18_742_644);
  const properties = KINDS.reduce((sum, kind) => {
    const count = full.dataset.range(kind).count;
    if (kind === 'connectionPort') return sum + count * 8;
    if (kind === 'typeDefinition') return sum + count * 80;
    // An independent rational oracle; decimal allocation must not lose whole entities.
    const small = Number(BigInt(count) * 7n / 10n);
    const medium = Number(BigInt(count) / 4n);
    return sum + small * 16 + medium * 48 + (count - small - medium) * 176;
  }, 0);
  assert.equal(properties, 145_118_512);
  const port = full.dataset.ref('connectionPort', 3_000_000);
  const owner = full.ownerOf(port);
  assert.equal(full.systemOf(port)?.id, full.systemOf(owner)?.id);
});

test('decimal cohort cutoffs retain the exact 70 percent and 25 percent boundaries for full inventory', () => {
  const full = graph('full');
  for (const [kind, small, medium] of [
    ['stud', 980_000, 350_000],
    ['electricalOutlet', 126_000, 45_000],
    ['ductSegment', 126_000, 45_000],
  ] satisfies [Kind, number, number][]) {
    assert.equal(propertyCount(full, full.dataset.ref(kind, small)), 16, `${kind}: last 16-value entity`);
    assert.equal(propertyCount(full, full.dataset.ref(kind, small + 1)), 48, `${kind}: first 48-value entity`);
    assert.equal(propertyCount(full, full.dataset.ref(kind, small + medium)), 48, `${kind}: last 48-value entity`);
    assert.equal(propertyCount(full, full.dataset.ref(kind, small + medium + 1)), 176, `${kind}: first 176-value entity`);
  }
  assert.deepEqual(cohortUpperBounds(1_400_000, [0.7, 0.25, 0.05]), [980_000, 1_330_000, 1_400_000]);
  assert.deepEqual(cohortUpperBounds(180_000, [0.7, 0.25, 0.05]), [126_000, 171_000, 180_000]);
  assert.deepEqual(cohortUpperBounds(1, [0.7, 0.25, 0.05]), [0, 0, 1]);
  assert.deepEqual(cohortUpperBounds(4, [0.7, 0.25, 0.05]), [2, 3, 4]);
  assert.deepEqual(cohortUpperBounds(10_000_000, [1e-7, 0.9999999]), [1, 10_000_000]);
});

test('smoke independently checks endpoints, type scope, degree distributions, parameters and repeatable wire bytes', () => {
  const result = runChecks(graph('smoke'));
  assert.equal(result.observations.length, 4);
  assert.ok(result.observations.every((observation) => observation.passed), JSON.stringify(result.observations, null, 2));
  assert.ok(result.manifest);
  assert.ok(result.manifest.explicitOverrideEntities > 0);
  assert.equal(result.manifest.externalArtifactReferences, 100);
  assert.equal(result.manifest.materializedExternalArtifactBytes, 0);
  assert.ok(result.manifest.payloadSamples.every((sample) => sample.uniqueSha256 === sample.count));
});

test('arbitrary fractions preserve odd-port ownership, a valid skeleton and exact inverse endpoint counts', () => {
  for (const fraction of ['0.000001', '0.000003', '0.000137']) {
    const reduced = graph(fraction, 'odd-ports-and-rounding');
    const result = runChecks(reduced);
    assert.ok(result.observations.every((observation) => observation.passed), JSON.stringify(result.observations, null, 2));
    for (const kind of KINDS) assert.ok(reduced.dataset.range(kind).count > 0);
    assert.ok(reduced.dataset.range('typeDefinition').count >= 27);
    assert.ok(reduced.dataset.range('system').count >= 3);
  }
});

test('COPY escaping preserves literal backslashes, SQL null, control characters and JSON distinctions', () => {
  const cells = ['plain', '\\N', null, 'tab\tCR\rLF\nslash\\', JSON.stringify({ value: '\t\n\\N', state: null })];
  const encoded = copyLine(cells);
  assert.equal(encoded.split('\n').length, 2);
  assert.deepEqual(decodeCopyLine(encoded), cells);
  assert.throws(() => decodeCopyLine('bad\\q\n'));
  assert.throws(() => decodeCopyLine('missing-LF'));
});

test('seed changes payloads and typed values, while type defaults and explicit occurrence overrides retain scope', () => {
  const first = graph('smoke', 'first-seed');
  const second = graph('smoke', 'second-seed');
  const wall = first.dataset.ref('wall', 17);
  assert.notEqual(entityLine(entityRow(first, wall)), entityLine(entityRow(second, wall)));
  const regular = first.dataset.ref('wall', 16);
  const regularType = first.typeOf(regular);
  assert.ok(regularType);
  const occurrence = propertiesFor(first, regular).nominalLength;
  const definition = propertiesFor(first, regularType).nominalLength;
  assert.ok(occurrence && occurrence.state === 'known' && occurrence.kind === 'quantity');
  assert.ok(definition && definition.state === 'known' && definition.kind === 'quantity');
  assert.equal(occurrence.value, definition.value);
  assert.equal(occurrence.scope, 'occurrence');
  assert.equal(definition.scope, 'definition');
  assert.equal(propertiesFor(first, wall).nominalLength?.override, true);
  assert.equal(propertiesFor(first, first.dataset.ref('wall', 11)).inspection?.state, 'missing');
  assert.equal(propertiesFor(first, first.dataset.ref('wall', 13)).finish?.state, 'unknown');
  assert.equal(propertiesFor(first, first.dataset.ref('wall', 7)).maintenance?.state, 'notApplicable');
  assert.equal(Object.keys(propertiesFor(first, wall)).length, propertyCount(first, wall));
});

test('TypeBox input boundaries reject malformed profiles and ambiguous CLI options', () => {
  assert.throws(() => parseOptions(['--table', 'unsafe']));
  assert.throws(() => parseOptions(['--seed', '']));
  assert.throws(() => parseOptions(['--scale', 'smoke', '--scale', 'full']));
  assert.throws(() => parseOptions(['--production', 'true']));
  assert.throws(() => graph('0'));
  assert.throws(() => graph('NaN'));
  assert.throws(() => graph('2.01'));
  const temporary = mkdtempSync(join(tmpdir(), 'bim-hospital-profile-'));
  try {
    const filename = join(temporary, 'profile.json');
    writeFileSync(filename, readFileSync('benchmarks/hospital/profile.json', 'utf8').replace('6777445', '6777446'));
    assert.throws(() => loadProfile(filename));
    writeFileSync(filename, '{"schemaVersion":1}');
    assert.throws(() => loadProfile(filename));
  } finally { rmSync(temporary, { recursive: true }); }
});
