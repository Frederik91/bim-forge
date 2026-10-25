import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { boundedLines } from './lines.ts';
import { decodeCopyCell, w4Record } from './w4.ts';
import { canonical, entity, hash } from './contract.ts';

const filename = process.argv[2];
if (!filename) throw new Error('Expected actual W4 entities COPY file');
const selected: string[] = [];
const kinds = new Map<string, number>();
let sourceRows = 0;
const sourceHash = createHash('sha256').update(await readFile(filename)).digest('hex');
for await (const line of boundedLines(createReadStream(filename))) {
  sourceRows += 1;
  const kind = line.split('\t')[1];
  if (!kind) throw new Error('Missing source kind');
  const count = kinds.get(kind) ?? 0;
  if (count < 2) { selected.push(line); kinds.set(kind, count + 1); }
}
const stages: Record<string, number> = { copyDecodeMs: 0, wireAdmissionMs: 0, repeatEntityCheckMs: 0, canonicalMs: 0, hashMs: 0 };
let bytes = 0;
let admitted = 0;
const outputHash = createHash('sha256');
const started = performance.now();
for (const line of selected) {
  let start = performance.now();
  const cells = line.split('\t').map(decodeCopyCell);
  stages.copyDecodeMs += performance.now() - start;
  start = performance.now();
  const record = w4Record('entities', cells);
  stages.wireAdmissionMs += performance.now() - start;
  start = performance.now();
  entity(record);
  stages.repeatEntityCheckMs += performance.now() - start;
  start = performance.now();
  const encoded = canonical(record);
  stages.canonicalMs += performance.now() - start;
  bytes += Buffer.byteLength(encoded);
  start = performance.now();
  outputHash.update(hash(record));
  stages.hashMs += performance.now() - start;
  admitted += 1;
}
process.stdout.write(`${JSON.stringify({ sourceHash, sourceRows, selectedRows: selected.length, admitted, bytes,
  kinds: Object.fromEntries(kinds), stages, elapsedMs: performance.now() - started,
  outputHash: outputHash.digest('hex'), node: process.version, cpu: process.cpuUsage(), memory: process.memoryUsage() }, null, 2)}\n`);
