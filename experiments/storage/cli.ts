import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { Storage } from './store.ts';
import { command, errorMessage, parse, IdSchema, HashSchema } from './contract.ts';
import { envelopes, fileHash, inspectBranch, load } from './load.ts';
import { fixtureEnvelopes, fromArray } from './fixture.ts';
import { nativeEnvelopes } from './baseline.ts';
import { runWorkload } from './workload.ts';
import { w4Input, w4Generator } from './w4.ts';
import { verifySelectionFile } from './selections.ts';

function argument(index: number): string {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing CLI argument ${index - 2}`);
  return value;
}
function limit(index: number): number {
  const value = Number(argument(index));
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) throw new Error('Limit must be an integer from 1 to 10000');
  return value;
}
async function jsonFile(filename: string): Promise<unknown> { return JSON.parse(await readFile(filename, 'utf8')); }
function boundedArgument(index: number, fallback: number, maximum: number): number {
  const value = process.argv[index] === undefined ? fallback : Number(argument(index));
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Argument ${index - 2} must be 1..${maximum}`);
  return value;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  if (!process.env.DATABASE_URL || !process.env.QVM_EXECUTION_LEASE) throw new Error('DATABASE_URL and coordinator QVM_EXECUTION_LEASE are required');
  await client.connect();
  const store = new Storage(client);
  await store.assertIsolated();
  const operation = argument(2);
  let result: unknown;
  switch (operation) {
    case 'init': await store.initialize(); result = { initialized: true }; break;
    case 'branch': await store.createBranch({ branch: argument(3), revisionId: argument(4) === 'empty' ? null : parse(HashSchema, argument(4), 'revision') }); result = { created: true }; break;
    case 'head': result = { head: await store.head(argument(3)) }; break;
    case 'open': result = await store.projectOpen({ branch: argument(3), limit: limit(4) }); break;
    case 'accept': result = await store.accept(command(await jsonFile(argument(3)))); break;
    case 'load': result = { ...await load(store, envelopes(argument(3)), argument(4)), fileSha256: await fileHash(argument(3)) }; break;
    case 'load-fixture': result = await load(store, fromArray(fixtureEnvelopes(await jsonFile(argument(3)))), argument(4)); break;
    case 'load-w4': result = await load(store, w4Input(argument(3)), argument(4)); break;
    case 'load-w4-generator': result = await load(store, w4Generator(argument(3)), argument(4)); break;
    case 'load-native': result = await load(store, fromArray(nativeEnvelopes(await jsonFile(argument(3))).entities), argument(4)); break;
    case 'page': result = await store.page({ branch: argument(3), after: argument(4) === 'start' ? '' : argument(4), limit: limit(5) }); break;
    case 'historical': result = await store.historical({ revisionId: argument(3), after: argument(4) === 'start' ? '' : argument(4), limit: limit(5) }); break;
    case 'history': result = await store.history(parse(IdSchema, argument(3), 'entity id')); break;
    case 'delta': result = await store.delta(parse(HashSchema, argument(3), 'revision id')); break;
    case 'fingerprint': result = await inspectBranch(store, argument(3)); break;
    case 'metrics': result = await store.metrics(); break;
    case 'property-counts': result = await store.propertyCounts(argument(3)); break;
    case 'verify-selections': {
      const verified = await verifySelectionFile(store, argument(3), { branch: argument(4),
        pageSize: boundedArgument(5, 1000, 1000), maximumRows: boundedArgument(6, 1000000, 100000000),
        statementTimeoutMs: boundedArgument(7, 30000, 3600000), wallTimeMs: boundedArgument(8, 900000, 3600000) });
      result = verified;
      if (!verified.passed) process.exitCode = 1;
      break;
    }
    case 'workload': result = await runWorkload(store, await jsonFile(argument(3)), argument(4)); break;
    default: throw new Error(`Unknown operation ${operation}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: errorMessage(error) })}\n`);
  process.exitCode = 1;
} finally { await client.end(); }
