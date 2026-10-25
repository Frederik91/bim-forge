import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomRepository, previewFurnishings, rectangleLayout, diffSnapshots } from './room-model.ts';
import { prepareModelProposal } from './model-proposal.ts';
import { createHousePilotFixture } from './house-pilot.ts';
import { furnitureFaces } from './furniture-geometry.ts';

export const officeItems = [
  { id: 'desk-office', type: 'Furniture', name: 'Office desk', kind: 'desk', position: [3, 3], width: 1.8, depth: 0.8, height: 0.75, rotationDeg: 0, supportId: null },
  { id: 'monitor-office', type: 'Furniture', name: 'Computer monitor', kind: 'monitor', position: [3, 3.2], width: 0.6, depth: 0.2, height: 0.45, rotationDeg: 0, supportId: 'desk-office' },
  { id: 'laptop-office', type: 'Furniture', name: 'Laptop', kind: 'laptop', position: [2.45, 2.9], width: 0.35, depth: 0.25, height: 0.24, rotationDeg: 0, supportId: 'desk-office' },
  { id: 'chair-office', type: 'Furniture', name: 'Office chair', kind: 'chair', position: [3, 2.15], width: 0.6, depth: 0.6, height: 1, rotationDeg: 0, supportId: null },
  { id: 'table-corner', type: 'Furniture', name: 'Corner table', kind: 'table', position: [5.3, 3.3], width: 0.6, depth: 0.6, height: 0.55, rotationDeg: 0, supportId: null },
  { id: 'plant-office', type: 'Furniture', name: 'Potted plant', kind: 'plant', position: [0.7, 3.3], width: 0.5, depth: 0.5, height: 1.1, rotationDeg: 0, supportId: null },
];

test('a complete office is a validated six-object delta and survives reviewed acceptance and restore', async () => {
  const repo = await RoomRepository.create('Office acceptance');
  const root = repo.head('main');
  const before = repo.view(root).snapshot;
  const preview = previewFurnishings(before, { furnishings: officeItems });
  assert.equal(diffSnapshots(before, preview).entities.added.length, 6);
  assert.deepEqual(rectangleLayout(preview), rectangleLayout(before));
  const reoriented = previewFurnishings(preview, { furnishings: officeItems.map((item) => item.kind === 'laptop' ? { ...item, rotationDeg: 180 } : item) });
  assert.deepEqual(diffSnapshots(preview, reoriented).entities.modified.map((item) => item.id), ['laptop-office']);
  for (const item of preview.entities) {
    if (item.type !== 'Furniture') continue;
    const faces = furnitureFaces(item, preview);
    assert.ok(faces.length >= 10, `${item.kind} has an identifiable multi-part silhouette`);
    assert.ok(faces.every((face) => face.object.id === item.id && face.points.every((point) => point.every(Number.isFinite))));
    const minZ = Math.min(...faces.flatMap((face) => face.points.map((point) => point[2])));
    assert.equal(minZ, item.supportId ? .75 : item.kind === 'chair' ? .04 : 0);
  }
  const result = await prepareModelProposal(repo, {
    requestId: 'office-test', proposalName: 'office-layout', baseRevisionId: root,
    selectedObjectIds: ['door-entry'], instruction: 'Furnish a home office.',
    visualIntent: { kind: 'rectangle-layout-sketch', layout: rectangleLayout(before) },
  }, {
    identity: { provider: 'test', model: 'office-worker' },
    async run(session: import('./model-proposal.ts').ModelWorkerSession) {
      assert.equal((await session.executeTool('run_model_script', { language: 'typescript', source: `
        await model.inspect();
        await model.previewFurnishings(${JSON.stringify({ furnishings: officeItems })});
        return {kind:'propose',review:{intent:{interpretation:'Furnish the office.',assumptions:[],certainty:90,basis:'The fixture names all six items.'},summary:'Add six office furnishings.',rationale:'Clear entry with a desk facing north.',
          constraints:'One entry door retained.',uncertainty:'Concept only, not construction approval.'}};
      ` })).ok, true);
      session.recordProviderEvent({ responseId: 'office-turn', inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    },
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.repository.review('office-layout').worker.responseIds, ['office-turn']);
  assert.equal(result.repository.review('office-layout').worker.usage.totalTokens, 150);
  const accepted = result.repository.accept('office-layout', { decisionId: 'office-accept', actor: 'tester' });
  const restored = await RoomRepository.restore(accepted.serialize());
  assert.equal(restored.view(restored.head('main')).snapshot.entities.length, 11);
  assert.equal(restored.view(root).snapshot.entities.length, 5);
});

test('House Pilot shell editing preserves window and equipment instead of treating every object as a door', async () => {
  const fixture = await createHousePilotFixture();
  const project = fixture.repository;
  const base = project.view(project.head('main')).snapshot;
  const layout = rectangleLayout(base);
  const { previewRectangle } = await import('./room-model.ts');
  assert.deepEqual(previewRectangle(base, layout), base);
  const next = previewRectangle(base, { ...layout, door: { ...layout.door, widthMm: 1000 } });
  const delta = diffSnapshots(base, next);
  assert.deepEqual(delta.entities.modified.map((item) => item.id), ['door-entry']);
});

test('furnishing guards reject collisions, unsupported devices, exterior objects and blocked doors', async () => {
  const repo = await RoomRepository.create('Office guards');
  const base = repo.view(repo.head('main')).snapshot;
  const change = (index: number, patch: Record<string, unknown>) => ({ furnishings: officeItems.map((item, i) => i === index ? { ...item, ...patch } : item) });
  assert.throws(() => previewFurnishings(base, change(5, { position: [3, 3] })), /overlap/);
  assert.throws(() => previewFurnishings(base, change(1, { supportId: null })), /support/);
  assert.throws(() => previewFurnishings(base, change(2, { position: [0, 0] })), /support/);
  assert.throws(() => previewFurnishings(base, change(5, { position: [7, 3] })), /inside/);
  assert.throws(() => previewFurnishings(base, change(5, { position: [2.8, 0.5] })), /door clearance/);
});
