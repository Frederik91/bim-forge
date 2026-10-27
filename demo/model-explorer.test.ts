import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomRepository } from '../src/room-model.ts';
import type { ModelGraph } from '../src/room-model.ts';
import { modelScopeFixture } from '../src/model-scope-fixture.ts';
import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { viewerBuilding } from './building-viewer-fixture.ts';
import { familyViewerSnapshot } from './generated-family-viewer-fixture.ts';
import { elementProperties, modelHierarchy } from './model-explorer.ts';
import type { ModelNode } from './model-explorer.ts';

async function singleRoom() {
  const repository = await RoomRepository.create('Single room inspection');
  return repository.view(repository.head('main')).snapshot;
}

function nodes(root: ModelNode): ModelNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

function nodeFor(root: ModelNode, id: string): ModelNode {
  const node = nodes(root).find((item) => item.id === id);
  assert.ok(node, `Hierarchy must expose stable identity ${id}`);
  return node;
}

function pathTo(root: ModelNode, id: string): ModelNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const path = pathTo(child, id);
    if (path.length) return [root, ...path];
  }
  return [];
}

function assertPlacement(root: ModelNode, id: string, levelId: string | null, roomId: string | null): void {
  const path = pathTo(root, id);
  assert.ok(path.length, `Missing ${id}`);
  assert.deepEqual(path.filter((node) => node.kind === 'level').map((node) => node.id), levelId ? [levelId] : [], `${id}: level`);
  assert.deepEqual(path.filter((node) => node.kind === 'room').map((node) => node.id), roomId ? [roomId] : [], `${id}: room`);
}

function assertRows(graph: ModelGraph, id: string, expected: Record<string, string>) {
  const properties = elementProperties(graph, id);
  assert.ok(properties, `Properties must exist for ${id}`);
  for (const [label, value] of Object.entries(expected)) {
    assert.deepEqual(properties.rows.filter(([key]) => key === label), [[label, value]], `${id}: ${label}`);
  }
  return properties;
}

function freezeDeep(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const child of Object.values(value)) freezeDeep(child);
  Object.freeze(value);
}

const fixtures = [
  { name: 'existing single room', create: singleRoom },
  { name: 'existing model scope', create: modelScopeFixture },
  { name: 'existing multi-storey house', create: multiStoreySnapshot },
  { name: 'existing coincident-floor viewer building', create: viewerBuilding },
  { name: 'existing generated asset viewer', create: async () => familyViewerSnapshot(await singleRoom()) },
];

for (const fixture of fixtures) {
  test(`${fixture.name}: hierarchy exposes every entity exactly once with its actual name, kind and stable ID`, async () => {
    const graph = await fixture.create();
    const root = modelHierarchy(graph, fixture.name);
    assert.equal(root.kind, 'project');
    assert.equal(root.name, fixture.name);
    const all = nodes(root);
    assert.equal(new Set(all.map((node) => node.id)).size, all.length, 'All selectable and grouping node identities must be unique');
    const entities = all.filter((node) => node.kind !== 'project' && node.kind !== 'group');
    assert.deepEqual(entities.map((node) => node.id).sort(), graph.entities.map((entity) => entity.id).sort());
    for (const entity of graph.entities) {
      const node = nodeFor(root, entity.id);
      assert.equal(node.name, entity.name);
      assert.equal(node.kind, entity.type === 'Level' ? 'level' : entity.type === 'Space' ? 'room' : 'element');
      if (node.kind === 'element') {
        assert.equal(node.detail, entity.type);
        assert.deepEqual(node.children, []);
      }
      if (entity.type === 'Space') assertPlacement(root, entity.id, entity.levelId, entity.id);
    }
  });

  test(`${fixture.name}: pure inspections are repeatable and do not mutate frozen graph data`, async () => {
    const graph = await fixture.create();
    const before = structuredClone(graph);
    freezeDeep(graph);
    const root = modelHierarchy(graph, fixture.name);
    assert.deepEqual(modelHierarchy(graph, fixture.name), root);
    for (const entity of graph.entities) {
      const properties = assertRows(graph, entity.id, { Identity: entity.id, Type: entity.type });
      assert.equal(properties.name, entity.name);
      assert.deepEqual(elementProperties(graph, entity.id), properties);
    }
    assert.equal(elementProperties(graph, 'missing-element-id'), null);
    assert.equal(elementProperties(graph, ''), null);
    assert.deepEqual(graph, before);
  });
}

test('single-room hierarchy keeps historical geometry at model scope without inventing a level or room', async () => {
  const graph = await singleRoom();
  const root = modelHierarchy(graph, 'Single room');
  assert.equal(nodes(root).filter((node) => node.kind === 'room' || node.kind === 'level').length, 0);
  for (const entity of graph.entities) {
    assertPlacement(root, entity.id, null, null);
    assert.equal(pathTo(root, entity.id).at(-2)?.kind, 'group');
  }
  assertRows(graph, 'wall-south', { Thickness: '0.2 m', Height: '3 m' });
  const door = assertRows(graph, 'door-entry', {
    Width: '0.9 m', Height: '2.1 m', 'hosted-by': 'South wall · host-entry',
  });
  assert.ok(door.rows.every(([label]) => label !== 'Room' && label !== 'Level'));
});

test('model-scope hierarchy assigns supported devices and asset instances to actual rooms, keeping shared geometry and family definitions separate', () => {
  const graph = modelScopeFixture();
  const root = modelHierarchy(graph, 'Model scope');
  for (const id of ['office-desk', 'office-monitor', 'office-laptop']) assertPlacement(root, id, 'level-ground', 'room-office');
  assertPlacement(root, 'living-person', 'level-ground', 'room-living');
  assertPlacement(root, 'bedroom-person', 'level-ground', 'room-bedroom-main');
  const sharedIds = graph.entities.filter((entity) => entity.type === 'Wall' || entity.type === 'Door' || entity.type === 'Window').map((entity) => entity.id);
  assert.ok(sharedIds.some((id) => id === 'wall-south-hall') && sharedIds.some((id) => id === 'door-office'));
  for (const id of sharedIds) {
    assertPlacement(root, id, 'level-ground', null);
    assert.equal(pathTo(root, id).at(-2)?.kind, 'group');
  }
  assertPlacement(root, 'standing-person', null, null);
  const familyGroup = pathTo(root, 'standing-person').at(-2);
  assert.equal(familyGroup?.kind, 'group');
  assert.deepEqual(familyGroup?.children.map((node) => node.id), ['standing-person']);
});

test('multi-storey hierarchy uses elevation rather than input or alphabetical order and retains floor-local ownership at coincident coordinates', () => {
  const graph = multiStoreySnapshot();
  const root = modelHierarchy(graph, 'House');
  const expectedLevels = ['level-basement', 'level-ground', 'level-attic'];
  assert.deepEqual(root.children.filter((node) => node.kind === 'level').map((node) => node.id), expectedLevels);
  assert.deepEqual(root.children.filter((node) => node.kind === 'level').map((node) => node.detail), ['-3 m', '0 m', '3 m']);
  const reversed: ModelGraph = { ...graph, entities: [...graph.entities].reverse(), relationships: [...graph.relationships].reverse() };
  assert.deepEqual(modelHierarchy(reversed, 'House'), root);
  for (const levelId of expectedLevels) {
    assertPlacement(root, `${levelId}-plant`, levelId, `${levelId}-west`);
    for (const suffix of ['wall-inner', 'door-inner', 'slab']) {
      assertPlacement(root, `${levelId}-${suffix}`, levelId, null);
      assert.equal(pathTo(root, `${levelId}-${suffix}`).at(-2)?.kind, 'group');
    }
  }
  assertPlacement(root, 'stair-basement-ground', 'level-basement', null);
  assertPlacement(root, 'stair-ground-attic', 'level-ground', null);
  assertPlacement(root, 'level-attic-roof', 'level-attic', null);
});

test('furniture properties expose dimensions in metres, rotation in degrees, actual support and room/level context', () => {
  const graph = modelScopeFixture();
  for (const [id, width, depth, height] of [
    ['office-monitor', '0.55 m', '0.2 m', '0.45 m'],
    ['office-laptop', '0.35 m', '0.25 m', '0.24 m'],
  ]) {
    assert.ok(id && width && depth && height);
    assertRows(graph, id, {
      Width: width, Depth: depth, Height: height, Rotation: '0°',
      'Supported by': 'Office desk', Room: 'Home office', Level: 'Ground floor',
    });
  }
  assertRows(graph, 'office-desk', { 'Supported by': 'None', Width: '1.6 m', Depth: '0.8 m', Height: '0.75 m' });
});

test('equipment and supported furniture resolve room and support on their own floor instead of the first overlapping XY room', () => {
  const graph = viewerBuilding();
  const root = modelHierarchy(graph, 'Viewer house');
  for (const level of ['basement', 'ground', 'attic']) {
    for (const suffix of ['desk', 'screen', 'equipment']) assertPlacement(root, `${level}-${suffix}`, level, `${level}-right`);
    assertRows(graph, `${level}-equipment`, {
      Level: level, Room: `${level} right`, Elevation: '0.3 m', Category: 'electrical', Width: '0.2 m', Depth: '0.15 m', Height: '0.4 m',
    });
    assertRows(graph, `${level}-screen`, { Level: level, Room: `${level} right`, 'Supported by': `${level} desk`, Rotation: '0°' });
  }
});

test('opening properties retain the real host relationship and level without claiming exclusive room ownership', () => {
  const graph = modelScopeFixture();
  for (const [id, host, width, height] of [
    ['door-office', 'Hall / south rooms · host-door-office', '0.9 m', '2.1 m'],
    ['window-office', 'East exterior · host-window-office', '1.6 m', '1.2 m'],
  ]) {
    assert.ok(id && host && width && height);
    const properties = assertRows(graph, id, { Level: 'Ground floor', Width: width, Height: height, 'hosted-by': host });
    assert.ok(properties.rows.every(([label]) => label !== 'Room'));
  }
  assertRows(graph, 'window-office', { 'Sill height': '0.9 m' });
  for (const level of ['basement', 'ground', 'attic']) {
    const properties = assertRows(viewerBuilding(), `${level}-door`, { Level: level, 'hosted-by': `${level} shared · ${level}-host` });
    assert.ok(properties.rows.every(([label]) => label !== 'Room'));
  }
});

test('level, space, stair, slab and roof properties preserve their identity and engineering context', () => {
  const graph = multiStoreySnapshot();
  assertRows(graph, 'level-basement', { Elevation: '-3 m' });
  assertRows(graph, 'level-attic-west', { Level: 'Attic' });
  assertRows(graph, 'level-ground-slab', { Level: 'Ground floor', Thickness: '0.2 m' });
  assertRows(graph, 'level-attic-roof', { Level: 'Attic', Thickness: '0.2 m' });
  assertRows(graph, 'stair-basement-ground', { Level: 'Basement', 'From Level Id': 'Basement', 'To Level Id': 'Ground floor', Width: '0.8 m', Steps: '15' });
});

test('generated asset properties resolve shared family references and explicit room placement without assigning the definition a room', () => {
  const graph = modelScopeFixture();
  assertRows(graph, 'living-person', { 'Asset family': 'Standing person proxy', Level: 'Ground floor', Room: 'Living room', Rotation: '0°' });
  assertRows(graph, 'bedroom-person', { 'Asset family': 'Standing person proxy', Level: 'Ground floor', Room: 'Main bedroom' });
  const family = assertRows(graph, 'standing-person', { Identity: 'standing-person', Type: 'AssetFamily' });
  assert.equal(family.name, 'Standing person proxy');
  assert.ok(family.rows.every(([label]) => label !== 'Room' && label !== 'Level'));
});

test('generated single-room assets retain separate definitions, shared family references and rotated instance geometry', async () => {
  const graph = familyViewerSnapshot(await singleRoom());
  const root = modelHierarchy(graph, 'Generated assets');
  const familyGroup = pathTo(root, 'standing-person').at(-2);
  assert.equal(familyGroup?.kind, 'group');
  assert.deepEqual(familyGroup?.children.map((node) => node.id).sort(), ['generated-plinth', 'standing-person']);
  for (const id of ['person-187', 'person-165', 'plinth-one']) {
    assertPlacement(root, id, null, null);
    assert.notEqual(pathTo(root, id).at(-2)?.id, familyGroup?.id);
  }
  assertRows(graph, 'plinth-one', { 'Asset family': 'Generated display plinth', Rotation: '90°', Size: '{"width":0.6,"depth":0.4,"height":0.8}' });
  assertRows(graph, 'person-165', { 'Asset family': 'Standing person proxy', Size: '{"width":0.5,"depth":0.3,"height":1.65}' });
});

test('partial inspection graphs: room-owned assets retain their actual rooms when level metadata is absent', () => {
  const source = modelScopeFixture();
  const graph: ModelGraph = { ...source, entities: source.entities.filter((entity) => entity.type !== 'Level') };
  freezeDeep(graph);
  const root = modelHierarchy(graph, 'Rooms without level metadata');
  assert.equal(nodes(root).filter((node) => node.kind === 'level').length, 0);
  for (const [id, roomId, roomName] of [
    ['living-person', 'room-living', 'Living room'],
    ['bedroom-person', 'room-bedroom-main', 'Main bedroom'],
  ]) {
    assert.ok(id && roomId && roomName);
    assertPlacement(root, id, null, roomId);
    assert.equal(pathTo(root, roomId).at(-2)?.kind, 'project');
    const properties = assertRows(graph, id, { Room: roomName, 'Asset family': 'Standing person proxy' });
    assert.ok(properties.rows.every(([label]) => label !== 'Level'));
  }
});

test('partial inspection graphs: missing room or family metadata does not invent ownership or definitions', () => {
  const source = modelScopeFixture();
  const graph: ModelGraph = { ...source,
    entities: source.entities.filter((entity) => entity.type === 'AssetFamily' || entity.type === 'AssetInstance'), relationships: [] };
  freezeDeep(graph);
  const root = modelHierarchy(graph, 'Assets without room metadata');
  assert.equal(nodes(root).filter((node) => node.kind === 'room' || node.kind === 'level').length, 0);
  for (const id of ['living-person', 'bedroom-person']) {
    assertPlacement(root, id, null, null);
    assert.equal(pathTo(root, id).at(-2)?.kind, 'group');
    assert.notEqual(pathTo(root, id).at(-2)?.id, pathTo(root, 'standing-person').at(-2)?.id);
    const properties = assertRows(graph, id, { 'Asset family': 'Standing person proxy' });
    assert.ok(properties.rows.every(([label]) => label !== 'Room' && label !== 'Level'));
  }
  const instancesOnly: ModelGraph = { ...graph, entities: graph.entities.filter((entity) => entity.type === 'AssetInstance') };
  const unbound = modelHierarchy(instancesOnly, 'Instances without definitions');
  assert.deepEqual(nodes(unbound).filter((node) => node.kind === 'element').map((node) => node.id).sort(), ['bedroom-person', 'living-person']);
  assertRows(instancesOnly, 'living-person', { 'Asset family': 'standing-person' });
  assert.equal(elementProperties(instancesOnly, 'standing-person'), null);
});

test('generated asset dimensions identify metre units just as native furniture dimensions do', () => {
  const graph = modelScopeFixture();
  const properties = elementProperties(graph, 'living-person');
  assert.ok(properties);
  const separateDimensions = ['Width', 'Depth', 'Height'].every((label) => properties.rows.some(([key, value]) => key === label && value.endsWith(' m')));
  const dimensionSummary = properties.rows.some(([label, value]) => label === 'Size' && /\bm\b/.test(value));
  const explicitUnits = properties.rows.some(([label, value]) => label === 'Units' && value === graph.units);
  assert.ok(separateDimensions || dimensionSummary || explicitUnits,
    `Asset instance dimensions need explicit metre units; actual rows: ${JSON.stringify(properties.rows)}`);
});
