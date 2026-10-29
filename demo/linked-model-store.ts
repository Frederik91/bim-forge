import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { IDENTITY_LINK_TRANSFORM, MAX_LINK_OUTPUT_BYTES, MAX_LINK_SOURCE_BYTES, MAX_LINK_REVISIONS, assertRigidLinkTransform, linkedDelta, parseLinkedJob, parseLinkedPrepared, parseLinkedState } from '../src/linked-model.ts';
import type { LinkedCatalogItem, LinkedJob, LinkedPrepared, LinkedSelection, LinkedState } from '../src/linked-model.ts';

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
function validateUpload(input: { name: string; bytes: Uint8Array }): void {
  if (!input.name.trim() || input.name.length > 160 || /[\x00-\x1f]/.test(input.name) || !/\.ifc$/i.test(input.name)) throw new Error('Choose an IFC file with a short filename.');
  if (input.bytes.length < 1 || input.bytes.length > MAX_LINK_SOURCE_BYTES) throw new Error('IFC source must be between 1 byte and 2 MiB.');
}

export type LinkedCurrentSnapshot = {
  catalogToken: string;
  links: { linkId: string; generation: number; versionId: string; prepared: LinkedPrepared }[];
  unavailable: { linkId: string; reason: string }[];
};
export type LinkedVersionResolution = { kind: 'ok'; versionId: string; prepared: LinkedPrepared }
  | { kind: 'unavailable'; reason: 'missing' | 'stale' | 'ambiguous' };
export type LinkedGuardResult<T> = { kind: 'committed'; value: T } | { kind: 'catalog-changed' };

/** SQLite serializes catalog writes across processes. Artifacts remain separate from native storage. */
export class LinkedModelStore {
  private readonly root: string;
  private readonly spool: string;
  private readonly database: DatabaseSync;
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;
  private locked = false;
  private readonly ownedJobs = new Set<string>();
  private constructor(input: { root: string; spool: string }) {
    this.root = path.resolve(input.root); this.spool = path.resolve(input.spool);
    for (const directory of [this.root, this.spool, path.join(this.root, 'sources'), path.join(this.root, 'prepared')]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path.join(this.root, 'links.sqlite'));
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, project TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS link_catalog (id TEXT PRIMARY KEY, project TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS link_versions (id TEXT PRIMARY KEY, link TEXT NOT NULL, expected INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS link_history (link TEXT NOT NULL, generation INTEGER NOT NULL, project TEXT NOT NULL, version TEXT NOT NULL, transform TEXT NOT NULL, PRIMARY KEY(link,generation));`);
    this.transaction(() => {
      for (const job of this.all()) {
        if (!this.database.prepare('SELECT id FROM link_versions WHERE id=?').get(job.id)) {
          const state: LinkedState = { id: job.id, projectId: job.projectId, namespace: job.source.namespace, occurrence: job.occurrence,
            generation: job.kind === 'ready' ? 1 : 0, currentVersionId: job.kind === 'ready' ? job.id : null, sourceToProjectMetres: structuredClone(IDENTITY_LINK_TRANSFORM) };
          this.saveState(state); this.database.prepare('INSERT INTO link_versions VALUES(?,?,?)').run(job.id, state.id, 0);
          if (state.currentVersionId) this.history(state);
        }
        // A second application process must not cancel a live first process's conversion.
        // Worker restart receipts or the bounded 90s deadline resolve interrupted jobs.
      }
    });
    this.timer = setInterval(() => {
      try { this.refresh(); } catch (error) {
        if (!(error instanceof Error) || !/database is locked/.test(error.message)) throw error;
      }
    }, 500); this.timer.unref();
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
  private transaction<T>(work: () => T): T {
    if (this.closed || this.locked) throw new Error('IFC store is closed or already in a catalog transaction.');
    this.database.exec('BEGIN IMMEDIATE'); this.locked = true;
    try { const value = work(); this.database.exec('COMMIT'); return value; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
    finally { this.locked = false; }
  }
  private states(projectId: string): LinkedState[] {
    if (!UUID.test(projectId)) throw new Error('Invalid project.');
    return this.database.prepare('SELECT body FROM link_catalog WHERE project=? ORDER BY id').all(projectId).map(row => {
      if (typeof row.body !== 'string') throw new Error('Invalid IFC catalog.'); return parseLinkedState(JSON.parse(row.body));
    });
  }
  private state(projectId: string, id: string): LinkedState {
    const value = this.states(projectId).find(item => item.id === id); if (!value) throw new Error('IFC link unavailable in this project.'); return value;
  }
  private saveState(state: LinkedState): void {
    parseLinkedState(state);
    this.database.prepare('INSERT INTO link_catalog VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(state.id, state.projectId, JSON.stringify(state));
  }
  private history(state: LinkedState): void {
    if (!state.currentVersionId) throw new Error('Cannot retain an empty IFC history pin.');
    this.database.prepare('INSERT INTO link_history VALUES(?,?,?,?,?)').run(state.id, state.generation, state.projectId, state.currentVersionId, JSON.stringify(state.sourceToProjectMetres));
  }
  private versionJobs(state: LinkedState): { job: LinkedJob; expectedGeneration: number }[] {
    const rows = this.database.prepare('SELECT id,expected FROM link_versions WHERE link=? ORDER BY rowid').all(state.id);
    const jobs = new Map(this.all().filter(job => job.projectId === state.projectId).map(job => [job.id, job]));
    return rows.map(row => {
      const job = typeof row.id === 'string' ? jobs.get(row.id) : undefined;
      if (!job || typeof row.expected !== 'number') throw new Error('Invalid retained IFC version.'); return { job, expectedGeneration: row.expected };
    });
  }
  catalog(projectId: string): LinkedCatalogItem[] {
    this.refresh(); return this.states(projectId).map(state => ({ state, revisionLimit: MAX_LINK_REVISIONS,
      versions: this.versionJobs(state).map(version => ({ ...version, current: state.currentVersionId === version.job.id,
        adopted: Boolean(this.database.prepare('SELECT 1 FROM link_history WHERE link=? AND version=? LIMIT 1').get(state.id, version.job.id)) })) }));
  }
  list(projectId: string): LinkedJob[] {
    this.refresh(); return this.states(projectId).map(state => {
      const versions = this.versionJobs(state); const selected = versions.find(value => value.job.id === state.currentVersionId) ?? versions[0];
      if (!selected) throw new Error('IFC link has no retained version.'); return { ...selected.job, id: state.id, occurrence: state.occurrence };
    });
  }
  get(projectId: string, id: string): LinkedJob {
    const job = this.list(projectId).find(item => item.id === id); if (!job) throw new Error('IFC reference unavailable in this project.'); return job;
  }
  attach(input: { projectId: string; name: string; bytes: Uint8Array }): LinkedJob {
    return this.transaction(() => {
      const id = randomUUID();
      if (this.states(input.projectId).length >= 8 || Number(this.database.prepare('SELECT COUNT(*) AS count FROM link_catalog').get()?.count) >= 32) throw new Error('IFC link limit reached (8 per project, 32 per installation).');
      const state: LinkedState = { id, projectId: input.projectId, namespace: id, occurrence: id, generation: 0, currentVersionId: null, sourceToProjectMetres: structuredClone(IDENTITY_LINK_TRANSFORM) };
      const job = this.enqueue(input, state, id); this.saveState(state); return job;
    });
  }
  prepareReplacement(input: { projectId: string; linkId: string; expectedGeneration: number; name: string; bytes: Uint8Array }): LinkedJob {
    validateUpload(input);
    return this.transaction(() => {
      const state = this.state(input.projectId, input.linkId); this.expect(state, input.expectedGeneration);
      const same = this.versionJobs(state).find(version => version.expectedGeneration === state.generation && version.job.source.originalSha256 === sha(input.bytes)
        && version.job.kind !== 'failed' && version.job.kind !== 'cancelled');
      if (same) return same.job;
      if (this.versionJobs(state).length >= MAX_LINK_REVISIONS) throw new Error(`IFC revision retention limit reached (${MAX_LINK_REVISIONS}); historical source dependencies are retained.`);
      if (this.versionJobs(state).some(version => pending(version.job))) throw new Error('This IFC link already has a candidate converting.');
      return this.enqueue(input, state, randomUUID());
    });
  }
  private expect(state: LinkedState, expected: number): void {
    if (!Number.isSafeInteger(expected) || state.generation !== expected) throw new Error('IFC link changed. Review the latest current version and retry.');
  }
  private enqueue(input: { projectId: string; name: string; bytes: Uint8Array }, state: LinkedState, id: string): LinkedJob {
    if (this.closed || !UUID.test(input.projectId)) throw new Error('Project unavailable.');
    validateUpload(input);
    const jobs = this.all();
    if (jobs.length >= 256) throw new Error('IFC retained revision limit reached (256 per installation).');
    if (fs.readdirSync(path.join(this.root, 'sources')).length >= 256 || fs.readdirSync(this.spool).length >= 256) throw new Error('IFC retained source/spool limit reached (256); no historical sources are deleted.');
    if (jobs.filter(pending).length >= 2) throw new Error('Two IFC conversions are already queued.');
    const originalSha256 = sha(input.bytes);
    const original = path.join(this.root, 'sources', originalSha256 + '.ifc');
    if (!fs.existsSync(original)) fs.writeFileSync(original, input.bytes, { flag: 'wx', mode: 0o400 });
    if (sha(readBounded(original, MAX_LINK_SOURCE_BYTES)) !== originalSha256) throw new Error('Retained IFC source is corrupt.');
    const job: LinkedJob = { id, projectId: input.projectId, name: input.name, source: { namespace: state.namespace, revision: originalSha256, originalSha256 }, occurrence: state.occurrence, createdAt: Date.now(), kind: 'queued' };
    const directory = path.join(this.spool, id); fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'input.ifc'), input.bytes, { flag: 'wx', mode: 0o400 });
    this.save(job);
    this.database.prepare('INSERT INTO link_versions VALUES(?,?,?)').run(id, state.id, state.generation);
    atomic(path.join(directory, 'request.json'), { id, source: job.source, occurrence: job.occurrence });
    this.ownedJobs.add(id);
    return job;
  }
  cancel(projectId: string, id: string): LinkedJob {
    return this.transaction(() => {
    const job = this.all().find(item => item.projectId === projectId && item.id === id); if (!job) throw new Error('IFC candidate unavailable.'); if (!pending(job)) return job;
    const cancelled: LinkedJob = { ...job, kind: 'cancelled' };
    this.save(cancelled); atomic(path.join(this.spool, id, 'cancel.json'), { cancelled: true }); return cancelled;
    });
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
    this.refresh(); const state = this.state(projectId, id);
    if (!state.currentVersionId) throw new Error('IFC reference is not ready.');
    return this.placed(this.preparedVersion(projectId, state.currentVersionId), state.sourceToProjectMetres);
  }
  private preparedVersion(projectId: string, id: string): LinkedPrepared {
    const job = this.all().find(item => item.projectId === projectId && item.id === id);
    if (!job || job.kind !== 'ready') throw new Error('IFC version is not ready.');
    return this.readPrepared(path.join(this.root, 'prepared', job.id), job);
  }
  private placed(prepared: LinkedPrepared, transform: number[][]): LinkedPrepared {
    return parseLinkedPrepared({ ...prepared, manifest: { ...prepared.manifest, occurrence: { ...prepared.manifest.occurrence, sourceToProjectMetres: structuredClone(transform) } } });
  }
  original(projectId: string, id: string): Buffer {
    const state = this.states(projectId).find(item => item.id === id);
    return this.originalVersion(projectId, state?.currentVersionId ?? id);
  }
  originalVersion(projectId: string, versionId: string): Buffer {
    if (!UUID.test(projectId)) throw new Error('Invalid project.');
    const job = this.all().find(item => item.projectId === projectId && item.id === versionId);
    if (!job) throw new Error('IFC source unavailable in this project.');
    const bytes = readBounded(path.join(this.root, 'sources', job.source.originalSha256 + '.ifc'), MAX_LINK_SOURCE_BYTES);
    if (sha(bytes) !== job.source.originalSha256) throw new Error('Retained IFC source is corrupt.'); return bytes;
  }
  refresh(): void {
    this.refreshPending();
  }
  reviewCandidate(projectId: string, linkId: string, candidateId: string) {
    this.refresh(); const state = this.state(projectId, linkId);
    const candidate = this.versionJobs(state).find(version => version.job.id === candidateId);
    if (!candidate) throw new Error('IFC candidate unavailable in this project.');
    const after = this.placed(this.preparedVersion(projectId, candidateId), state.sourceToProjectMetres);
    const before = state.currentVersionId ? this.placed(this.preparedVersion(projectId, state.currentVersionId), state.sourceToProjectMetres) : null;
    return { linkId, candidateId, generation: state.generation, expectedGeneration: candidate.expectedGeneration,
      delta: linkedDelta(before, after), diagnostics: after.manifest.diagnostics, losses: after.manifest.losses };
  }
  adopt(input: { projectId: string; linkId: string; candidateId: string; expectedGeneration: number }): LinkedState {
    return this.transaction(() => {
      const state = this.state(input.projectId, input.linkId);
      if (state.currentVersionId === input.candidateId && state.generation === input.expectedGeneration + 1) return state;
      this.expect(state, input.expectedGeneration);
      const candidate = this.versionJobs(state).find(version => version.job.id === input.candidateId);
      if (!candidate || candidate.expectedGeneration !== state.generation) throw new Error('Candidate was prepared against a different current version. Prepare a fresh candidate.');
      this.placed(this.preparedVersion(input.projectId, candidate.job.id), state.sourceToProjectMetres);
      const adopted = { ...state, currentVersionId: candidate.job.id, generation: state.generation + 1 };
      this.saveState(adopted); this.history(adopted); return adopted;
    });
  }
  place(input: { projectId: string; linkId: string; expectedGeneration: number; sourceToProjectMetres: number[][] }): LinkedState {
    assertRigidLinkTransform(input.sourceToProjectMetres);
    return this.transaction(() => {
      const state = this.state(input.projectId, input.linkId);
      const previous = this.database.prepare('SELECT version FROM link_history WHERE link=? AND generation=?').get(state.id, input.expectedGeneration);
      if (state.generation === input.expectedGeneration + 1 && previous?.version === state.currentVersionId && JSON.stringify(state.sourceToProjectMetres) === JSON.stringify(input.sourceToProjectMetres)) return state;
      this.expect(state, input.expectedGeneration);
      if (!state.currentVersionId) throw new Error('Prepare a current IFC version before placing its occurrence.');
      this.placed(this.preparedVersion(input.projectId, state.currentVersionId), input.sourceToProjectMetres);
      if (JSON.stringify(state.sourceToProjectMetres) === JSON.stringify(input.sourceToProjectMetres)) return state;
      if (Number(this.database.prepare('SELECT COUNT(*) AS count FROM link_history WHERE link=?').get(state.id)?.count) >= 64) throw new Error('IFC placement history limit reached (64). Historical pins are retained.');
      const placed = { ...state, generation: state.generation + 1, sourceToProjectMetres: structuredClone(input.sourceToProjectMetres) };
      this.saveState(placed); this.history(placed); return placed;
    });
  }
  private token(projectId: string, states = this.states(projectId)): string {
    const jobs = new Map(this.all().filter(job => job.projectId === projectId).map(job => [job.id, job]));
    const availability = states.map(state => {
      if (!state.currentVersionId) return [];
      const job = jobs.get(state.currentVersionId);
      if (!job) return ['missing-version'];
      return [path.join(this.root, 'sources', job.source.originalSha256 + '.ifc'), ...['manifest.json', 'index.json', 'geometry.json'].map(name => path.join(this.root, 'prepared', job.id, name))].map(filename => {
        try {
          const stat = fs.lstatSync(filename, { bigint: true });
          return stat.isFile() ? [String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs), String(stat.ino)] : ['not-file'];
        } catch { return ['missing']; }
      });
    });
    return sha(Buffer.from(JSON.stringify([projectId, states, availability])));
  }
  snapshotCurrent(projectId: string): LinkedCurrentSnapshot {
    this.refresh(); const states = this.states(projectId);
    const result: LinkedCurrentSnapshot = { catalogToken: this.token(projectId, states), links: [], unavailable: [] };
    for (const state of states) {
      if (!state.currentVersionId) { result.unavailable.push({ linkId: state.id, reason: 'No current prepared version.' }); continue; }
      try { result.links.push({ linkId: state.id, generation: state.generation, versionId: state.currentVersionId,
        prepared: this.placed(this.preparedVersion(projectId, state.currentVersionId), state.sourceToProjectMetres) }); }
      catch { result.unavailable.push({ linkId: state.id, reason: 'Current IFC artifacts unavailable or corrupt.' }); }
    }
    return result;
  }
  readVersion(projectId: string, selection: LinkedSelection): LinkedVersionResolution {
    const state = this.states(projectId).find(item => item.namespace === selection.source.namespace && item.occurrence === selection.occurrence.id);
    if (!state) return { kind: 'unavailable', reason: 'missing' };
    const versions = this.versionJobs(state).filter(version => version.job.kind === 'ready' && version.job.source.revision === selection.source.revision
      && version.job.source.originalSha256 === selection.source.originalSha256);
    const rows = this.database.prepare('SELECT version,transform FROM link_history WHERE link=? AND project=?').all(state.id, projectId);
    const retained = versions.find(version => rows.some(row => row.version === version.job.id && row.transform === JSON.stringify(selection.occurrence.sourceToProjectMetres)));
    if (!retained) return { kind: 'unavailable', reason: 'missing' };
    try {
      const prepared = this.placed(this.preparedVersion(projectId, retained.job.id), selection.occurrence.sourceToProjectMetres);
      if (!prepared.index.objects.some(object => object.ref.globalId === selection.source.globalId)) return { kind: 'unavailable', reason: 'missing' };
      return { kind: 'ok', versionId: retained.job.id, prepared };
    } catch { return { kind: 'unavailable', reason: 'missing' }; }
  }
  resolve(projectId: string, selection: LinkedSelection, mode: 'current' | 'historical'): LinkedVersionResolution {
    const historical = this.readVersion(projectId, selection); if (historical.kind !== 'ok' || mode === 'historical') return historical;
    const state = this.states(projectId).find(item => item.namespace === selection.source.namespace && item.occurrence === selection.occurrence.id);
    const current = this.all().find(job => job.projectId === projectId && job.id === state?.currentVersionId);
    if (!state || !current || current.source.originalSha256 !== selection.source.originalSha256 || current.source.revision !== selection.source.revision || JSON.stringify(state.sourceToProjectMetres) !== JSON.stringify(selection.occurrence.sourceToProjectMetres)) return { kind: 'unavailable', reason: 'stale' };
    return historical;
  }
  /** Lock order: linked catalog first, then the caller's native transaction. Never await or reenter. */
  withCatalogGuard<T>(projectId: string, expectedCatalogToken: string, synchronousCommit: () => T): LinkedGuardResult<T> {
    if (Object.prototype.toString.call(synchronousCommit) === '[object AsyncFunction]') throw new Error('IFC catalog guard requires synchronous publication.');
    return this.transaction<LinkedGuardResult<T>>(() => {
      if (this.token(projectId) !== expectedCatalogToken) return { kind: 'catalog-changed' };
      const value = synchronousCommit();
      if (((typeof value === 'object' && value !== null) || typeof value === 'function') && 'then' in value) throw new Error('IFC catalog guard cannot publish a thenable.');
      return { kind: 'committed', value };
    });
  }
  private refreshPending(): void {
    if (this.closed || this.locked) return;
    if (!this.all().some(pending)) return;
    this.transaction(() => {
    for (const job of this.all().filter(pending)) {
      const directory = path.join(this.spool, job.id);
      this.database.exec('SAVEPOINT publish_job');
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
          const target = path.join(this.root, 'prepared', job.id);
          if (!fs.existsSync(target)) {
            const staging = `${target}.${randomUUID()}.tmp`; fs.mkdirSync(staging, { mode: 0o700 });
            for (const name of ['index.json', 'geometry.json', 'manifest.json']) fs.writeFileSync(path.join(staging, name), readBounded(path.join(output, name), MAX_LINK_OUTPUT_BYTES), { flag: 'wx', mode: 0o400 });
            this.readPrepared(staging, job); fs.renameSync(staging, target);
          } else this.readPrepared(target, job);
          this.save({ ...job, kind: 'ready' });
          const row = this.database.prepare('SELECT link FROM link_versions WHERE id=?').get(job.id);
          if (typeof row?.link !== 'string') throw new Error('IFC candidate association missing.');
          const state = this.state(job.projectId, row.link);
          if (state.currentVersionId === null && state.generation === 0) {
            const adopted = { ...state, currentVersionId: job.id, generation: 1 }; this.saveState(adopted); this.history(adopted);
          }
        } else if (fs.existsSync(path.join(directory, 'progress.json'))) {
          const value: unknown = JSON.parse(readBounded(path.join(directory, 'progress.json'), 4096).toString());
          if (typeof value === 'object' && value !== null && 'phase' in value && typeof value.phase === 'string') this.save({ ...job, kind: 'running', progress: value.phase.slice(0, 256) });
        }
        this.database.exec('RELEASE publish_job');
      } catch (error) {
        this.database.exec('ROLLBACK TO publish_job; RELEASE publish_job');
        this.save({ ...job, kind: 'failed', error: error instanceof Error ? error.message.slice(0, 1024) : 'Conversion failed.' });
      }
    }
    });
  }
  close(): void {
    if (this.closed) return;
    for (const job of this.all().filter(job => this.ownedJobs.has(job.id) && pending(job))) this.cancel(job.projectId, job.id);
    this.closed = true; clearInterval(this.timer); this.database.close();
  }
}
