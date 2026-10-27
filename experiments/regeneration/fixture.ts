import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { parseFixture } from '../fixtures/fixture.ts';
import { parseModel } from './contract.ts';
import type { Model } from './contract.ts';

const levels = Type.Object({ elevation: Type.Number({ minimum: -1000, maximum: 1000 }) });
const localIds = new Map([
  ['ground', 'level-ground'], ['first', 'level-upper'], ['shared-wall', 'wall'], ['door', 'opening'],
]);

export function fixture(): Model {
  const sharedValue: unknown = JSON.parse(readFileSync(new URL('../fixtures/tiny-building.json', import.meta.url), 'utf8'));
  const shared = parseFixture(sharedValue);
  const extensionValue: unknown = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'));
  const extension = parseModel(extensionValue);
  const levelNodes = ['ground', 'first'].map((id) => {
    const entity = shared.entities.find((item) => item.id === id);
    const localId = localIds.get(id);
    if (!entity || entity.kind !== 'level' || !localId || !Check(levels, entity.properties)) {
      throw new Error(`Missing W0 level projection:${id}`);
    }
    return { kind: 'level', id: localId, elevationMm: entity.properties.elevation * 1000 };
  });
  function target(source: string, kind: string): string {
    const matches = shared.relationships.filter((item) => item.source === source && item.kind === kind);
    if (matches.length !== 1) throw new Error(`Expected one W0 relationship:${source}:${kind}`);
    const relationship = matches.at(0);
    const localId = relationship ? localIds.get(relationship.target) : undefined;
    if (!localId) throw new Error(`Unmapped W0 relationship:${source}:${kind}`);
    return localId;
  }
  // W0 owns levels and host identities. All vertical offsets, the handle,
  // clearance dimension and connectivity cycle are declared W3 extensions.
  return parseModel({ ...extension, nodes: [...levelNodes, ...extension.nodes.map((node) => {
    if (node.kind === 'hosted' && node.id === 'wall') return { ...node, hostId: target('shared-wall', 'containedIn') };
    if (node.kind === 'hosted' && node.id === 'opening') return { ...node, hostId: target('door', 'hostedBy') };
    return node;
  })] });
}
