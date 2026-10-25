import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { FixtureSchema, parseFixture } from '../fixtures/fixture.ts';
import type { Fixture } from '../fixtures/fixture.ts';
import { canonical } from '../storage/contract.ts';

const options = { additionalProperties: false };
export const HistoryV1Schema = Type.Object({ format: Type.Literal('w6-history-v1'),
  dictionary: Type.Literal('owners-v1'), model: FixtureSchema }, options);
export const HistoryV2Schema = Type.Object({ format: Type.Literal('w6-history-v2'),
  dictionary: Type.Literal('disciplines-v2'), contents: FixtureSchema }, options);

function dictionary(fixture: Fixture, direction: 'upgrade' | 'read'): Fixture {
  const keys = direction === 'upgrade'
    ? new Map([['mechanicalOwner', 'mechanicalDiscipline'], ['electricalOwner', 'electricalDiscipline']])
    : new Map([['mechanicalDiscipline', 'mechanicalOwner'], ['electricalDiscipline', 'electricalOwner']]);
  return parseFixture({ ...fixture, entities: fixture.entities.map((entity) => ({ ...entity,
    properties: Object.fromEntries(Object.entries(entity.properties).map(([name, value]) => [keys.get(name) ?? name, value])),
  })) });
}

export function encodeHistory(fixture: Fixture, version: 'v1' | 'v2'): Buffer {
  const validated = parseFixture(fixture);
  return version === 'v1'
    ? Buffer.from(canonical({ format: 'w6-history-v1', dictionary: 'owners-v1', model: validated }))
    : Buffer.from(JSON.stringify({ format: 'w6-history-v2', dictionary: 'disciplines-v2', contents: dictionary(validated, 'upgrade') }, null, 2));
}

export function readHistoryV1(bytes: Uint8Array): Fixture {
  const raw: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!Check(HistoryV1Schema, raw)) throw new Error('Pinned v1 reader requires its original format and dictionary.');
  return parseFixture(raw.model);
}

export function readHistory(bytes: Uint8Array): Fixture {
  const raw: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (Check(HistoryV1Schema, raw)) return parseFixture(raw.model);
  if (Check(HistoryV2Schema, raw)) return dictionary(parseFixture(raw.contents), 'read');
  throw new Error('No pinned history reader for this representation.');
}
