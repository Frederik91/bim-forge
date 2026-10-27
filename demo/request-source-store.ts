import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { MAX_SOURCE_BYTES, parseRequestSources, sourceMediaType, sourceName } from '../src/request-sources.ts';
import type { RequestSource, SourceMediaType } from '../src/request-sources.ts';

const MAX_STORE_BYTES = 512 * 1024 * 1024;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_VISUALS = 8;
const MAX_PDF_PAGES = 4;
const PREPARATION_MS = 45_000;
const MAX_RENDER_BYTES = 12 * 1024 * 1024;
const MAX_PREPARED_IMAGE_BYTES = 12 * 1024 * 1024;
const TEMP_ROOT = path.resolve(process.platform === 'linux' ? '/tmp' : os.tmpdir());
const TEMP_PREFIX = `bim-request-sources-${process.pid}-`;

// A child owns native image decoding so cancellation can kill and drain it.
// The module URL and program are application-owned; filenames never become code.
const IMAGE_PROGRAM = `
try {
  const { default: sharp } = await import(process.argv[1]);
  const image = sharp(process.argv[2], { limitInputPixels: 16000000, failOn: 'warning' });
  const metadata = await image.metadata();
  const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
  if (metadata.format !== formats[process.argv[3]] || !metadata.width || !metadata.height
      || metadata.width * metadata.height > 16000000 || (metadata.pages ?? 1) !== 1) process.exit(1);
  const bytes = await image.rotate().resize({ width: 1600, height: 1600,
    fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  process.stdout.write(bytes);
} catch { process.exitCode = 1; }
`;

interface StoredSource {
  source: RequestSource;
  bytes: Buffer;
  visuals: number;
  textBytes: number;
}
interface SourceFacts { visuals: number; textBytes: number }
export interface PreparedRequestSources {
  images: readonly { path: string }[];
  documents: readonly { sourceId: string; text: string }[];
  dispose(): Promise<void>;
}

function identity(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('Invalid source ownership identity.');
  return value;
}
function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function references(sources: readonly RequestSource[]): RequestSource[] {
  if (Array.isArray(sources) && sources.length === 0) return [];
  return parseRequestSources(sources);
}
function sameSource(left: RequestSource, right: RequestSource): boolean {
  return left.id === right.id && left.name === right.name && left.mediaType === right.mediaType
    && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}
function utf8(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Text sources must contain valid UTF-8.'); }
}
function mapping(source: RequestSource, first: number, visuals: number): string {
  if (source.mediaType === 'application/pdf') return `Visual inputs ${first}..${first + visuals - 1} belong to source ${source.id}, PDF pages 1..${visuals}.\n\n`;
  return visuals ? `Visual input ${first} belongs to source ${source.id}, image 1.` : '';
}

/** Kill on abort/output limits; wait for close (including pipe drainage) before returning. */
function command(executable: string, args: readonly string[], directory: string, signal: AbortSignal, maximum: number): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd: directory, shell: false, windowsHide: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: directory, TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let failure: Error | null = null;
    let outputBytes = 0; let errorBytes = 0;
    const chunks: Buffer[] = [];
    const stop = (message: string): void => { failure ??= new Error(message); child.kill('SIGKILL'); };
    const abort = (): void => stop('Source preparation was cancelled or timed out.');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximum) stop('Prepared source output exceeds its limit.');
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 8192) stop('Source diagnostic output exceeds its limit.');
    });
    child.on('error', () => { failure ??= new Error('Source preparation tool is unavailable.'); });
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('Source could not be decoded. Encrypted, corrupt or unsupported files are not accepted.'));
      else resolve(Buffer.concat(chunks, outputBytes));
    });
  });
}

async function normalizedImage(filename: string, mediaType: SourceMediaType, directory: string, signal: AbortSignal): Promise<Buffer> {
  return command(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', IMAGE_PROGRAM, import.meta.resolve('sharp'), filename, mediaType],
    directory, signal, MAX_RENDER_BYTES);
}

function pdfCommand(tool: 'pdfinfo' | 'pdftotext' | 'pdftoppm', args: readonly string[], directory: string, signal: AbortSignal, maximum: number): Promise<Buffer> {
  return command('/usr/bin/prlimit', ['--as=268435456', '--cpu=20', '--fsize=16777216', '--', `/usr/bin/${tool}`, ...args], directory, signal, maximum);
}

async function prepareFiles(files: readonly { source: RequestSource; bytes: Buffer }[], inputSignal: AbortSignal): Promise<{
  prepared: PreparedRequestSources; facts: readonly SourceFacts[];
}> {
  inputSignal.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  inputSignal.addEventListener('abort', forwardAbort, { once: true });
  if (inputSignal.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(), PREPARATION_MS);
  const signal = controller.signal;
  let directory: string | null = null;
  let disposal: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      if (!directory) return;
      // The target comes from mkdtemp, never from a source name or ID.
      if (path.dirname(directory) !== TEMP_ROOT || !path.basename(directory).startsWith(TEMP_PREFIX)) throw new Error('Invalid source preparation directory.');
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 2 });
    })();
    return disposal;
  };
  try {
    directory = await fs.mkdtemp(path.join(TEMP_ROOT, TEMP_PREFIX));
    await fs.chmod(directory, 0o700);
    const workDirectory = directory;
    const images: { path: string }[] = [];
    const documents: { sourceId: string; text: string }[] = [];
    const facts: SourceFacts[] = [];
    let textBytes = 0; let imageBytes = 0;
    const addImage = async (normalized: Buffer): Promise<void> => {
      imageBytes += normalized.length;
      if (imageBytes > MAX_PREPARED_IMAGE_BYTES) throw new Error('Prepared images exceed the 12 MiB request limit.');
      const output = path.join(workDirectory, `visual-${images.length + 1}.png`);
      signal.throwIfAborted();
      await fs.writeFile(output, normalized, { mode: 0o400 });
      images.push({ path: output });
    };
    for (const [index, { source, bytes }] of files.entries()) {
      signal.throwIfAborted();
      const first = images.length + 1;
      let text = ''; let visuals = 0;
      if (source.mediaType === 'text/plain' || source.mediaType === 'text/markdown') {
        if (bytes.length > MAX_TEXT_BYTES) throw new Error('Source text exceeds the 64 KiB request limit.');
        text = utf8(bytes);
      } else {
        const input = path.join(directory, `input-${index}`);
        await fs.writeFile(input, bytes, { mode: 0o600 });
        if (source.mediaType === 'application/pdf') {
          const info = utf8(await pdfCommand('pdfinfo', ['-enc', 'UTF-8', input], directory, signal, 16 * 1024));
          const pages = [...info.matchAll(/^Pages:[ \t]*(\d+)[ \t]*\r?$/gm)];
          const encrypted = [...info.matchAll(/^Encrypted:[ \t]*([^\r\n]+)\r?$/gm)];
          if (pages.length !== 1 || encrypted.length !== 1 || encrypted[0]?.[1]?.trim() !== 'no') throw new Error('PDF must be unencrypted and have a readable page count.');
          visuals = Number(pages[0]?.[1]);
          if (!Number.isSafeInteger(visuals) || visuals < 1 || visuals > MAX_PDF_PAGES) throw new Error('Attach a PDF containing at most four pages.');
          if (images.length + visuals > MAX_VISUALS) throw new Error('Request sources exceed eight visual inputs.');
          text = utf8(await pdfCommand('pdftotext', ['-enc', 'UTF-8', '-nopgbrk', '-f', '1', '-l', String(visuals), input, '-'],
            directory, signal, MAX_TEXT_BYTES));
          for (let page = 1; page <= visuals; page += 1) {
            const png = await pdfCommand('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '1600', '-png', input],
              directory, signal, MAX_RENDER_BYTES);
            const raw = path.join(directory, `page-${index}-${page}.png`);
            await fs.writeFile(raw, png, { mode: 0o600 });
            const normalized = await normalizedImage(raw, 'image/png', directory, signal);
            await addImage(normalized);
            await fs.rm(raw);
          }
        } else {
          visuals = 1;
          if (images.length + visuals > MAX_VISUALS) throw new Error('Request sources exceed eight visual inputs.');
          const normalized = await normalizedImage(input, source.mediaType, directory, signal);
          await addImage(normalized);
        }
        await fs.rm(input);
      }
      const document = mapping(source, first, visuals) + text;
      textBytes += Buffer.byteLength(document, 'utf8');
      if (textBytes > MAX_TEXT_BYTES) throw new Error('Source text and page mappings exceed the 64 KiB request limit.');
      documents.push({ sourceId: source.id, text: document });
      facts.push({ visuals, textBytes: Buffer.byteLength(text, 'utf8') });
    }
    signal.throwIfAborted();
    return { prepared: { images, documents, dispose }, facts };
  } catch (error) {
    await dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    inputSignal.removeEventListener('abort', forwardAbort);
  }
}

/** The caller owns the connection and ticket transaction. Source rows are immutable. */
export class RequestSourceStore {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.#db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS request_source_blobs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, media_type TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK(byte_length > 0 AND byte_length <= ${MAX_SOURCE_BYTES}),
      sha256 TEXT NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes) = byte_length),
      visual_count INTEGER NOT NULL CHECK(visual_count BETWEEN 0 AND ${MAX_PDF_PAGES}),
      text_bytes INTEGER NOT NULL CHECK(text_bytes BETWEEN 0 AND ${MAX_TEXT_BYTES}), created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS request_source_project ON request_source_blobs(project_id);
      CREATE TABLE IF NOT EXISTS request_source_identities (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS request_source_bindings (
        request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS request_source_memberships (
        request_id TEXT NOT NULL REFERENCES request_source_bindings(request_id),
        source_id TEXT NOT NULL REFERENCES request_source_blobs(id), PRIMARY KEY(request_id, source_id));
      CREATE INDEX IF NOT EXISTS request_source_member ON request_source_memberships(source_id);
      CREATE TABLE IF NOT EXISTS request_source_project_retention (
        source_id TEXT PRIMARY KEY REFERENCES request_source_blobs(id), project_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS request_source_retained_project ON request_source_project_retention(project_id);`);
    this.#write(() => this.#expire());
  }

  #write<T>(operation: () => T): T {
    this.#db.exec('SAVEPOINT request_source_store_write');
    try { const result = operation(); this.#db.exec('RELEASE request_source_store_write'); return result; }
    catch (error) {
      this.#db.exec('ROLLBACK TO request_source_store_write; RELEASE request_source_store_write');
      throw error;
    }
  }
  #expire(): void {
    this.#db.prepare(`DELETE FROM request_source_blobs WHERE created_at <= ?
      AND NOT EXISTS (SELECT 1 FROM request_source_memberships WHERE source_id = request_source_blobs.id)
      AND NOT EXISTS (SELECT 1 FROM request_source_project_retention WHERE source_id = request_source_blobs.id AND project_id = request_source_blobs.project_id)`)
      .run(Date.now() - UPLOAD_LIFETIME_MS);
  }
  #read(projectId: string, id: string): StoredSource {
    const row = this.#db.prepare(`SELECT * FROM request_source_blobs WHERE project_id = ? AND id = ?
      AND (created_at > ? OR EXISTS (SELECT 1 FROM request_source_memberships WHERE source_id = request_source_blobs.id)
        OR EXISTS (SELECT 1 FROM request_source_project_retention WHERE source_id = request_source_blobs.id AND project_id = request_source_blobs.project_id))`)
      .get(identity(projectId), identity(id), Date.now() - UPLOAD_LIFETIME_MS);
    if (!row || !(row.bytes instanceof Uint8Array)) throw new Error('Unknown or expired project source.');
    const [source] = parseRequestSources([{ id: row.id, name: row.name, mediaType: row.media_type, byteLength: row.byte_length, sha256: row.sha256 }]);
    if (!source || typeof row.visual_count !== 'number' || !Number.isSafeInteger(row.visual_count) || row.visual_count < 0 || row.visual_count > MAX_PDF_PAGES
      || typeof row.text_bytes !== 'number' || !Number.isSafeInteger(row.text_bytes) || row.text_bytes < 0 || row.text_bytes > MAX_TEXT_BYTES) throw new Error('Invalid stored source metadata.');
    const bytes = Buffer.from(row.bytes);
    if (bytes.length !== source.byteLength || digest(bytes) !== source.sha256) throw new Error('Stored source integrity check failed.');
    return { source, bytes, visuals: row.visual_count, textBytes: row.text_bytes };
  }

  async add(input: { projectId: string; id: string; name: string; mediaType: SourceMediaType; bytes: Buffer; signal: AbortSignal }): Promise<RequestSource> {
    input.signal.throwIfAborted();
    const projectId = identity(input.projectId);
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length < 1 || input.bytes.length > MAX_SOURCE_BYTES) throw new Error('Source files must contain 1 byte to 6 MiB.');
    const bytes = Buffer.from(input.bytes);
    const [source] = parseRequestSources([{ id: input.id, name: sourceName(input.name), mediaType: sourceMediaType(input.mediaType), byteLength: bytes.length, sha256: digest(bytes) }]);
    if (!source) throw new Error('Missing source reference.');
    const replay = (): RequestSource | null => {
      const immutable = this.#db.prepare('SELECT project_id, manifest FROM request_source_identities WHERE id = ?').get(source.id);
      if (immutable && (immutable.project_id !== projectId || immutable.manifest !== JSON.stringify(source))) throw new Error('Source identity is already bound to different input.');
      const row = this.#db.prepare('SELECT project_id FROM request_source_blobs WHERE id = ?').get(source.id);
      if (!row) return null;
      if (row.project_id !== projectId) throw new Error('Source identity is already bound to different input.');
      const existing = this.#read(projectId, source.id);
      if (!sameSource(existing.source, source)) throw new Error('Source identity is already bound to different input.');
      return existing.source;
    };
    this.#write(() => this.#expire());
    const existing = replay();
    if (existing) return existing;
    const admission = await prepareFiles([{ source, bytes }], input.signal);
    await admission.prepared.dispose();
    input.signal.throwIfAborted();
    const fact = admission.facts[0];
    if (!fact) throw new Error('Missing source admission metadata.');
    return this.#write(() => {
      this.#expire();
      const duplicate = replay();
      if (duplicate) return duplicate;
      const usage = this.#db.prepare('SELECT COALESCE(SUM(byte_length), 0) AS bytes FROM request_source_blobs').get();
      if (!usage || typeof usage.bytes !== 'number' || usage.bytes + bytes.length > MAX_STORE_BYTES) throw new Error('The private source store has reached its 512 MiB limit.');
      this.#db.prepare('INSERT INTO request_source_identities(id, project_id, manifest) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(source.id, projectId, JSON.stringify(source));
      this.#db.prepare(`INSERT INTO request_source_blobs(id, project_id, name, media_type, byte_length, sha256, bytes, visual_count, text_bytes, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(source.id, projectId, source.name, source.mediaType, source.byteLength, source.sha256, bytes, fact.visuals, fact.textBytes, Date.now());
      return source;
    });
  }

  assert(projectId: string, sources: readonly RequestSource[]): void {
    identity(projectId);
    const parsed = references(sources);
    let visuals = 0; let textBytes = 0;
    for (const [index, source] of parsed.entries()) {
      const original = sources[index];
      const stored = this.#read(projectId, source.id);
      if (!original || !sameSource(original, stored.source)) throw new Error('Source reference does not match its immutable upload.');
      textBytes += stored.textBytes + Buffer.byteLength(mapping(source, visuals + 1, stored.visuals), 'utf8');
      visuals += stored.visuals;
    }
    if (visuals > MAX_VISUALS || textBytes > MAX_TEXT_BYTES) throw new Error('Request sources exceed eight visual inputs or 64 KiB text.');
  }

  /** Safe within the caller's ticket transaction; rollback also removes these memberships. */
  bind(projectId: string, sources: readonly RequestSource[], requestId: string): void {
    identity(requestId);
    this.#write(() => {
      this.assert(projectId, sources);
      const manifest = JSON.stringify(references(sources));
      const existing = this.#db.prepare('SELECT project_id, manifest FROM request_source_bindings WHERE request_id = ?').get(requestId);
      if (existing) {
        if (existing.project_id !== projectId || existing.manifest !== manifest) throw new Error('Request source binding is immutable.');
        return;
      }
      this.#db.prepare('INSERT INTO request_source_bindings(request_id, project_id, manifest) VALUES(?,?,?)').run(requestId, projectId, manifest);
      const insert = this.#db.prepare('INSERT INTO request_source_memberships(request_id, source_id) VALUES(?,?)');
      for (const source of sources) insert.run(requestId, source.id);
    });
  }

  get(projectId: string, id: string): { source: RequestSource; bytes: Buffer } {
    const { source, bytes } = this.#read(projectId, id);
    return { source, bytes };
  }

  /** Explicit durable project admission; original identity, manifest and bytes never change. */
  retainProject(projectId: string, source: RequestSource): RequestSource {
    return this.#write(() => {
      this.assert(projectId, [source]);
      this.#db.prepare('INSERT INTO request_source_project_retention(source_id, project_id) VALUES(?,?) ON CONFLICT(source_id) DO NOTHING')
        .run(source.id, projectId);
      return this.retained(projectId, source.id);
    });
  }

  /** Private authorized metadata only, verified against the sole original byte authority. */
  retained(projectId: string, id: string): RequestSource {
    const row = this.#db.prepare('SELECT source_id FROM request_source_project_retention WHERE project_id = ? AND source_id = ?')
      .get(identity(projectId), identity(id));
    if (!row) throw new Error('Source is not retained by this project.');
    return this.#read(projectId, id).source;
  }

  async prepare(projectId: string, sources: readonly RequestSource[], signal: AbortSignal): Promise<PreparedRequestSources> {
    signal.throwIfAborted();
    this.assert(projectId, sources);
    const files = sources.map((source) => this.get(projectId, source.id));
    return (await prepareFiles(files, signal)).prepared;
  }
}
