import assert from 'node:assert/strict';
import test from 'node:test';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { BabylonAdapter } from './adapters/babylon.ts';
import { assertReadback, parseModel } from './contract.ts';
import type { Element, Model } from './contract.ts';

function triangleModel(instances: number): Model {
  return parseModel({
    version: 1, id: 'lifecycle', revision: 'baseline',
    coordinateSystem: 'right-handed-y-up-metres', grossFloorAreaM2: 1,
    provenance: { kind: 'synthetic', seed: 194 },
    cameraPath: [{ eye: [0, 0, 10], target: [0, 0, 0] }],
    geometries: [{ id: 'triangle', positions: [-1, -2, 0, 2, -2, 0, -1, 3, 0], indices: [0, 1, 2] }],
    elements: Array.from({ length: instances }, (_, index) => ({
      id: 'element-' + index, geometryId: 'triangle', category: 'Wall', discipline: 'architecture', storey: 'ground',
      position: [index * 5, 0, 0], scale: [1, 1, 1], color: [.2, .5, .7], properties: {},
    })),
  });
}

for (const instances of [1, 3]) {
  test(instances === 1 ? 'unique triangle retains buffers and bounds through repeated moves'
    : 'shared triangle survives replacing every instance and a zero-instance interval', async () => {
    assert.equal(Engine.Version, '9.32.0');
    const engine = new NullEngine();
    class HeadlessAdapter extends BabylonAdapter {
      override async frame(): Promise<void> {
        for (const scene of engine.scenes) scene.render();
      }
    }
    const adapter = new HeadlessAdapter(engine);
    const scene = engine.scenes[0];
    const model = triangleModel(instances);
    let geometry: Geometry | undefined;
    try {
      await adapter.load(model);
      geometry = scene.geometries[0];
      assert.ok(geometry instanceof Geometry);
      const positions = geometry.getVertexBuffer(VertexBuffer.PositionKind);
      const indices = geometry.getIndexBuffer();
      assert.ok(positions);
      assert.ok(positions.getBuffer());
      assert.ok(indices);
      const vertexBuffer = positions.getBuffer();
      const checkGeometry = async (elements: Element[]): Promise<void> => {
        assert.ok(geometry);
        assert.equal(geometry.isDisposed(), false);
        assert.equal(geometry.getVertexBuffer(VertexBuffer.PositionKind), positions);
        assert.equal(positions.getBuffer(), vertexBuffer);
        assert.equal(geometry.getIndexBuffer(), indices);
        assert.deepEqual(geometry.getVerticesData(VertexBuffer.PositionKind), model.geometries[0].positions);
        assert.deepEqual(geometry.getIndices(), [0, 1, 2]);
        assert.equal(scene.meshes.length, elements.length);
        for (const mesh of scene.meshes) {
          assert.equal(mesh.getTotalVertices(), 3);
          assert.equal(mesh.getTotalIndices(), 3);
        }
        assertReadback(model, elements, await adapter.readback());
      };
      await checkGeometry(model.elements);
      let moved = model.elements;
      for (let step = 1; step <= 8; step++) {
        moved = model.elements.map((element): Element => ({
          ...element, position: [element.position[0] + step, step * 2, -step],
        }));
        await adapter.apply({ upsert: moved, remove: [] });
        await checkGeometry(moved);
      }
      await adapter.apply({ upsert: [], remove: moved.map(element => element.id) });
      await checkGeometry([]);
      await adapter.apply({ upsert: moved, remove: [] });
      await checkGeometry(moved);
      if (instances > 1) {
        await adapter.apply({ upsert: [], remove: moved.map(element => element.id) });
        await checkGeometry([]);
      }
    } finally {
      await adapter.dispose();
    }
    assert.ok(geometry);
    assert.equal(geometry.isDisposed(), true);
    assert.equal(geometry.getVertexBuffer(VertexBuffer.PositionKind), undefined);
    assert.equal(geometry.getIndexBuffer(), null);
    assert.equal(scene.isDisposed, true);
    assert.equal(engine.scenes.length, 0);
  });
}
