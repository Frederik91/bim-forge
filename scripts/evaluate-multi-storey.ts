import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAccountConnection } from '../src/codex-app-server.ts';
import { ChangeRequests } from '../demo/change-requests.ts';
import { RoomRepository, diffSnapshots, validateSnapshot } from '../src/room-model.ts';
import { levels, levelView } from '../src/building-levels.ts';

// Manual evaluation with the existing server sign-in; synthetic project and separate backlog only.
const output = process.env.BIM_BUILDING_EVIDENCE;
if (!output || !path.isAbsolute(output)) throw new Error('Set BIM_BUILDING_EVIDENCE to an absolute evaluation directory.');
await mkdir(output, { recursive: true });
const codex = await CodexAccountConnection.open();
if (!codex.publicSession().connected) { codex.close(); throw new Error('Connect the server ChatGPT session first.'); }
const queue = await ChangeRequests.open(path.join(output, `evaluation-${randomUUID()}.sqlite`), () => codex.modelWorker());
try {
  const repository = await RoomRepository.create('Synthetic multi-storey evaluation');
  const original = repository.serialize();
  const ticket = await queue.submit(original, { requestId: randomUUID(), baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-north'], visualIntent: { kind: 'selection' }, authoringScope: 'building-reconstruction',
    instruction: 'Model a house with basement at -3 m, ground floor at 0 m and attic at 3 m. Each storey is 8 m east-west by 6 m north-south, split into west and east rooms of 4 by 6 m with a connecting door. Ground has an exterior entrance. Add straight stairs basement-west to ground-west and ground-east to attic-east, each 4 m long, 0.8 m wide, 15 steps, clear of walls and doors. Use 150 mm walls, 200 mm slabs, 2.7 m wall height below attic, 4.2 m nominal attic walls and a 200 mm gable roof with 2.7 m eaves, 4.2 m ridge along X. Preserve history. Explain estimated construction and stair assumptions for human review.' });
  const deadline = Date.now() + 180000;
  while (['queued', 'working'].includes(queue.get(ticket.id).state) && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 250));
  const result = queue.get(ticket.id);
  await writeFile(path.join(output, 'activity.json'), JSON.stringify({ state: result.state, error: result.error, activity: result.activity }, null, 2));
  assert.equal(result.state, 'ready', result.error ?? JSON.stringify(result.result?.review)); assert.ok(result.result);
  const proposed = await RoomRepository.restore(result.result.project);
  const after = validateSnapshot(proposed.view(proposed.head(result.request.proposalName)).snapshot);
  assert.equal(after.version, 2);
  assert.deepEqual(levels(after).map(level => level.elevation), [-3, 0, 3]);
  for (const level of levels(after)) {
    assert.equal(levelView(after, level.id).entities.filter(item => item.type === 'Space').length, 2);
  }
  assert.equal(after.entities.filter(item => item.type === 'Stair').length, 2);
  assert.equal(after.entities.filter(item => item.type === 'Slab').length, 3);
  assert.equal(after.entities.filter(item => item.type === 'Roof').length, 1);
  assert.equal(proposed.head('main'), repository.head('main'));
  assert.equal(queue.project(repository.projectId), original);
  const delta = diffSnapshots(repository.view(repository.head('main')).snapshot, after);
  await writeFile(path.join(output, 'proposal.project.json'), proposed.serialize());
  await writeFile(path.join(output, 'delta.json'), JSON.stringify(delta, null, 2));
  await writeFile(path.join(output, 'review.json'), JSON.stringify(result.result.review, null, 2));
  process.stdout.write(JSON.stringify({ status: 'ready', levels: levels(after).map(level => ({ name: level.name, elevation: level.elevation })),
    entities: after.entities.length, originalPreserved: true, directory: output }) + '\n');
} finally { await queue.close(); codex.close(); }
