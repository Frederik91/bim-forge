import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { Type } from 'typebox';
import { parse, hash, errorMessage } from '../../../../experiments/storage/contract.ts';
import { Storage } from '../../../../experiments/storage/store.ts';
import { runWorkload } from '../../../../experiments/storage/workload-profile.ts';
import { initializeProbe, assertPlans, phase } from './probe.ts';

const client = new Client({ connectionString: process.env.DATABASE_URL });
const expectedFingerprint = {
  count: 270205,
  sum: '7a7dce5cc0865f0bf3aa82a0fe14ca5a115e8a5258b60a4f24442bb7d5600082',
  xor: '50c0078fc4df5d1d4fca3e065a4ea698cf7d53cae90fceb20a6a9ffe2cce472a',
};
try {
  if (!process.env.QVM_EXECUTION_LEASE) throw new Error('Missing coordinator lease');
  await client.connect();
  const store = new Storage(client);
  await store.initialize();
  await initializeProbe(client);
  const raw: unknown = JSON.parse(await readFile('/e/config.json', 'utf8'));
  const observations = await runWorkload(store, raw, '/e/run');
  if (observations.length === 0 || observations.some((row) => !row.passed)) throw new Error('Original workload oracle failed');
  assertPlans();
  const loaded: unknown = JSON.parse(await readFile('/e/run/load.json', 'utf8'));
  const Load = Type.Object({ revisionId: Type.String(), fingerprint: Type.Object({ count: Type.Integer(), sum: Type.String(), xor: Type.String() }) }, { additionalProperties: true });
  const summary = parse(Load, loaded, 'completed load');
  if (hash(summary.fingerprint) !== hash(expectedFingerprint)) throw new Error('Pinned reduced fingerprint differs');
  const [state] = await store.rows(Type.Object({ valid: Type.Boolean() }), `SELECT (
    (SELECT count(*) FROM qvm_storage.versions)=270205 AND
    (SELECT count(*) FROM qvm_storage.changes)=270205 AND
    (SELECT count(*) FROM qvm_storage.visibility)=270205 AND
    (SELECT count(*) FROM qvm_storage.revisions)=1 AND
    (SELECT count(*) FROM qvm_storage.branches)=1 AND
    (SELECT count(*) FROM qvm_storage.receipts)=1 AND
    EXISTS(SELECT 1 FROM qvm_storage.branches WHERE head=$1) AND
    EXISTS(SELECT 1 FROM qvm_storage.receipts WHERE revision_id=$1 AND payload_hash=$1)
  ) AS valid`, [summary.revisionId]);
  if (!state?.valid) throw new Error('Exact published state differs');
  await phase(store, 'complete-readback-after');
  await writeFile('/e/profile-result.json', `${JSON.stringify({ status: 'PASS', observations, fingerprint: summary.fingerprint,
    revisionId: summary.revisionId, claim: 'One instrumented reduced diagnostic. No whole-admission speedup or full-capacity claim.' }, null, 2)}\n`, { flag: 'wx' });
} catch (error) {
  await writeFile('/e/profile-error.json', `${JSON.stringify({ status: 'ISSUES', error: errorMessage(error) })}\n`, { flag: 'wx' });
  process.exitCode = 1;
} finally {
  await client.end();
}
