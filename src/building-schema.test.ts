import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiKit, createRuntime, Type } from '@frederik91/scriptbox';
import { BuildingLayoutSchema } from './building-schema.ts';
import { multiStoreyLayout } from './multi-storey-house.ts';

test('the real ScriptBox compiler accepts building arrays, mixed openings and both named roof profiles', async (t) => {
  const api = createApiKit<null>();
  const building = api.namespace({ name: 'building', description: 'Check the authoring contract.', methods: {
    countRooms: api.method({ summary: 'Count rooms without changing a model.', effect: 'read',
      params: { input: BuildingLayoutSchema }, result: Type.Integer(),
      handler: ({ input }) => input.levels.reduce((sum, floor) => sum + floor.rooms.length, 0),
    }),
  } });
  const runtime = await createRuntime<null>({ apis: [building], compilerWorkers: 1 });
  t.after(() => runtime.dispose());
  const session = runtime.createSession({ context: null, capabilities: ['building.countRooms'] });
  t.after(() => session.dispose());
  const gabled = multiStoreyLayout(); const attic = gabled.levels.find((floor) => floor.level.id === 'level-attic'); assert.ok(attic);
  attic.openings.push({ id: 'attic-window', type: 'Window', name: 'Attic window', roomId: 'level-attic-west',
    side: 'north', offsetMm: 1000, widthMm: 1200, heightMm: 1000, sillHeightMm: 900 });
  const flat = structuredClone(gabled); const top = flat.levels.find((floor) => floor.level.id === 'level-attic'); assert.ok(top?.roof);
  top.roof.profile = { kind: 'flat', heightMm: 3000 };
  const result = await session.execute({ language: 'typescript', source:
    `return [await building.countRooms(${JSON.stringify(gabled)}), await building.countRooms(${JSON.stringify(flat)})];` });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  if (result.status === 'completed') assert.deepEqual(result.value, [6, 6]);
});
