import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseRun, parseObservations } from './schema.ts';
import { publishRun, verifyRun } from './records.ts';

const [command, input, evidenceRoot, output] = process.argv.slice(2);
if (input === undefined) throw new Error('Usage: cli.ts observations|verify|publish input.json [evidence-root] [results-root]');
const value: unknown = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
if (command === 'observations') {
  const observations = parseObservations(value);
  process.stdout.write(`${JSON.stringify({ count: observations.length, failed: observations.filter(item => !item.passed).length })}\n`);
} else if (command === 'verify' || command === 'publish') {
  if (evidenceRoot === undefined) throw new Error('Evidence root is required.');
  const run = parseRun(value);
  const roots = { repository: process.cwd(), evidence: resolve(evidenceRoot) };
  if (command === 'verify') { await verifyRun(run, roots); process.stdout.write(`${run.experimentId} verified\n`); }
  else {
    if (output === undefined) throw new Error('Results root is required.');
    process.stdout.write(`${await publishRun(run, { ...roots, results: resolve(output) })}\n`);
  }
} else throw new Error('Unknown qualification command.');
