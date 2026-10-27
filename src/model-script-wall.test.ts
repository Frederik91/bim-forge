import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRuntime } from '@frederik91/scriptbox';
import { doorClearanceBounds } from './floor-plan.ts';
import { ModelScripts, modelScriptApi, summarizeModelDelta } from './model-script.ts';
import { freezeModelScope } from './model-scope.ts';
import type { FrozenModelScope, ModelScopeQuery } from './model-scope-contract.ts';
import { RoomRepository, diffSnapshots, identifier, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { syntheticResidentialFixture } from './synthetic-residential-fixture.ts';
import { previewWallShift } from './wall-dependencies.ts';

const scripts = new ModelScripts();
after(() => scripts.dispose());
const review = {
  summary: 'Shift the shared partition 200 mm.', rationale: 'The two adjacent room boundaries follow the existing shared wall.',
  constraints: 'Retain hosted objects and unrelated contents.', uncertainty: 'Synthetic concept geometry requires human review.',
  intent: { interpretation: 'Preview the shared partition shift.', assumptions: [], certainty: 90,
    basis: 'The fixture supplies a complete shared partition and a hosted doorway.' },
};
const propose = `return {kind:'propose',review:${JSON.stringify(review)}};`;

async function residential() {
  const fixture = syntheticResidentialFixture();
  const repo = await RoomRepository.createProject({ projectId: fixture.projectId, name: 'Script wall preview', snapshot: fixture.snapshot });
  const baseRevisionId = repo.head('main');
  const base = repo.view(baseRevisionId).snapshot;
  const wallId = identifier(fixture.sources.measurements[0].objectId);
  const host = fixture.inventory.hostedOpenings.find(item => item.wallId === wallId);
  assert.ok(host);
  return { fixture, repo, base, host, input: { wallId, offsetMetres: .2 },
    binding: { baseRevisionId, selectedObjectIds: [wallId], visualIntent: { kind: 'selection' } satisfies { kind: 'selection' } } };
}

function run(data: Awaited<ReturnType<typeof residential>>, source: string, options: {
  scope?: FrozenModelScope; onPreview?: (snapshot: ModelSnapshot | null) => void;
} = {}) {
  return scripts.run({ base: data.base, binding: { ...data.binding, ...(options.scope ? { scope: options.scope } : {}) },
    language: 'typescript', source, signal: new AbortController().signal, remainingHostCalls: 24, onActivity: () => {},
    ...(options.onPreview ? { onPreview: options.onPreview } : {}) });
}

function scopeFor(data: Awaited<ReturnType<typeof residential>>, ids: string[]) {
  const query = { version: 1, allOf: [{ kind: 'ids', ids }], anyOf: [], excludeIds: [] } satisfies ModelScopeQuery;
  return freezeModelScope({ graph: data.base, query, baseRevisionId: data.binding.baseRevisionId });
}

test('typed WASM wall preview reports stored delta and evaluated doorway motion without publishing the generated floor', async () => {
  const data = await residential(); const accepted = data.repo.serialize(); const baseBytes = JSON.stringify(data.base);
  const expected = previewWallShift(data.base, data.input);
  const previews: (ModelSnapshot | null)[] = [];
  const declarations = await scripts.declarations();
  assert.match(declarations, /previewWallShift\(input:/);
  assert.match(declarations, /offsetMetres: number/);
  const evidence = { changes: summarizeModelDelta(expected.delta), impacts: expected.impacts };
  const result = await run(data, `
    const guide = await docs.read('/guides/model.md');
    if (!JSON.stringify(guide).includes('model.previewWallShift')) throw new Error('Missing wall guide.');
    const result = await model.previewWallShift(${JSON.stringify(data.input)});
    if (JSON.stringify({changes:result.changes,impacts:result.impacts}) !== ${JSON.stringify(JSON.stringify(evidence))}) throw new Error('Lost impact evidence.');
    ${propose}
  `, { onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind !== 'proposal') return;
  assert.deepEqual(result.snapshot, expected.snapshot);
  assert.deepEqual(validateSnapshot(result.snapshot), result.snapshot);
  assert.deepEqual(diffSnapshots(data.base, result.snapshot), expected.delta);
  assert.deepEqual(expected.delta.entities.modified.map(item => item.id).sort(),
    [...(data.fixture.inventory.walls.find(item => item.id === data.input.wallId)?.roomIds ?? []), data.input.wallId].sort());
  assert.deepEqual(expected.delta.relationships, { added: [], removed: [], modified: [] });
  const beforeDoor = data.base.entities.find(item => item.id === data.host.openingId);
  const afterDoor = result.snapshot.entities.find(item => item.id === data.host.openingId);
  assert.ok(beforeDoor?.type === 'Door' && afterDoor?.type === 'Door');
  assert.deepEqual(afterDoor, beforeDoor);
  assert.deepEqual(result.snapshot.relationships, data.base.relationships);
  const beforeClearance = doorClearanceBounds(data.base, beforeDoor);
  const afterClearance = doorClearanceBounds(result.snapshot, afterDoor);
  assert.ok(Math.abs(afterClearance.minX - beforeClearance.minX - data.input.offsetMetres) < 1e-9);
  assert.deepEqual(expected.impacts.find(item => item.id === beforeDoor.id),
    { kind: 'entity', id: beforeDoor.id, reasons: ['hosted-opening'], changed: false });
  for (const entity of data.base.entities) {
    if (!expected.delta.entities.modified.some(item => item.id === entity.id)) {
      assert.deepEqual(result.snapshot.entities.find(item => item.id === entity.id), entity);
    }
  }
  assert.deepEqual(previews, [null, expected.snapshot]);
  assert.equal(JSON.stringify(data.base), baseBytes); assert.equal(data.repo.serialize(), accepted);
  assert.equal(result.evidence.runtime.guestAbi, 2);
  assert.match(result.evidence.runtime.artifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.validation, 'passed'); assert.equal(result.evidence.disposition, 'proposal');
  assert.deepEqual(result.evidence.calls.filter(item => item.method.startsWith('model.')),
    [{ sequence: 2, method: 'model.previewWallShift', disposition: 'completed' }]);
});

test('two wall previews compose on the current draft and report cumulative stored changes', async () => {
  const data = await residential();
  const expected = previewWallShift(data.base, data.input);
  const result = await run(data, `
    await model.previewWallShift(${JSON.stringify({ ...data.input, offsetMetres: .1 })});
    const result = await model.previewWallShift(${JSON.stringify({ ...data.input, offsetMetres: .1 })});
    if (JSON.stringify(result.changes) !== ${JSON.stringify(JSON.stringify(summarizeModelDelta(expected.delta)))}) throw new Error('Noncumulative delta.');
    ${propose}
  `);
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind === 'proposal') assert.deepEqual(result.snapshot, expected.snapshot);
});

test('invalid wall contents reject atomically and preserve an earlier valid private draft for correction', async () => {
  const data = await residential(); const bytes = JSON.stringify(data.base);
  const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `
    const valid = await model.previewWallShift(${JSON.stringify(data.input)});
    try {
      await model.previewWallShift(${JSON.stringify({ ...data.input, offsetMetres: .7 })});
      throw new Error('Invalid contents accepted.');
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error;
    }
    const retained = await model.inspect();
    if (JSON.stringify(retained.model) !== JSON.stringify(valid.model)) throw new Error('Partial invalid write.');
    ${propose}
  `, { onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind === 'proposal') assert.deepEqual(result.snapshot, previewWallShift(data.base, data.input).snapshot);
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'app-error', 'completed']);
  assert.equal(previews.filter(item => item !== null).length, 1);
  assert.equal(JSON.stringify(data.base), bytes);
});

test('invalid first preview, zero and off-grid offsets leave the entire draft unchanged', async () => {
  const data = await residential(); const bytes = JSON.stringify(data.base);
  const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `
    const before = await model.inspect();
    for (const offsetMetres of [.9, 0, .0005]) {
      try {
        await model.previewWallShift({wallId:${JSON.stringify(data.input.wallId)},offsetMetres});
        throw new Error('Invalid shift accepted.');
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error;
      }
    }
    const after = await model.inspect();
    if (JSON.stringify(after.model) !== JSON.stringify(before.model)) throw new Error('Invalid draft leaked.');
    return {kind:'observe',observation:'unchanged'};
  `, { onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'observation', JSON.stringify(result));
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'app-error', 'app-error', 'app-error', 'completed']);
  assert.deepEqual(previews, [null, null]); assert.equal(JSON.stringify(data.base), bytes);
});

test('read-only WASM capabilities deny the registered draft-write wall method before staging', async t => {
  const data = await residential(); const bytes = JSON.stringify(data.base);
  const runtime = await createRuntime({ apis: [modelScriptApi], compilerWorkers: 1,
    limits: { memoryBytes: 64 * 1024 * 1024, compilerHeapMb: 256, sourceBytes: 32 * 1024, resultBytes: 64 * 1024, hostCalls: 16 } });
  t.after(() => runtime.dispose());
  const descriptor = runtime.contract.namespaces.find(item => item.name === 'model')?.methods.find(item => item.name === 'previewWallShift');
  assert.equal(descriptor?.effect, 'draft-write');
  const activity: string[] = []; const previews: (ModelSnapshot | null)[] = [];
  const context: Parameters<typeof runtime.createSession>[0]['context'] = {
    base: data.base, snapshot: data.base, binding: data.binding, signal: new AbortController().signal,
    onActivity: event => activity.push(event.stage), onPreview: snapshot => previews.push(snapshot),
  };
  const session = runtime.createSession({ context, capabilities: method => method.effect === 'read' });
  t.after(() => session.dispose());
  const outcome = await session.execute({ language: 'typescript', source: `
    await model.inspect();
    await model.previewWallShift(${JSON.stringify(data.input)});
    return null;
  ` });
  assert.equal(outcome.status, 'failed', JSON.stringify(outcome));
  const call = outcome.evidence.calls.find(item => item.method === 'model.previewWallShift');
  assert.equal(call?.disposition, 'denied');
  assert.deepEqual(activity, ['inspecting']); assert.deepEqual(previews, []);
  assert.equal(context.snapshot, data.base); assert.equal(JSON.stringify(data.base), bytes);
});

test('wall-only frozen scope refuses changed Space context without uplifting write authority', async () => {
  const data = await residential(); const scope = scopeFor(data, [data.input.wallId]); const frozen = JSON.stringify(scope);
  const expected = previewWallShift(data.base, data.input);
  const changedSpaces = expected.delta.entities.modified.filter(item => item.after.type === 'Space').map(item => item.id);
  assert.equal(changedSpaces.length, 2);
  assert.ok(changedSpaces.every(id => scope.contextIds.includes(id) && !scope.writableIds.includes(id)));
  const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `
    const before = await model.scope();
    try {
      await model.previewWallShift(${JSON.stringify(data.input)});
      throw new Error('Read-only Space was changed.');
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ModelValidationError' || !error.message.includes('Out-of-scope entity write')) throw error;
    }
    const after = await model.scope();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Scope or draft expanded.');
    ${propose}
  `, { scope, onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'failed', JSON.stringify(result));
  if (result.kind === 'failed') { assert.equal(result.diagnostic.code, 'invalid-proposal'); assert.match(result.diagnostic.message, /identical/); }
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'app-error', 'completed']);
  assert.equal(result.evidence.validation, 'failed');
  assert.equal(JSON.stringify(scope), frozen); assert.deepEqual(previews, [null, null]);
});

test('explicit wall and adjacent Space targets succeed under the existing frozen closure', async () => {
  const data = await residential(); const accepted = data.repo.serialize();
  const expected = previewWallShift(data.base, data.input);
  const ids = expected.delta.entities.modified.map(item => item.id);
  const scope = scopeFor(data, ids); const frozen = JSON.stringify(scope);
  assert.deepEqual(scope.targetIds, [...ids].sort());
  assert.ok(scope.dependentIds.includes(data.host.openingId));
  const result = await run(data, `
    const before = await model.scope();
    const result = await model.previewWallShift(${JSON.stringify(data.input)});
    if (JSON.stringify(result.impacts) !== ${JSON.stringify(JSON.stringify(expected.impacts))}) throw new Error('Missing evaluation evidence.');
    const after = await model.scope();
    if (!after.scope) throw new Error('Missing frozen scope.');
    if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) throw new Error('Frozen authority changed.');
    const readable = [...after.scope.targetIds,...after.scope.contextIds,...after.scope.dependentIds,...after.scope.writableIds];
    if (result.model.entities.some(item => !readable.includes(item.id))) throw new Error('Escaped working graph.');
    ${propose}
  `, { scope });
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  if (result.kind === 'proposal') assert.deepEqual(result.snapshot, expected.snapshot);
  assert.equal(result.evidence.validation, 'passed'); assert.equal(JSON.stringify(scope), frozen);
  assert.equal(data.repo.serialize(), accepted);
});

test('wall preview retains abort and host-call budget fences without publishing geometry', async t => {
  const data = await residential(); const bytes = JSON.stringify(data.base);
  const limited = new ModelScripts({ hostCalls: 1 }); t.after(() => limited.dispose());
  const previews: (ModelSnapshot | null)[] = [];
  const limitedResult = await limited.run({ base: data.base, binding: data.binding, language: 'typescript',
    source: `await model.previewWallShift(${JSON.stringify(data.input)}); await model.inspect(); ${propose}`,
    signal: new AbortController().signal, remainingHostCalls: 24, onActivity: () => {}, onPreview: snapshot => previews.push(snapshot) });
  assert.equal(limitedResult.kind, 'failed', JSON.stringify(limitedResult));
  assert.equal(limitedResult.evidence.disposition, 'discarded');
  assert.equal(limitedResult.evidence.status, 'resource-limit'); assert.equal(previews.at(-1), null);
  const controller = new AbortController(); const cancelledPreviews: (ModelSnapshot | null)[] = [];
  const cancelled = await scripts.run({ base: data.base, binding: data.binding, language: 'typescript',
    source: `await model.previewWallShift(${JSON.stringify(data.input)}); ${propose}`,
    signal: controller.signal, remainingHostCalls: 24,
    onActivity: event => { if (event.stage === 'validated') controller.abort(); }, onPreview: snapshot => cancelledPreviews.push(snapshot) });
  assert.equal(cancelled.kind, 'failed', JSON.stringify(cancelled)); assert.equal(cancelled.evidence.disposition, 'discarded');
  assert.deepEqual(cancelledPreviews, [null, null]); assert.equal(JSON.stringify(data.base), bytes);
});
