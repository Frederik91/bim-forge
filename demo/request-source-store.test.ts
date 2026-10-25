import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { RequestSourceStore } from './request-source-store.ts';
import type { RequestSource, SourceMediaType } from '../src/request-sources.ts';

const project = '00000000-0000-4000-8000-000000000109';
const otherProject = '00000000-0000-4000-8000-000000000110';
const signal = (): AbortSignal => new AbortController().signal;
function setup(t: TestContext): { db: DatabaseSync; store: RequestSourceStore } {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  t.after(() => db.close());
  return { db, store: new RequestSourceStore(db) };
}
function upload(store: RequestSourceStore, bytes: Buffer, mediaType: SourceMediaType = 'text/plain', name = 'source.txt', id: string = randomUUID()) {
  return store.add({ projectId: project, id, name, mediaType, bytes, signal: signal() });
}
async function attempts(): Promise<string[]> {
  const root = process.platform === 'linux' ? '/tmp' : os.tmpdir();
  return (await fs.readdir(root)).filter((name) => name.startsWith(`bim-request-sources-${process.pid}-`)).sort();
}

// Standard-security revision 2, including an empty user password, exercises PDFs
// that pdfinfo can open but must still be rejected because they are encrypted.
function rc4(key: Buffer, input: Buffer): Buffer {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(input.length);
  let i = 0; j = 0;
  for (let n = 0; n < input.length; n += 1) {
    i = (i + 1) % 256; j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
    output[n] = input[n] ^ state[(state[i] + state[j]) % 256];
  }
  return output;
}
function pdf(pages = 1, encrypted = false, repetitions = 0): Buffer {
  const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const owner = Buffer.concat([Buffer.from('fixture-owner'), padding]).subarray(0, 32);
  const md5 = (bytes: Buffer): Buffer => createHash('md5').update(bytes).digest();
  const o = rc4(md5(owner).subarray(0, 5), padding);
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const fileId = Buffer.alloc(16, 1);
  const key = md5(Buffer.concat([padding, o, permissions, fileId])).subarray(0, 5);
  const u = rc4(key, padding);
  const font = 3 + pages * 2;
  const objects: Buffer[] = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(`<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, index) => `${3 + index * 2} 0 R`).join(' ')}] >>`)];
  for (let page = 0; page < pages; page += 1) {
    const streamId = 4 + page * 2;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 160] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${streamId} 0 R >>`));
    let content: Buffer = Buffer.from(`BT /F1 10 Tf 10 140 Td (Two rooms 6000 x 4000 mm, page ${page + 1}) Tj ET\n10 10 180 120 re S\n100 10 m 100 130 l S\n${'10 10 1 1 re S\n'.repeat(repetitions)}`);
    if (encrypted) {
      const objectKey = md5(Buffer.concat([key, Buffer.from([streamId & 255, (streamId >> 8) & 255, (streamId >> 16) & 255, 0, 0])])).subarray(0, 10);
      content = rc4(objectKey, content);
    }
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]));
  }
  objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  if (encrypted) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /O <${o.toString('hex')}> /U <${u.toString('hex')}> /P -4 >>`));
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = chunks[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk); length += chunk.length;
  }
  const trailer = encrypted ? ` /Encrypt ${objects.length} 0 R /ID [<${fileId.toString('hex')}><${fileId.toString('hex')}>]` : '';
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailer} >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test('uploads bind exact project, bytes and metadata; replay and concurrent delivery are idempotent', async (t) => {
  const { db, store } = setup(t);
  const bytes = Buffer.from('Room width: 6000 mm.'); const id = randomUUID();
  const [source, replay] = await Promise.all([upload(store, bytes, 'text/plain', 'room.txt', id), upload(store, bytes, 'text/plain', 'room.txt', id)]);
  assert.deepEqual(source, replay);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM request_source_blobs').get()?.count, 1);
  store.assert(project, [source]);
  assert.deepEqual(store.get(project, source.id).bytes, bytes);
  assert.throws(() => store.get(otherProject, source.id), /Unknown/);
  assert.throws(() => store.assert(otherProject, [source]), /Unknown/);
  for (const forged of [{ ...source, name: 'different.txt' }, { ...source, sha256: 'a'.repeat(64) }, { ...source, byteLength: 1 }, { ...source, mediaType: 'text/markdown' }] satisfies RequestSource[]) {
    assert.throws(() => store.assert(project, [forged]), /immutable/);
  }
  await assert.rejects(() => upload(store, Buffer.from('Changed input.'), 'text/plain', 'room.txt', id), /different input/);
  await assert.rejects(() => store.add({ projectId: otherProject, id, name: source.name, mediaType: source.mediaType, bytes, signal: signal() }), /different input/);
  const copy = store.get(project, source.id).bytes; copy.fill(0);
  assert.deepEqual(store.get(project, source.id).bytes, bytes);
  db.prepare('UPDATE request_source_blobs SET bytes = ? WHERE id = ?').run(Buffer.alloc(bytes.length), source.id);
  assert.throws(() => store.get(project, source.id), /integrity/);
});

test('memberships share the ticket transaction; expiry preserves bound sources and immutable upload identities', async (t) => {
  const { db, store } = setup(t);
  const bound = await upload(store, Buffer.from('Keep this original sketch.'));
  const unbound = await upload(store, Buffer.from('Abandoned upload.'));
  db.exec('BEGIN IMMEDIATE');
  store.bind(project, [unbound], 'rolled-back-request');
  db.exec('ROLLBACK');
  db.exec('BEGIN IMMEDIATE');
  store.bind(project, [bound], 'request-version-one');
  store.bind(project, [bound], 'request-version-one');
  db.exec('COMMIT');
  assert.throws(() => store.bind(project, [unbound], 'request-version-one'), /immutable/);
  store.bind(project, [], 'empty-request');
  assert.throws(() => store.bind(project, [bound], 'empty-request'), /immutable/);
  db.prepare('UPDATE request_source_blobs SET created_at = ?').run(Date.now() - 25 * 60 * 60 * 1000);
  const reopened = new RequestSourceStore(db);
  assert.equal(reopened.get(project, bound.id).source.id, bound.id);
  assert.throws(() => reopened.get(project, unbound.id), /expired/);
  await assert.rejects(() => upload(reopened, Buffer.from('Different bytes.'), unbound.mediaType, unbound.name, unbound.id), /different input/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM request_source_blobs').get()?.count, 1);
});

test('source bytes and request memberships survive SQLite close and reopen', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-source-store-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'sources.sqlite');
  let db = new DatabaseSync(filename);
  let store = new RequestSourceStore(db);
  const bytes = Buffer.from('# Floor\nTwo adjacent rectangular rooms.\n');
  const source = await upload(store, bytes, 'text/markdown', 'floor.md');
  store.bind(project, [source], 'durable-request');
  db.close();
  db = new DatabaseSync(filename); t.after(() => db.close());
  store = new RequestSourceStore(db);
  store.assert(project, [source]); store.bind(project, [source], 'durable-request');
  assert.deepEqual(store.get(project, source.id), { source, bytes });
  const prepared = await store.prepare(project, [source], signal());
  assert.deepEqual(prepared.documents, [{ sourceId: source.id, text: bytes.toString('utf8') }]);
  await prepared.dispose();
});

test('real PNG/PDF/text inputs normalize privately and retain source/page mappings and extracted text', async (t) => {
  const { store } = setup(t);
  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: 'white' } }).png().toBuffer();
  const image = await upload(store, png, 'image/png', 'room.png');
  const document = await upload(store, pdf(2), 'application/pdf', 'two-rooms.pdf');
  const note = await upload(store, Buffer.from('Scale is explicitly 6000 x 4000 mm.'), 'text/plain', 'scale.txt');
  const a = await store.prepare(project, [image, document, note], signal());
  const b = await store.prepare(project, [image], signal());
  try {
    assert.equal(a.images.length, 3);
    assert.match(a.documents[0]?.text ?? '', /Visual input 1/);
    assert.equal(a.documents[0]?.sourceId, image.id);
    assert.match(a.documents[1]?.text ?? '', /Visual inputs 2\.\.3.*PDF pages 1\.\.2/);
    assert.match(a.documents[1]?.text ?? '', /Two rooms 6000 x 4000 mm, page 1/);
    assert.match(a.documents[1]?.text ?? '', /page 2/);
    assert.equal(a.documents[1]?.sourceId, document.id);
    assert.equal(a.documents[2]?.text, 'Scale is explicitly 6000 x 4000 mm.');
    const first = a.images[0]; const other = b.images[0];
    assert.ok(first && other);
    assert.notEqual(path.dirname(first.path), path.dirname(other.path));
    const metadata = await sharp(first.path).metadata();
    assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 1600); assert.equal(metadata.height, 800);
    if (process.platform === 'linux') assert.equal((await fs.stat(path.dirname(first.path))).mode & 0o777, 0o700);
    await a.dispose(); await a.dispose();
    await assert.rejects(() => fs.access(first.path));
    await fs.access(other.path);
  } finally { await a.dispose(); await b.dispose(); }
});

test('admission rejects wrong decoded formats, corrupt/encrypted PDFs, excess pages, UTF-8 and pixel limits without leaks', async (t) => {
  const { store } = setup(t); const before = await attempts();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(() => upload(store, png, 'image/jpeg', 'wrong.jpg'), /decoded/);
  await assert.rejects(() => upload(store, Buffer.from('%PDF-1.4\ncorrupt'), 'application/pdf', 'bad.pdf'), /decoded/);
  await assert.rejects(() => upload(store, pdf(1, true), 'application/pdf', 'encrypted.pdf'), /unencrypted|decoded/);
  await assert.rejects(() => upload(store, pdf(5), 'application/pdf', 'long.pdf'), /four pages/);
  await assert.rejects(() => upload(store, Buffer.from([0xc3, 0x28])), /UTF-8/);
  await assert.rejects(() => upload(store, Buffer.alloc(64 * 1024 + 1, 65)), /64 KiB/);
  await assert.rejects(() => upload(store, Buffer.alloc(6 * 1024 * 1024 + 1)), /6 MiB/);
  const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(() => upload(store, oversized, 'image/png', 'pixels.png'), /decoded/);
  assert.deepEqual(await attempts(), before);
});

test('request aggregate text and visual budgets reject the complete request without truncation', async (t) => {
  const { store } = setup(t);
  const a = await upload(store, Buffer.alloc(40 * 1024, 65));
  const b = await upload(store, Buffer.alloc(40 * 1024, 66));
  assert.throws(() => store.assert(project, [a, b]), /64 KiB/);
  const pdfA = await upload(store, pdf(4), 'application/pdf', 'a.pdf');
  const pdfB = await upload(store, pdf(4), 'application/pdf', 'b.pdf');
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  const image = await upload(store, png, 'image/png', 'extra.png');
  store.assert(project, [pdfA, pdfB]);
  assert.throws(() => store.assert(project, [pdfA, pdfB, image]), /eight visual/);
  const before = await attempts();
  await assert.rejects(() => store.prepare(project, [pdfA, pdfB, image], signal()), /eight visual/);
  assert.deepEqual(await attempts(), before);
});

test('prepared PNG bytes have an aggregate 12 MiB limit and failures remove every attempt file', async (t) => {
  const { store } = setup(t);
  const jpeg = await sharp(randomBytes(1600 * 1600 * 3), { raw: { width: 1600, height: 1600, channels: 3 } })
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
  assert.ok(jpeg.length < 6 * 1024 * 1024);
  const a = await upload(store, jpeg, 'image/jpeg', 'noise-a.jpg');
  const b = await upload(store, jpeg, 'image/jpeg', 'noise-b.jpg');
  const before = await attempts();
  await assert.rejects(() => store.prepare(project, [a, b], signal()), /Prepared images exceed the 12 MiB/);
  assert.deepEqual(await attempts(), before);
  assert.deepEqual(store.get(project, a.id).bytes, jpeg);
});

test('cancelled preparation drains native work, removes its directory and retains durable source bytes', async (t) => {
  const { store } = setup(t);
  const source = await upload(store, pdf(1, false, 100_000), 'application/pdf', 'busy-sketch.pdf');
  const before = await attempts();
  const controller = new AbortController();
  const pending = store.prepare(project, [source], controller.signal);
  const rejected = assert.rejects(pending, /cancel|abort|timed out/i);
  let directory: string | undefined;
  for (let n = 0; n < 200 && !directory; n += 1) {
    directory = (await attempts()).find((name) => !before.includes(name));
    if (!directory) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(directory, 'the attempt created its own directory');
  controller.abort();
  await rejected;
  assert.deepEqual(await attempts(), before);
  assert.equal(store.get(project, source.id).source.sha256, source.sha256);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(() => store.prepare(project, [source], stopped.signal), /abort/i);
  assert.deepEqual(await attempts(), before);
});
