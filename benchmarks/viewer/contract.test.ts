import assert from 'node:assert/strict';
import test from 'node:test';
import { admission, applyProposal, assertReadback, changesBetween, comparisonElements, parseModel } from './contract.ts';
import { smokeModel, smokeProposal } from './fixtures.ts';
import { parseResult, summarize } from './metrics.ts';
import type { Result } from './metrics.ts';

test('fixture is deterministic and cannot qualify a realistic hospital by changing its area', () => {
  assert.deepEqual(smokeModel(), smokeModel());
  const model = smokeModel(); model.grossFloorAreaM2 = 250000;
  assert.equal(admission(model).qualified, false);
  assert.ok(admission(model).reasons.some(reason => reason.includes('Synthetic')));
});
test('input boundary rejects missing geometry, duplicate identities, invalid indices, and non-finite coordinates', () => {
  const duplicate = smokeModel(); duplicate.elements.push(duplicate.elements[0]);
  assert.throws(() => parseModel(duplicate), /Duplicate/);
  const missing = smokeModel(); missing.elements[0].geometryId = 'absent';
  assert.throws(() => parseModel(missing), /Missing geometry/);
  const index = smokeModel(); index.geometries[0].indices[0] = 999999;
  assert.throws(() => parseModel(index), /triangle geometry/);
  const infinite = smokeModel(); infinite.elements[0].position[0] = Infinity;
  assert.throws(() => parseModel(infinite));
  const scale = smokeModel(); scale.elements[0].scale[0] = 0;
  assert.throws(() => parseModel(scale), /transform/);
  const camera = smokeModel(); camera.cameraPath[0].eye = [...camera.cameraPath[0].target];
  assert.throws(() => parseModel(camera), /camera/);
});
test('proposal adds, moves, and removes exactly its declared elements without mutating the baseline', () => {
  const model = smokeModel(); const initial = structuredClone(model);
  const result = applyProposal(model, smokeProposal(model));
  assert.deepEqual(model, initial);
  const delta = changesBetween(model.elements, result.elements);
  assert.deepEqual(delta.remove, ['element-1']);
  assert.deepEqual(delta.upsert.map(item => item.id), ['element-0', 'proposal-added']);
  assert.equal(result.elements.find(item => item.id === 'element-0')?.position[1], 2.75);
  assert.deepEqual(result.elements.find(item => item.id === 'element-2'), model.elements[2]);
  assert.equal(result.revision, 'baseline-1-proposal');
});
test('stale, duplicate, and invalid proposals leave accepted input intact', () => {
  const model = smokeModel(); const initial = JSON.stringify(model); const proposal = smokeProposal(model);
  assert.throws(() => applyProposal(model, { ...proposal, baseRevision: 'old' }), /Stale/);
  assert.throws(() => applyProposal(model, { ...proposal, upsert: [proposal.upsert[0], proposal.upsert[0]] }), /Duplicate/);
  assert.throws(() => applyProposal(model, { ...proposal, remove: ['unknown'] }), /removal/);
  assert.throws(() => applyProposal(model, { ...proposal, upsert: [{ ...proposal.upsert[0], geometryId: 'missing' }] }), /Missing geometry/);
  assert.equal(JSON.stringify(model), initial);
});
test('comparison retains removed and previous geometry and discard restores the exact base', () => {
  const model = smokeModel(); const proposal = applyProposal(model, smokeProposal(model));
  const review = comparisonElements(model, proposal);
  assert.deepEqual(review.filter(item => item.id.startsWith('before:')).map(item => item.id), ['before:element-0', 'before:element-1']);
  assert.deepEqual(review.find(item => item.id === 'before:element-0')?.position, model.elements[0].position);
  const restore = changesBetween(review, model.elements);
  const displayed = new Map(review.map(item => [item.id, item]));
  restore.remove.forEach(id => displayed.delete(id)); restore.upsert.forEach(item => displayed.set(item.id, item));
  assert.deepEqual([...displayed.values()].sort((a, b) => a.id.localeCompare(b.id)), [...model.elements].sort((a, b) => a.id.localeCompare(b.id)));
});
test('renderer oracle catches lost IDs, duplicate IDs, and wrong movement', () => {
  const model = smokeModel(); const elements = model.elements;
  const readback = elements.map(item => ({ id: item.id, position: item.position,
    min: [item.position[0] - .6, item.position[1] - .75, item.position[2] - .6] satisfies [number, number, number],
    max: [item.position[0] + .6, item.position[1] + .75, item.position[2] + .6] satisfies [number, number, number] }));
  assertReadback(model, elements, readback);
  assert.throws(() => assertReadback(model, elements, readback.slice(1)), /count/);
  assert.throws(() => assertReadback(model, elements, readback.map((item, index) => index ? item : readback[1])), /identity/);
  assert.throws(() => assertReadback(model, elements, readback.map((item, index) => index ? item : { ...item, position: [0, 0, 0] })), /transform/);
  assert.throws(() => assertReadback(model, elements, readback.map((item, index) => index ? item : { ...item, max: [100, 100, 100] })), /bounds/);
});
test('percentiles require enough samples and never combine missing values into zeros', () => {
  assert.deepEqual(summarize([]), { count: 0, median: null, p95: null, maximum: null });
  assert.equal(summarize([1, 5, 2]).p95, null);
  assert.equal(summarize(Array.from({ length: 100 }, (_, i) => i + 1)).p95, 95);
  assert.throws(() => summarize([NaN]));
});
test('result validator rejects a false completion or a qualification claim', () => {
  const result: Result = { version: 1, candidate: 'babylon', profile: 'viewer-192-v1', purpose: 'setup-smoke', status: 'failed', qualified: false,
    reviewCycles: 3, samples: [], frameIntervalsMs: [], checks: [], limitations: [], error: 'Browser unavailable',
    environment: { userAgent: 'test', hardwareConcurrency: 1, renderer: 'unavailable', viewport: [1280, 800], devicePixelRatio: 1 } };
  parseResult(result);
  assert.throws(() => parseResult({ ...result, status: 'completed', error: null }), /missing scenario evidence/);
  assert.throws(() => parseResult({ ...result, qualified: true }), /Invalid benchmark result/);
});

function completedResult(): Result {
  const operations = ['load', 'select', 'properties', 'pick', 'filter', 'section',
    ...Array.from({ length: 3 }, () => ['proposal', 'comparison', 'comparison-exit', 'discard']).flat()];
  return { version: 1, candidate: 'babylon', profile: 'viewer-192-v1', purpose: 'setup-smoke', status: 'completed', qualified: false,
    reviewCycles: 3, samples: operations.map(operation => ({ operation, durationMs: 1, drawCalls: 1, triangles: 12 })),
    checks: [...operations, 'renderer-readback', 'stale-rejected', ...Array.from({ length: 12 }, () => 'accepted-immutable')],
    frameIntervalsMs: [16], limitations: ['Unit-test result, no browser measurement'], error: null,
    environment: { userAgent: 'test', hardwareConcurrency: 1, renderer: 'unavailable', viewport: [1280, 800], devicePixelRatio: 1 } };
}

test('completed results require every claimed scenario check and operation', () => {
  const result = completedResult(); parseResult(result, { candidate: 'babylon', reviewCycles: 3 });
  for (const check of new Set(result.checks)) {
    assert.throws(() => parseResult({ ...result, checks: result.checks.filter(item => item !== check) }), /scenario evidence/, check);
  }
  for (const operation of new Set(result.samples.map(sample => sample.operation))) {
    assert.throws(() => parseResult({ ...result, samples: result.samples.filter(sample => sample.operation !== operation) }), /scenario evidence/, operation);
  }
  assert.throws(() => parseResult({ ...result, frameIntervalsMs: [] }), /scenario evidence/);
});

test('completed results reject truncated, overcounted and relabelled review cycles', () => {
  const result = completedResult();
  for (const operation of ['proposal', 'comparison', 'comparison-exit', 'discard']) {
    const index = result.samples.findIndex(sample => sample.operation === operation);
    assert.throws(() => parseResult({ ...result, samples: result.samples.filter((_, i) => i !== index) }), /counts/, operation);
    assert.throws(() => parseResult({ ...result, samples: [...result.samples, result.samples[index]] }), /counts/, operation);
    const checkIndex = result.checks.indexOf(operation);
    assert.throws(() => parseResult({ ...result, checks: result.checks.filter((_, i) => i !== checkIndex) }), /counts/, operation);
  }
  const index = result.checks.indexOf('accepted-immutable');
  assert.throws(() => parseResult({ ...result, checks: result.checks.filter((_, i) => i !== index) }), /counts/);
  assert.throws(() => parseResult({ ...result, reviewCycles: 1 }), /counts/);
  assert.throws(() => parseResult(result, { candidate: 'babylon', reviewCycles: 100 }), /requested/);
  assert.throws(() => parseResult(result, { candidate: 'fragments', reviewCycles: 3 }), /requested/);
});
