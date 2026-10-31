import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, previewAssets, diffSnapshots } from './room-model.ts';
import { GeometryEvidenceSession, DraftContinuation } from './geometry-evidence.ts';
import { FixtureGeometrySource, cubeMeasurement } from './geometry-evidence.fixture.ts';

test('a conversation can remove a previously proposed cube while retaining the other cube and its clearance', async t => {
  const repository = await RoomRepository.create('Synthetic draft retirement');
  const acceptedBytes = repository.serialize();
  const baseRevisionId = repository.head('main');
  const base = repository.view(baseRevisionId).snapshot;
  const native = { snapshot: base, revisionId: baseRevisionId, target: { kind: 'main' } } satisfies Parameters<typeof GeometryEvidenceSession.open>[0]['native'];
  const source = new FixtureGeometrySource();
  const history = repository.geometryHistory();
  const first = await GeometryEvidenceSession.open({ source, projectId: repository.projectId, requestId: 'draft-generation-one', native,
    history, chatId: 'draft-chat', signal: new AbortController().signal });
  t.after(() => first.close());
  const draft = previewAssets(base, {
    families: [{ id: 'evidence-cube', type: 'AssetFamily', name: 'Cube', description: 'Synthetic closed cube',
      parts: [{ id: 'body', kind: 'box', min: [0, 0, 0], size: [1, 1, 1], color: '#546778' }] }],
    instances: [1, 3].map((x, i) => ({ id: i === 0 ? 'requested-cube' : 'trial-cube', type: 'AssetInstance', name: 'Draft cube',
      familyId: 'evidence-cube', position: [x, 2], rotationDeg: 0, size: { width: .5, depth: .5, height: .5 },
      placement: { kind: 'single-room' } })), removeInstanceIds: [],
  });
  assert.equal((await first.measure(cubeMeasurement)).kind, 'complete');
  assert.equal((await first.measure({ ...cubeMeasurement,
    subject: { ...cubeMeasurement.subject, candidateId: 'trial-cube', bounds: { min: [2.75, 1.75, 0], max: [3.25, 2.25, .5] } },
    against: { kind: 'query', query: { role: 'physical', region: { min: [-.1, 1, -1], max: [4.1, 3, 1.5] } } } })).kind, 'complete');
  const inherited = await first.seal(draft); assert.ok(inherited);
  await first.close();
  const remaining = previewAssets(draft, { families: [], instances: [], removeInstanceIds: ['trial-cube'] });
  assert.deepEqual(diffSnapshots(draft, remaining).entities.removed.map(entity => entity.id), ['trial-cube']);
  assert.equal(base.entities.some(entity => entity.id === 'trial-cube'), false);
  const next = await GeometryEvidenceSession.open({ source, projectId: repository.projectId, requestId: 'draft-generation-two', native,
    history, chatId: 'draft-chat', continuation: await DraftContinuation.fromPrior({ chatId: 'draft-chat', history,
      predecessor: { evidence: inherited, snapshot: draft } }), signal: new AbortController().signal });
  t.after(() => next.close());
  assert.ok(await next.seal(remaining));
  assert.equal(repository.serialize(), acceptedBytes);
});
