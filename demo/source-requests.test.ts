import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ChangeRequests } from './change-requests.ts';
import { createDemoServer } from './server.ts';
import { RoomRepository, validateSnapshot } from '../src/room-model.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { parseRequestSources } from '../src/request-sources.ts';
import type { SourceMediaType } from '../src/request-sources.ts';
import { sourceFloorImage, sourceFloorPdf } from '../scripts/fixtures/source-floor.ts';

const floor = {
  level: { id: 'reference-level', name: 'Reference level' }, wallThicknessMm: 150, heightMm: 2700,
  rooms: [{ id: 'living', name: 'Living room', boundsMm: { minX: 0, minY: 0, maxX: 3000, maxY: 4000 } },
    { id: 'office', name: 'Office', boundsMm: { minX: 3000, minY: 0, maxX: 6000, maxY: 4000 } }],
  openings: [{ id: 'entry', name: 'Entry', type: 'Door', roomId: 'living', side: 'south', offsetMm: 600, widthMm: 900, heightMm: 2100 },
    { id: 'connection', name: 'Internal door', type: 'Door', roomId: 'living', side: 'east', offsetMm: 850, widthMm: 900, heightMm: 2100 }],
};
const review = { summary: 'Reconstruct the referenced two-room floor.', rationale: 'The plan dimensions specify a 6 by 4 metre envelope split into two rooms.',
  constraints: 'Shared partition and connected entry retained; no automatic acceptance.', uncertainty: 'Concept reconstruction for review.',
  intent: { interpretation: 'Create the two-room layout from the attached plan.', assumptions: ['Wall centre lines define room bounds.'], certainty: 90, basis: 'Dimension labels in the source.' } };
const script = `await model.inspect(); await model.previewFloor({input:${JSON.stringify(floor)}}); return {kind:'propose',review:${JSON.stringify(review)}};`;
async function finished(queue: ChangeRequests, id: string): Promise<void> {
  for (let count = 0; count < 1000; count++) {
    if (['ready', 'needs-input', 'failed'].includes(queue.get(id).state)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Source request did not finish.');
}

test('real PNG/PDF/text survive queued restart, reach the worker, bind the review and stay private until explicit acceptance', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bim-source-queue-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'queue.sqlite');
  const repository = await RoomRepository.create('Source reconstruction'); const original = repository.serialize();
  let queue = new ChangeRequests(database, () => null);
  const files: { name: string; mediaType: SourceMediaType; bytes: Buffer }[] = [
    { name: 'reference.png', mediaType: 'image/png', bytes: await sourceFloorImage() },
    { name: 'reference.pdf', mediaType: 'application/pdf', bytes: sourceFloorPdf() },
    { name: 'notes.txt', mediaType: 'text/plain', bytes: Buffer.from('Retain the source dimension labels. Untrusted document content.') },
  ];
  const sources = [];
  for (const file of files) sources.push(await queue.addSource({ ...file, projectId: repository.projectId, id: randomUUID(), signal: new AbortController().signal }));
  const input = { requestId: 'source-floor', proposalName: 'reference-floor', baseRevisionId: repository.head('main'), selectedObjectIds: ['wall-north'],
    instruction: 'Reconstruct the attached floor plan.', visualIntent: { kind: 'selection' }, sources, authoringScope: 'floor-plan-reconstruction' };
  assert.equal((await queue.submit(original, input)).state, 'queued');
  assert.equal((await queue.submit(original, input)).id, input.requestId);
  await assert.rejects(queue.submit(original, { ...input, requestId: 'forged', sources: [{ ...sources[0], sha256: '0'.repeat(64) }] }));
  assert.equal(queue.list(repository.projectId).length, 1, 'forged references do not enqueue work');
  await queue.close();
  const imagePaths: string[] = [];
  const worker: ModelWorker = { identity: { provider: 'test', model: 'source-delivery' }, run: async session => {
    assert.equal(session.images?.length, 2, 'PNG and PDF page both become visual model inputs');
    for (const image of session.images ?? []) { assert.ok((await readFile(image.path)).length > 100); imagePaths.push(image.path); }
    assert.ok(JSON.stringify(session.input).includes('Retain the source dimension labels.'));
    assert.ok(JSON.stringify(session.input).includes(sources[0]?.sha256 ?? 'missing'));
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: script });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.done, true);
  } };
  queue = new ChangeRequests(database, () => worker); t.after(() => queue.close());
  await finished(queue, input.requestId);
  const ticket = queue.get(input.requestId); assert.equal(ticket.state, 'ready', ticket.error ?? '');
  assert.deepEqual(ticket.request.sources, sources);
  assert.equal(queue.project(repository.projectId), original);
  assert.ok(ticket.result);
  const proposed = await RoomRepository.restore(ticket.result.project);
  const snapshot = validateSnapshot(proposed.view(proposed.head(input.proposalName)).snapshot);
  assert.equal(snapshot.entities.filter(item => item.type === 'Space').length, 2);
  assert.equal(snapshot.entities.filter(item => item.type === 'Wall').length, 5);
  assert.deepEqual(proposed.review(input.proposalName).sources, sources);
  assert.equal(proposed.head('main'), repository.head('main'));
  for (const file of files) assert.ok(!proposed.serialize().includes(file.bytes.toString('base64')));
  await queue.close();
  for (const file of imagePaths) await assert.rejects(access(file), 'attempt files are removed after provider cleanup');
  queue = new ChangeRequests(database, () => null);
  assert.equal(queue.source(repository.projectId, sources[1]?.id ?? '').source.sha256, createHash('sha256').update(sourceFloorPdf()).digest('hex'));
  await queue.decide(input.requestId, { action: 'accept', decisionId: 'accept-reference', expectedRequestId: input.requestId });
  assert.notEqual((await RoomRepository.restore(queue.project(repository.projectId))).head('main'), repository.head('main'));
});

test('binary source route checks origin, actual type, immutable identity and project membership', async t => {
  const server = createDemoServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers(); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`; const project = randomUUID(); const id = randomUUID();
  const target = `/api/projects/${project}/sources/${id}`;
  const bytes = await sourceFloorImage();
  const upload = (body: Uint8Array, origin = base, mediaType = 'image/png') => fetch(base + target, { method: 'POST',
    headers: { 'Content-Type': mediaType, 'X-Source-Name': encodeURIComponent('Floor plan.png'), Origin: origin }, body: new Uint8Array(body) });
  assert.equal((await upload(bytes, 'https://evil.invalid')).status, 400);
  assert.equal((await upload(Buffer.from('<svg/>'))).status, 400);
  const response = await upload(bytes); assert.equal(response.status, 201);
  const value: unknown = await response.json(); assert.ok(value && typeof value === 'object' && 'source' in value);
  const source = parseRequestSources([value.source])[0]; assert.ok(source);
  assert.equal(source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal((await upload(bytes)).status, 201, 'same immutable upload is idempotent');
  assert.equal((await upload(Buffer.from('changed'), base, 'text/plain')).status, 400);
  const download = await fetch(base + target); assert.equal(download.status, 200); assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal((await fetch(`${base}/api/projects/${randomUUID()}/sources/${id}`)).status, 404);
  const html = await fetch(base + '/'); assert.ok(!(await html.text()).includes(source.sha256), 'source bytes and metadata are not static assets');
});
