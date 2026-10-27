import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDemoServer } from './server.ts';
import { ProjectClient } from './room-store.ts';
import { ProjectEvidenceClient } from './project-evidence-client.ts';
import { initializeSyntheticEvidence } from './synthetic-pilot-client.ts';
import { RoomRepository } from '../src/room-model.ts';
import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';

test('generated evidence setup resumes after a disconnected upload without duplicate claims or accepted-model changes', { timeout: 60_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-synthetic-setup-'));
  const server = await createDemoServer({ modelWorker: null, codex: null, backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await server.closeModelWorkers(); await fs.rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an isolated server port.');
  const origin = `http://127.0.0.1:${address.port}`;
  let uploads = 0; let disconnected = false;
  const request: typeof fetch = async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api/')) throw new Error('Expected a same-origin project API path.');
    if (init?.method === 'POST' && /\/sources\//.test(input)) {
      uploads++;
      if (!disconnected && uploads === 2) { disconnected = true; throw new Error('Simulated lost connection during sample setup.'); }
    }
    return fetch(new URL(input, origin), init);
  };
  const projects = new ProjectClient(request); const evidence = new ProjectEvidenceClient(request);
  const fixture = syntheticResidentialFixture();
  const original = await RoomRepository.createProject({ projectId: randomUUID(), name: 'Generated residential sample', snapshot: fixture.snapshot });
  const repository = await projects.register(original);
  const signal = AbortSignal.timeout(30_000);
  await assert.rejects(initializeSyntheticEvidence(repository, signal, request), /lost connection/);
  await initializeSyntheticEvidence(repository, signal, request);
  await initializeSyntheticEvidence(repository, signal, request);
  const sources = await evidence.sources(repository.projectId); const claims = await evidence.evidence(repository.projectId);
  assert.equal(sources.sources.length, 3); assert.equal(claims.entries.length, 3);
  assert.equal(sources.next, null); assert.equal(claims.next, null);
  assert.deepEqual(new Set(claims.entries.map(item => item.entry.assertion.kind)), new Set(['documented']));
  const partition = claims.entries.filter(item => item.entry.anchor.entityId === 'wall-living-kitchen');
  assert.deepEqual(partition.map(item => item.entry.assertion).flatMap(assertion => 'value' in assertion && assertion.value.kind === 'length' ? [assertion.value.value] : []).sort(), [5, 5.2]);
  const current = await projects.read(repository.projectId);
  assert.equal(current.serialize(), repository.serialize());
  assert.ok(claims.entries.every(item => item.entry.anchor.target.kind === 'main' && item.entry.anchor.revisionId === repository.root()));
});

test('sample initialization refuses a different house before reading or uploading private sources', async () => {
  const repository = await RoomRepository.create('User house');
  let calls = 0;
  const request: typeof fetch = async () => { calls++; throw new Error('Must not contact the server.'); };
  await assert.rejects(initializeSyntheticEvidence(repository, new AbortController().signal, request), /only initialize the generated/);
  assert.equal(calls, 0);
});
