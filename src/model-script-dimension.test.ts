import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRuntime } from '@frederik91/scriptbox';
import { ModelScripts, modelScriptApi, modelWorkingGraph, summarizeModelDelta } from './model-script.ts';
import { freezeModelScope } from './model-scope.ts';
import type { FrozenModelScope, ModelScopeQuery } from './model-scope-contract.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { roomDimensionFixture } from './room-dimension-fixture.ts';
import { previewRoomDimensionChange } from './room-dimension-preview.ts';
import type { RoomDimensionRequest } from './room-dimension-preview.ts';
import { RoomRepository, identifier, validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

const scripts = new ModelScripts();
after(() => scripts.dispose());
const review = { summary: 'Preview a 3.3 m centreline room span.', rationale: 'Move the complete existing shared partition using the interpreted measurement.',
  constraints: 'Retain hosted openings, unrelated contents and minimum clear spans.', uncertainty: 'Synthetic interpretation requires human review; sourceRef is opaque context.',
  intent: { interpretation: 'Drive the partition from the requested centreline span.', assumptions: ['The supplied dimension is a centreline span.'],
    certainty: 80, basis: 'The synthetic fixture and explicit user interpretation supply metre dimensions.' } };
const propose = `return {kind:'propose',review:${JSON.stringify(review)}};`;

async function setup(base = roomDimensionFixture(), requested?: RoomDimensionRequest) {
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Dimension bridge fixture', snapshot: base });
  const baseRevisionId = repo.head('main');
  const host = base.relationships.find(item => item.source === 'door-between');
  const input: RoomDimensionRequest = requested ?? { roomId: host ? 'room-a' : 'room-living', wallId: host?.target ?? 'wall-living-kitchen', axis: 'x',
    measurement: { kind: 'confirmed', metres: host ? 3.3 : 5.2, sourceRef: 'opaque-agent-interpretation' },
    minimumClearSpans: host ? [{ roomId: 'room-b', axis: 'x', metres: 2.5 }] : [] };
  return { repo, base, input, binding: { baseRevisionId, selectedObjectIds: [identifier(input.wallId)], visualIntent: { kind: 'selection' } satisfies { kind: 'selection' } } };
}

function run(data: Awaited<ReturnType<typeof setup>>, source: string, options: {
  scope?: FrozenModelScope; onPreview?: (snapshot: ModelSnapshot | null) => void; language?: 'javascript' | 'typescript';
} = {}) {
  return scripts.run({ base: data.base, binding: { ...data.binding, ...(options.scope ? { scope: options.scope } : {}) },
    source, language: options.language ?? 'typescript', signal: new AbortController().signal, remainingHostCalls: 24, onActivity: () => {},
    ...(options.onPreview ? { onPreview: options.onPreview } : {}) });
}

function scopeFor(data: Awaited<ReturnType<typeof setup>>, ids: string[]) {
  const query = { version: 1, allOf: [{ kind: 'ids', ids }], anyOf: [], excludeIds: [] } satisfies ModelScopeQuery;
  return freezeModelScope({ graph: data.base, query, baseRevisionId: data.binding.baseRevisionId });
}

test('typed guest dimension API, generated docs and host evidence agree on the evaluated ready result', async () => {
  const data = await setup(); const accepted = data.repo.serialize(); const bytes = JSON.stringify(data.base);
  const expected = previewRoomDimensionChange(data.base, data.input); assert.equal(expected.status, 'ready');
  if (expected.status !== 'ready') return;
  const declarations = await scripts.declarations();
  assert.match(declarations, /previewRoomDimensionChange\(input:/); assert.match(declarations, /centrelineSpans/);
  assert.match(declarations, /minimumClearSpans/); assert.match(declarations, /contradictory-evidence/);
  const details = { changes: summarizeModelDelta(expected.delta), impacts: expected.impacts, offsetMetres: expected.offsetMetres,
    measurement: expected.measurement, dependencies: expected.dependencies, clearSpanChecks: expected.clearSpanChecks };
  const observation = await run(data, `
    const guide = await docs.read('/guides/model.md');
    if (!JSON.stringify(guide).includes('model.previewRoomDimensionChange')) throw new Error('Missing dimension guide.');
    const result = await model.previewRoomDimensionChange(${JSON.stringify(data.input)});
    if (result.status !== 'ready') throw new Error('Expected a ready interpretation.');
    return {kind:'observe',observation:{changes:result.changes,impacts:result.impacts,offsetMetres:result.offsetMetres,measurement:result.measurement,dependencies:result.dependencies,clearSpanChecks:result.clearSpanChecks}};
  `);
  assert.equal(observation.kind, 'observation', JSON.stringify(observation));
  if (observation.kind !== 'observation') return;
  assert.deepEqual(observation.observation, details);
  assert.deepEqual(observation.evidence.calls.filter(item => item.method.startsWith('model.')),
    [{ sequence: 2, method: 'model.previewRoomDimensionChange', disposition: 'completed' }]);
  const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `await model.previewRoomDimensionChange(${JSON.stringify(data.input)}); ${propose}`,
    { onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'proposal', JSON.stringify(result)); if (result.kind !== 'proposal') return;
  assert.deepEqual(result.snapshot, expected.snapshot); assert.deepEqual(validateSnapshot(result.snapshot), expected.snapshot);
  assert.deepEqual(previews, [null, expected.snapshot]);
  assert.equal(JSON.stringify(data.base), bytes); assert.equal(data.repo.serialize(), accepted);
  assert.equal(result.review.evidenceUses, undefined, 'opaque measurement sourceRef creates no evidence choice');
  assert.equal(result.evidence.runtime.guestAbi, 2); assert.match(result.evidence.runtime.artifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.validation, 'passed'); assert.equal(result.evidence.disposition, 'proposal');
  assert.deepEqual(result.evidence.calls.filter(item => item.method.startsWith('model.')),
    [{ sequence: 1, method: 'model.previewRoomDimensionChange', disposition: 'completed' }]);
});

test('unresolved scale, ambiguity and contradictions emit no model or mutation, including after an earlier valid draft', async () => {
  const data = await setup(); const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `
    const initial = await model.inspect();
    const unknown = await model.previewRoomDimensionChange({...${JSON.stringify(data.input)},measurement:{kind:'unresolved',reason:'unknown-scale',sourceRefs:['plan']}});
    if (unknown.status !== 'unresolved' || 'model' in unknown || 'changes' in unknown) throw new Error('Unknown scale generated geometry.');
    if (JSON.stringify((await model.inspect()).model) !== JSON.stringify(initial.model)) throw new Error('Unknown-scale mutation.');
    const ready = await model.previewRoomDimensionChange(${JSON.stringify(data.input)});
    if (ready.status !== 'ready') throw new Error('Missing ready draft.');
    for (const reason of ['unknown-scale','ambiguous-dimension','contradictory-evidence'] as const) {
      const result = await model.previewRoomDimensionChange({...${JSON.stringify(data.input)},measurement:{kind:'unresolved',reason,sourceRefs:['sheet-b','sheet-a','sheet-b']}});
      if (result.status !== 'unresolved' || 'model' in result || 'changes' in result) throw new Error('Unresolved mutation result.');
      if (JSON.stringify(result.measurement.sourceRefs) !== '["sheet-a","sheet-b"]') throw new Error('Unstable source refs.');
      if (JSON.stringify((await model.inspect()).model) !== JSON.stringify(ready.model)) throw new Error('Unresolved evidence changed the prior draft.');
    }
    ${propose}
  `, { onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'proposal', JSON.stringify(result));
  assert.equal(previews.filter(item => item !== null).length, 1);
  assert.ok(result.evidence.calls.every(item => item.disposition === 'completed'));
});

test('failed clear minimum is a recoverable atomic app error that retains prior changes and cumulative delta', async () => {
  const data = await setup(); const bytes = JSON.stringify(data.base); const previews: (ModelSnapshot | null)[] = [];
  const expected = previewRoomDimensionChange(data.base, data.input); assert.equal(expected.status, 'ready');
  if (expected.status !== 'ready') return;
  const result = await run(data, `
    await model.previewWallShift({wallId:${JSON.stringify(data.input.wallId)},offsetMetres:.1});
    const valid = await model.previewRoomDimensionChange(${JSON.stringify(data.input)});
    if (valid.status !== 'ready') throw new Error('Missing cumulative result.');
    if (valid.offsetMetres !== .2 || JSON.stringify(valid.changes) !== ${JSON.stringify(JSON.stringify(summarizeModelDelta(expected.delta)))}) throw new Error('Not based on current draft/cumulative base.');
    try {
      await model.previewRoomDimensionChange({...${JSON.stringify(data.input)},measurement:{kind:'confirmed',metres:3.4,sourceRef:'opaque'},minimumClearSpans:[{roomId:'room-b',axis:'x',metres:2.6}]});
      throw new Error('Impossible clear minimum accepted.');
    } catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError' || !error.message.includes('Minimum clear span')) throw error; }
    if (JSON.stringify((await model.inspect()).model) !== JSON.stringify(valid.model)) throw new Error('Failed constraint leaked a partial change.');
    ${propose}
  `, { onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'proposal', JSON.stringify(result)); if (result.kind === 'proposal') assert.deepEqual(result.snapshot, expected.snapshot);
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'completed', 'app-error', 'completed']);
  assert.equal(previews.filter(item => item !== null).length, 2); assert.equal(JSON.stringify(data.base), bytes);
});

test('closed guest boundary rejects malformed measurement, constraints and unsupported fields before staging', async () => {
  const data = await setup(); const previews: (ModelSnapshot | null)[] = [];
  const malformed = [
    { ...data.input, extra: 'not-supported' }, { ...data.input, axis: 'z' },
    { ...data.input, measurement: { kind: 'confirmed', metres: 3.3 } },
    { ...data.input, measurement: { kind: 'confirmed', metres: 3.3, sourceRef: 'opaque', grantsApproval: true } },
    { ...data.input, measurement: { kind: 'unresolved', reason: 'unknown-scale', sourceRefs: [] } },
    { ...data.input, minimumClearSpans: [{ roomId: 'room-b', axis: 'x', metres: 2.5, surveyed: true }] },
  ];
  const result = await run(data, `
    for (const input of ${JSON.stringify(malformed)}) {
      try { await model.previewRoomDimensionChange(input); } catch (error) { }
    }
    return {kind:'observe',observation:'malformed requests'};
  `, { language: 'javascript', onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'failed', JSON.stringify(result));
  assert.equal(result.evidence.calls.length, malformed.length);
  assert.ok(result.evidence.calls.every(item => item.method === 'model.previewRoomDimensionChange' && item.disposition !== 'completed'));
  assert.equal(result.evidence.disposition, 'discarded'); assert.deepEqual(previews, [null, null]);
});

test('read-only guest capability denies the registered draft-write dimension method before handler activity', async t => {
  const data = await setup();
  const runtime = await createRuntime({ apis: [modelScriptApi], compilerWorkers: 1,
    limits: { memoryBytes: 64 * 1024 * 1024, compilerHeapMb: 256, sourceBytes: 32 * 1024, resultBytes: 64 * 1024, hostCalls: 16 } });
  t.after(() => runtime.dispose());
  const descriptor = runtime.contract.namespaces.find(item => item.name === 'model')?.methods.find(item => item.name === 'previewRoomDimensionChange');
  assert.equal(descriptor?.effect, 'draft-write');
  const activity: string[] = []; const previews: (ModelSnapshot | null)[] = [];
  const context: Parameters<typeof runtime.createSession>[0]['context'] = { base: data.base, snapshot: data.base,
    binding: data.binding, signal: new AbortController().signal,
    onActivity: event => activity.push(event.stage), onPreview: snapshot => previews.push(snapshot) };
  const session = runtime.createSession({ context, capabilities: method => method.effect === 'read' });
  t.after(() => session.dispose());
  const outcome = await session.execute({ language: 'typescript', source: `await model.previewRoomDimensionChange(${JSON.stringify(data.input)}); return null;` });
  assert.equal(outcome.status, 'failed', JSON.stringify(outcome));
  assert.equal(outcome.evidence.calls.find(item => item.method === 'model.previewRoomDimensionChange')?.disposition, 'denied');
  assert.deepEqual(activity, []); assert.deepEqual(previews, []); assert.equal(context.snapshot, data.base);
});

test('wall-only frozen scope cannot write adjacent read-only rooms or uplift its authority', async () => {
  const data = await setup(); const scope = scopeFor(data, [data.input.wallId]); const frozen = JSON.stringify(scope);
  const previews: (ModelSnapshot | null)[] = [];
  const result = await run(data, `
    const before = await model.scope();
    try { await model.previewRoomDimensionChange(${JSON.stringify(data.input)}); throw new Error('Unauthorized adjacent room write.'); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError' || !error.message.includes('Out-of-scope entity write')) throw error; }
    const after = await model.scope();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('Frozen scope/draft changed.');
    return {kind:'observe',observation:'scope unchanged'};
  `, { scope, onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'observation', JSON.stringify(result));
  assert.deepEqual(result.evidence.calls.map(item => item.disposition), ['completed', 'app-error', 'completed']);
  assert.deepEqual(previews, [null, null]); assert.equal(JSON.stringify(scope), frozen);
});

test('explicit partition and adjacent-room targets stage a scoped dimension proposal without expanding reads', async () => {
  const data = await setup(); const expected = previewRoomDimensionChange(data.base, data.input);
  assert.equal(expected.status, 'ready'); if (expected.status !== 'ready') return;
  const scope = scopeFor(data, expected.delta.entities.modified.map(item => item.id)); const frozen = JSON.stringify(scope);
  const readable = modelWorkingGraph(data.base, scope).entities.map(item => item.id);
  const result = await run(data, `
    const ready = await model.previewRoomDimensionChange(${JSON.stringify(data.input)});
    if (ready.status !== 'ready') throw new Error('Not ready.');
    if (ready.model.entities.some(item => !${JSON.stringify(readable)}.includes(item.id))) throw new Error('Escaped model scope.');
    if (ready.dependencies.some(item => !${JSON.stringify(readable)}.includes(item.id))) throw new Error('Escaped dependency scope.');
    ${propose}
  `, { scope });
  assert.equal(result.kind, 'proposal', JSON.stringify(result)); if (result.kind === 'proposal') assert.deepEqual(result.snapshot, expected.snapshot);
  assert.equal(JSON.stringify(scope), frozen);
});

test('unreadable named minimum constraints cannot expose dimensions outside frozen scope', async () => {
  const data = await setup(multiStoreySnapshot(), { roomId: 'level-ground-west', wallId: 'level-ground-wall-inner', axis: 'x',
    measurement: { kind: 'confirmed', metres: 4.2, sourceRef: 'opaque' }, minimumClearSpans: [] });
  const scope = scopeFor(data, [data.input.wallId, 'level-ground-west', 'level-ground-east']);
  const hidden = data.base.entities.find(item => item.type === 'Space' && !modelWorkingGraph(data.base, scope).entities.some(visible => visible.id === item.id));
  assert.ok(hidden, 'fixture must include a room outside the readable closure');
  const result = await run(data, `
    try { await model.previewRoomDimensionChange({...${JSON.stringify(data.input)},minimumClearSpans:[{roomId:${JSON.stringify(hidden.id)},axis:'x',metres:1}]}); throw new Error('Read outside scope.'); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError' || !error.message.includes('readable within the frozen model scope')) throw error; }
    return {kind:'observe',observation:'outside read refused'};
  `, { scope });
  assert.equal(result.kind, 'observation', JSON.stringify(result)); assert.equal(result.evidence.calls[0]?.disposition, 'app-error');
});

test('dimension previews retain abort and host-call budget fences', async t => {
  const data = await setup(); const bytes = JSON.stringify(data.base);
  const limited = new ModelScripts({ hostCalls: 1 }); t.after(() => limited.dispose());
  const previews: (ModelSnapshot | null)[] = [];
  const result = await limited.run({ base: data.base, binding: data.binding, language: 'typescript',
    source: `await model.previewRoomDimensionChange(${JSON.stringify(data.input)}); await model.inspect(); ${propose}`,
    signal: new AbortController().signal, remainingHostCalls: 24, onActivity: () => {}, onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.kind, 'failed', JSON.stringify(result)); assert.equal(result.evidence.status, 'resource-limit');
  assert.equal(result.evidence.disposition, 'discarded'); assert.equal(previews.at(-1), null);
  const controller = new AbortController(); const cancelledPreviews: (ModelSnapshot | null)[] = [];
  const cancelled = await scripts.run({ base: data.base, binding: data.binding, language: 'typescript',
    source: `await model.previewRoomDimensionChange(${JSON.stringify(data.input)}); ${propose}`,
    signal: controller.signal, remainingHostCalls: 24,
    onActivity: event => { if (event.stage === 'validated') controller.abort(); }, onPreview: snapshot => cancelledPreviews.push(snapshot) });
  assert.equal(cancelled.kind, 'failed', JSON.stringify(cancelled)); assert.equal(cancelled.evidence.disposition, 'discarded');
  assert.deepEqual(cancelledPreviews, [null, null]); assert.equal(JSON.stringify(data.base), bytes);
});
