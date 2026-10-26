import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Check } from 'typebox/value';
import type { ModelGraph } from '../src/room-model.ts';
import { createModelScopeIndex, parseModelScopeIndex, resolveIndexedModelScope } from '../src/model-scope.ts';
import { parseFrozenModelScope, parseModelScopeQuery, SavedModelScopeSchema } from '../src/model-scope-contract.ts';
import type { FrozenModelScope, ModelScopeQuery, SavedModelScope } from '../src/model-scope-contract.ts';
import type { RepositoryReference, VersionedProjects } from './versioned-project-contract.ts';

let transactionSequence = 0;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const projectPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export class ScopeStoreConflict extends Error {
  readonly code: 'not-found' | 'conflict';
  constructor(message: string, code: 'not-found' | 'conflict' = 'conflict') {
    super(message); this.name = 'ScopeStoreConflict'; this.code = code;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  throw new Error('Scope storage requires finite JSON.');
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function text(value: unknown): string { if (typeof value !== 'string') throw new Error('Unreadable saved scope.'); return value; }

/** Named queries are project settings; the sole authored model remains VersionedProjects. */
export class ModelScopeStore {
  readonly #db: DatabaseSync;
  readonly #projects: VersionedProjects;
  constructor(db: DatabaseSync, projects: VersionedProjects) {
    this.#db = db; this.#projects = projects;
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_scope_versions (
        project_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, parent_version TEXT,
        name TEXT NOT NULL, query TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        PRIMARY KEY(project_id,id,version)) STRICT;
      CREATE TABLE IF NOT EXISTS model_scope_heads (
        project_id TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY(project_id,id)) STRICT;
      CREATE TABLE IF NOT EXISTS model_scope_projection (
        project_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, revision_id TEXT NOT NULL,
        source_signature TEXT NOT NULL, payload_hash TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
    `);
  }

  #project(projectId: string): RepositoryReference {
    if (!projectPattern.test(projectId)) throw new Error('Invalid scope project identity.');
    const reference = this.#projects.current(projectId);
    if (!reference) throw new ScopeStoreConflict('Unknown scope project.', 'not-found');
    return reference;
  }

  #atomic<T>(operation: () => T): T {
    const savepoint = `model_scope_store_${++transactionSequence}`;
    this.#db.exec(`SAVEPOINT ${savepoint}`);
    try { const result = operation(); this.#db.exec(`RELEASE ${savepoint}`); return result; }
    catch (error) { this.#db.exec(`ROLLBACK TO ${savepoint}`); this.#db.exec(`RELEASE ${savepoint}`); throw error; }
  }

  #index(reference: RepositoryReference, revisionId: string): ReturnType<typeof createModelScopeIndex> {
    if (!revisionPattern.test(revisionId)) throw new Error('Invalid scope base revision.');
    const signature = this.#projects.graphSignature({reference,revisionId});
    const cached = this.#db.prepare('SELECT * FROM model_scope_projection WHERE project_id=?').get(reference.projectId);
    if (cached && cached.document_id === reference.documentId && cached.revision_id === revisionId && cached.source_signature === signature
        && typeof cached.payload === 'string' && hash(cached.payload) === cached.payload_hash) {
      try { return parseModelScopeIndex(JSON.parse(cached.payload)); }
      catch { /* A derived cache can be rebuilt from the verified immutable source. */ }
    }
    const graph = this.#projects.readGraph({reference,revisionId});
    const index = createModelScopeIndex(graph); const payload = canonical(index);
    if (Buffer.byteLength(payload) > 256 * 1024) throw new Error('Scope projection exceeds the bounded house limit.');
    this.#db.prepare(`INSERT INTO model_scope_projection(project_id,document_id,revision_id,source_signature,payload_hash,payload)
      VALUES(?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET document_id=excluded.document_id,revision_id=excluded.revision_id,
      source_signature=excluded.source_signature,payload_hash=excluded.payload_hash,payload=excluded.payload`)
      .run(reference.projectId,reference.documentId,revisionId,signature,hash(payload),payload);
    return index;
  }

  preview(input: {projectId: string; baseRevisionId: string; query: ModelScopeQuery}): {scope: FrozenModelScope; graph: ModelGraph} {
    const reference = this.#project(input.projectId); const query = parseModelScopeQuery(input.query);
    const index = this.#index(reference,input.baseRevisionId);
    const resolved = resolveIndexedModelScope({index,query});
    const scope = parseFrozenModelScope({version:1,baseRevisionId:input.baseRevisionId,query,
      targetIds:resolved.targetIds,contextIds:resolved.contextIds,dependentIds:resolved.dependentIds,
      writableIds:resolved.writableIds,relationshipIds:resolved.relationshipIds});
    const entityIds = [...new Set([...scope.targetIds,...scope.contextIds,...scope.dependentIds])];
    const graph = this.#projects.readItems({reference,revisionId:input.baseRevisionId,entityIds,relationshipIds:scope.relationshipIds});
    return {scope,graph};
  }

  #saved(row: Record<string,unknown>): SavedModelScope {
    const query = parseModelScopeQuery(JSON.parse(text(row.query)));
    const name = text(row.name); const id = text(row.id); const version = text(row.version);
    const parentVersion = row.parent_version === null ? null : text(row.parent_version);
    if (hash(canonical({projectId:row.project_id,id,parentVersion,name,query})) !== version) throw new Error('Saved scope version is corrupt.');
    const saved = {id,name,query,version,recordedAt:row.recorded_at};
    if (!Check(SavedModelScopeSchema,saved)) throw new Error('Saved scope metadata is invalid.');
    return saved;
  }

  list(projectId: string): readonly SavedModelScope[] {
    this.#project(projectId);
    return this.#db.prepare(`SELECT v.* FROM model_scope_heads h JOIN model_scope_versions v
      ON v.project_id=h.project_id AND v.id=h.id AND v.version=h.version WHERE h.project_id=? ORDER BY v.name,h.id LIMIT 32`)
      .all(projectId).map(row => this.#saved(row));
  }

  load(input: {projectId: string; id: string}): SavedModelScope {
    this.#project(input.projectId);
    if (!idPattern.test(input.id)) throw new Error('Invalid saved scope identity.');
    const row = this.#db.prepare(`SELECT v.* FROM model_scope_heads h JOIN model_scope_versions v
      ON v.project_id=h.project_id AND v.id=h.id AND v.version=h.version WHERE h.project_id=? AND h.id=?`).get(input.projectId,input.id);
    if (!row) throw new ScopeStoreConflict('Unknown saved scope.', 'not-found');
    return this.#saved(row);
  }

  save(input: {projectId: string; id: string; name: string; query: ModelScopeQuery; expectedVersion: string | null}): SavedModelScope {
    const reference = this.#project(input.projectId);
    if (!idPattern.test(input.id) || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name)
        || input.expectedVersion !== null && !revisionPattern.test(input.expectedVersion)) throw new Error('Invalid saved scope metadata.');
    const query = parseModelScopeQuery(input.query);
    const revisionId = this.#projects.acceptedHead(input.projectId);
    if (revisionId === null) throw new Error('Saved scope project has no accepted revision.');
    resolveIndexedModelScope({index:this.#index(reference,revisionId),query});
    return this.#atomic(() => {
      const head = this.#db.prepare('SELECT version FROM model_scope_heads WHERE project_id=? AND id=?').get(input.projectId,input.id);
      const currentVersion = head ? text(head.version) : null;
      if (currentVersion !== null) {
        const current = this.load({projectId:input.projectId,id:input.id});
        if (current.name === input.name && canonical(current.query) === canonical(query)) return current;
      }
      if (currentVersion !== input.expectedVersion) throw new ScopeStoreConflict('The saved scope changed. Reload it before saving.');
      if (currentVersion === null) {
        const count = this.#db.prepare('SELECT COUNT(*) AS n FROM model_scope_heads WHERE project_id=?').get(input.projectId)?.n;
        if (typeof count !== 'number' || count >= 32) throw new Error('This project already has the bounded number of saved scopes.');
      }
      const count = this.#db.prepare('SELECT COUNT(*) AS n FROM model_scope_versions WHERE project_id=? AND id=?').get(input.projectId,input.id)?.n;
      if (typeof count !== 'number' || count >= 64) throw new Error('This saved scope has reached its bounded version limit.');
      const version = hash(canonical({projectId:input.projectId,id:input.id,parentVersion:currentVersion,name:input.name,query}));
      const recordedAt = Date.now();
      this.#db.prepare('INSERT INTO model_scope_versions(project_id,id,version,parent_version,name,query,recorded_at) VALUES(?,?,?,?,?,?,?)')
        .run(input.projectId,input.id,version,currentVersion,input.name,canonical(query),recordedAt);
      this.#db.prepare(`INSERT INTO model_scope_heads(project_id,id,version) VALUES(?,?,?)
        ON CONFLICT(project_id,id) DO UPDATE SET version=excluded.version`).run(input.projectId,input.id,version);
      return {id:input.id,name:input.name,query,version,recordedAt};
    });
  }
}
