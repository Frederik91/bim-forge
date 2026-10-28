import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { ModelScripts, MODEL_REVIEW_TEXT_CONTRACT, MODEL_REVIEW_TEXT_GUIDANCE } from './model-script.ts';
import { prepareModelProposal } from './model-proposal.ts';
import type { ModelWorker } from './model-proposal.ts';
import { RoomRepository } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { roomDimensionFixture } from './room-dimension-fixture.ts';

const scripts = new ModelScripts();
after(() => scripts.dispose());
const review = { summary: 'Move the shared partition 100 mm.', rationale: 'Preview the requested bounded geometry change.',
  constraints: 'Keep hosted openings and both adjacent rooms valid.', uncertainty: 'Synthetic geometry requires human review.',
  intent: { interpretation: 'Move the shared partition.', assumptions: [], certainty: 90, basis: 'Synthetic complete-partition fixture.' } };

async function execute(value: unknown, field: keyof typeof MODEL_REVIEW_TEXT_CONTRACT.maximumLengths = 'constraints') {
  const base = roomDimensionFixture();
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Review contract fixture', snapshot: base });
  const accepted = repo.serialize(); const baseBytes = JSON.stringify(base);
  const host = base.relationships.find(item => item.source === 'door-between'); assert.ok(host);
  const previews: (ModelSnapshot | null)[] = [];
  const result = await scripts.run({ base,
    binding: { baseRevisionId: repo.head('main'), selectedObjectIds: [host.target], visualIntent: { kind: 'selection' } },
    source: `await model.previewWallShift({wallId:${JSON.stringify(host.target)},offsetMetres:.1}); return {kind:'propose',review:${JSON.stringify({ ...review, [field]: value })}};`,
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

test('all authoritative review field limits accept their exact maximum and reject one extra code unit', async () => {
  assert.deepEqual(MODEL_REVIEW_TEXT_CONTRACT.maximumLengths, { summary: 240, rationale: 800, constraints: 600, uncertainty: 400 });
  const fields: (keyof typeof MODEL_REVIEW_TEXT_CONTRACT.maximumLengths)[] = ['summary', 'rationale', 'constraints', 'uncertainty'];
  for (const field of fields) {
    const maximum = MODEL_REVIEW_TEXT_CONTRACT.maximumLengths[field];
    const valid = await execute('x'.repeat(maximum), field);
    assert.equal(valid.result.kind, 'proposal', JSON.stringify(valid.result));
    const invalid = await execute('x'.repeat(maximum + 1), field);
    assert.equal(invalid.result.kind, 'failed', JSON.stringify(invalid.result)); if (invalid.result.kind !== 'failed') return;
    assert.ok(invalid.result.diagnostic.message.includes(`review.${field} length ${maximum + 1} exceeds maximum ${maximum}`));
    assert.equal(invalid.previews.at(-1), null);
  }
});

test('empty and wrong-type review values identify the field and distinguish their repair', async () => {
  for (const value of ['', '   ', 42, null, [], {}]) {
    const { result, previews } = await execute(value);
    assert.equal(result.kind, 'failed', JSON.stringify(result)); if (result.kind !== 'failed') return;
    assert.match(result.diagnostic.message, /review\.constraints must be a nonempty string \(1-600 characters\)/);
    if (typeof value === 'string') assert.ok(result.diagnostic.message.includes(`empty or whitespace-only string (length ${value.length})`));
    else assert.ok(result.diagnostic.message.includes(`received ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`));
    assert.equal(previews.at(-1), null);
  }
});

test('the exact legacy C0 control range stays forbidden and other legacy text remains accepted', async () => {
  for (let code = 0; code <= 31; code += 1) {
    const { result, previews } = await execute(`a${String.fromCharCode(code)}b`);
    assert.equal(result.kind, 'failed', JSON.stringify(result)); if (result.kind !== 'failed') return;
    assert.match(result.diagnostic.message, /review\.constraints contains forbidden control characters U\+0000-U\+001F/);
    assert.match(result.diagnostic.message, /Received length 3; maximum 600/); assert.equal(previews.at(-1), null);
  }
  for (const value of [' retained spaces ', 'a\u007fb', 'a\u0085b', 'a\u2028b', 'a\u2029b', 'a\u200bb']) {
    const { result } = await execute(value);
    assert.equal(result.kind, 'proposal', JSON.stringify(result));
    if (result.kind === 'proposal') assert.equal(result.review.constraints, value.trim());
  }
});

test('raw length before the existing trim and UTF-16 code-unit counting remain unchanged', async () => {
  for (const value of [' ' + 'x'.repeat(598) + ' ', '\u{1f600}'.repeat(300)]) {
    const { result } = await execute(value); assert.equal(result.kind, 'proposal', JSON.stringify(result));
    if (result.kind === 'proposal') assert.equal(result.review.constraints, value.trim());
  }
  for (const value of [' ' + 'x'.repeat(599) + ' ', '\u{1f600}'.repeat(301)]) {
    const { result } = await execute(value); assert.equal(result.kind, 'failed', JSON.stringify(result));
    if (result.kind === 'failed') assert.ok(result.diagnostic.message.includes(`length ${value.length} exceeds maximum 600`));
  }
});

test('real guest docs and initial proposal instructions contain guidance generated from the same contract', async () => {
  for (const [field, maximum] of Object.entries(MODEL_REVIEW_TEXT_CONTRACT.maximumLengths)) {
    assert.ok(MODEL_REVIEW_TEXT_GUIDANCE.includes(`review.${field}: 1-${maximum} characters`));
  }
  const base = roomDimensionFixture();
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Review instruction contract', snapshot: base });
  const host = base.relationships.find(item => item.source === 'door-between'); assert.ok(host);
  const doc = await scripts.run({ base, binding: { baseRevisionId: repo.head('main'), selectedObjectIds: [host.target], visualIntent: { kind: 'selection' } },
    language: 'typescript', source: "return {kind:'observe',observation:await docs.read('/guides/model.md')};",
    signal: new AbortController().signal, remainingHostCalls: 16, onActivity: () => {} });
  assert.equal(doc.kind, 'observation', JSON.stringify(doc));
  if (doc.kind === 'observation') assert.ok(JSON.stringify(doc.observation).includes(MODEL_REVIEW_TEXT_GUIDANCE));
  const accepted = repo.serialize();
  const worker: ModelWorker = { identity: { provider: 'test', model: 'review-contract' }, run: async session => {
    assert.ok(session.instructions.includes(MODEL_REVIEW_TEXT_GUIDANCE));
    const output = await session.executeTool('run_model_script', { language: 'typescript',
      source: `await model.previewWallShift({wallId:${JSON.stringify(host.target)},offsetMetres:.1}); return {kind:'propose',review:${JSON.stringify(review)}};` });
    assert.equal(output.ok, true, JSON.stringify(output));
  } };
  const result = await prepareModelProposal(repo, { requestId: 'review-text-guidance', proposalName: 'review-text-guidance',
    baseRevisionId: repo.head('main'), selectedObjectIds: [host.target], instruction: 'Preview a 100 mm shared partition shift.', visualIntent: { kind: 'selection' } }, worker);
  assert.equal(result.status, 'ready', JSON.stringify(result)); assert.equal(repo.serialize(), accepted);
});
