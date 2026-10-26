import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ModelScripts } from './model-script.ts';
import { prepareModelProposal, MODEL_PROPOSAL_TOOLS, validateModelProposalRequest } from './model-proposal.ts';
import type { ModelWorker, ModelWorkerSession } from './model-proposal.ts';
import { RoomRepository, rectangleLayout, diffSnapshots, validateSnapshot } from './room-model.ts';
import { multiStoreySnapshot } from './multi-storey-house.ts';
import { freezeModelScope } from './model-scope.ts';
import type { ModelScopeQuery } from './model-scope-contract.ts';
import { createResidentialProject } from './residential-floor.ts';
import type { ScriptExecutionEvidence } from './script-evidence.ts';
import { MODEL_INTENT_GUIDANCE, parseIntentAssessment } from './model-intent.ts';

const review = { summary: 'Widen the entry.', rationale: 'The requested door fits its existing host.',
  constraints: 'Retain the shell, hosted objects and unaffected furniture.', uncertainty: 'Concept model requiring human review.',
  intent: { interpretation: 'Widen the selected entry.', assumptions: [], certainty: 90, basis: 'The deterministic test request specifies the width.' } };
const propose = `return {kind:'propose',review:${JSON.stringify(review)}};`;
const observe = "return {kind:'observe',observation:await model.inspect()};";
function request(repo: RoomRepository, id: string) {
  return { requestId: id, proposalName: id, baseRevisionId: repo.head('main'), selectedObjectIds: ['door-entry'],
    instruction: 'Widen the entry to 1200 mm.', visualIntent: { kind: 'selection' } };
}
function widen(width = 1200) {
  return `const view = await model.inspect(); const layout = view.placement.layout;
    if (!layout) throw new Error('Single room required.');
    await model.previewRectangle({...layout,door:{...layout.door,widthMm:${width}}});`;
}
function worker(run: (session: ModelWorkerSession) => Promise<void>): ModelWorker {
  return { identity: { provider: 'test', model: 'scriptbox-parity-agent' }, run };
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

test('the only executable tool uses real typed scripts; evidence, delta and explicit human acceptance survive restore', async () => {
  const repo = await RoomRepository.create('Script acceptance'); const original = repo.serialize();
  const source = `${widen()}\n${propose}`;
  const result = await prepareModelProposal(repo, request(repo, 'script-acceptance'), worker(async (session) => {
    assert.deepEqual(MODEL_PROPOSAL_TOOLS.map((tool) => tool.name), ['run_model_script']);
    assert.match(session.instructions, /declare const model:/);
    const output = await session.executeTool('run_model_script', { language: 'typescript', source });
    assert.equal(output.ok, true, JSON.stringify(output)); assert.equal(output.done, true);
  }));
  assert.equal(result.status, 'ready'); assert.equal(repo.serialize(), original);
  assert.equal(result.repository.head('main'), repo.head('main'));
  const evidence = result.repository.review('script-acceptance').scriptExecutions;
  assert.equal(evidence?.length, 1); assert.equal(evidence?.[0]?.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(evidence?.[0]?.runtime.guestAbi, 2);
  assert.equal(evidence?.[0]?.disposition, 'proposal'); assert.equal(evidence?.[0]?.validation, 'passed');
  assert.deepEqual(evidence?.[0]?.calls.map((call) => call.method), ['model.inspect', 'model.previewRectangle']);
  const after = result.repository.view(result.repository.head('script-acceptance')).snapshot;
  assert.deepEqual(diffSnapshots(repo.view(repo.head('main')).snapshot, after).entities.modified.map((item) => item.id), ['door-entry']);
  const accepted = result.repository.accept('script-acceptance', { decisionId: 'accept-script', actor: 'Human reviewer' });
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
  assert.equal(rectangleLayout(accepted.view(accepted.head('main')).snapshot).door.widthMm, 1200);
});

test('intent assumptions and self-rated certainty survive script review, acceptance and exact restore without approval authority', async () => {
  const repo = await RoomRepository.create('Interpreted intent');
  const intent = { interpretation: 'Use the requested wider entry.', assumptions: ['Keep the existing door height.'],
    certainty: 35, basis: 'The width is explicit, but the reason for the change is not.' };
  const result = await prepareModelProposal(repo, request(repo, 'intent-review'), worker(async session => {
    assert.ok(session.instructions.includes(MODEL_INTENT_GUIDANCE));
    const { intent: omitted, ...withoutIntent } = review; assert.ok(omitted);
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source:
      `${widen()} return {kind:'propose',review:${JSON.stringify(withoutIntent)}};` })).ok, false, 'fresh proposals must not silently omit intent assessment');
    const output = await session.executeTool('run_model_script', { language: 'typescript', source:
      `${widen()} return {kind:'propose',review:${JSON.stringify({ ...review, intent })}};` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }));
  assert.equal(result.status, 'ready', 'a low self-rated score does not block a valid reviewable proposal');
  assert.deepEqual(result.repository.review('intent-review').intent, intent);
  assert.equal(result.repository.head('main'), repo.head('main'), 'a score never authorizes acceptance');
  const accepted = result.repository.accept('intent-review', { decisionId: 'human-intent-decision', actor: 'reviewer' });
  const restored = await RoomRepository.restore(accepted.serialize());
  assert.equal(restored.serialize(), accepted.serialize());
  assert.deepEqual(restored.review('intent-review').intent, intent);
  const tampered: unknown = JSON.parse(accepted.serialize());
  assert.ok(object(tampered) && Array.isArray(tampered.reviews));
  const altered = tampered.reviews.find((item: unknown) => object(item) && item.proposalName === 'intent-review');
  assert.ok(object(altered) && object(altered.intent)); altered.intent.certainty = 101;
  await assert.rejects(RoomRepository.restore(JSON.stringify(tampered)), /Intent certainty/);
});

test('certainty is bounded plain review data rather than an approval threshold', () => {
  const assessment = { interpretation: 'Move the selected item.', assumptions: ['Keep unrelated items unchanged.'], certainty: 50, basis: 'Selection and local geometry support this interpretation.' };
  for (const certainty of [0, 35, 100]) assert.equal(parseIntentAssessment({ ...assessment, certainty }).certainty, certainty);
  for (const certainty of [-1, 101, 50.5, NaN, Infinity, '80', null]) assert.throws(() => parseIntentAssessment({ ...assessment, certainty }));
  for (const invalid of [{ ...assessment, extra: true }, { ...assessment, assumptions: Array(9).fill('Assumed.') },
    { ...assessment, assumptions: ['a'.repeat(161)] }, { ...assessment, interpretation: '' }, { ...assessment, basis: '\u0085hidden' }]) assert.throws(() => parseIntentAssessment(invalid));
  const accessor = { ...assessment };
  Object.defineProperty(accessor, 'certainty', { get() { throw new Error('Accessor must not run.'); }, enumerable: true });
  assert.throws(() => parseIntentAssessment(accessor), /plain data/);
  const sparse = new Array<string>(1);
  assert.throws(() => parseIntentAssessment({ ...assessment, assumptions: sparse }));
  const source = { ...assessment, assumptions: ['A bounded choice.'] };
  const parsed = parseIntentAssessment(source); source.assumptions[0] = 'Changed outside the boundary.';
  assert.deepEqual(parsed.assumptions, ['A bounded choice.']); assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.assumptions));
});

test('high intent certainty cannot bypass geometry validation and decline metadata never mutates the model', async () => {
  const repo = await RoomRepository.create('Certainty is not authority');
  const intent = { interpretation: 'Use the requested entry width.', assumptions: [], certainty: 100, basis: 'The instruction explicitly names the width.' };
  const result = await prepareModelProposal(repo, request(repo, 'intent-boundaries'), worker(async session => {
    const failed = await session.executeTool('run_model_script', { language: 'typescript', source:
      `${widen(100000)} return {kind:'propose',review:${JSON.stringify({ ...review, intent })}};` });
    assert.equal(failed.ok, false);
    const declined = await session.executeTool('run_model_script', { language: 'typescript', source:
      `await model.inspect(); return {kind:'decline',reason:'The requested width cannot fit its host.',uncertainty:'Geometry is invalid, regardless of intent certainty.',intent:${JSON.stringify(intent)}};` });
    assert.equal(declined.ok, true);
  }));
  assert.equal(result.status, 'declined'); assert.equal(result.repository.serialize(), repo.serialize()); assert.deepEqual(result.review.intent, intent);
});

test('write then throw rolls back; the next observation and corrected script start from the immutable base', async () => {
  const repo = await RoomRepository.create('Rollback');
  const records: ScriptExecutionEvidence[] = [];
  const result = await prepareModelProposal(repo, request(repo, 'rollback-script'), worker(async (session) => {
    const failed = await session.executeTool('run_model_script', { language: 'javascript', source: `${widen(1400)} throw new Error('abort this draft');` });
    assert.equal(failed.ok, false);
    const inspection = await session.executeTool('run_model_script', { language: 'typescript', source: observe });
    assert.equal(inspection.ok, true, JSON.stringify(inspection));
    const value = inspection.observation;
    assert.ok(object(value) && object(value.placement) && object(value.placement.layout) && object(value.placement.layout.door));
    assert.equal(value.placement.layout.door.widthMm, 900);
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: `${widen()} ${propose}` })).ok, true);
  }), () => {}, { onExecution: (record) => records.push(record) });
  assert.equal(result.status, 'ready');
  assert.deepEqual(records.map((record) => record.disposition), ['discarded', 'observation', 'proposal']);
  assert.equal(rectangleLayout(repo.view(repo.head('main')).snapshot).door.widthMm, 900);
});

test('a caught invalid geometry operation leaves no partial write and can be repaired in the same script', async () => {
  const repo = await RoomRepository.create('Repair invalid geometry');
  const result = await prepareModelProposal(repo, request(repo, 'repair-script'), worker(async (session) => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const view = await model.inspect(); const layout = view.placement.layout;
      if (!layout) throw new Error('Single room required.');
      try { await model.previewRectangle({...layout,door:{...layout.door,widthMm:100000}}); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; }
      const untouched = await model.inspect();
      if (untouched.placement.layout?.door.widthMm !== 900) throw new Error('Partial invalid write.');
      await model.previewRectangle({...layout,door:{...layout.door,widthMm:1200}});
      ${propose}
    ` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }));
  assert.equal(result.status, 'ready');
  assert.ok(result.repository.review('repair-script').scriptExecutions?.[0]?.calls.some((call) => call.disposition === 'app-error'));
});

test('observation and decline discard staged geometry rather than persisting an implicit checkpoint', async () => {
  const repo = await RoomRepository.create('No hidden checkpoint'); const original = repo.serialize();
  const result = await prepareModelProposal(repo, request(repo, 'discard-observation'), worker(async (session) => {
    assert.equal((await session.executeTool('run_model_script', { language: 'javascript', source: `${widen(1400)} ${observe}` })).ok, true);
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const view = await model.inspect();
      if (view.placement.layout?.door.widthMm !== 900) throw new Error('Checkpoint leaked.');
      return {kind:'decline',reason:'Which width should the entry have?',uncertainty:'The instruction needs clarification.'};
    ` });
    assert.equal(output.done, true, JSON.stringify(output));
  }));
  assert.equal(result.status, 'declined'); assert.equal(result.repository.serialize(), original);
});

test('caught forbidden host access poisons the attempt and cannot be followed by a proposal', async () => {
  const repo = await RoomRepository.create('No commit capability');
  await assert.rejects(() => prepareModelProposal(repo, request(repo, 'forbidden-script'), worker(async (session) => {
    const output = await session.executeTool('run_model_script', { language: 'javascript', source: `
      try { await __scriptbox.hostCall('model.accept', []); } catch (_) {}
      ${widen()} ${propose}
    ` });
    assert.equal(output.ok, false);
    assert.equal((await session.executeTool('run_model_script', { language: 'javascript', source: `${widen()} ${propose}` })).ok, false);
  })), /lost execution authority/);
  assert.equal(repo.branches().length, 1);
});

test('an ordinary guest exception cannot hide a caught forbidden call or restore proposal authority', async () => {
  const repo = await RoomRepository.create('Sticky integrity failure');
  await assert.rejects(() => prepareModelProposal(repo, request(repo, 'sticky-integrity'), worker(async (session) => {
    const output = await session.executeTool('run_model_script', { language: 'javascript', source: `
      try { await __scriptbox.hostCall('model.accept', []); } catch (_) {}
      throw new Error('ordinary script error');
    ` });
    assert.equal(output.ok, false);
    const retry = await session.executeTool('run_model_script', { language: 'javascript', source: `${widen()} ${propose}` });
    assert.equal(retry.ok, false, 'host denial remains fatal even when the final guest error is ordinary');
  })), /lost execution authority/);
  assert.equal(repo.branches().length, 1);
});

test('hostile method names and diagnostic controls still produce bounded durable failure evidence', async () => {
  for (const source of ["await __scriptbox.hostCall(' ', []);", "await __scriptbox.hostCall('\\u007f', []);", "throw new Error('\\u007f\\u0085');"]) {
    const repo = await RoomRepository.create('Evidence normalization');
    const records: ScriptExecutionEvidence[] = [];
    await assert.rejects(() => prepareModelProposal(repo, request(repo, 'hostile-evidence'), worker(async (session) => {
      assert.equal((await session.executeTool('run_model_script', { language: 'javascript', source })).ok, false);
    }), () => {}, { onExecution: (record) => records.push(record) }));
    assert.equal(records.length, 1, 'every terminal runtime outcome reaches the durable evidence callback');
    assert.equal(records[0]?.disposition, 'discarded');
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(JSON.stringify(records[0])));
  }
});

test('a resource limit after a write discards it and prevents ready publication through the proposal application', async (t) => {
  const repo = await RoomRepository.create('Hard budget rollback');
  const scripts = new ModelScripts({ hostCalls: 2 }); t.after(() => scripts.dispose());
  const records: ScriptExecutionEvidence[] = [];
  await assert.rejects(() => prepareModelProposal(repo, request(repo, 'resource-script'), worker(async (session) => {
    const output = await session.executeTool('run_model_script', { language: 'javascript', source: `${widen()} await model.inspect(); ${propose}` });
    assert.equal(output.ok, false);
  }), () => {}, { scripts, onExecution: (record) => records.push(record) }), /lost execution authority/);
  assert.equal(records[0]?.status, 'resource-limit'); assert.equal(records[0]?.disposition, 'discarded');
  assert.equal(rectangleLayout(repo.view(repo.head('main')).snapshot).door.widthMm, 900);
  assert.equal(repo.branches().length, 1);
});

test('cancelling one execution cannot affect another pending request sharing the runtime', async (t) => {
  const repo = await RoomRepository.create('Independent cancellation');
  const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  const controller = new AbortController(); const firstRecords: ScriptExecutionEvidence[] = [];
  const first = prepareModelProposal(repo, request(repo, 'cancelled-script'), worker(async (session) => {
    await session.executeTool('run_model_script', { language: 'javascript', source: `${widen(1400)} while (true) {}` });
  }), (event) => { if (event.stage === 'validated') controller.abort(); },
  { scripts, signal: controller.signal, onExecution: (record) => firstRecords.push(record) });
  const rejected = assert.rejects(first, /cancel|abort/i);
  const second = await prepareModelProposal(repo, request(repo, 'independent-script'), worker(async (session) => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `${widen()} ${propose}` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }), () => {}, { scripts });
  await rejected;
  assert.equal(second.status, 'ready'); assert.equal(firstRecords.length, 1); assert.equal(firstRecords[0]?.disposition, 'discarded');
  assert.equal(repo.branches().length, 1);
});

test('provider failure after a valid scripted proposal still publishes nothing', async () => {
  const repo = await RoomRepository.create('Provider rollback'); const original = repo.serialize();
  await assert.rejects(() => prepareModelProposal(repo, request(repo, 'provider-failure'), worker(async (session) => {
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: `${widen()} ${propose}` })).ok, true);
    throw new Error('provider disconnected');
  })), /provider disconnected/);
  assert.equal(repo.serialize(), original);
});

test('inspection retains room memberships, doorway connections, coordinates and generated docs in the real package', async () => {
  const repo = await createResidentialProject('Inspection parity');
  const input = { ...request(repo, 'floor-inspection'), selectedObjectIds: ['room-office'] };
  const result = await prepareModelProposal(repo, input, worker(async (session) => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const view = await model.inspect();
      if (view.placement.rooms.length !== 8 || view.placement.doorConnections.length !== 8) throw new Error('Missing floor context.');
      const furnishings = view.model.entities.filter(item => item.type === 'Furniture');
      if (!furnishings.some(item => item.id === 'office-plant')) throw new Error('Typed entity arrays lost furnishing data.');
      const room = view.placement.rooms.find(room => room.id === 'room-office');
      if (!room?.entityIds.includes('office-plant')) throw new Error('Missing actual room membership.');
      if (view.placement.levels.length !== 1 || view.placement.selectedLevelId !== room.levelId) throw new Error('Missing bound legacy floor context.');
      const plant = view.placement.entities.find(item => item.entityId === 'office-plant');
      if (plant?.levelId !== room.levelId || plant.elevation !== 0) throw new Error('Missing legacy ownership inspection.');
      if (view.placement.layout !== null) throw new Error('Multi-room floor cannot be resized as one rectangle.');
      const guide = await docs.read('/guides/model.md');
      if (!JSON.stringify(guide).includes('millimetres')) throw new Error('Missing API guide.');
      return {kind:'decline',reason:'Inspection complete; no change requested.',uncertainty:'No proposal to review.'};
    ` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }));
  assert.equal(result.status, 'declined');
});

test('returned snapshots, forged evidence, empty deltas and legacy executable authoring tools are rejected', async () => {
  const repo = await RoomRepository.create('No result injection');
  await assert.rejects(() => prepareModelProposal(repo, request(repo, 'forged-return'), worker(async (session) => {
    assert.equal((await session.executeTool('preview_rectangle', rectangleLayout(repo.view(repo.head('main')).snapshot))).ok, false);
    assert.equal((await session.executeTool('run_model_script', { language: 'javascript', source: `return {kind:'propose',review:${JSON.stringify(review)},snapshot:{},evidence:{}};` })).ok, false);
    assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: propose })).ok, false);
  })), /without proposing|lost execution/);
  assert.equal(repo.branches().length, 1);
});

test('a scoped room script inspects only frozen working context, fences old tools and preserves supported devices and unrelated metadata', async () => {
  const source = await createResidentialProject('Scoped room');
  const original = source.view(source.head('main')).snapshot;
  const repo = await RoomRepository.createProject({ projectId: source.projectId, name: source.name,
    snapshot: validateSnapshot({ ...original, entities: original.entities.map(item => item.id === 'living-table'
      ? { ...item, parameters: [{ definitionId: 'inspection-interval', name: 'Inspection interval', value: { kind: 'duration', value: 30, unit: 'min' } }] } : item) }) });
  const base = repo.view(repo.head('main')).snapshot;
  const query: ModelScopeQuery = { version: 1, allOf: [{ kind: 'in-spaces', spaceIds: ['room-office'] },
    { kind: 'entity-type', entityType: 'Furniture' }], anyOf: [], excludeIds: [] };
  const input = { ...request(repo, 'scope-room'), selectedObjectIds: ['room-office'], scope: { query }, instruction: 'Move only the office chair 100 mm east.' };
  const living = base.entities.filter(item => item.type === 'Furniture' && item.id.startsWith('living-'))
    .map(item => { const { parameters, ...body } = item; return item.id === 'living-plant' ? { ...body, height: 1.1 } : body; });
  const activity: string[] = [];
  const result = await prepareModelProposal(repo, input, worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const binding = await model.scope();
      if (!binding.scope || !binding.scope.targetIds.includes('office-chair')) throw new Error('Missing frozen targets.');
      const ids = [...binding.scope.targetIds,...binding.scope.contextIds,...binding.scope.dependentIds,...binding.scope.writableIds];
      if (binding.graph.entities.some(item => !ids.includes(item.id))) throw new Error('Full-project read escaped scope.');
      const view = await model.inspect();
      if (view.model.entities.map(item => item.id).join() !== binding.graph.entities.map(item => item.id).join()) throw new Error('Inspection escaped working graph.');
      let refused = false;
      try { await model.previewRoomFurnishings({roomId:'room-living',furnishings:${JSON.stringify(living)}}); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'ModelValidationError') throw error; refused = true; }
      if (!refused) throw new Error('Old room tool escaped write fence.');
      const room = view.placement.rooms.find(item => item.id === 'room-office');
      if (!room) throw new Error('Missing room context.');
      const furnishings = view.model.entities.filter(item => item.type === 'Furniture').filter(item => room.entityIds.includes(item.id))
        .map(item => ({id:item.id,type:item.type,name:item.name,kind:item.kind,position:item.id === 'office-chair' ? [item.position[0]+.1,item.position[1]] : item.position,
          width:item.width,depth:item.depth,height:item.height,rotationDeg:item.rotationDeg,supportId:item.supportId}));
      await model.previewRoomFurnishings({roomId:room.id,furnishings});
      ${propose}
    ` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }), event => activity.push(event.stage));
  assert.equal(result.status, 'ready');
  const stored = result.repository.review('scope-room');
  assert.deepEqual(stored.scope, freezeModelScope({ graph: base, query, baseRevisionId: repo.head('main') }));
  assert.ok(activity.includes('validation-failed')); assert.ok(activity.includes('validated'));
  assert.deepEqual(stored.scriptExecutions?.[0]?.calls.map(call => call.method),
    ['model.scope', 'model.inspect', 'model.previewRoomFurnishings', 'model.previewRoomFurnishings']);
  const after = result.repository.view(stored.proposalRevisionId).snapshot;
  assert.deepEqual(diffSnapshots(base, after).entities.modified.map(item => item.id), ['office-chair']);
  assert.deepEqual(after.entities.find(item => item.id === 'living-table'), base.entities.find(item => item.id === 'living-table'));
  assert.deepEqual(after.entities.find(item => item.id === 'office-monitor'), base.entities.find(item => item.id === 'office-monitor'));
  assert.deepEqual(validateSnapshot(after), after);
  assert.equal(result.repository.head('main'), repo.head('main'));
});

test('a real building-wide type script edits frozen plant dimensions in millimetres and typed duration metadata', async () => {
  const repo = await RoomRepository.createProject({ projectId: crypto.randomUUID(), name: 'Global scoped type', snapshot: multiStoreySnapshot() });
  const query: ModelScopeQuery = { version: 1, allOf: [{ kind: 'furniture-kind', furnitureKind: 'plant' }], anyOf: [], excludeIds: [] };
  const input = { ...request(repo, 'scope-parameter'), selectedObjectIds: ['level-ground-plant'], scope: { query }, instruction: 'Set every plant proxy height to 1200 mm and inspection interval to 2 h.' };
  const result = await prepareModelProposal(repo, input, worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: `
      const scoped = await model.scope(); const view = await model.inspect();
      if (scoped.scope?.targetIds.length !== 3) throw new Error('Expected one plant per level.');
      if (!view.parameters.some(item => item.parameters.some(parameter => parameter.definitionId === 'geometry-height' && parameter.value.kind === 'length' && parameter.value.unit === 'm'))) throw new Error('Missing typed units.');
      await model.previewParameters({edits:[{definitionId:'geometry-height',name:'height',value:{kind:'length',value:1200,unit:'mm'}},
        {definitionId:'inspection-interval',name:'Inspection interval',value:{kind:'duration',value:2,unit:'h'}}]});
      const live = await model.scope();
      if (live.graph.entities.some(item => item.type === 'Furniture' && item.kind === 'plant' && item.height !== 1.2)) throw new Error('Stale working graph.');
      ${propose}
    ` });
    assert.equal(output.ok, true, JSON.stringify(output));
  }));
  const reviewRecord = result.repository.review('scope-parameter');
  assert.equal(reviewRecord.scope?.targetIds.length, 3);
  const before = repo.view(repo.head('main')).snapshot;
  const after = result.repository.view(reviewRecord.proposalRevisionId).snapshot;
  const modified = diffSnapshots(before, after).entities.modified;
  assert.equal(modified.length, 3);
  for (const item of after.entities.filter(item => item.type === 'Furniture' && item.kind === 'plant')) {
    assert.equal(item.height, 1.2);
    assert.deepEqual(item.parameters, [{ definitionId: 'inspection-interval', name: 'Inspection interval', value: { kind: 'duration', value: 2, unit: 'h' } }]);
  }
  const accepted = result.repository.accept('scope-parameter', { decisionId: 'scope-parameter-human', actor: 'Human reviewer' });
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(), accepted.serialize());
});

test('scoped request validation rejects guest write authority and mismatched frozen script bindings before execution', async () => {
  const repo = await RoomRepository.create('No forged scope');
  const query: ModelScopeQuery = { version: 1, allOf: [{ kind: 'ids', ids: ['door-entry'] }], anyOf: [], excludeIds: [] };
  const input = { ...request(repo, 'scope-forgery'), scope: { query, writableIds: ['wall-south'] } };
  assert.throws(() => validateModelProposalRequest(repo, input), /scoped request/i);
  const bound = validateModelProposalRequest(repo, { ...request(repo, 'scope-frozen-input'), scope: { query } });
  assert.ok(bound.scope && Object.isFrozen(bound.scope) && Object.isFrozen(bound.scope.targetIds) && Object.isFrozen(bound.scope.query.allOf));
  let reads = 0;
  const accessor = Object.defineProperty({ ...request(repo, 'scope-accessor') }, 'scope', { enumerable: true,
    get() { reads += 1; return { query }; } });
  assert.throws(() => validateModelProposalRequest(repo, accessor), /accessor/i); assert.equal(reads, 0);
  const scripts = new ModelScripts();
  try {
    const scope = freezeModelScope({ graph: repo.view(repo.head('main')).snapshot, query, baseRevisionId: repo.head('main') });
    await assert.rejects(() => scripts.run({ base: repo.view(repo.head('main')).snapshot,
      binding: { baseRevisionId: repo.head('main'), selectedObjectIds: [], visualIntent: { kind: 'selection' }, scope: { ...scope, writableIds: [] } },
      language: 'typescript', source: `${widen()} ${propose}`, signal: new AbortController().signal, remainingHostCalls: 16, onActivity: () => {} }), /scope/i);
  } finally { await scripts.dispose(); }
});
