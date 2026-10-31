import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRuntime } from '@frederik91/scriptbox';
import { ModelScripts, modelScriptApi, summarizeModelDelta } from './model-script.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { RoomRepository, identifier } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { freezeModelScope, assertModelScopeWrites } from './model-scope.ts';
import { previewHostedDoorWidth } from './hosted-opening.ts';

const scripts = new ModelScripts(); after(() => scripts.dispose());
const input = { doorId: 'level-ground-door-inner', widthMetres: 1.1, anchor: 'centre' };
const review = { summary: 'Widen the connecting door to 1100 mm, retaining its centre.',
  rationale: 'Compensate the existing hosted offset by 100 mm.', constraints: 'Only one native door and its host offset change.',
  uncertainty: 'Synthetic concept model requires human review.',
  intent: { interpretation: 'Widen the selected door with a fixed centre.', assumptions: [], certainty: 100, basis: 'Deterministic fixture.' } };
const propose = `return {kind:'propose',review:${JSON.stringify(review)}};`;
async function fixture(selected = input.doorId) {
  const base = multiStoreySnapshot();
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Centred hosted door', snapshot: base });
  const baseRevisionId = repo.head('main');
  const scope = freezeModelScope({ graph: base, baseRevisionId,
    query: { version: 1, allOf: [{ kind: 'ids', ids: [selected] }], anyOf: [], excludeIds: [] } });
  const binding = { baseRevisionId, selectedObjectIds: [identifier(selected)], scope, visualIntent: { kind: 'selection' } satisfies { kind: 'selection' } };
  return { base, repo, binding };
}
function run(data: Awaited<ReturnType<typeof fixture>>, source: string, onPreview: (snapshot: ModelSnapshot | null) => void = () => {}) {
  return scripts.run({ base: data.base, binding: data.binding, source, language: 'typescript',
    signal: new AbortController().signal, remainingHostCalls: 24, onActivity: () => {}, onPreview });
}
test('actual typed ScriptBox invocation exposes centre impact and stages only the validated scoped two-record proposal', async () => {
  const data = await fixture(); const accepted = data.repo.serialize();
  const expected = previewHostedDoorWidth(data.base, input); const previews: (ModelSnapshot | null)[] = [];
  assert.match(await scripts.declarations(), /previewHostedDoorWidth\(input:/);
  const result = await run(data, `
    const guide = await docs.read('/guides/model.md');
    if (!JSON.stringify(guide).includes('previewHostedDoorWidth')) throw new Error('Guide missing.');
    const result = await model.previewHostedDoorWidth(${JSON.stringify(input)});
    if (JSON.stringify(result.impact) !== ${JSON.stringify(JSON.stringify(expected.impact))}) throw new Error('Impact lost.');
    if (JSON.stringify(result.changes) !== ${JSON.stringify(JSON.stringify(summarizeModelDelta(expected.delta)))}) throw new Error('Delta lost.');
    ${propose}`, snapshot => previews.push(snapshot));
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind !== 'proposal') return;
  assert.deepEqual(result.snapshot, expected.snapshot); assert.equal(data.repo.serialize(), accepted);
  assert.deepEqual(previews, [null, expected.snapshot]); assert.equal(result.evidence.validation, 'passed');
  assert.equal(result.evidence.runtime.guestAbi, 2);
  assert.deepEqual(result.evidence.calls.filter(item => item.method.startsWith('model.')).map(item => [item.method, item.disposition]),
    [['model.previewHostedDoorWidth', 'completed']]);
});
test('invalid later preview preserves the previous staged door while subsequent width previews compose from that draft', async () => {
  const data = await fixture(); const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `
    const valid = await model.previewHostedDoorWidth(${JSON.stringify(input)});
    try { await model.previewHostedDoorWidth({...${JSON.stringify(input)},widthMetres:7}); throw new Error('Invalid accepted'); }
    catch(error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
    const retained = await model.inspect();
    if (JSON.stringify(retained.model) !== JSON.stringify(valid.model)) throw new Error('Partial write');
    const next = await model.previewHostedDoorWidth({...${JSON.stringify(input)},widthMetres:1.3});
    if (next.impact.before.widthMetres !== 1.1 || next.impact.after.offsetMetres !== 2.8) throw new Error('Draft did not compose');
    ${propose}`, snapshot => previews.push(snapshot));
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind === 'proposal') assert.deepEqual(result.snapshot, previewHostedDoorWidth(data.base, { ...input, widthMetres: 1.3 }).snapshot);
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'app-error', 'completed', 'completed']);
  assert.equal(previews.filter(item => item !== null).length, 2);
});
test('readable door context cannot grant width or relationship writes and failed scope leaves no draft', async () => {
  const data = await fixture('door-entry'); const previews: (ModelSnapshot | null)[] = [];
  assert.ok(data.binding.scope.contextIds.includes(input.doorId));
  const candidate = previewHostedDoorWidth(data.base, input).snapshot;
  assert.throws(() => assertModelScopeWrites({ before: data.base, after: candidate, binding: data.binding.scope }), /Out-of-scope entity/);
  assert.throws(() => assertModelScopeWrites({ before: data.base, after: { ...data.base, relationships: candidate.relationships }, binding: data.binding.scope }), /Out-of-scope relationship/);
  const result = await run(data, `
    const before = await model.inspect();
    try { await model.previewHostedDoorWidth(${JSON.stringify(input)}); throw new Error('Scope accepted'); }
    catch(error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
    const after = await model.inspect();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Scope expanded');
    return {kind:'observe',observation:'unchanged'};`, snapshot => previews.push(snapshot));
  assert.equal(result.kind, 'observation', JSON.stringify(result)); assert.deepEqual(previews, [null, null]);
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'app-error', 'completed']);
});
test('read-only ScriptBox capability rejects the registered draft-write method before any stage or preview', async t => {
  const data = await fixture(); const events: string[] = [];
  const runtime = await createRuntime({ apis: [modelScriptApi], compilerWorkers: 1 });
  const context = { base: data.base, snapshot: data.base, binding: data.binding, signal: new AbortController().signal,
    onActivity: () => events.push('activity'), onPreview: () => events.push('preview') };
  const session = runtime.createSession({ context, capabilities: method => method.effect === 'read' });
  t.after(async () => { await session.dispose(); await runtime.dispose(); });
  const outcome = await session.execute({ language: 'typescript', source: `await model.previewHostedDoorWidth(${JSON.stringify(input)}); return null;` });
  assert.equal(outcome.status, 'failed'); assert.equal(outcome.evidence.calls[0]?.disposition, 'denied');
  assert.deepEqual(events, []); assert.equal(context.snapshot, data.base);
});
