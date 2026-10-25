import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAccountConnection } from '../src/codex-app-server.ts';
import { ChangeRequests } from '../demo/change-requests.ts';
import { RoomRepository, diffSnapshots, validateSnapshot } from '../src/room-model.ts';
import { assetGeometry } from '../src/asset-family.ts';

// Manual server-container evaluation: existing ChatGPT sign-in, synthetic project, private backlog.
// Recipes must come from the live worker. Nothing in this evaluator accepts a proposal.
const output = process.env.BIM_ASSET_EVIDENCE;
if (!output || !path.isAbsolute(output)) throw new Error('Set BIM_ASSET_EVIDENCE to an absolute evaluation directory.');
await mkdir(output, { recursive: true });
const codex = await CodexAccountConnection.open();
if (!codex.publicSession().connected) { codex.close(); throw new Error('Connect the existing server ChatGPT session before evaluating asset authoring.'); }
const queue = new ChangeRequests(path.join(output, `assets-${randomUUID()}.sqlite`), () => codex.modelWorker());
try {
  const repository = await RoomRepository.create('Synthetic AI-authored asset evaluation');
  const original = repository.serialize();
  const before = repository.view(repository.head('main')).snapshot;
  const instruction = [
    'Author a recognizable standing-person proxy with distinct head, torso, two arms and two legs, at least five primitive parts, not a named box.',
    'Instance person-1870 must be exactly 1.87 m tall, .55 m wide and .35 m deep at [1.2,2.8].',
    'Then add person-1650, exactly 1.65 m tall at [2.7,2.8], reusing the SAME authored family and width/depth.',
    'Independently author an unrelated floor lamp with base, stem and shade as instance floor-lamp at [4.5,2.8], width/depth .5 m and height 1.5 m.',
    'Use normalized primitives attaining all six unit-box extrema. Keep the existing unlevelled single-room shell, entry and unrelated objects unchanged; no reconstruction.',
    'Disclose proxy fidelity and assumptions, no anatomy or product certification. Leave all changes in one proposal for human review.',
  ].join(' ');
  assert.ok(instruction.length <= 1000);
  const ticket = await queue.submit(original, { requestId: randomUUID(), baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-north'], visualIntent: { kind: 'selection' }, instruction });
  const deadline = Date.now() + 180000;
  while (['queued', 'working'].includes(queue.get(ticket.id).state) && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, 250));
  }
  const result = queue.get(ticket.id);
  await writeFile(path.join(output, 'activity.json'), JSON.stringify({ state: result.state, error: result.error, activity: result.activity }, null, 2));
  await writeFile(path.join(output, 'executions.json'), JSON.stringify(queue.executions(ticket.id), null, 2));
  assert.equal(result.state, 'ready', result.error ?? JSON.stringify(result.result?.review)); assert.ok(result.result);
  const proposed = await RoomRepository.restore(result.result.project);
  const after = validateSnapshot(proposed.view(proposed.head(result.request.proposalName)).snapshot);
  const families = after.entities.filter(item => item.type === 'AssetFamily');
  const instances = after.entities.filter(item => item.type === 'AssetInstance');
  const person = instances.find(item => item.id === 'person-1870');
  const shorter = instances.find(item => item.id === 'person-1650');
  const lamp = instances.find(item => item.id === 'floor-lamp');
  assert.ok(person && shorter && lamp, 'The live worker must create both people and the independent lamp.');
  assert.equal(person.size.height, 1.87); assert.equal(shorter.size.height, 1.65);
  assert.equal(person.familyId, shorter.familyId, 'Different heights must reuse one immutable family.');
  assert.notEqual(person.familyId, lamp.familyId, 'The unrelated lamp must have its own authored recipe.');
  assert.equal(person.size.width, .55); assert.equal(person.size.depth, .35);
  assert.equal(lamp.size.width, .5); assert.equal(lamp.size.depth, .5); assert.equal(lamp.size.height, 1.5);
  const body = families.find(item => item.id === person.familyId);
  const lampFamily = families.find(item => item.id === lamp.familyId);
  assert.ok(body && body.parts.length >= 5, 'A named single box cannot qualify as a recognizable standing figure.');
  assert.ok(lampFamily && lampFamily.parts.length >= 3, 'The lamp needs independently authored base, stem and shade.');
  assert.equal(families.length, 2); assert.equal(instances.length, 3);
  assert.equal(assetGeometry(after, person).bounds.maxZ, 1.87);
  assert.equal(assetGeometry(after, shorter).bounds.maxZ, 1.65);
  for (const instance of instances) assert.equal(instance.placement.kind, 'single-room');
  assert.equal(after.version, undefined, 'Ordinary asset authoring must not upgrade or reconstruct the shell.');
  const delta = diffSnapshots(before, after);
  assert.deepEqual(delta.entities.modified, []); assert.deepEqual(delta.entities.removed, []);
  assert.equal(delta.entities.added.length, 5); assert.deepEqual(after.relationships, before.relationships);
  assert.equal(proposed.head('main'), repository.head('main'));
  assert.equal(proposed.review(result.request.proposalName).decision.status, 'pending');
  assert.equal(queue.project(repository.projectId), original);
  assert.ok(proposed.review(result.request.proposalName).scriptExecutions?.some(execution =>
    execution.calls.some(call => call.method === 'model.previewAssets' && call.disposition === 'completed')));
  assert.equal((await RoomRepository.restore(proposed.serialize())).serialize(), proposed.serialize());
  await writeFile(path.join(output, 'proposal.project.json'), proposed.serialize());
  await writeFile(path.join(output, 'delta.json'), JSON.stringify(delta, null, 2));
  await writeFile(path.join(output, 'review.json'), JSON.stringify(result.result.review, null, 2));
  const summary = { status: 'ready', accepted: false, originalPreserved: true,
    familyCount: families.length, instanceCount: instances.length, personPartCount: body.parts.length,
    instances: instances.map(instance => ({ id: instance.id, familyId: instance.familyId, dimensions: instance.size,
      bounds: assetGeometry(after, instance).bounds, placement: instance.placement })), directory: output };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify(summary) + '\n');
} finally { await queue.close(); codex.close(); }
