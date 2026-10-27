import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SOURCE_BYTES } from '../src/request-sources.ts';
import type { RequestSource } from '../src/request-sources.ts';
import type { EvidenceEntry } from '../src/model-evidence.ts';
import { parseEvidenceHistoryPage, parseSourceMetadataPage, privateSourceHref, ProjectEvidenceClient, ProjectEvidenceError } from './project-evidence-client.ts';
import { uploadSourceFile } from './request-source-ui.ts';

const projectId = 'project-211';
const source: RequestSource = { id: '00000000-0000-0000-0000-000000000001', name: 'plan.txt', mediaType: 'text/plain', byteLength: 4, sha256: 'a'.repeat(64) };
const entry: EvidenceEntry = { id: 'record-1', anchor: { projectId, entityId: 'wall-north', revisionId: 'b'.repeat(64), bodyHash: 'c'.repeat(64), target: { kind: 'main' } },
  property: { definitionId: 'geometry-thickness', valueKind: 'length' }, predecessor: null,
  assertion: { kind: 'documented', value: { kind: 'length', value: 150, unit: 'mm' }, citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'Page 1' }] } };
const pin = { entryId: entry.id, hash: 'd'.repeat(64) };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('the evidence client supports a browser fetch function without changing its receiver', async () => {
  const request: typeof fetch = function(this: unknown, input) {
    assert.equal(this, undefined, 'A fetch function must not receive the evidence client as its receiver.');
    assert.equal(input, '/api/projects/project-211/project-sources');
    return Promise.resolve(reply({ sources: [source], next: null }));
  };
  assert.deepEqual((await new ProjectEvidenceClient(request).sources(projectId)).sources, [source]);
});

test('20 retained descriptors are metadata, not a four-file / 12 MiB request group', () => {
  const sources = Array.from({ length: 20 }, (_, index) => ({ ...source, id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, byteLength: MAX_SOURCE_BYTES }));
  assert.equal(parseSourceMetadataPage({ sources, next: sources.at(-1)?.id }).sources.length, 20);
  assert.throws(() => parseSourceMetadataPage({ sources: [...sources, source], next: null }));
  assert.throws(() => parseSourceMetadataPage({ sources: [source, source], next: null }));
  assert.throws(() => parseSourceMetadataPage({ sources: [{ ...source, sha256: 'bad' }], next: null }));
  assert.throws(() => parseSourceMetadataPage({ sources: [{ ...source, bytes: 'unwanted' }], next: null }));
  assert.throws(() => parseSourceMetadataPage({ sources: [], next: source.id }));
  assert.throws(() => parseSourceMetadataPage({ sources: [source], next: null, total: 1 }));
});

test('evidence pages use authoritative exact target-aware entry/pin codecs', () => {
  assert.deepEqual(parseEvidenceHistoryPage({ entries: [{ entry, pin }], next: 1 }, projectId), { entries: [{ entry, pin }], next: 1 });
  const { target, ...oldAnchor } = entry.anchor; assert.equal(target.kind, 'main');
  for (const value of [
    { entries: [{ entry: { ...entry, anchor: oldAnchor }, pin }], next: null },
    { entries: [{ entry, pin: { ...pin, entryId: 'wrong' } }], next: null },
    { entries: [{ entry: { ...entry, extra: true }, pin }], next: null },
    { entries: [{ entry, pin }, { entry, pin }], next: null },
    { entries: [], next: 3 }, { entries: [], next: -1 }, { entries: [], next: 1.5 },
    { entries: [], next: Number.MAX_SAFE_INTEGER + 1 },
    { entries: Array.from({ length: 21 }, () => ({ entry, pin })), next: null },
  ]) assert.throws(() => parseEvidenceHistoryPage(value, projectId));
  assert.throws(() => parseEvidenceHistoryPage({ entries: [{ entry, pin }], next: null }, 'another-project'));
});

test('keyset routes never fetch file bytes and refuse invalid or nonadvancing cursors', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = new ProjectEvidenceClient(async (input, init) => {
    calls.push({ url: String(input), init });
    return String(input).includes('/project-sources') ? reply({ sources: [source], next: null }) : reply({ entries: [{ entry, pin }], next: 3 });
  });
  await client.sources(projectId); await client.evidence(projectId, 2);
  assert.deepEqual(calls.map(call => call.url), ['/api/projects/project-211/project-sources', '/api/projects/project-211/evidence?after=2']);
  assert.ok(calls.every(call => call.init?.redirect === 'error' && call.init.credentials === 'same-origin' && call.init.method === 'GET'));
  await assert.rejects(client.sources(projectId, source.id), /advance/);
  await assert.rejects(client.sources(projectId, 'https://outside.invalid'), /cursor/);
  await assert.rejects(client.evidence(projectId, 3), /advance/);
  await assert.rejects(client.evidence(projectId, -1), /cursor/);
  await assert.rejects(client.evidence('../outside'), /project identity/);
});

test('source hrefs have a guarded same-origin project/UUID path only', () => {
  assert.equal(privateSourceHref(projectId, source.id), `/api/projects/${projectId}/sources/${source.id}`);
  for (const id of ['//outside.invalid/file', '../file', 'javascript:alert(1)', `${source.id}?url=bad`]) assert.throws(() => privateSourceHref(projectId, id));
  for (const id of ['../outside', '//outside.invalid', 'https://outside.invalid', '%2f..', '']) assert.throws(() => privateSourceHref(id, source.id));
});

test('explicit retention and append preserve identity and exact request bodies', async () => {
  const calls: RequestInit[] = [];
  const client = new ProjectEvidenceClient(async (input, init) => {
    if (init) calls.push(init);
    return String(input).endsWith('/project-sources') ? reply({ source }) : reply({ pin });
  });
  assert.deepEqual(await client.retain(projectId, source), source);
  assert.deepEqual(await client.append(projectId, 'command-211', entry), pin);
  assert.deepEqual(calls.map(call => JSON.parse(String(call.body))), [{ source }, { commandId: 'command-211', entry }]);
  const changed = new ProjectEvidenceClient(async () => reply({ source: { ...source, sha256: 'f'.repeat(64) } }));
  await assert.rejects(changed.retain(projectId, source), /identity changed/);
  await assert.rejects(client.append('wrong-project', 'command-211', entry), /context/);
  await assert.rejects(client.append(projectId, '', entry), /context/);
  await assert.rejects(new ProjectEvidenceClient(async () => reply({ pin: { ...pin, entryId: 'wrong' } })).append(projectId, 'command-211', entry), /different entry/);
});

test('missing/backpressure statuses are distinct and oversized response streams are cancelled', async () => {
  for (const status of [404, 429, 503, 403]) {
    const client = new ProjectEvidenceClient(async () => reply({ error: 'untrusted detail' }, status));
    await assert.rejects(client.sources(projectId), error => error instanceof ProjectEvidenceError && error.status === status
      && error.message.includes(status === 404 ? 'unavailable' : status === 403 ? 'failed' : 'busy'));
  }
  let cancelled = false;
  const client = new ProjectEvidenceClient(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(33 * 1024)); }, cancel() { cancelled = true; },
  })));
  await assert.rejects(client.sources(projectId), /metadata limit/); assert.equal(cancelled, true);
  await assert.rejects(new ProjectEvidenceClient(async () => new Response('not JSON')).sources(projectId));
  await assert.rejects(new ProjectEvidenceClient(async () => new Response(new Uint8Array([255]))).sources(projectId));
});

test('abort signal reaches each request without conversion to missing history', async () => {
  const controller = new AbortController(); controller.abort();
  const client = new ProjectEvidenceClient(async (_input, init) => { init?.signal?.throwIfAborted(); return reply({ sources: [], next: null }); });
  await assert.rejects(client.sources(projectId, null, controller.signal), { name: 'AbortError' });
});

test('shared upload keeps original protocol, file guards and immutable SHA/name/type/size checks', async () => {
  const file = new File(['plan'], 'plan.txt'); const signal = new AbortController().signal;
  let count = 0;
  const fetcher: typeof fetch = async (input, init) => {
    count++; assert.equal(String(input), privateSourceHref(projectId, source.id));
    assert.equal(init?.method, 'POST'); assert.equal(init?.body, file); assert.equal(init.signal, signal);
    assert.deepEqual(init.headers, { 'Content-Type': 'text/plain', 'X-Source-Name': 'plan.txt' });
    return reply({ source });
  };
  assert.deepEqual(await uploadSourceFile({ projectId, id: source.id, file, signal, fetcher }), source);
  assert.equal(count, 1);
  for (const invalid of [new File([], 'empty.txt'), new File(['x'], 'bad.exe', { type: 'application/octet-stream' }), new File(['x'], '../bad.txt')]) {
    await assert.rejects(uploadSourceFile({ projectId, id: source.id, file: invalid, signal, fetcher }));
  }
  assert.equal(count, 1, 'invalid files never start a private upload');
  for (const changed of [{ ...source, id: '00000000-0000-0000-0000-000000000002' }, { ...source, name: 'other.txt' },
    { ...source, mediaType: 'image/png' }, { ...source, byteLength: 5 }, { ...source, sha256: 'not-a-hash' }]) {
    await assert.rejects(uploadSourceFile({ projectId, id: source.id, file, signal, fetcher: async () => reply({ source: changed }) }));
  }
  await assert.rejects(uploadSourceFile({ projectId, id: source.id, file, signal, fetcher: async () => reply({ error: 'Busy\nretry' }, 503) }), /Busy retry/);
  await assert.rejects(uploadSourceFile({ projectId, id: source.id, file, signal, fetcher: async () => new Response('x'.repeat(4097)) }), /metadata limit/);
});
