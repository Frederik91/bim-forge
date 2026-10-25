import { parseFixture } from '../fixtures/fixture.ts';
import { entity } from './contract.ts';
import type { StoredEntity } from './contract.ts';

export function fixtureEnvelopes(value: unknown): StoredEntity[] {
  const fixture = parseFixture(value);
  return [
    ...fixture.entities.map((item) => entity({ entityId: item.id, kind: item.kind,
      typeId: fixture.relationships.find((edge) => edge.source === item.id && edge.kind === 'instanceOf')?.target ?? null,
      containerId: fixture.relationships.find((edge) => edge.source === item.id && edge.kind === 'containedIn')?.target ?? null,
      systemId: fixture.relationships.find((edge) => edge.source === item.id && edge.kind === 'memberOfSystem')?.target ?? null,
      fromId: null, toId: null, document: item })),
    ...fixture.relationships.map((item) => entity({ entityId: item.id, kind: item.kind,
      typeId: null, containerId: null, systemId: null, fromId: item.source, toId: item.target, document: item })),
  ];
}

export async function* fromArray(items: StoredEntity[]): AsyncGenerator<StoredEntity> { yield* items; }
