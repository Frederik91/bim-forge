import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { parse } from './contract.ts';

const filename = process.argv[2];
if (!filename) throw new Error('Expected V8 CPU profile');
const schema = Type.Object({ nodes: Type.Array(Type.Object({ id: Type.Integer(),
  callFrame: Type.Object({ functionName: Type.String(), url: Type.String() }),
  children: Type.Optional(Type.Array(Type.Integer())) })), samples: Type.Array(Type.Integer()) });
const profile = parse(schema, JSON.parse(await readFile(filename, 'utf8')), 'V8 CPU profile');
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const counts = new Map<number, number>();
const parents = new Map<number, number>();
for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
let typeboxSamples = 0;
for (const id of profile.samples) {
  let current: number | undefined = id;
  while (current !== undefined) {
    if (nodes.get(current)?.callFrame.url.includes('/typebox/')) { typeboxSamples += 1; break; }
    current = parents.get(current);
  }
}
process.stdout.write(`${JSON.stringify({ totalSamples: profile.samples.length, typeboxInclusiveSamples: typeboxSamples,
  typeboxInclusiveFraction: typeboxSamples / profile.samples.length,
  topSelf: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, count]) => ({
    count, fraction: count / profile.samples.length, ...nodes.get(id)?.callFrame,
  })) }, null, 2)}\n`);
