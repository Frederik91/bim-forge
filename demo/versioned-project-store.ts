import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { RoomRepository, validateSnapshot, parseModelEntity, parseModelRelationship, branchName } from '../src/room-model.ts';
import { parseDesignTargets, parseWritableDesignTarget, parseFrozenDesignTarget, sameDesignTarget } from '../src/design-targets.ts';
import type { DesignTargetsState, WritableDesignTarget } from '../src/design-targets.ts';
import type { ModelSnapshot, ModelGraph } from '../src/room-model.ts';
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
  version: 1 | 2 | 3;
  projectId: string;
  name: string;
  revisions: string[];
  branches: { name: string; revisionId: string }[];
  reviews: { hash: string; decision: unknown }[];
  designTargets?: DesignTargetsState;
}
let savepointSequence = 0;
const MAX_BYTES = 256 * 1024;

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
function targetKey(target: WritableDesignTarget): string { return target.kind === 'main' ? 'main' : `alternative:${target.id}`; }
function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
/** Count before serializing: preserve the portable depth, array and UTF-8 byte bounds. */
function portableBytes(value: unknown, depth = 0): number {
  if (depth > 16) fail('portable data exceeds the depth bound.');
  let bytes: number;
  if (Array.isArray(value)) {
    const entries = array(value); bytes = 2 + Math.max(0, entries.length - 1);
    for (const entry of entries) { bytes += portableBytes(entry, depth + 1); if (bytes > MAX_BYTES) fail('project exceeds the 256 KiB portable bound.'); }
  } else if (isObject(value)) {
    const entries = Object.entries(value); bytes = 2 + Math.max(0, entries.length - 1);
    for (const [key, entry] of entries) {
      bytes += portableBytes(key, depth + 1) + 1 + portableBytes(entry, depth + 1);
      if (bytes > MAX_BYTES) fail('project exceeds the 256 KiB portable bound.');
    }
  } else {
    if (typeof value === 'string' && value.length > MAX_BYTES) fail('project exceeds the 256 KiB portable bound.');
    bytes = Buffer.byteLength(canonical(value));
  }
  if (bytes > MAX_BYTES) fail('project exceeds the 256 KiB portable bound.');
  return bytes;
}
function parsed(text: string): unknown {
  if (Buffer.byteLength(text) > MAX_BYTES) fail('stored document exceeds the portable bound.');
  return JSON.parse(text);
}
function bounded(limit: number, maximum: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) fail(`limit must be 1..${maximum}.`);
}
function manifest(text: string): Manifest {
  const value = object(parsed(text));
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) fail('invalid repository version.');
  return { version: value.version, projectId: string(value.projectId), name: string(value.name),
    revisions: array(value.revisions, 32).map(string), branches: array(value.branches, 32).map((entry) => {
      const branch = object(entry); return { name: string(branch.name), revisionId: string(branch.revisionId) };
    }), reviews: value.version !== 1 ? array(value.reviews, 31).map((entry) => {
      const review = object(entry); return { hash: string(review.hash), decision: review.decision };
    }) : [], ...(value.version === 3 ? { designTargets: parseDesignTargets(value.designTargets, branchName) } : {}) };
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
      CREATE TABLE IF NOT EXISTS versioned_reviews (
        project_id TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(project_id, hash)) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_projects (
        project_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, name TEXT NOT NULL, head_revision_id TEXT NOT NULL, recorded_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_publications (
        project_id TEXT NOT NULL, revision_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        origin TEXT NOT NULL, request_id TEXT, decision_id TEXT, PRIMARY KEY(project_id, revision_id)) STRICT;
      CREATE TABLE IF NOT EXISTS versioned_target_publications (
        project_id TEXT NOT NULL, target_key TEXT NOT NULL, revision_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
        origin TEXT NOT NULL, request_id TEXT, decision_id TEXT, PRIMARY KEY(project_id, target_key, revision_id)) STRICT;
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
    portableBytes(state);
    array(state.revisions, 32); array(state.branches, 32);
    if (state.version !== 1) array(state.reviews, 31);
    const serialized = canonical(state);
    if (Buffer.byteLength(serialized) > MAX_BYTES) fail('project exceeds the 256 KiB portable bound.');
    return this.#atomic(() => {
      const revisions = new Map(state.revisions.map((revision) => [revision.id, revision]));
      for (const revision of state.revisions) {
        const existing = this.#db.prepare('SELECT parent_id, delta_hash, delta FROM versioned_revisions WHERE project_id = ? AND id = ?').get(state.projectId, revision.id);
        if (existing) {
          const text = string(existing.delta);
          if (existing.parent_id !== revision.parentId || hash(text) !== existing.delta_hash) fail('immutable revision hash corruption.');
          delta(text);
          continue;
        }
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
            const saved = this.#db.prepare('SELECT kind, body FROM versioned_bodies WHERE hash = ?').get(bodyHash);
            if (saved) { if (saved.body !== text || saved.kind !== kind) fail('body hash corruption.'); }
            else this.#db.prepare('INSERT INTO versioned_bodies(hash, kind, body) VALUES (?, ?, ?)').run(bodyHash, kind, text);
            result.push({ id: item.id, body: bodyHash });
          }
          for (const item of before) if (!remaining.has(item.id)) result.push({ id: item.id, body: null });
          return result;
        };
        const patch: Delta = { version: revision.snapshot.version ?? null, entities: changes('entity'), relationships: changes('relationship'),
          entityOrder: orderChanges(parent?.snapshot.entities.map((item) => item.id) ?? [], revision.snapshot.entities.map((item) => item.id)),
          relationshipOrder: orderChanges(parent?.snapshot.relationships.map((item) => item.id) ?? [], revision.snapshot.relationships.map((item) => item.id)) };
        const text = canonical(patch); const deltaHash = hash(text);
        this.#db.prepare('INSERT INTO versioned_revisions(project_id, id, parent_id, delta_hash, delta) VALUES (?, ?, ?, ?, ?)')
          .run(state.projectId, revision.id, revision.parentId, deltaHash, text);
      }
      const reviews = state.version !== 1 ? state.reviews.map((review) => {
        const { decision, ...evidence } = review; const body = canonical(evidence); const reviewHash = hash(body);
        const saved = this.#db.prepare('SELECT body FROM versioned_reviews WHERE project_id = ? AND hash = ?').get(state.projectId, reviewHash);
        if (saved) { if (saved.body !== body) fail('review body hash corruption.'); }
        else this.#db.prepare('INSERT INTO versioned_reviews(project_id, hash, body) VALUES (?, ?, ?)').run(state.projectId, reviewHash, body);
        return { hash: reviewHash, decision };
      }) : [];
      const metadata = { version: state.version, projectId: state.projectId, name: state.name,
        revisions: state.revisions.map((revision) => revision.id), branches: state.branches,
        ...(state.version !== 1 ? { reviews } : {}), ...(state.version === 3 ? { designTargets: state.designTargets } : {}) };
      const text = canonical(metadata); const documentId = hash(text);
      const saved = this.#db.prepare('SELECT manifest FROM versioned_documents WHERE project_id = ? AND id = ?').get(state.projectId, documentId);
      if (saved) { if (saved.manifest !== text) fail('document hash corruption.'); }
      else this.#db.prepare('INSERT INTO versioned_documents(project_id, id, manifest) VALUES (?, ?, ?)').run(state.projectId, documentId, text);
      const reference = { projectId: state.projectId, documentId };
      // Verify the persisted graph, including existing unchanged bodies, before committing a reference.
      if (this.read(reference) !== serialized) fail('portable reconstruction mismatch.');
      return reference;
    });
  }

  read(reference: RepositoryReference): string {
    const metadata = this.#manifest(reference); const allowed = new Set(metadata.revisions);
    if (allowed.size === 0 || allowed.size !== metadata.revisions.length || metadata.branches.length === 0
        || new Set(metadata.branches.map((branch) => branch.name)).size !== metadata.branches.length
        || !metadata.branches.some((branch) => branch.name === 'main')) fail('invalid repository references.');
    const cache = new Map<string, { graph: Graph; parentId: string | null }>(); const visiting = new Set<string>();
    let hydratedBytes = 0; let loadedBodyBytes = 0;
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
          loadedBodyBytes += Buffer.byteLength(text);
          if (loadedBodyBytes > MAX_BYTES) fail('hydrated bodies exceed the portable bound.');
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
        if (values.size > 100 || order.length !== values.size) fail('invalid bounded item ordering.');
        return new Map(order.map((key) => [key, values.get(key)]));
      };
      const graph: Graph = { version: revision.delta.version,
        entities: apply('entity', parent?.entities ?? new Map(), revision.delta.entities, revision.delta.entityOrder),
        relationships: apply('relationship', parent?.relationships ?? new Map(), revision.delta.relationships, revision.delta.relationshipOrder) };
      const snapshot = { ...(graph.version === 2 ? { version: 2 } : {}), units: 'm', entities: [...graph.entities.values()], relationships: [...graph.relationships.values()] };
      // Reuse the synchronous engineering boundary: hash-valid broken host/level references still fail closed.
      const validated = validateSnapshot(snapshot);
      const snapshotText = canonical(snapshot);
      hydratedBytes += Buffer.byteLength(snapshotText);
      if (hydratedBytes > MAX_BYTES) fail('reconstructed project exceeds the portable bound.');
      if (snapshotText !== canonical(validated) || hash(canonical({ version: 1, parentId: revision.parentId, snapshot })) !== id) fail('portable revision hash corruption.');
      const result = { graph, parentId: revision.parentId }; visiting.delete(id); cache.set(id, result); return result;
    };
    const revisions = metadata.revisions.map((id) => {
      const { graph, parentId } = load(id);
      return { id, parentId, snapshot: { ...(graph.version === 2 ? { version: 2 } : {}), units: 'm',
        entities: [...graph.entities.values()], relationships: [...graph.relationships.values()] } };
    });
    for (const branch of metadata.branches) if (!allowed.has(branch.revisionId)) fail('missing branch revision.');
    const roots = [...cache].filter(([, revision]) => revision.parentId === null);
    if (roots.length !== 1) fail('missing unique root revision.');
    const reachable = new Set<string>();
    const heads = [...metadata.branches, ...(metadata.designTargets?.baselines.map(item => ({ name: 'baseline', revisionId: item.from.revisionId })) ?? []),
      ...(metadata.designTargets?.alternatives.map(item => ({ name: 'alternative', revisionId: item.revisionId })) ?? [])];
    for (const branch of heads) {
      let id: string | null = branch.revisionId;
      while (id !== null && !reachable.has(id)) { reachable.add(id); id = load(id).parentId; }
      if (metadata.version === 1 && branch.name === 'main' && load(branch.revisionId).parentId !== null) fail('legacy main must retain root.');
    }
    if (reachable.size !== allowed.size) fail('unreachable revision references.');
    const reviews = metadata.reviews.map((reference) => {
      const row = this.#row('SELECT body FROM versioned_reviews WHERE project_id = ? AND hash = ?', metadata.projectId, reference.hash);
      const body = string(row.body); hydratedBytes += Buffer.byteLength(body);
      if (hydratedBytes > MAX_BYTES) fail('reconstructed project exceeds the portable bound.');
      if (hash(body) !== reference.hash) fail('review body hash corruption.');
      const review = object(parsed(body));
      if (!allowed.has(string(review.baseRevisionId)) || !allowed.has(string(review.proposalRevisionId))) fail('missing review revision reference.');
      const decision = object(reference.decision);
      if (Object.hasOwn(decision, 'appliedRevisionId') && !allowed.has(string(decision.appliedRevisionId))) fail('missing applied review reference.');
      return { ...review, decision };
    });
    const text = canonical({ version: metadata.version, projectId: metadata.projectId, name: metadata.name, revisions,
      branches: metadata.branches, ...(metadata.version !== 1 ? { reviews } : {}),
      ...(metadata.version === 3 ? { designTargets: metadata.designTargets } : {}) });
    if (Buffer.byteLength(text) > MAX_BYTES) fail('reconstructed project exceeds the portable bound.');
    if (metadata.version === 3) RoomRepository.assertDesignTargetAuthority(parsed(text));
    return text;
  }

  current(projectId: string): RepositoryReference | null {
    const row = this.#db.prepare('SELECT document_id FROM versioned_projects WHERE project_id = ?').get(projectId);
    return row ? { projectId, documentId: string(row.document_id) } : null;
  }

  #head(metadata: Manifest, target: WritableDesignTarget): string {
    if (target.kind === 'main') {
      const head = metadata.branches.find(branch => branch.name === 'main')?.revisionId;
      if (!head) fail('missing main branch.');
      return head;
    }
    const alternative = metadata.designTargets?.alternatives.find(item => item.id === target.id);
    if (!alternative) fail('unknown design alternative.');
    return alternative.revisionId;
  }

  acceptedHead(projectId: string, input: WritableDesignTarget = { kind: 'main' }): string | null {
    const target = parseWritableDesignTarget(input); const current = this.current(projectId);
    return current ? this.#head(this.#manifest(current), target) : null;
  }

  #bodyReferences(input: { reference: RepositoryReference; revisionId: string }): {
    version: 2 | null; parentId: string | null; entities: Map<string, string>; relationships: Map<string, string>; signature: string;
  } {
    const metadata = this.#manifest(input.reference);
    const allowed = new Set(metadata.revisions);
    if (!allowed.has(input.revisionId) || allowed.size !== metadata.revisions.length) fail('revision is outside this project document.');
    const ancestry: { id: string; parentId: string | null; delta: Delta }[] = [];
    const seen = new Set<string>();
    let id: string | null = input.revisionId;
    while (id !== null) {
      if (!allowed.has(id) || seen.has(id) || seen.size >= 32) fail('invalid bounded revision ancestry.');
      seen.add(id);
      const revision = this.#revision(input.reference.projectId, id);
      ancestry.push({ id, ...revision }); id = revision.parentId;
    }
    let entities = new Map<string, string>(); let relationships = new Map<string, string>();
    let version: 2 | null = null;
    function apply(before: Map<string, string>, changes: Change[], moves: Move[]): Map<string, string> {
      const values = new Map(before); const changed = new Set<string>();
      for (const change of changes) {
        if (changed.has(change.id)) fail('duplicate item delta.'); changed.add(change.id);
        if (change.body === null) { if (!values.delete(change.id)) fail('missing deleted item.'); }
        else values.set(change.id, change.body);
      }
      const order = [...before.keys()].filter(key => values.has(key));
      for (const move of moves) {
        if (!values.has(move.id) || move.after === move.id) fail('invalid item ordering.');
        const previous = order.indexOf(move.id); if (previous !== -1) order.splice(previous, 1);
        const index = move.after === null ? -1 : order.indexOf(move.after);
        if (move.after !== null && index === -1) fail('missing ordering reference.');
        order.splice(index + 1, 0, move.id);
      }
      if (values.size > 100 || order.length !== values.size) fail('invalid bounded item ordering.');
      return new Map(order.map(key => {
        const body = values.get(key); if (!body) fail('missing ordered body.'); return [key, body];
      }));
    }
    for (const revision of [...ancestry].reverse()) {
      version = revision.delta.version;
      entities = apply(entities, revision.delta.entities, revision.delta.entityOrder);
      relationships = apply(relationships, revision.delta.relationships, revision.delta.relationshipOrder);
    }
    const selected = ancestry[0]; if (!selected) fail('missing revision.');
    return { version, parentId: selected.parentId, entities, relationships,
      signature: hash(canonical({ projectId: input.reference.projectId, revisionId: input.revisionId, ancestry })) };
  }

  graphSignature(input: Parameters<VersionedProjects['graphSignature']>[0]): string {
    return this.#bodyReferences(input).signature;
  }

  #body(kind: Kind, id: string, bodyHash: string): unknown {
    const row = this.#row('SELECT kind, body FROM versioned_bodies WHERE hash = ?', bodyHash);
    const text = string(row.body);
    if (row.kind !== kind || hash(text) !== bodyHash) fail('body hash corruption.');
    const item = object(parsed(text)); if (item.id !== id) fail('body identity mismatch.');
    return item;
  }

  readGraph(input: Parameters<VersionedProjects['readGraph']>[0]): ModelSnapshot {
    const refs = this.#bodyReferences(input);
    const snapshot = validateSnapshot({ ...(refs.version === 2 ? { version: 2 } : {}), units: 'm',
      entities: [...refs.entities].map(([id, body]) => this.#body('entity', id, body)),
      relationships: [...refs.relationships].map(([id, body]) => this.#body('relationship', id, body)) });
    if (hash(canonical({ version: 1, parentId: refs.parentId, snapshot })) !== input.revisionId) fail('portable revision hash corruption.');
    return snapshot;
  }

  readItems(input: Parameters<VersionedProjects['readItems']>[0]): ModelGraph {
    const refs = this.#bodyReferences(input);
    const entityIds = new Set(input.entityIds); const relationshipIds = new Set(input.relationshipIds);
    if (entityIds.size !== input.entityIds.length || relationshipIds.size !== input.relationshipIds.length
        || entityIds.size > 100 || relationshipIds.size > 100) fail('invalid bounded working-set identities.');
    for (const id of entityIds) if (!refs.entities.has(id)) fail('working-set entity is absent from the bound revision.');
    for (const id of relationshipIds) if (!refs.relationships.has(id)) fail('working-set relationship is absent from the bound revision.');
    const entities = [...refs.entities].filter(([id]) => entityIds.has(id))
      .map(([id, body]) => parseModelEntity(this.#body('entity', id, body), refs.version === 2));
    const relationships = [...refs.relationships].filter(([id]) => relationshipIds.has(id))
      .map(([id, body]) => parseModelRelationship(this.#body('relationship', id, body)));
    if (relationships.some(item => !entityIds.has(item.source) || !entityIds.has(item.target))) fail('working-set relationship endpoints must be included.');
    return { ...(refs.version === 2 ? { version: 2 } : {}), units: 'm', entities, relationships };
  }

  #preserveTargets(before: Manifest, after: Manifest, selected?: WritableDesignTarget): void {
    const oldTargets = before.designTargets; const newTargets = after.designTargets;
    if (oldTargets && !newTargets) fail('target envelope cannot be downgraded.');
    for (const baseline of oldTargets?.baselines ?? []) {
      if (canonical(newTargets?.baselines.find(item => item.id === baseline.id) ?? null) !== canonical(baseline)) fail('immutable baseline changed.');
    }
    for (const alternative of oldTargets?.alternatives ?? []) {
      const next = newTargets?.alternatives.find(item => item.id === alternative.id);
      if (!next || next.name !== alternative.name || next.baselineId !== alternative.baselineId) fail('immutable alternative origin changed.');
      if (!(selected?.kind === 'alternative' && selected.id === alternative.id) && next.revisionId !== alternative.revisionId) fail('sibling target head changed.');
    }
    if (selected?.kind !== 'main' && this.#head(before, { kind: 'main' }) !== this.#head(after, { kind: 'main' })) fail('sibling main head changed.');
  }

  #preserveHistory(before: Manifest, after: Manifest, selected: WritableDesignTarget): void {
    if (before.name !== after.name || before.revisions.some(id => !after.revisions.includes(id))) fail('existing project history changed.');
    for (const branch of before.branches.filter(item => item.name !== 'main')) {
      if (canonical(after.branches.find(item => item.name === branch.name) ?? null) !== canonical(branch)) fail('existing proposal branch changed.');
    }
    for (const binding of before.designTargets?.proposals ?? []) {
      if (canonical(after.designTargets?.proposals.find(item => item.proposalName === binding.proposalName) ?? null) !== canonical(binding)) fail('existing proposal target changed.');
    }
    for (const review of before.reviews) {
      const next = after.reviews.find(item => item.hash === review.hash);
      if (!next) fail('immutable review evidence changed.');
      if (canonical(next.decision) === canonical(review.decision)) continue;
      const row = this.#row('SELECT body FROM versioned_reviews WHERE project_id=? AND hash=?', before.projectId, review.hash);
      const body = object(parsed(string(row.body)));
      const target: WritableDesignTarget = body.target === undefined ? { kind: 'main' } : parseFrozenDesignTarget(body.target).target;
      const oldDecision = object(review.decision); const newDecision = object(next.decision);
      if (!sameDesignTarget(target, selected)) fail('sibling human decision changed.');
      if (oldDecision.status === 'pending' && newDecision.status === 'accepted') continue;
      if (oldDecision.status === 'accepted' && newDecision.status === 'superseded'
          && canonical({ ...oldDecision, status: 'superseded' }) === canonical(newDecision)) continue;
      fail('historical human decision changed.');
    }
  }

  publishMetadata(input: Parameters<VersionedProjects['publishMetadata']>[0]): void {
    this.#atomic(() => {
      if (input.reference.projectId !== input.projectId) fail('publication belongs to another project.');
      const current = this.current(input.projectId);
      if (!current || current.documentId !== input.expectedDocumentId) fail('metadata publication CAS conflict.');
      const before = this.#manifest(current); const after = this.#manifest(input.reference);
      this.read(current); this.read(input.reference);
      if (after.version !== 3 || !after.designTargets) fail('metadata publication requires target envelope version 3.');
      this.#preserveTargets(before, after);
      if (before.name !== after.name || canonical(before.revisions) !== canonical(after.revisions)
          || canonical(before.branches) !== canonical(after.branches) || canonical(before.reviews) !== canonical(after.reviews)
          || canonical(before.designTargets?.proposals ?? []) !== canonical(after.designTargets.proposals)) fail('metadata publication cannot change geometry or reviews.');
      const oldBaselines = before.designTargets?.baselines ?? []; const oldAlternatives = before.designTargets?.alternatives ?? [];
      const additions = after.designTargets.baselines.filter(item => !oldBaselines.some(old => old.id === item.id));
      const forks = after.designTargets.alternatives.filter(item => !oldAlternatives.some(old => old.id === item.id));
      if (additions.length + forks.length === 0) fail('metadata publication requires new immutable references.');
      for (const baseline of additions) {
        if (baseline.from.revisionId !== this.#head(after, baseline.from.target)) fail('new baseline must capture the current frozen source target.');
      }
      for (const fork of forks) {
        const baseline = after.designTargets.baselines.find(item => item.id === fork.baselineId);
        if (!baseline || fork.revisionId !== baseline.from.revisionId) fail('new alternatives must start at their immutable baseline.');
      }
      this.#db.prepare('UPDATE versioned_projects SET document_id=?, recorded_at=? WHERE project_id=?')
        .run(input.reference.documentId, Date.now(), input.projectId);
    });
  }

  publish(input: Parameters<VersionedProjects['publish']>[0]): void {
    this.#atomic(() => {
      if (input.reference.projectId !== input.projectId) fail('publication belongs to another project.');
      if (!['created', 'imported', 'accepted'].includes(input.origin)) fail('invalid publication origin.');
      const current = this.current(input.projectId);
      if ((current?.documentId ?? null) !== input.expectedDocumentId) fail('publication CAS conflict.');
      const serialized = this.read(input.reference); const metadata = this.#manifest(input.reference);
      const target = parseWritableDesignTarget(input.target ?? { kind: 'main' });
      const before = current ? this.#manifest(current) : null;
      const explicit = metadata.version === 3 || before?.version === 3;
      if (explicit && (input.target === undefined || input.expectedTargetRevisionId === undefined)) fail('target publication requires explicit target CAS.');
      if (explicit && !current && (target.kind !== 'main' || input.origin === 'accepted')) fail('initialize a portable project through main created/imported publication.');
      const head = this.#head(metadata, target); const oldHead = before ? this.#head(before, target) : null;
      if (input.expectedTargetRevisionId !== undefined && input.expectedTargetRevisionId !== oldHead) fail('target publication CAS conflict.');
      if (before) {
        this.#preserveTargets(before, metadata, target);
        if (explicit) this.#preserveHistory(before, metadata, target);
        if (explicit && (canonical(before.designTargets?.baselines ?? []) !== canonical(metadata.designTargets?.baselines ?? [])
            || canonical(before.designTargets?.alternatives.map(item => ({ ...item, revisionId: null })) ?? [])
              !== canonical(metadata.designTargets?.alternatives.map(item => ({ ...item, revisionId: null })) ?? []))) fail('new target references require metadata publication.');
      }
      if (explicit && current && input.origin !== 'accepted') fail('existing targets require native accepted publication or metadata publication.');
      if (explicit && input.origin === 'accepted') {
        if (!current || head === oldHead) fail('acceptance must advance the selected target.');
        if (this.#revision(input.projectId, head).parentId !== oldHead) fail('one publication must apply exactly one native target decision.');
        const document = object(parsed(serialized));
        const matching = array(document.reviews, 31).map(object).filter(review => {
          const decision = object(review.decision);
          const bound: WritableDesignTarget = review.target === undefined ? { kind: 'main' } : parseFrozenDesignTarget(review.target).target;
          return decision.status === 'accepted' && (decision.appliedRevisionId ?? review.proposalRevisionId) === head
            && review.requestId === input.requestId && decision.decisionId === input.decisionId && sameDesignTarget(bound, target);
        });
        if (matching.length !== 1) fail('publication must match the exact native target review decision.');
      }
      let id: string | null = head; let foundPrevious = oldHead === null; const seen = new Set<string>();
      const ancestry: { id: string; parentId: string | null }[] = [];
      while (id !== null) {
        if (seen.has(id) || seen.size >= 32 || !metadata.revisions.includes(id)) fail('invalid publication ancestry.');
        seen.add(id); if (id === oldHead) foundPrevious = true;
        const revision = this.#revision(input.projectId, id); ancestry.push({ id, parentId: revision.parentId }); id = revision.parentId;
      }
      if (!foundPrevious) fail('publication must extend accepted target ancestry.');
      const recordedAt = Date.now();
      if (metadata.version === 3 && !current) {
        const document = object(parsed(serialized));
        for (const raw of array(document.reviews, 31)) {
          const review = object(raw); const decision = object(review.decision);
          if (decision.status === 'pending') continue;
          const acceptedTarget: WritableDesignTarget = review.target === undefined ? { kind: 'main' } : parseFrozenDesignTarget(review.target).target;
          this.#db.prepare(`INSERT OR IGNORE INTO versioned_target_publications
            (project_id, target_key, revision_id, recorded_at, origin, request_id, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(input.projectId, targetKey(acceptedTarget), string(decision.appliedRevisionId ?? review.proposalRevisionId), recordedAt,
              'imported', string(review.requestId), string(decision.decisionId));
        }
      }
      for (const revision of ancestry.filter(item => item.id === head || !explicit || oldHead === null || !before?.revisions.includes(item.id))) this.#db.prepare(`INSERT OR IGNORE INTO versioned_target_publications
        (project_id, target_key, revision_id, recorded_at, origin, request_id, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(input.projectId, targetKey(target), revision.id, recordedAt, revision.id === head ? input.origin : 'imported',
          revision.id === head ? input.requestId : null, revision.id === head ? input.decisionId : null);
      if (target.kind === 'main') for (const revision of ancestry) this.#db.prepare(`INSERT OR IGNORE INTO versioned_publications
        (project_id, revision_id, recorded_at, origin, request_id, decision_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(input.projectId, revision.id, recordedAt, revision.id === head ? input.origin : 'imported',
          revision.id === head ? input.requestId : null, revision.id === head ? input.decisionId : null);
      const main = this.#head(metadata, { kind: 'main' });
      this.#db.prepare(`INSERT INTO versioned_projects(project_id, document_id, name, head_revision_id, recorded_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET document_id = excluded.document_id, name = excluded.name,
        head_revision_id = excluded.head_revision_id, recorded_at = excluded.recorded_at`)
        .run(input.projectId, input.reference.documentId, metadata.name, main, recordedAt);
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

  history(input: { projectId: string; before: string | null; limit: number; target?: WritableDesignTarget }): ProjectHistoryPage {
    bounded(input.limit, 50); const current = this.current(input.projectId);
    if (!current) fail('unknown project.');
    const metadata = this.#manifest(current); const target = parseWritableDesignTarget(input.target ?? { kind: 'main' });
    let id: string | null = this.#head(metadata, target);
    let historyTarget = target;
    const entries: ProjectHistoryEntry[] = []; const seen = new Set<string>(); let cursorFound = input.before === null;
    while (id !== null) {
      if (seen.has(id) || seen.size >= 100 || !metadata.revisions.includes(id)) fail('invalid accepted ancestry.'); seen.add(id);
      const revision = this.#revision(input.projectId, id);
        while (historyTarget.kind === 'alternative') {
          const alternative = metadata.designTargets?.alternatives.find(item => historyTarget.kind === 'alternative' && item.id === historyTarget.id);
          const baseline = metadata.designTargets?.baselines.find(item => item.id === alternative?.baselineId);
          if (!baseline || baseline.from.revisionId !== id) break;
          historyTarget = baseline.from.target;
        }
      if (cursorFound) {
        if (entries.length === input.limit) return { entries, nextCursor: entries.at(-1)?.revisionId ?? null };
        const row = this.#db.prepare('SELECT * FROM versioned_target_publications WHERE project_id=? AND target_key=? AND revision_id=?').get(input.projectId, targetKey(historyTarget), id)
          ?? this.#db.prepare('SELECT * FROM versioned_publications WHERE project_id=? AND revision_id=?').get(input.projectId, id);
        if (!row) fail('missing accepted history publication.');
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
