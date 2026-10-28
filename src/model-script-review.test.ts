import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ModelScripts } from './model-script.ts';
import { RoomRepository } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { roomDimensionFixture } from './room-dimension-fixture.ts';

const scripts = new ModelScripts();
after(() => scripts.dispose());
const review = { summary: 'Move the shared partition 100 mm.', rationale: 'Preview the requested bounded geometry change.',
  constraints: 'Keep hosted openings and both adjacent rooms valid.', uncertainty: 'Synthetic geometry requires human review.',
  intent: { interpretation: 'Move the shared partition.', assumptions: [], certainty: 90, basis: 'Synthetic complete-partition fixture.' } };

async function execute(constraints: unknown) {
  const base = roomDimensionFixture();
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Review contract fixture', snapshot: base });
  const accepted = repo.serialize(); const baseBytes = JSON.stringify(base);
  const host = base.relationships.find(item => item.source === 'door-between'); assert.ok(host);
  const previews: (ModelSnapshot | null)[] = [];
  const result = await scripts.run({ base,
    binding: { baseRevisionId: repo.head('main'), selectedObjectIds: [host.target], visualIntent: { kind: 'selection' } },
    source: `await model.previewWallShift({wallId:${JSON.stringify(host.target)},offsetMetres:.1}); return {kind:'propose',review:${JSON.stringify({ ...review, constraints })}};`,
    language: 'typescript', signal: new AbortController().signal, remainingHostCalls: 16, onActivity: () => {},
    onPreview: snapshot => previews.push(snapshot) });
  assert.equal(repo.serialize(), accepted); assert.equal(JSON.stringify(base), baseBytes);
  assert.equal(result.evidence.calls.find(item => item.method === 'model.previewWallShift')?.disposition, 'completed', 'geometry must pass before the review is checked');
  return { result, previews };
}

test('valid staged geometry with 601-character constraints is discarded with the field, actual length and maximum', async () => {
  const { result, previews } = await execute('x'.repeat(601));
  assert.equal(result.kind, 'failed', JSON.stringify(result)); if (result.kind !== 'failed') return;
  assert.equal(result.diagnostic.code, 'invalid-proposal'); assert.equal(result.evidence.disposition, 'discarded');
  assert.equal(previews.filter(item => item !== null).length, 1); assert.equal(previews.at(-1), null);
  assert.match(result.diagnostic.message, /review\.constraints/);
  assert.match(result.diagnostic.message, /length 601 exceeds maximum 600/);
});

test('valid staged geometry with a newline in constraints is discarded with an actionable control diagnostic', async () => {
  const { result, previews } = await execute('Keep the host.\nKeep both rooms.');
  assert.equal(result.kind, 'failed', JSON.stringify(result)); if (result.kind !== 'failed') return;
  assert.equal(result.diagnostic.code, 'invalid-proposal'); assert.equal(previews.at(-1), null);
  assert.match(result.diagnostic.message, /review\.constraints/);
  assert.match(result.diagnostic.message, /control.*U\+0000-U\+001F.*newline/);
});

test('exactly 600 constraints characters remain accepted and a corrected concise review yields a proposal', async () => {
  for (const constraints of ['x'.repeat(600), 'Keep hosts and room boundaries valid.']) {
    const { result, previews } = await execute(constraints);
    assert.equal(result.kind, 'proposal', JSON.stringify(result)); if (result.kind !== 'proposal') return;
    assert.equal(result.review.constraints, constraints); assert.equal(result.evidence.validation, 'passed');
    assert.notEqual(previews.at(-1), null);
  }
});
