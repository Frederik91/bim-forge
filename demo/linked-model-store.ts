import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MAX_LINK_OUTPUT_BYTES, MAX_LINK_SOURCE_BYTES, parseLinkedJob, parseLinkedPrepared } from '../src/linked-model.ts';
import type { LinkedJob, LinkedPrepared } from '../src/linked-model.ts';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function readBounded(filename: string, max: number): Buffer {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile() || info.size > max) throw new Error('IFC artifact exceeds its byte budget.');
    const bytes = Buffer.alloc(info.size); const size = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (size !== bytes.length) throw new Error('Incomplete IFC artifact.'); return bytes;
  } finally { fs.closeSync(descriptor); }
}
function atomic(filename: string, value: unknown): void {
  const temp = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, filename);
}
function pending(job: LinkedJob): boolean { return job.kind === 'queued' || job.kind === 'running'; }

/** One instance per application data root; jobs and artifacts are separate from native storage. */
export class LinkedModelStore {
  private readonly root: string;
  private readonly spool: string;
  private readonly database: DatabaseSync;
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;
  private constructor(input: { root: string; spool: string }) {
    this.root = path.resolve(input.root); this.spool = path.resolve(input.spool);
    for (const directory of [this.root, this.spool, path.join(this.root, 'sources'), path.join(this.root, 'prepared')]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path.join(this.root, 'links.sqlite'));
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, project TEXT NOT NULL, body TEXT NOT NULL)');
    for (const job of this.all()) if (pending(job)) {
      atomic(path.join(this.spool, job.id, 'cancel.json'), { cancelled: true });
      this.save({ ...job, kind: 'failed', error: 'Conversion interrupted by application restart. Attach again to retry.' });
    }
    this.timer = setInterval(() => this.refresh(), 200); this.timer.unref();
  }
  static open(input: { root: string; spool: string }): LinkedModelStore { return new LinkedModelStore(input); }
  private all(): LinkedJob[] {
    return this.database.prepare('SELECT body FROM links ORDER BY id').all().map(row => {
      if (typeof row.body !== 'string') throw new Error('Invalid stored IFC receipt.'); return parseLinkedJob(JSON.parse(row.body));
    });
  }
  private save(job: LinkedJob): void {
    this.database.prepare('INSERT INTO links(id,project,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(job.id, job.projectId, JSON.stringify(job));
  }
  list(projectId: string): LinkedJob[] { if (!UUID.test(projectId)) throw new Error('Invalid project.'); this.refresh(); return this.all().filter(job => job.projectId === projectId); }
  get(projectId: string, id: string): LinkedJob {
    const job = this.list(projectId).find(item => item.id === id); if (!job) throw new Error('IFC reference unavailable in this project.'); return job;
  }
  attach(input: { projectId: string; name: string; bytes: Uint8Array }): LinkedJob {
    if (this.closed || !UUID.test(input.projectId)) throw new Error('Project unavailable.');
    if (!input.name.trim() || input.name.length > 160 || /[\x00-\x1f]/.test(input.name) || !/\.ifc$/i.test(input.name)) throw new Error('Choose an IFC file with a short filename.');
    if (input.bytes.length < 1 || input.bytes.length > MAX_LINK_SOURCE_BYTES) throw new Error('IFC source must be between 1 byte and 2 MiB.');
    const jobs = this.all();
    if (jobs.length >= 32 || jobs.filter(job => job.projectId === input.projectId).length >= 8) throw new Error('IFC retention limit reached (8 per project, 32 per installation).');
    if (jobs.filter(pending).length >= 2) throw new Error('Two IFC conversions are already queued.');
    const id = randomUUID(); const originalSha256 = sha(input.bytes);
    const original = path.join(this.root, 'sources', originalSha256 + '.ifc');
    if (!fs.existsSync(original)) fs.writeFileSync(original, input.bytes, { flag: 'wx', mode: 0o400 });
    if (sha(readBounded(original, MAX_LINK_SOURCE_BYTES)) !== originalSha256) throw new Error('Retained IFC source is corrupt.');
    const job: LinkedJob = { id, projectId: input.projectId, name: input.name, source: { namespace: id, revision: originalSha256, originalSha256 }, occurrence: id, createdAt: Date.now(), kind: 'queued' };
    const directory = path.join(this.spool, id); fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'input.ifc'), input.bytes, { flag: 'wx', mode: 0o400 });
    this.save(job);
    atomic(path.join(directory, 'request.json'), { id, source: job.source, occurrence: job.occurrence });
    return job;
  }
  cancel(projectId: string, id: string): LinkedJob {
    const job = this.get(projectId, id); if (!pending(job)) return job;
    const cancelled: LinkedJob = { ...job, kind: 'cancelled' };
    this.save(cancelled); atomic(path.join(this.spool, id, 'cancel.json'), { cancelled: true }); return cancelled;
  }
  private readPrepared(directory: string, job: LinkedJob): LinkedPrepared {
    const manifestBytes = readBounded(path.join(directory, 'manifest.json'), 128 * 1024);
    const indexBytes = readBounded(path.join(directory, 'index.json'), MAX_LINK_OUTPUT_BYTES);
    const geometryBytes = readBounded(path.join(directory, 'geometry.json'), MAX_LINK_OUTPUT_BYTES);
    const prepared = parseLinkedPrepared({ manifest: JSON.parse(manifestBytes.toString()), index: JSON.parse(indexBytes.toString()), geometry: JSON.parse(geometryBytes.toString()) });
    const { manifest } = prepared;
    if (manifest.source.namespace !== job.source.namespace || manifest.source.revision !== job.source.revision || manifest.source.originalSha256 !== job.source.originalSha256
        || manifest.occurrence.id !== job.occurrence || JSON.stringify(manifest.occurrence.sourceToProjectMetres) !== '[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]') throw new Error('IFC artifact belongs to a different source or occurrence.');
    const original = readBounded(path.join(this.root, 'sources', job.source.originalSha256 + '.ifc'), MAX_LINK_SOURCE_BYTES);
    const artifacts = [['original.ifc', original], ['index.json', indexBytes], ['geometry.json', geometryBytes]] satisfies [keyof typeof manifest.artifacts, Buffer][];
    if (manifestBytes.length + artifacts.reduce((sum, [, bytes]) => sum + bytes.length, 0) > MAX_LINK_OUTPUT_BYTES) throw new Error('IFC output exceeds 8 MiB.');
    for (const [name, bytes] of artifacts) if (manifest.artifacts[name].bytes !== bytes.length || manifest.artifacts[name].sha256 !== sha(bytes)) throw new Error('IFC artifact integrity check failed.');
    return prepared;
  }
  prepared(projectId: string, id: string): LinkedPrepared {
    const job = this.get(projectId, id); if (job.kind !== 'ready') throw new Error('IFC reference is not ready.');
    return this.readPrepared(path.join(this.root, 'prepared', id), job);
  }
  original(projectId: string, id: string): Buffer {
    const job = this.get(projectId, id); const bytes = readBounded(path.join(this.root, 'sources', job.source.originalSha256 + '.ifc'), MAX_LINK_SOURCE_BYTES);
    if (sha(bytes) !== job.source.originalSha256) throw new Error('Retained IFC source is corrupt.'); return bytes;
  }
  refresh(): void {
    if (this.closed) return;
    for (const job of this.all().filter(pending)) {
      const directory = path.join(this.spool, job.id);
      try {
        if (Date.now() - job.createdAt > 90000) {
          atomic(path.join(directory, 'cancel.json'), { cancelled: true }); throw new Error('Converter unavailable or deadline exceeded.');
        }
        const terminal = path.join(directory, 'terminal.json');
        if (fs.existsSync(terminal)) {
          const result: unknown = JSON.parse(readBounded(terminal, 4096).toString());
          if (typeof result !== 'object' || result === null || !('kind' in result) || result.kind !== 'complete') {
            const detail = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string' ? result.error.slice(0, 1000) : 'Conversion failed.';
            throw new Error(detail);
          }
          const output = path.join(directory, 'output'); this.readPrepared(output, job);
          const target = path.join(this.root, 'prepared', job.id); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
          for (const name of ['index.json', 'geometry.json', 'manifest.json']) fs.writeFileSync(path.join(target, name), readBounded(path.join(output, name), MAX_LINK_OUTPUT_BYTES), { flag: 'wx', mode: 0o400 });
          this.save({ ...job, kind: 'ready' });
        } else if (fs.existsSync(path.join(directory, 'progress.json'))) {
          const value: unknown = JSON.parse(readBounded(path.join(directory, 'progress.json'), 4096).toString());
          if (typeof value === 'object' && value !== null && 'phase' in value && typeof value.phase === 'string') this.save({ ...job, kind: 'running', progress: value.phase.slice(0, 256) });
        }
      } catch (error) { this.save({ ...job, kind: 'failed', error: error instanceof Error ? error.message.slice(0, 1024) : 'Conversion failed.' }); }
    }
  }
  close(): void {
    if (this.closed) return;
    for (const job of this.all().filter(pending)) this.cancel(job.projectId, job.id);
    this.closed = true; clearInterval(this.timer); this.database.close();
  }
}
