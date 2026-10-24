import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ModelScripts } from './model-script.ts';
import { prepareModelProposal, MODEL_PROPOSAL_TOOLS } from './model-proposal.ts';
import type { ModelWorker, ModelWorkerSession } from './model-proposal.ts';
import { RoomRepository, rectangleLayout, diffSnapshots } from './room-model.ts';
import { createResidentialProject } from './residential-floor.ts';
import type { ScriptExecutionEvidence } from './script-evidence.ts';

const review = { summary: 'Widen the entry.', rationale: 'The requested door fits its existing host.',
  constraints: 'Retain the shell, hosted objects and unaffected furniture.', uncertainty: 'Concept model requiring human review.' };
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
