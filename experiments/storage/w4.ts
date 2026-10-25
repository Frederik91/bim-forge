import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { Type } from 'typebox';
import { entity, parse, JsonSchema, JsonObjectSchema, HashSchema } from './contract.ts';
import type { Json, StoredEntity } from './contract.ts';
import { fileHash } from './load.ts';
import { boundedLines } from './lines.ts';

const file = Type.Object({ file: Type.String({ minLength: 1 }), sha256: HashSchema, rows: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const W4InputSchema = Type.Object({
  schemaVersion: Type.Literal(1), sourceManifest: Type.Object({ file: Type.String({ minLength: 1 }), sha256: HashSchema }, { additionalProperties: false }),
  tables: Type.Object({ entities: file, relationships: file, parameters: file }, { additionalProperties: false }),
}, { additionalProperties: false });
const digest = Type.Object({ sha256: HashSchema, rows: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export const W4GeneratorSchema = Type.Object({
  schemaVersion: Type.Literal(1), sourceManifest: Type.Object({ file: Type.String({ minLength: 1 }), sha256: HashSchema }, { additionalProperties: false }),
  generator: Type.Object({ cli: Type.String({ minLength: 1 }), profile: Type.String({ minLength: 1 }),
    scale: Type.String({ minLength: 1 }), seed: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  tables: Type.Object({ entities: digest, relationships: digest, parameters: digest }, { additionalProperties: false }),
}, { additionalProperties: false });

function identifier(value: string | null): string {
  if (value === null || !/^[1-9][0-9]*$/.test(value) || value.length > 19) throw new Error('Invalid positive W4 bigint');
  return value;
}
function id(prefix: string, value: string | null): string { return `${prefix}:${identifier(value).padStart(19, '0')}`; }
function optionalEntityId(value: string | null): string | null { return value === null ? null : id('entity', value); }
function text(value: string | null): string {
  if (!value) throw new Error('Missing W4 text column');
  return value;
}
function json(value: string | null): Json {
  if (value === null) throw new Error('Unexpected SQL null JSON cell');
  const document: unknown = JSON.parse(value);
  return parse(JsonSchema, document, 'W4 JSON cell');
}
function properties(value: string | null): Record<string, Json> {
  return parse(JsonObjectSchema, json(value), 'W4 typed property object');
}

export function decodeCopyCell(value: string): string | null {
  if (value === '\\N') return null;
  const escapes: Record<string, string> = { '\\': '\\', t: '\t', r: '\r', n: '\n', b: '\b', f: '\f', v: '\v' };
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') { decoded += character; continue; }
    const next = value[++index];
    if (next === undefined || escapes[next] === undefined) throw new Error('Unsupported or incomplete W4 COPY escape');
    decoded += escapes[next];
  }
  return decoded;
}

export function w4Record(table: 'entities' | 'relationships' | 'parameters', cells: (string | null)[]): StoredEntity {
  const at = (index: number): string | null => {
    const value = cells[index];
    if (value === undefined) throw new Error('Missing W4 cell');
    return value;
  };
  const size = { entities: 10, relationships: 6, parameters: 8 };
  if (cells.length !== size[table]) throw new Error(`Invalid W4 ${table} column count`);
  if (table === 'entities') {
    const document = { id: identifier(at(0)), kind: text(at(1)), ordinal: identifier(at(2)), type_id: at(3), space_id: at(4),
      system_id: at(5), revision_id: identifier(at(6)), properties: properties(at(7)), payload: json(at(8)), source: json(at(9)) };
    return entity({ entityId: id('entity', at(0)), kind: document.kind, typeId: optionalEntityId(at(3)),
      containerId: optionalEntityId(at(4)), systemId: optionalEntityId(at(5)), fromId: null, toId: null, document });
  }
  if (table === 'relationships') {
    const document = { id: identifier(at(0)), kind: text(at(1)), source_id: identifier(at(2)), target_id: identifier(at(3)),
      revision_id: identifier(at(4)), properties: properties(at(5)) };
    return entity({ entityId: id('relationship', at(0)), kind: document.kind, typeId: null, containerId: null, systemId: null,
      fromId: id('entity', at(2)), toId: id('entity', at(3)), document });
  }
  const dependency = optionalEntityId(at(5));
  const document = { id: identifier(at(0)), entity_id: identifier(at(1)), name: text(at(2)), kind: text(at(3)), value: json(at(4)),
    depends_on_entity_id: at(5), revision_id: identifier(at(6)), properties: properties(at(7)) };
  return entity({ entityId: id('parameter', at(0)), kind: `parameter:${document.kind}`, typeId: null,
    containerId: id('entity', at(1)), systemId: null, fromId: dependency === null ? null : id('entity', at(1)), toId: dependency, document });
}

export async function* w4Input(filename: string): AsyncGenerator<StoredEntity> {
  const raw: unknown = JSON.parse(await readFile(filename, 'utf8'));
  const manifest = parse(W4InputSchema, raw, 'W4 admission manifest');
  const resolve = (file: string): string => path.resolve(path.dirname(filename), file);
  if (await fileHash(resolve(manifest.sourceManifest.file)) !== manifest.sourceManifest.sha256) throw new Error('W4 source manifest hash mismatch');
  // Verify all exact source bytes before publishing anything. Row count is checked again while streaming.
  for (const source of Object.values(manifest.tables)) {
    if (await fileHash(resolve(source.file)) !== source.sha256) throw new Error(`W4 table hash mismatch: ${source.file}`);
  }
  const tables: ('entities' | 'relationships' | 'parameters')[] = ['entities', 'relationships', 'parameters'];
  for (const table of tables) {
    const source = manifest.tables[table];
    const input = createReadStream(resolve(source.file));
    let rows = 0;
    try {
      for await (const line of boundedLines(input)) {
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('W4 row exceeds 4 MiB admission bound');
        yield w4Record(table, line.split('\t').map(decodeCopyCell));
        rows += 1;
      }
    } finally { input.destroy(); }
    if (rows !== source.rows) throw new Error(`W4 ${table} row count mismatch: ${rows} != ${source.rows}`);
  }
}

export async function* w4Generator(filename: string): AsyncGenerator<StoredEntity> {
  if (!process.env.QVM_EXECUTION_LEASE) throw new Error('Coordinator lease required for W4 generation');
  const raw: unknown = JSON.parse(await readFile(filename, 'utf8'));
  const admission = parse(W4GeneratorSchema, raw, 'W4 direct generator admission');
  const resolve = (file: string): string => path.resolve(path.dirname(filename), file);
  if (await fileHash(resolve(admission.sourceManifest.file)) !== admission.sourceManifest.sha256) throw new Error('W4 source manifest hash mismatch');
  const tables: ('entities' | 'relationships' | 'parameters')[] = ['entities', 'relationships', 'parameters'];
  for (const table of tables) {
    const producer = spawn(process.execPath, [resolve(admission.generator.cli), '--profile', resolve(admission.generator.profile),
      '--scale', admission.generator.scale, '--seed', admission.generator.seed, '--table', table], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    producer.stderr.setEncoding('utf8');
    producer.stderr.on('data', (chunk: unknown) => { if (typeof chunk === 'string') stderr = (stderr + chunk).slice(-32768); });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      producer.once('error', reject);
      producer.once('close', (code, signal) => resolve({ code, signal }));
    });
    // A hashing Transform preserves exact COPY bytes while its bounded buffers apply backpressure.
    const checksum = createHash('sha256');
    const tapped = new Transform({ transform(chunk: unknown, _encoding, callback) {
      if (!Buffer.isBuffer(chunk)) { callback(new Error('Expected generator bytes')); return; }
      checksum.update(chunk); callback(null, chunk);
    } });
    producer.stdout.pipe(tapped);
    let rows = 0;
    try {
      for await (const line of boundedLines(tapped)) {
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('W4 generated row exceeds bound');
        yield w4Record(table, line.split('\t').map(decodeCopyCell)); rows += 1;
      }
      const status = await exit;
      if (status.code !== 0) throw new Error(`W4 ${table} producer failed: ${status.code}/${status.signal}: ${stderr}`);
      if (rows !== admission.tables[table].rows || checksum.digest('hex') !== admission.tables[table].sha256) {
        throw new Error(`W4 generated ${table} byte hash/row oracle mismatch`);
      }
    } finally {
      tapped.destroy(); producer.stdout.destroy(); producer.stderr.destroy();
      if (producer.exitCode === null && producer.signalCode === null) producer.kill('SIGTERM');
      await exit.catch(() => undefined);
    }
  }
}
