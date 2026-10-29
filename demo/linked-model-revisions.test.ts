import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { LinkedModelStore } from './linked-model-store.ts';
import { handleLinkedModelRoute } from './linked-model-routes.ts';
import { IDENTITY_LINK_TRANSFORM, MAX_LINK_REVISIONS, linkedDelta, parseLinkedJob, parseLinkedPrepared, parseLinkedReview } from '../src/linked-model.ts';
import type { LinkedJob, LinkedSelection } from '../src/linked-model.ts';

const gid = '0000000000000000000001';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const source = (text: string) => Buffer.from(`ISO-10303-21;/* synthetic lifecycle fixture: ${text} */END-ISO-10303-21;`);
function setup(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ifc232-')); const data = path.join(root, 'private'); const spool = path.join(root, 'spool');
  const store = LinkedModelStore.open({ root: data, spool });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { data, spool, store, projectId: randomUUID() };
}
/** Synthetic prepared artifacts test lifecycle integrity, not IFC conversion accuracy. Real IFC is qualified separately. */
function complete(input: { spool: string; job: LinkedJob; bytes: Buffer; offset?: number; name?: string; globalId?: string; corrupt?: boolean }) {
  const ref = { ...input.job.source, globalId: input.globalId ?? gid }; const transform = structuredClone(IDENTITY_LINK_TRANSFORM);
  const row = transform[0]; assert.ok(row); row[3] = input.offset ?? 0;
  const index = { source: input.job.source, schema: 'IFC4', unitScaleToMetres: 1, units: [], georeferencing: { applied: false, inventory: [] },
    objects: [{ ref, ifcClass: 'IfcWall', name: input.name ?? 'Wall', properties: [{ name: 'FireRating', value: 'EI60' }] }], spatial: [], relationships: [], placements: [] };
  const geometry = { source: input.job.source, frame: 'source-engineering-metres', meshes: [{ ref, productToSourceMetres: transform, verticesMetres: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] }] };
  const indexBytes = Buffer.from(JSON.stringify(index)); const geometryBytes = Buffer.from(JSON.stringify(geometry));
  const artifact = (bytes: Buffer) => ({ bytes: bytes.length, sha256: sha(bytes) });
  const manifest = { format: 'bim-forge-ifc-link', version: 1, state: 'complete', readOnly: true, source: input.job.source,
    schema: 'IFC4', tool: { ifcopenshell: '0.9.0.post1' }, occurrence: { id: input.job.occurrence, sourceToProjectMetres: structuredClone(IDENTITY_LINK_TRANSFORM) },
    artifacts: { 'original.ifc': artifact(input.bytes), 'index.json': artifact(indexBytes), 'geometry.json': artifact(geometryBytes) },
    counts: { entities: 1, objects: 1, products: 1, meshes: 1, vertices: 3, triangles: 1 }, diagnostics: [], losses: [] };
  const prepared = parseLinkedPrepared({ manifest, index, geometry });
  const directory = path.join(input.spool, input.job.id); const output = path.join(directory, 'output'); fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'index.json'), indexBytes); fs.writeFileSync(path.join(output, 'geometry.json'), input.corrupt ? Buffer.concat([geometryBytes, Buffer.from(' ')]) : geometryBytes);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest)); fs.writeFileSync(path.join(directory, 'terminal.json'), JSON.stringify({ kind: 'complete' }));
  return prepared;
}
function attachReady(input: ReturnType<typeof setup>, text = 'v1') {
  const bytes = source(text); const job = input.store.attach({ projectId: input.projectId, name: `${text}.ifc`, bytes });
  complete({ spool: input.spool, job, bytes }); input.store.refresh();
  return { job, bytes, prepared: input.store.prepared(input.projectId, job.id) };
}
function selection(prepared: ReturnType<LinkedModelStore['prepared']>): LinkedSelection {
  const object = prepared.index.objects[0]; assert.ok(object);
  return { kind: 'ifc-reference', source: object.ref, occurrence: prepared.manifest.occurrence };
}

test('replacement stages separately, adopts atomically, retains original pins and never remaps removed/reused IDs', t => {
  const input = setup(t); const { store, projectId, spool } = input; const first = attachReady(input);
  const originalPin = selection(first.prepared); const oldToken = store.snapshotCurrent(projectId).catalogToken;
  const bytes = source('v2 moved'); const candidate = store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'v2.ifc', bytes });
  assert.notEqual(candidate.id, candidate.source.namespace); assert.equal(candidate.source.namespace, first.job.source.namespace); assert.equal(candidate.occurrence, first.job.occurrence);
  const request: unknown = JSON.parse(fs.readFileSync(path.join(spool, candidate.id, 'request.json'), 'utf8'));
  assert.ok(typeof request === 'object' && request !== null && 'id' in request && 'occurrence' in request);
  assert.equal(request.id, candidate.id); assert.equal(request.occurrence, first.job.occurrence);
  assert.equal(store.snapshotCurrent(projectId).catalogToken, oldToken, 'staging does not change current or its concurrency token');
  complete({ spool, job: candidate, bytes, offset: 2 }); store.refresh();
  assert.equal(store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'v2.ifc', bytes }).id, candidate.id, 'lost prepare response reuses the matching candidate');
  assert.equal(store.snapshotCurrent(projectId).catalogToken, oldToken);
  assert.deepEqual(store.reviewCandidate(projectId, first.job.id, candidate.id).delta.moved, [gid]);
  assert.deepEqual(store.reviewCandidate(projectId, first.job.id, candidate.id).delta.ambiguous, [gid]);
  assert.deepEqual(store.original(projectId, first.job.id), first.bytes);
  const adopted = store.adopt({ projectId, linkId: first.job.id, candidateId: candidate.id, expectedGeneration: 1 }); assert.equal(adopted.generation, 2);
  assert.deepEqual(store.adopt({ projectId, linkId: first.job.id, candidateId: candidate.id, expectedGeneration: 1 }), adopted, 'retry converges');
  assert.deepEqual(store.original(projectId, first.job.id), bytes); assert.deepEqual(store.originalVersion(projectId, first.job.id), first.bytes);
  assert.equal(store.readVersion(projectId, originalPin).kind, 'ok'); assert.deepEqual(store.resolve(projectId, originalPin, 'current'), { kind: 'unavailable', reason: 'stale' });
  assert.equal(store.readVersion(randomUUID(), originalPin).kind, 'unavailable');
  assert.throws(() => store.adopt({ projectId: randomUUID(), linkId: first.job.id, candidateId: candidate.id, expectedGeneration: 2 }), /unavailable/);
  assert.throws(() => store.originalVersion(randomUUID(), candidate.id), /unavailable/);
  const changed = structuredClone(first.prepared); const object = changed.index.objects[0]; const mesh = changed.geometry.meshes[0]; assert.ok(object && mesh);
  object.ref.globalId = '0000000000000000000002'; mesh.ref.globalId = object.ref.globalId;
  const delta = linkedDelta(first.prepared, parseLinkedPrepared(changed)); assert.deepEqual(delta.removed, [gid]); assert.deepEqual(delta.added, [object.ref.globalId]);
});

test('corrupt, cancelled, oversize and interrupted candidates preserve usable current and source bytes across reopen', t => {
  const input = setup(t); const first = attachReady(input); const { store, projectId, spool, data } = input;
  const token = store.snapshotCurrent(projectId).catalogToken;
  assert.throws(() => store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'huge.ifc', bytes: Buffer.alloc(2 * 1024 * 1024 + 1) }), /2 MiB/);
  const bytes = source('corrupt'); const corrupt = store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'corrupt.ifc', bytes });
  complete({ spool, job: corrupt, bytes, corrupt: true }); store.refresh();
  assert.equal(store.catalog(projectId)[0]?.versions.find(version => version.job.id === corrupt.id)?.job.kind, 'failed');
  const cancelled = store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'cancelled.ifc', bytes: source('cancel') });
  store.cancel(projectId, cancelled.id); complete({ spool, job: cancelled, bytes: source('cancel') }); store.refresh();
  assert.equal(store.catalog(projectId)[0]?.versions.find(version => version.job.id === cancelled.id)?.job.kind, 'cancelled');
  const interrupted = store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'interrupted.ifc', bytes: source('restart') });
  const second = LinkedModelStore.open({ root: data, spool }); t.after(() => second.close());
  assert.equal(second.catalog(projectId)[0]?.versions.find(version => version.job.id === interrupted.id)?.job.kind, 'queued', 'another process opening is not a restart authority');
  fs.writeFileSync(path.join(spool, interrupted.id, 'terminal.json'), JSON.stringify({ kind: 'failed', error: 'Converter interrupted by restart.' })); second.refresh();
  assert.equal(store.snapshotCurrent(projectId).catalogToken, token); assert.deepEqual(second.original(projectId, first.job.id), first.bytes);
  assert.deepEqual(second.prepared(projectId, first.job.id), first.prepared);
});

test('placement is independent, rigid, bounded, CAS protected and retains historical occurrence transform', t => {
  const input = setup(t); const first = attachReady(input); const { store, projectId, spool } = input;
  const candidateBytes = source('next'); const candidate = store.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'next.ifc', bytes: candidateBytes });
  complete({ spool, job: candidate, bytes: candidateBytes }); store.refresh();
  const transformed = [[0, -1, 0, 12], [1, 0, 0, -3], [0, 0, 1, 4], [0, 0, 0, 1]];
  const placed = store.place({ projectId, linkId: first.job.id, expectedGeneration: 1, sourceToProjectMetres: transformed }); assert.equal(placed.generation, 2);
  assert.deepEqual(store.prepared(projectId, first.job.id).manifest.occurrence.sourceToProjectMetres, transformed);
  assert.deepEqual(store.original(projectId, first.job.id), first.bytes); assert.equal(store.readVersion(projectId, selection(first.prepared)).kind, 'ok');
  assert.throws(() => store.adopt({ projectId, linkId: first.job.id, candidateId: candidate.id, expectedGeneration: 2 }), /different current/);
  assert.deepEqual(store.place({ projectId, linkId: first.job.id, expectedGeneration: 1, sourceToProjectMetres: transformed }), placed, 'lost placement response reuses current state');
  assert.throws(() => store.place({ projectId, linkId: first.job.id, expectedGeneration: 1, sourceToProjectMetres: structuredClone(IDENTITY_LINK_TRANSFORM) }), /changed/);
  for (const bad of [NaN, Infinity, 1e7]) {
    const invalid = structuredClone(transformed); const row = invalid[0]; assert.ok(row); row[3] = bad;
    assert.throws(() => store.place({ projectId, linkId: first.job.id, expectedGeneration: 2, sourceToProjectMetres: invalid }), /transform/);
  }
  const reflection = [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  assert.throws(() => store.place({ projectId, linkId: first.job.id, expectedGeneration: 2, sourceToProjectMetres: reflection }), /Reflected/);
  const scale = [[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 1]];
  assert.throws(() => store.place({ projectId, linkId: first.job.id, expectedGeneration: 2, sourceToProjectMetres: scale }), /rigid/);
});

test('catalog guard fences separate SQLite connections/processes and rejects stale, nested and async publication', t => {
  const input = setup(t); const first = attachReady(input); const { store, projectId, spool, data } = input;
  const other = LinkedModelStore.open({ root: data, spool }); t.after(() => other.close());
  const snapshot = store.snapshotCurrent(projectId); let invoked = false;
  assert.deepEqual(store.withCatalogGuard(projectId, 'stale', () => { invoked = true; }), { kind: 'catalog-changed' }); assert.equal(invoked, false);
  assert.throws(() => store.withCatalogGuard(projectId, snapshot.catalogToken, async () => { invoked = true; }), /synchronous/); assert.equal(invoked, false);
  assert.throws(() => store.withCatalogGuard(projectId, snapshot.catalogToken, () => Promise.resolve(1)), /thenable/);
  assert.throws(() => store.withCatalogGuard(projectId, snapshot.catalogToken, () => store.withCatalogGuard(projectId, snapshot.catalogToken, () => 1)), /already in/);
  assert.throws(() => store.withCatalogGuard(projectId, snapshot.catalogToken, () => { throw new Error('native transaction rejected'); }), /native transaction/);
  const fenced = store.withCatalogGuard(projectId, snapshot.catalogToken, () => {
    assert.throws(() => other.place({ projectId, linkId: first.job.id, expectedGeneration: 1, sourceToProjectMetres: [[1, 0, 0, 2], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }), /locked/);
    const code = `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=20'); try { db.exec('BEGIN IMMEDIATE'); process.exitCode=9; } catch(e) { if (!(e instanceof Error) || !/locked/.test(e.message)) throw e; process.stdout.write('fenced'); } finally { db.close(); }`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', code, path.join(data, 'links.sqlite')], { encoding: 'utf8', timeout: 5000 }), 'fenced'); return 'native commit';
  });
  assert.deepEqual(fenced, { kind: 'committed', value: 'native commit' });
  assert.equal(other.snapshotCurrent(projectId).catalogToken, snapshot.catalogToken);
});

test('legacy ready rows upgrade deterministically and retained revision budgets fail without deleting originals', t => {
  const input = setup(t); const first = attachReady(input); const { store, projectId, spool, data } = input;
  store.close(); const database = new DatabaseSync(path.join(data, 'links.sqlite'));
  database.exec('DROP TABLE link_history; DROP TABLE link_versions; DROP TABLE link_catalog'); database.close();
  const upgraded = LinkedModelStore.open({ root: data, spool }); t.after(() => upgraded.close());
  assert.deepEqual(upgraded.prepared(projectId, first.job.id), first.prepared); assert.deepEqual(upgraded.original(projectId, first.job.id), first.bytes);
  for (let i = 1; i < MAX_LINK_REVISIONS; i++) {
    const job = upgraded.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: `${i}.ifc`, bytes: source(String(i)) }); upgraded.cancel(projectId, job.id);
  }
  assert.throws(() => upgraded.prepareReplacement({ projectId, linkId: first.job.id, expectedGeneration: 1, name: 'ninth.ifc', bytes: source('overflow') }), /retention limit/);
  assert.deepEqual(upgraded.originalVersion(projectId, first.job.id), first.bytes); assert.equal(upgraded.catalog(projectId)[0]?.versions.length, MAX_LINK_REVISIONS);
});

test('same GlobalId in another namespace is distinct, duplicate IDs fail, and corrupt active artifacts stay explicitly unavailable', t => {
  const input = setup(t); const first = attachReady(input); const { store, projectId, spool, data } = input;
  const other = attachReady(input, 'other occurrence');
  assert.equal(first.prepared.index.objects[0]?.ref.globalId, other.prepared.index.objects[0]?.ref.globalId);
  assert.notEqual(first.prepared.manifest.source.namespace, other.prepared.manifest.source.namespace);
  assert.throws(() => linkedDelta(first.prepared, other.prepared), /same namespace and occurrence/);
  const duplicate = structuredClone(first.prepared); const object = duplicate.index.objects[0]; assert.ok(object); duplicate.index.objects.push(structuredClone(object));
  assert.throws(() => parseLinkedPrepared(duplicate), /identity/);
  const forged = selection(first.prepared); forged.occurrence = structuredClone(other.prepared.manifest.occurrence);
  assert.deepEqual(store.readVersion(projectId, forged), { kind: 'unavailable', reason: 'missing' });
  const token = store.snapshotCurrent(projectId).catalogToken;
  const filename = path.join(data, 'prepared', first.job.id, 'geometry.json'); fs.chmodSync(filename, 0o600); fs.appendFileSync(filename, ' ');
  const current = store.snapshotCurrent(projectId); assert.notEqual(current.catalogToken, token); assert.equal(current.unavailable.length, 1); assert.equal(current.links.length, 1);
  let called = false; assert.deepEqual(store.withCatalogGuard(projectId, token, () => { called = true; }), { kind: 'catalog-changed' }); assert.equal(called, false);
  assert.equal(store.readVersion(projectId, selection(first.prepared)).kind, 'unavailable');
  assert.deepEqual(store.originalVersion(projectId, first.job.id), first.bytes);
});

test('revision routes enforce origin/project/version associations and retain exact historic downloads after adoption', async t => {
  const input = setup(t); const first = attachReady(input); const { store, projectId, spool } = input; const foreignProject = randomUUID();
  const socket = path.join(os.tmpdir(), `ifc232-${randomUUID()}.sock`);
  const server = http.createServer((request, response) => {
    void handleLinkedModelRoute({ request, response, store, hasProject: id => id === projectId || id === foreignProject,
      authorize: req => { if (req.headers.origin !== 'https://preview.example') throw new Error('Same-origin required.'); } })
      .then(handled => { if (!handled) { response.statusCode = 404; response.end(); } })
      .catch(error => { response.statusCode = 500; response.end(String(error)); });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const request = (url: string, options: { method?: string; body?: Buffer | string; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number | undefined; bytes: Buffer }>((resolve, reject) => {
      const req = http.request({ socketPath: socket, path: url, method: options.method ?? 'GET',
        headers: { Host: 'preview.example', Origin: 'https://preview.example', ...options.headers } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
        response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
      }); req.on('error', reject); req.end(options.body);
    });
  const root = `/api/projects/${projectId}/ifc-links`; const link = `${root}/${first.job.id}`;
  for (const suffix of ['/catalog', `/${first.job.id}/placement`, `/${first.job.id}/candidate`, `/${first.job.id}/versions/${first.job.id}/review`, `/${first.job.id}/versions/${first.job.id}/adopt`, `/${first.job.id}/versions/${first.job.id}/original`]) {
    for (const method of ['GET', 'POST']) assert.equal((await request(root + suffix, { method, headers: { Origin: 'https://attacker.invalid' } })).status, 400);
  }
  assert.equal((await request(`${root}/catalog?path=/secret`)).status, 400);
  assert.equal((await request(`/api/projects/${randomUUID()}/ifc-links/catalog`)).status, 404);
  assert.equal((await request(`/api/projects/${foreignProject}/ifc-links/${first.job.id}/versions/${first.job.id}/original`)).status, 400);
  const bytes = source('HTTP v2');
  const upload = { method: 'POST', headers: { 'Content-Type': 'application/x-step', 'X-Source-Name': 'v2.ifc', 'X-Expected-Generation': '1' }, body: bytes };
  assert.equal((await request(`${link}/candidate`, { ...upload, headers: { ...upload.headers, 'X-Expected-Generation': 'wrong' } })).status, 400);
  const accepted = await request(`${link}/candidate`, upload); assert.equal(accepted.status, 202, accepted.bytes.toString());
  const raw: unknown = JSON.parse(accepted.bytes.toString()); assert.ok(typeof raw === 'object' && raw !== null && 'link' in raw); const candidate = parseLinkedJob(raw.link);
  complete({ spool, job: candidate, bytes, name: 'Changed wall' }); store.refresh();
  const review = await request(`${link}/versions/${candidate.id}/review`); assert.equal(review.status, 200); assert.deepEqual(parseLinkedReview(JSON.parse(review.bytes.toString())).delta.properties, [gid]);
  const adoption = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedGeneration: 1 }) };
  assert.equal((await request(`${link}/versions/${candidate.id}/adopt`, { ...adoption, body: JSON.stringify({ expectedGeneration: '1' }) })).status, 400);
  assert.equal((await request(`${link}/placement`, { ...adoption, body: ' '.repeat(4097) })).status, 400);
  assert.deepEqual((await request(`${link}/original`)).bytes, first.bytes);
  const adopted = await request(`${link}/versions/${candidate.id}/adopt`, adoption); assert.equal(adopted.status, 200, adopted.bytes.toString());
  assert.deepEqual((await request(`${link}/original`)).bytes, bytes); assert.deepEqual((await request(`${link}/versions/${first.job.id}/original`)).bytes, first.bytes);
  const other = attachReady(input, 'separate link');
  assert.equal((await request(`${link}/versions/${other.job.id}/original`)).status, 400);
});
