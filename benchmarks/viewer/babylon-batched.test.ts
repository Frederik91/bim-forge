import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { BatchedBabylonAdapter } from './adapters/babylon-batched.ts';
import { applyProposal, assertReadback, changesBetween, comparisonElements } from './contract.ts';
import type { Element } from './contract.ts';
import { smokeModel, smokeProposal } from './fixtures.ts';
import { parseResult } from './metrics.ts';
import type { Result } from './metrics.ts';

test('optimized result boundary rejects invalid resource counters and overlapping timing phases', () => {
  const result: Result = { version: 1, candidate: 'babylon-batched', profile: 'viewer-192-v1', purpose: 'setup-smoke', status: 'failed', qualified: false,
    reviewCycles: 1, samples: [{ operation: 'proposal', durationMs: 10, drawCalls: 1, triangles: 12,
      phases: { validationMs: 4, diffMs: 1, applyMs: 2, readbackMs: 3 },
      resources: { rebuiltBatches: 1, preservedBatches: 4, uploadedIndices: 36, uploadedVertices: 8, batches: 5, elements: 20, storedTriangles: 240 } }],
    frameIntervalsMs: [], checks: [], limitations: ['Boundary test only'], error: 'deliberate incomplete fixture',
    environment: { userAgent: 'test', hardwareConcurrency: 1, renderer: 'test', viewport: [1280, 800], devicePixelRatio: 1 } };
  parseResult(result);
  assert.throws(() => parseResult({ ...result, samples: [{ ...result.samples[0], resources: { ...result.samples[0].resources, uploadedIndices: -1 } }] }), /Invalid benchmark result/);
  assert.throws(() => parseResult({ ...result, samples: [{ ...result.samples[0], phases: { validationMs: 10, diffMs: 2, applyMs: 5, readbackMs: 3 } }] }), /timing phase/);
});

function setup() {
  const engine = new NullEngine({ renderWidth: 1280, renderHeight: 800, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
  class HeadlessAdapter extends BatchedBabylonAdapter {
    override async frame(): Promise<void> { for (const scene of engine.scenes) scene.render(); }
  }
  return { engine, adapter: new HeadlessAdapter(engine) };
}

test('batch buffers contain every source triangle and exact stable identities through repeated review/discard', async () => {
  const { engine, adapter } = setup(); const model = smokeModel(300);
  try {
    await adapter.load(model); let displayed = model.elements;
    const verify = async (elements: Element[]) => {
      assertReadback(model, elements, await adapter.readback());
      assert.equal(engine.scenes[0].meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), elements.length * 12);
      assert.equal(adapter.resources().storedTriangles, elements.length * 12);
      assert.equal(adapter.resources().elements, elements.length);
    };
    await verify(displayed);
    assert.ok(engine.scenes[0].meshes.length < model.elements.length / 2);
    const actualTriangles: string[] = [];
    for (const mesh of engine.scenes[0].meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind); const indices = mesh.getIndices();
      assert.ok(positions && indices);
      for (let i = 0; i < indices.length; i += 3) actualTriangles.push([indices[i], indices[i + 1], indices[i + 2]].map(index =>
        [positions[index * 3] + mesh.position.x, positions[index * 3 + 1] + mesh.position.y, positions[index * 3 + 2] + mesh.position.z]
          .map(value => value.toFixed(4)).join(',')).join('|'));
    }
    const expectedTriangles: string[] = [];
    for (const item of model.elements) {
      const geometry = model.geometries[0];
      for (let i = 0; i < geometry.indices.length; i += 3) expectedTriangles.push(geometry.indices.slice(i, i + 3).map(index =>
        item.position.map((value, axis) => value + geometry.positions[index * 3 + axis] * item.scale[axis])
          .map(value => value.toFixed(4)).join(',')).join('|'));
    }
    assert.deepEqual(actualTriangles.sort(), expectedTriangles.sort());
    for (let cycle = 0; cycle < 8; cycle++) {
      const proposal = applyProposal(model, smokeProposal(model));
      for (const elements of [proposal.elements, comparisonElements(model, proposal), proposal.elements, model.elements]) {
        await adapter.apply(changesBetween(displayed, elements)); displayed = elements; await verify(elements);
      }
    }
    await adapter.apply({ upsert: [], remove: displayed.map(item => item.id) });
    await verify([]); assert.equal(engine.scenes[0].meshes.length, 0);
    await adapter.apply({ upsert: model.elements, remove: [] }); await verify(model.elements);
  } finally { await adapter.dispose(); }
  assert.equal(engine.scenes.length, 0);
});

test('one move preserves untouched GPU buffers; metadata updates upload no geometry', async () => {
  const { engine, adapter } = setup(); const model = smokeModel(300);
  try {
    await adapter.load(model);
    const before = new Map(engine.scenes[0].meshes.map(mesh => [mesh, mesh.getVertexBuffer(VertexBuffer.PositionKind)?.getBuffer()]));
    const first = model.elements[0];
    const moved: Element = { ...first, position: [first.position[0] + .25, first.position[1], first.position[2]] };
    await adapter.apply({ upsert: [moved], remove: [] });
    assert.equal(adapter.resources().rebuiltBatches, 1);
    assert.ok(adapter.resources().preservedBatches > 0);
    assert.ok(adapter.resources().uploadedVertices < model.elements.length * 8);
    assert.equal([...before].filter(([mesh, buffer]) => mesh.getVertexBuffer(VertexBuffer.PositionKind)?.getBuffer() === buffer).length, before.size - 1);
    assertReadback(model, model.elements.map(item => item.id === moved.id ? moved : item), await adapter.readback());
    await adapter.apply({ upsert: [{ ...moved, properties: { Name: 'metadata-only' } }], remove: [] });
    assert.equal(adapter.resources().rebuiltBatches, 0); assert.equal(adapter.resources().uploadedIndices, 0);
    assert.deepEqual(await adapter.properties(moved.id), { Name: 'metadata-only' });
  } finally { await adapter.dispose(); }
});

test('filtered batch preserves hidden identities and picks the correct visible element', async () => {
  const { engine, adapter } = setup(); const model = smokeModel(12);
  try {
    await adapter.load(model); const item = model.elements[0];
    await adapter.visible([item.id]);
    await adapter.camera({ eye: [item.position[0], item.position[1], item.position[2] + 8], target: item.position });
    assert.equal(await adapter.pick(640, 400), item.id);
    assertReadback(model, model.elements, await adapter.readback());
    assert.equal(engine.scenes[0].meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), 12);
    await adapter.select(item.id);
    assert.equal(await adapter.pick(640, 400), item.id);
    assertReadback(model, model.elements, await adapter.readback());
    await adapter.section(-1000); assert.equal(await adapter.pick(640, 400), null);
    await adapter.section(null); await adapter.visible([]); assert.equal(await adapter.pick(640, 400), null);
    await adapter.visible(null); await adapter.select(null);
    assert.equal(adapter.resources().storedTriangles, 144);
  } finally { await adapter.dispose(); }
});

test('clipped foreground in the same batch does not hide an unclipped hit behind it', async () => {
  const { adapter } = setup(); const model = smokeModel(3);
  const first = model.elements[0];
  model.elements = [first, { ...first, id: 'behind', position: [first.position[0], first.position[1] - 3, first.position[2]] }];
  try {
    await adapter.load(model);
    await adapter.camera({ eye: [first.position[0], 10, first.position[2] + .01], target: [first.position[0], -3, first.position[2]] });
    assert.equal(await adapter.pick(640, 400), first.id);
    await adapter.section(-1); assert.equal(await adapter.pick(640, 400), 'behind');
  } finally { await adapter.dispose(); }
});

test('scale/color/spatial relocation and unique replacement keep correct geometry', async () => {
  const { adapter } = setup(); const model = smokeModel(3);
  try {
    await adapter.load(model);
    const changed: Element = { ...model.elements[0], position: [100000.123, 12.5, -100000.456], scale: [2, 3, .25], color: [.9, .2, .1] };
    await adapter.apply({ upsert: [changed], remove: [] });
    assertReadback(model, [changed, ...model.elements.slice(1)], await adapter.readback());
    await adapter.apply({ upsert: [], remove: [changed.id] });
    assertReadback(model, model.elements.slice(1), await adapter.readback());
  } finally { await adapter.dispose(); }
});
