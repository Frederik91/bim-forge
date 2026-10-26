import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { RoomRepository } from '../src/room-model.ts';
import type { ProjectHistoryEntry, ProjectHistoryPage, ProjectSummary, RepositoryReference, VersionedProjects } from './versioned-project-contract.ts';

type Kind = 'entity' | 'relationship';
interface Change { id: string; body: string | null }
interface Move { id: string; after: string | null }
interface Delta {
  version: 2 | null;
  entities: Change[];
  relationships: Change[];
  entityOrder: Move[];
  relationshipOrder: Move[];
}
interface Graph { version: 2 | null; entities: Map<string, unknown>; relationships: Map<string, unknown> }
interface Manifest {
  version: 1 | 2;
  projectId: string;
  name: string;
  revisions: string[];
  branches: { name: string; revisionId: string }[];
  reviews: unknown[];
}
let savepointSequence = 0;

function fail(message: string): never { throw new Error(`Versioned project store: ${message}`); }
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) fail('invalid stored object.');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string') fail('invalid stored text.');
  return value;
}
function nullable(value: unknown): string | null { return value === null ? null : string(value); }
function array(value: unknown, maximum = 100): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail('invalid bounded collection.');
  const result: unknown[] = value;
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  return fail('invalid JSON value.');
}
function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function parsed(text: string): unknown {
  if (Buffer.byteLength(text) > 256 * 1024) fail('stored document exceeds the portable bound.');
  return JSON.parse(text);
}
function bounded(limit: number, maximum: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) fail(`limit must be 1..${maximum}.`);
}
function manifest(text: string): Manifest {
  const value = object(parsed(text));
  if (value.version !== 1 && value.version !== 2) fail('invalid repository version.');
  return { version: value.version, projectId: string(value.projectId), name: string(value.name),
    revisions: array(value.revisions).map(string), branches: array(value.branches).map((entry) => {
      const branch = object(entry); return { name: string(branch.name), revisionId: string(branch.revisionId) };
    }), reviews: value.version === 2 ? array(value.reviews) : [] };
}
function delta(text: string): Delta {
  const value = object(parsed(text));
  if (value.version !== null && value.version !== 2) fail('invalid snapshot version.');
  const changes = (input: unknown): Change[] => array(input, 200).map((entry) => {
    const item = object(entry); return { id: string(item.id), body: nullable(item.body) };
  });
  const moves = (input: unknown): Move[] => array(input).map((entry) => {
    const item = object(entry); return { id: string(item.id), after: nullable(item.after) };
  });
  return { version: value.version, entities: changes(value.entities), relationships: changes(value.relationships),
    entityOrder: moves(value.entityOrder), relationshipOrder: moves(value.relationshipOrder) };
}
function orderChanges(before: readonly string[], after: readonly string[]): Move[] {
  const desired = new Set(after); const working = before.filter((id) => desired.has(id)); const result: Move[] = [];
  for (const [index, id] of after.entries()) {
    if (working[index] === id) continue;
    const previous = working.indexOf(id); if (previous !== -1) working.splice(previous, 1);
    working.splice(index, 0, id); result.push({ id, after: index === 0 ? null : after[index - 1] });
  }
  return result;
}

/** Immutable portable documents over changed-only model storage. Publication is a separate CAS. */
export class VersionedProjectStore implements VersionedProjects {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#atomic(() => db.exec(`
      CREATE TABLE IF NOT EXISTS versioned_bodies (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_revisions (
        project_id TEXT NOT NULL, id TEXT NOT NULL, parent_id TEXT, delta_hash TEXT NOT NULL, delta TEXT NOT NULL,
        PRIMARY KEY(project_id, id)) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_documents (
        project_id TEXT NOT NULL, id TEXT NOT NULL, manifest TEXT NOT NULL, PRIMARY KEY(project_id, id)) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_projects (
        project_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, name TEXT NOT NULL, head_revision_id TEXT NOT NULL, recorded_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_publications (
        project_id TEXT NOT NULL, revision_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        origin TEXT NOT NULL, request_id TEXT, decision_id TEXT, PRIMARY KEY(project_id, revision_id)) STRICT;
    `));
  }

  #atomic<T>(write: () => T): T {
    const name = `versioned_store_${++savepointSequence}`;
    this.#db.exec(`SAVEPOINT ${name}`);
    try { const result = write(); this.#db.exec(`RELEASE ${name}`); return result; }
    catch (error) { this.#db.exec(`ROLLBACK TO ${name}`); this.#db.exec(`RELEASE ${name}`); throw error; }
  }

  #row(sql: string, ...values: SQLInputValue[]): Record<string, unknown> {
    const row = this.#db.prepare(sql).get(...values);
    if (!row) fail('missing immutable reference.');
    return row;
  }

  #manifest(reference: RepositoryReference): Manifest {
    const row = this.#row('SELECT manifest FROM versioned_documents WHERE project_id = ? AND id = ?', reference.projectId, reference.documentId);
    const text = string(row.manifest);
    if (hash(text) !== reference.documentId) fail('document hash corruption.');
    const result = manifest(text);
    if (result.projectId !== reference.projectId) fail('document belongs to another project.');
    return result;
  }

  #revision(projectId: string, id: string): { parentId: string | null; delta: Delta } {
    const row = this.#row('SELECT parent_id, delta_hash, delta FROM versioned_revisions WHERE project_id = ? AND id = ?', projectId, id);
    const text = string(row.delta);
    if (hash(text) !== row.delta_hash) fail('revision delta hash corruption.');
    return { parentId: nullable(row.parent_id), delta: delta(text) };
  }

  put(repository: RoomRepository): RepositoryReference {
    if (!(repository instanceof RoomRepository)) fail('put requires a validated RoomRepository.');
    const state = repository.persistence();
    return this.#atomic(() => {
      const revisions = new Map(state.revisions.map((revision) => [revision.id, revision]));
      for (const revision of state.revisions) {
        if (hash(canonical({ version: 1, parentId: revision.parentId, snapshot: revision.snapshot })) !== revision.id) fail('portable revision hash corruption.');
        const parent = revision.parentId === null ? undefined : revisions.get(revision.parentId);
        if (revision.parentId !== null && !parent) fail('missing parent revision.');
        const changes = (kind: Kind): Change[] => {
          const items = kind === 'entity' ? revision.snapshot.entities : revision.snapshot.relationships;
          const before = kind === 'entity' ? parent?.snapshot.entities ?? [] : parent?.snapshot.relationships ?? [];
          const old = new Map(before.map((item) => [item.id, canonical(item)]));
          const remaining = new Set<string>(items.map((item) => item.id)); const result: Change[] = [];
          for (const item of items) {
            const text = canonical(item);
            if (old.get(item.id) === text) continue;
            const bodyHash = hash(text);
            this.#db.prepare('INSERT OR IGNORE INTO versioned_bodies(hash, kind, body) VALUES (?, ?, ?)').run(bodyHash, kind, text);
            const saved = this.#row('SELECT kind, body FROM versioned_bodies WHERE hash = ?', bodyHash);
            if (saved.body !== text || saved.kind !== kind) fail('body hash corruption.');
            result.push({ id: item.id, body: bodyHash });
          }
          for (const item of before) if (!remaining.has(item.id)) result.push({ id: item.id, body: null });
          return result;
        };
        const patch: Delta = { version: revision.snapshot.version ?? null, entities: changes('entity'), relationships: changes('relationship'),
          entityOrder: orderChanges(parent?.snapshot.entities.map((item) => item.id) ?? [], revision.snapshot.entities.map((item) => item.id)),
          relationshipOrder: orderChanges(parent?.snapshot.relationships.map((item) => item.id) ?? [], revision.snapshot.relationships.map((item) => item.id)) };
        const text = canonical(patch); const deltaHash = hash(text);
        this.#db.prepare('INSERT OR IGNORE INTO versioned_revisions(project_id, id, parent_id, delta_hash, delta) VALUES (?, ?, ?, ?, ?)')
          .run(state.projectId, revision.id, revision.parentId, deltaHash, text);
        const saved = this.#row('SELECT parent_id, delta_hash, delta FROM versioned_revisions WHERE project_id = ? AND id = ?', state.projectId, revision.id);
        if (saved.parent_id !== revision.parentId || saved.delta_hash !== deltaHash || saved.delta !== text) fail('immutable revision mismatch.');
      }
      const metadata = { version: state.version, projectId: state.projectId, name: state.name,
        revisions: state.revisions.map((revision) => revision.id), branches: state.branches,
        ...(state.version === 2 ? { reviews: state.reviews } : {}) };
      const text = canonical(metadata); const documentId = hash(text);
      this.#db.prepare('INSERT OR IGNORE INTO versioned_documents(project_id, id, manifest) VALUES (?, ?, ?)').run(state.projectId, documentId, text);
      const reference = { projectId: state.projectId, documentId };
      // Verify the persisted graph, including existing unchanged bodies, before committing a reference.
      if (this.read(reference) !== repository.serialize()) fail('portable reconstruction mismatch.');
      return reference;
    });
  }

  read(reference: RepositoryReference): string {
    const metadata = this.#manifest(reference); const allowed = new Set(metadata.revisions);
    const cache = new Map<string, { graph: Graph; parentId: string | null }>(); const visiting = new Set<string>();
    const load = (id: string): { graph: Graph; parentId: string | null } => {
      const existing = cache.get(id); if (existing) return existing;
      if (!allowed.has(id) || visiting.has(id) || visiting.size >= 100) fail('missing or cyclic revision ancestry.');
      visiting.add(id); const revision = this.#revision(reference.projectId, id);
      const parent = revision.parentId === null ? undefined : load(revision.parentId).graph;
      const apply = (kind: Kind, before: Map<string, unknown>, changes: Change[], moves: Move[]): Map<string, unknown> => {
        const values = new Map(before); const seen = new Set<string>();
        for (const change of changes) {
          if (seen.has(change.id)) fail('duplicate item delta.'); seen.add(change.id);
          if (change.body === null) { if (!values.delete(change.id)) fail('missing deleted item.'); continue; }
          const row = this.#row('SELECT kind, body FROM versioned_bodies WHERE hash = ?', change.body);
          const text = string(row.body);
          if (row.kind !== kind || hash(text) !== change.body) fail('body hash corruption.');
          const item = object(parsed(text)); if (item.id !== change.id) fail('body identity mismatch.');
          values.set(change.id, item);
        }
        const order = [...before.keys()].filter((key) => values.has(key));
        for (const move of moves) {
          if (!values.has(move.id) || move.after === move.id) fail('invalid item ordering.');
          const previous = order.indexOf(move.id); if (previous !== -1) order.splice(previous, 1);
          const index = move.after === null ? -1 : order.indexOf(move.after);
          if (move.after !== null && index === -1) fail('missing ordering reference.');
          order.splice(index + 1, 0, move.id);
        }
        if (order.length !== values.size) fail('incomplete item ordering.');
        return new Map(order.map((key) => [key, values.get(key)]));
      };
      const graph: Graph = { version: revision.delta.version,
        entities: apply('entity', parent?.entities ?? new Map(), revision.delta.entities, revision.delta.entityOrder),
        relationships: apply('relationship', parent?.relationships ?? new Map(), revision.delta.relationships, revision.delta.relationshipOrder) };
      const snapshot = { ...(graph.version === 2 ? { version: 2 } : {}), units: 'm', entities: [...graph.entities.values()], relationships: [...graph.relationships.values()] };
      if (hash(canonical({ version: 1, parentId: revision.parentId, snapshot })) !== id) fail('portable revision hash corruption.');
      const result = { graph, parentId: revision.parentId }; visiting.delete(id); cache.set(id, result); return result;
    };
    const revisions = metadata.revisions.map((id) => {
      const { graph, parentId } = load(id);
      return { id, parentId, snapshot: { ...(graph.version === 2 ? { version: 2 } : {}), units: 'm',
        entities: [...graph.entities.values()], relationships: [...graph.relationships.values()] } };
    });
    for (const branch of metadata.branches) if (!allowed.has(branch.revisionId)) fail('missing branch revision.');
    const text = canonical({ version: metadata.version, projectId: metadata.projectId, name: metadata.name, revisions,
      branches: metadata.branches, ...(metadata.version === 2 ? { reviews: metadata.reviews } : {}) });
    if (Buffer.byteLength(text) > 256 * 1024) fail('reconstructed project exceeds the portable bound.');
    return text;
  }

  current(projectId: string): RepositoryReference | null {
    const row = this.#db.prepare('SELECT document_id FROM versioned_projects WHERE project_id = ?').get(projectId);
    return row ? { projectId, documentId: string(row.document_id) } : null;
  }

  publish(input: Parameters<VersionedProjects['publish']>[0]): void {
    this.#atomic(() => {
      if (input.reference.projectId !== input.projectId) fail('publication belongs to another project.');
      if (!['created', 'imported', 'accepted'].includes(input.origin)) fail('invalid publication origin.');
      const current = this.current(input.projectId);
      if ((current?.documentId ?? null) !== input.expectedDocumentId) fail('publication CAS conflict.');
      this.read(input.reference); const metadata = this.#manifest(input.reference);
      const head = metadata.branches.find((branch) => branch.name === 'main')?.revisionId;
      if (!head) fail('missing main branch.');
      const oldHead = current ? this.#manifest(current).branches.find((branch) => branch.name === 'main')?.revisionId : null;
      let id: string | null = head; let foundPrevious = oldHead === null; const seen = new Set<string>();
      const ancestry: { id: string; parentId: string | null }[] = [];
      while (id !== null) {
        if (seen.has(id) || seen.size >= 100 || !metadata.revisions.includes(id)) fail('invalid publication ancestry.');
        seen.add(id); if (id === oldHead) foundPrevious = true;
        const revision = this.#revision(input.projectId, id); ancestry.push({ id, parentId: revision.parentId }); id = revision.parentId;
      }
      if (!foundPrevious) fail('publication must extend accepted main ancestry.');
      const recordedAt = Date.now();
      for (const revision of ancestry) this.#db.prepare(`INSERT OR IGNORE INTO versioned_publications
        (project_id, revision_id, recorded_at, origin, request_id, decision_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(input.projectId, revision.id, recordedAt, revision.id === head ? input.origin : 'imported',
          revision.id === head ? input.requestId : null, revision.id === head ? input.decisionId : null);
      this.#db.prepare(`INSERT INTO versioned_projects(project_id, document_id, name, head_revision_id, recorded_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET document_id = excluded.document_id, name = excluded.name,
        head_revision_id = excluded.head_revision_id, recorded_at = excluded.recorded_at`)
        .run(input.projectId, input.reference.documentId, metadata.name, head, recordedAt);
    });
  }

  list(input: { limit: number }): readonly ProjectSummary[] {
    bounded(input.limit, 32);
    return this.#db.prepare('SELECT * FROM versioned_projects ORDER BY recorded_at DESC, project_id LIMIT ?').all(input.limit).map((row) => ({
      projectId: string(row.project_id), name: string(row.name), headRevisionId: string(row.head_revision_id), recordedAt: this.#time(row.recorded_at) }));
  }

  #time(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('invalid recorded timestamp.');
    return value;
  }

  history(input: { projectId: string; before: string | null; limit: number }): ProjectHistoryPage {
    bounded(input.limit, 50); const current = this.current(input.projectId);
    if (!current) fail('unknown project.');
    const metadata = this.#manifest(current); let id = metadata.branches.find((branch) => branch.name === 'main')?.revisionId ?? null;
    const entries: ProjectHistoryEntry[] = []; const seen = new Set<string>(); let cursorFound = input.before === null;
    while (id !== null) {
      if (seen.has(id) || seen.size >= 100 || !metadata.revisions.includes(id)) fail('invalid accepted ancestry.'); seen.add(id);
      const revision = this.#revision(input.projectId, id);
      if (cursorFound) {
        if (entries.length === input.limit) return { entries, nextCursor: entries.at(-1)?.revisionId ?? null };
        const row = this.#row('SELECT * FROM versioned_publications WHERE project_id = ? AND revision_id = ?', input.projectId, id);
        const origin = row.origin;
        if (origin !== 'created' && origin !== 'imported' && origin !== 'accepted') fail('invalid history origin.');
        entries.push({ revisionId: id, parentRevisionId: revision.parentId,
          changedEntityIds: revision.delta.entities.map((item) => item.id), changedRelationshipIds: revision.delta.relationships.map((item) => item.id),
          recordedAt: this.#time(row.recorded_at), origin, requestId: nullable(row.request_id), decisionId: nullable(row.decision_id) });
      } else if (id === input.before) cursorFound = true;
      id = revision.parentId;
    }
    if (!cursorFound) fail('unknown project-bound history cursor.');
    return { entries, nextCursor: null };
  }
}
