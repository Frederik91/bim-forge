import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

export const JsonSchema = Type.Cyclic({
  Json: Type.Union([Type.Null(), Type.Boolean(), Type.Number(), Type.String(),
    Type.Array(Type.Ref('Json')), Type.Record(Type.String(), Type.Ref('Json'))]),
}, 'Json');
export type Json = Static<typeof JsonSchema>;
export const JsonObjectSchema = Type.Record(Type.String(), JsonSchema);
export const IdSchema = Type.String({ minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' });
export const HashSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const nullableId = Type.Union([IdSchema, Type.Null()]);
export const EntitySchema = Type.Object({
  entityId: IdSchema, kind: IdSchema, typeId: nullableId, containerId: nullableId, systemId: nullableId,
  fromId: nullableId, toId: nullableId, document: JsonObjectSchema,
}, { additionalProperties: false });
export type StoredEntity = Static<typeof EntitySchema>;
export const CommandSchema = Type.Object({
  branch: IdSchema, commandId: IdSchema, expectedHead: Type.Union([HashSchema, Type.Null()]),
  assumptions: Type.Array(Type.Object({ entityId: IdSchema, versionId: Type.Union([HashSchema, Type.Null()]) },
    { additionalProperties: false }), { maxItems: 10000 }),
  puts: Type.Array(EntitySchema, { maxItems: 2000 }), deletes: Type.Array(IdSchema, { maxItems: 2000 }),
}, { additionalProperties: false });
export type Command = Static<typeof CommandSchema>;
export { ObservationSchema } from '../contracts/schema.ts';
export type { Observation } from '../contracts/schema.ts';

const validators = new WeakMap<TSchema, (value: unknown) => boolean>();
function checkCompiled<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  let check = validators.get(schema);
  if (!check) {
    const validator = Compile(schema);
    check = (input: unknown): boolean => validator.Check(input);
    validators.set(schema, check);
  }
  return check(value);
}

export function parse<T extends TSchema>(schema: T, value: unknown, label: string): Static<T> {
  if (!checkCompiled(schema, value)) throw new Error(`Invalid ${label}`);
  return value;
}

export function entity(value: unknown): StoredEntity {
  const result = parse(EntitySchema, value, 'storage entity');
  if ((result.fromId === null) !== (result.toId === null)) throw new Error('Both relationship endpoints are required');
  return result;
}

export function command(value: unknown): Command {
  const result = parse(CommandSchema, value, 'acceptance command');
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024) throw new Error('Command exceeds 8 MiB bound');
  const assumptions = new Set(result.assumptions.map((item) => item.entityId));
  if (assumptions.size !== result.assumptions.length) throw new Error('Duplicate read assumption');
  const changes = [...result.puts.map((item) => entity(item).entityId), ...result.deletes];
  if (new Set(changes).size !== changes.length) throw new Error('Duplicate write or overlapping put/delete');
  if (changes.some((id) => !assumptions.has(id))) throw new Error('Every write requires a semantic read assumption');
  return result;
}

export function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => {
    const child = value[key];
    if (child === undefined) throw new Error('Undefined JSON value');
    return `${JSON.stringify(key)}:${canonical(child)}`;
  }).join(',')}}`;
}

export function hash(value: Json): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
