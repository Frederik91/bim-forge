import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKit, createRuntime, Type } from '@frederik91/scriptbox';
import { AssetEditSchema } from './asset-family.ts';
import { assetFixtureEdit } from './asset-fixture.ts';

test('real ScriptBox declarations accept native family arrays, primitive variants and discriminated placements', async (t) => {
  const api = createApiKit<null>();
  const assets = api.namespace({ name: 'assets', description: 'Inspect native asset recipe data.', methods: {
    count: api.method({ summary: 'Count placements without changing a model.', effect: 'read',
      params: { edit: AssetEditSchema }, result: Type.Integer(), handler: ({ edit }) => edit.instances.length }),
  } });
  const runtime = await createRuntime<null>({ apis: [assets], compilerWorkers: 1 }); t.after(() => runtime.dispose());
  const session = runtime.createSession({ context: null, capabilities: ['assets.count'] }); t.after(() => session.dispose());
  const edit = assetFixtureEdit();
  const roomBound = { ...edit, instances: edit.instances.map((item) => ({ ...item, placement: { kind: 'room', roomId: 'office' } })) };
  const mounted = { ...edit, instances: edit.instances.map((item, i) => ({ ...item, mounting: i === 0 ? { kind: 'wall', wallId: 'wall-north', elevation: 1.4 } : i === 1 ? { kind: 'ceiling', clearance: .1 } : { kind: 'free-floating', elevation: 1 } })) };
  const result = await session.execute({ language: 'typescript', source:
    `return [await assets.count(${JSON.stringify(edit)}), await assets.count(${JSON.stringify(roomBound)}), await assets.count(${JSON.stringify(mounted)})];` });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  if (result.status === 'completed') assert.deepEqual(result.value, [3, 3, 3]);
});
