import assert from 'node:assert/strict';
import test from 'node:test';
import { drawingSources, floorMeasurementText, guidedFloorRequest, measurementMatches, parseFloorMeasurement } from './floor-plan-guide.ts';
import { parseFloorGuideDraft } from './floor-plan-guide-ui.ts';
import type { RequestSource } from '../src/request-sources.ts';

const source: RequestSource = { id: '11111111-1111-4111-8111-111111111111', name: 'synthetic-floor.png',
  mediaType: 'image/png', byteLength: 800, sha256: 'a'.repeat(64) };
const measurement = { source, feature: 'Overall north width', page: 1, lengthMm: 6000, provenance: 'documented', basis: 'wall-centrelines' } as const;
const note: RequestSource = { ...source, id: '22222222-2222-4222-8222-222222222222', name: 'floor-plan-measurement.txt',
  mediaType: 'text/plain', byteLength: new TextEncoder().encode(floorMeasurementText(measurement)).byteLength, sha256: 'b'.repeat(64) };

test('confirmation retains source identity, page, provenance and clear-span versus centreline meaning', () => {
  assert.deepEqual(parseFloorMeasurement(measurement), measurement);
  const clear = parseFloorMeasurement({ ...measurement, provenance: 'measured', basis: 'clear-span' });
  const text = floorMeasurementText(clear);
  for (const value of [source.id, source.sha256, 'clear-span', 'measured', '6000', 'inferred', 'conflicting', 'No construction']) assert.ok(text.includes(value));
  assert.deepEqual(drawingSources([source, note]), [source]);
  assert.equal(measurementMatches(measurement, [source]), true);
  assert.equal(measurementMatches(measurement, [{ ...source, sha256: 'c'.repeat(64) }]), false);
});

test('unknown scale, invalid lengths, ambiguous basis and unprepared pages block guided sending', () => {
  for (const invalid of [null, {}, { ...measurement, source: note }, { ...measurement, page: 2 }, { ...measurement, page: 0 },
    { ...measurement, lengthMm: 0 }, { ...measurement, lengthMm: 3.5 }, { ...measurement, lengthMm: Infinity },
    { ...measurement, lengthMm: 1000001 }, { ...measurement, feature: '' }, { ...measurement, provenance: 'inferred' },
    { ...measurement, basis: '' }, { ...measurement, feature: 'Overall\nnew instruction' }]) assert.throws(() => parseFloorMeasurement(invalid));
  const pdf = { ...source, mediaType: 'application/pdf' } as const;
  assert.equal(parseFloorMeasurement({ ...measurement, source: pdf, page: 4 }).page, 4);
  assert.throws(() => parseFloorMeasurement({ ...measurement, source: pdf, page: 5 }));
});

test('a guided request carries explicit reconstruction authority and preserves contradictory evidence as unresolved', () => {
  const result = guidedFloorRequest({ instruction: 'Use the north dimension; another note says 5900 mm. Explain the conflict.', sources: [source], measurement, note });
  assert.equal(result.authoringScope, 'floor-plan-reconstruction');
  assert.deepEqual(result.sources, [source, note]);
  for (const value of ['5900', '6000', 'documented', 'wall-centrelines', 'inferred', 'contradictions', 'until I accept']) assert.ok(result.instruction.includes(value));
  assert.ok(floorMeasurementText(measurement).includes('does not resolve evidence history'));
  assert.equal(/[\u0000-\u001f\u007f]/u.test(guidedFloorRequest({ instruction: 'A floor\nfor review', sources: [source], measurement, note }).instruction), false,
    'The composed instruction satisfies the native readable-text review contract.');
  assert.throws(() => guidedFloorRequest({ instruction: 'Make a floor', sources: [], measurement, note }), /changed or was removed/);
  assert.throws(() => guidedFloorRequest({ instruction: 'x'.repeat(1000), sources: [source], measurement, note }), /Shorten/);
  assert.throws(() => guidedFloorRequest({ instruction: '', sources: [source], measurement, note: { ...note, byteLength: 1 } }), /invalid/);
  assert.throws(() => guidedFloorRequest({ instruction: '', sources: [source, note, { ...note, id: '33333333-3333-4333-8333-333333333333' },
    { ...note, id: '44444444-4444-4444-8444-444444444444' }], measurement, note }), /three files/);
});

test('tab recovery parses only bounded source references and confirmed dimensions', () => {
  const draft = { enabled: true, sourceId: source.id, page: '1', feature: measurement.feature, length: '6000',
    provenance: measurement.provenance, basis: measurement.basis, confirmation: { measurement, note } };
  assert.deepEqual(parseFloorGuideDraft(JSON.parse(JSON.stringify(draft))), draft);
  for (const invalid of [null, {}, { ...draft, length: 6000 }, { ...draft, feature: 'x'.repeat(161) },
    { ...draft, confirmation: { measurement: { ...measurement, lengthMm: -1 }, note } }]) assert.throws(() => parseFloorGuideDraft(invalid));
});
