import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ModelScripts } from './model-script.ts';
import { prepareModelProposal } from './model-proposal.ts';
import type { ModelWorker } from './model-proposal.ts';
import { RoomRepository } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';
import { GeometryEvidenceConflict, GeometryEvidenceSession, readGeometryEvidence } from './geometry-evidence.ts';
import { GeometrySessionError } from './geometry-session.ts';
import { GeometryEvidenceLimitError } from './geometry-evidence-contract.ts';
import { FixtureGeometrySource, evidenceWall, geometryProposalScript } from './geometry-evidence.fixture.ts';
import type { ScriptExecutionEvidence } from './script-evidence.ts';
import type { ActivityUpdate } from './request-activity.ts';

function request(repository: RoomRepository) {
  return { requestId: 'geometry-preseal', proposalName: 'geometry-preseal', baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-west'], instruction: 'Place the requested cube 500 mm clear of the inspected wall.', visualIntent: { kind: 'selection' } };
}
function worker(run: ModelWorker['run']): ModelWorker {
  return { identity: { provider: 'test', model: 'geometry-preseal-scriptbox' }, run };
}
const unsafeScript = geometryProposalScript.replace('position:[1,2]', 'position:[.75,2]');

for (const condition of ['fatal preseal failure', 'complete correctable preseal failure']) {
  test(`throwing activity sink during ${condition} stays fatal and redacts persistence details`, async t => {
    const repository = await RoomRepository.create(); const accepted = repository.serialize();
    const scripts = new ModelScripts(); t.after(() => scripts.dispose());
    const database = new DatabaseSync(':memory:'); t.after(() => database.close());
    database.exec(`CREATE TABLE activity(stage TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TRIGGER reject_failure_activity BEFORE INSERT ON activity WHEN NEW.stage = 'validation-failed'
      BEGIN SELECT RAISE(ABORT, 'PRIVATE_ACTIVITY_SINK_DETAIL'); END;`);
    const insertActivity = database.prepare('INSERT INTO activity(stage, body) VALUES(?, ?)');
    const executions: ScriptExecutionEvidence[] = []; const activities: ActivityUpdate[] = [];
    const previews: (ModelSnapshot | null)[] = []; const outputs: unknown[] = [];
    let sinkFailures = 0;
    const activity = (event: ActivityUpdate): void => {
      try { insertActivity.run(event.stage, JSON.stringify(event)); }
      catch (error) {
        sinkFailures += 1;
        database.exec('DROP TRIGGER reject_failure_activity');
        throw error;
      }
      activities.push(event);
    };
    if (condition === 'fatal preseal failure') t.mock.method(GeometryEvidenceSession.prototype, 'seal', async () => {
      throw new GeometrySessionError('deadline', 'Geometry operation exceeded its hard worker deadline.');
    });
    await assert.rejects(prepareModelProposal(repository, request(repository), worker(async session => {
      const output = await session.executeTool('run_model_script', { language: 'typescript', source: unsafeScript });
      outputs.push(output);
      assert.equal(output.ok, false, JSON.stringify(output));
      const failed = executions[0]; assert.ok(failed);
      assert.equal(failed.status, 'completed'); assert.equal(failed.disposition, 'discarded'); assert.equal(failed.validation, 'failed');
      assert.equal(failed.diagnostic?.code, 'host-failure');
      assert.equal(failed.diagnostic?.message, 'Host proposal validation failed. Staged changes discarded.');
      assert.deepEqual(output.execution, failed);
      assert.equal(previews.at(-1), null); assert.equal(repository.serialize(), accepted);
      assert.ok(!JSON.stringify({ output, activities, executions }).includes('PRIVATE_ACTIVITY_SINK_DETAIL'));
      const replay = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
      outputs.push(replay); assert.equal(replay.ok, false, JSON.stringify(replay));
    }), activity, { geometry: { source: new FixtureGeometrySource() }, scripts,
      onExecution: evidence => executions.push(evidence), onPreview: snapshot => previews.push(snapshot) }), /authority|ended/);
    assert.equal(sinkFailures, 1, 'The actual SQLite write fails once; later writes recover.');
    assert.equal(executions.length, 1, 'A failed activity write must revoke subsequent scripts.');
    assert.ok(previews.some(snapshot => snapshot !== null)); assert.equal(previews.at(-1), null);
    assert.equal(repository.serialize(), accepted); assert.equal(repository.head('main'), request(repository).baseRevisionId);
    const persistedActivities = database.prepare('SELECT body FROM activity').all();
    assert.ok(!JSON.stringify({ outputs, activities, persistedActivities, executions }).includes('PRIVATE_ACTIVITY_SINK_DETAIL'));
  });
}

test('the worker receives final geometry failure before success and corrects its complete script without losing history', async t => {
  const repository = await RoomRepository.create(); const accepted = repository.serialize();
  const source = new FixtureGeometrySource(); const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  const executions: ScriptExecutionEvidence[] = []; const previews: (ModelSnapshot | null)[] = [];
  const activities: ActivityUpdate[] = [];
  const result = await prepareModelProposal(repository, request(repository), worker(async session => {
    const first = await session.executeTool('run_model_script', { language: 'typescript', source: unsafeScript });
    assert.equal(first.ok, false, JSON.stringify(first)); assert.equal(first.done, undefined);
    const failed = executions[0]; assert.ok(failed);
    assert.equal(failed.status, 'completed'); assert.equal(failed.disposition, 'discarded'); assert.equal(failed.validation, 'failed');
    assert.equal(failed.diagnostic?.code, 'invalid-proposal'); assert.deepEqual(first.execution, failed);
    assert.ok(failed.diagnostic); assert.match(failed.diagnostic.message, /\[clearance-violated\]/);
    assert.ok(activities.some(event => event.stage === 'validation-failed' && event.message === failed.diagnostic?.message));
    assert.equal(previews.at(-1), null); assert.equal(repository.serialize(), accepted);
    const corrected = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
    assert.equal(corrected.ok, true, JSON.stringify(corrected)); assert.equal(corrected.done, true);
    assert.equal(repository.serialize(), accepted);
  }), event => activities.push(event), { geometry: { source }, scripts, onExecution: evidence => executions.push(evidence), onPreview: snapshot => previews.push(snapshot) });
  assert.equal(result.status, 'ready'); assert.equal(repository.serialize(), accepted);
  assert.equal(result.repository.head('main'), repository.head('main'));
  assert.equal(executions.length, 2); assert.equal(executions[1]?.disposition, 'proposal'); assert.equal(executions[1]?.validation, 'passed');
  const review = result.repository.review('geometry-preseal');
  assert.deepEqual(review.scriptExecutions, executions);
  const evidence = readGeometryEvidence(review.geometryEvidence);
  assert.equal(evidence.measurements.length, 2, 'both attempts retain their host observations');
  assert.ok(evidence.receipts.some(receipt => receipt.reads.some(read => read.kind === 'query')));
  assert.ok(previews.some(snapshot => snapshot !== null)); assert.equal(previews.at(-1), null);
});

test('a source change after a correctable failure revokes further scripts instead of clearing prior observations', async t => {
  const repository = await RoomRepository.create(); const accepted = repository.serialize();
  const source = new FixtureGeometrySource(); const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  const executions: ScriptExecutionEvidence[] = [];
  await assert.rejects(prepareModelProposal(repository, request(repository), worker(async session => {
    const first = await session.executeTool('run_model_script', { language: 'typescript', source: unsafeScript });
    assert.equal(first.ok, false, JSON.stringify(first));
    assert.equal(executions[0]?.diagnostic?.code, 'invalid-proposal');
    source.replace([evidenceWall({ version: 'changed-after-failure', x: .1 })]);
    const second = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
    assert.equal(second.ok, false, JSON.stringify(second));
    const third = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
    assert.equal(third.ok, false, JSON.stringify(third));
  }), () => {}, { geometry: { source }, scripts, onExecution: evidence => executions.push(evidence) }), /authority|geometry|Geometry|changed/);
  assert.equal(executions.length, 1); assert.equal(repository.serialize(), accepted);
});

test('outer geometry sealing still rejects relevant changes after the worker receives a validated proposal', async t => {
  const repository = await RoomRepository.create(); const accepted = repository.serialize();
  const source = new FixtureGeometrySource(); const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  await assert.rejects(prepareModelProposal(repository, request(repository), worker(async session => {
    const output = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
    assert.equal(output.ok, true, JSON.stringify(output));
    source.replace([evidenceWall({ version: 'changed-after-tool-success', x: .1 })]);
  }), () => {}, { geometry: { source }, scripts }), /geometry|Geometry|changed|observation|measurement/);
  assert.equal(repository.serialize(), accepted);
});

test('fatal host geometry failures retain discarded execution evidence and cannot be repaired by another script', async t => {
  const scripts = new ModelScripts(); t.after(() => scripts.dispose());
  const failures = [
    new GeometryEvidenceConflict('Inspected geometry changed.'),
    new GeometryEvidenceLimitError(65537, 1, 1),
    new GeometrySessionError('deadline', 'Geometry operation exceeded its hard worker deadline.'),
    new GeometrySessionError('worker-failed', 'Geometry worker rejected its input or operation.'),
    new GeometrySessionError('invalid-reply', 'Geometry result/receipt does not match the dispatched operation.'),
    new GeometrySessionError('closed', 'Geometry session call budget exhausted.'),
    new GeometrySessionError('aborted', 'Geometry authority was revoked.'),
    new Error('PRIVATE raw handler details must not cross the script boundary'),
  ];
  for (const failure of failures) await t.test(failure.message, async child => {
    const repository = await RoomRepository.create(); const accepted = repository.serialize();
    const executions: ScriptExecutionEvidence[] = []; const previews: (ModelSnapshot | null)[] = [];
    const activities: ActivityUpdate[] = [];
    const original = GeometryEvidenceSession.prototype.seal; let seals = 0;
    child.mock.method(GeometryEvidenceSession.prototype, 'seal', async function (this: GeometryEvidenceSession, candidate: ModelSnapshot) {
      if (++seals === 1) throw failure;
      return original.call(this, candidate);
    });
    await assert.rejects(prepareModelProposal(repository, request(repository), worker(async session => {
      const output = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
      assert.equal(output.ok, false, JSON.stringify(output));
      const evidence = executions[0]; assert.ok(evidence);
      assert.equal(evidence.status, 'completed'); assert.equal(evidence.disposition, 'discarded'); assert.equal(evidence.validation, 'failed');
      assert.equal(evidence.diagnostic?.code, 'host-failure'); assert.deepEqual(output.execution, evidence);
      if (failure.constructor === Error) assert.ok(!JSON.stringify(output).includes('PRIVATE'));
      else assert.equal(evidence.diagnostic?.message, failure.message);
      assert.ok(activities.some(event => event.stage === 'validation-failed' && event.message === evidence.diagnostic?.message));
      assert.ok(!JSON.stringify(activities).includes('PRIVATE'));
      assert.equal(previews.at(-1), null);
      const replay = await session.executeTool('run_model_script', { language: 'typescript', source: geometryProposalScript });
      assert.equal(replay.ok, false, JSON.stringify(replay));
    }), event => activities.push(event), { geometry: { source: new FixtureGeometrySource() }, scripts,
      onExecution: evidence => executions.push(evidence), onPreview: snapshot => previews.push(snapshot) }), /authority|ended/);
    assert.equal(seals, 1); assert.equal(executions.length, 1); assert.equal(repository.serialize(), accepted);
    assert.ok(!JSON.stringify(activities).includes('PRIVATE'));
  });
});
