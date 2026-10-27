import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { Check } from 'typebox/value';
import type { RoomRepository } from '../src/room-model.ts';
import { EvidenceSubjectSchema, evidenceCanonical, evidenceDependencies, evidenceSubjectKey,
  MAX_EVIDENCE_ENTRIES, MAX_EVIDENCE_ENTRY_BYTES, MAX_EVIDENCE_PAGE, MAX_EVIDENCE_PINS, MAX_EVIDENCE_PROJECT_BYTES,
  MAX_EVIDENCE_CONTEXT_ENTRIES, MAX_EVIDENCE_CONTEXT_BYTES,
  normalizedEvidenceValue, parseEvidenceEntry, parseEvidencePin, parseEvidenceReadSet, parseEvidenceUses } from '../src/model-evidence.ts';
import type { EvidenceAnchor, EvidenceEntry, EvidencePin, EvidenceReadSet, EvidenceSubject, EvidenceUse } from '../src/model-evidence.ts';
import { modelParameters } from '../src/model-parameters.ts';
import { parseDesignTarget, parseWritableDesignTarget } from '../src/design-targets.ts';
import { plainScopeData } from '../src/model-scope-contract.ts';
import type { RequestSource } from '../src/request-sources.ts';
import { RequestSourceStore } from './request-source-store.ts';

export interface StoredEvidence { entry: EvidenceEntry; pin: EvidencePin }
interface Readiness { ready: boolean; reasons: string[] }
export interface EvidenceReviewReadiness extends Readiness { warnings: string[] }
type EvidenceIssue = { kind: 'blocking'; message: string }
  | { kind: 'value-conflict'; message: string; subject: EvidenceSubject }
  | { kind: 'unknown-required'; message: string; entryId: string }
  | { kind: 'conflicting-resolutions'; message: string; subject: EvidenceSubject };
export type EvidenceContextIssue = Exclude<EvidenceIssue, { kind: 'blocking' }>;
export interface EvidenceReviewContext {
  entries: StoredEvidence[]; readSet: EvidenceReadSet; sources: RequestSource[]; issues: EvidenceContextIssue[];
}
interface SubjectState {
  signature: string; issues: EvidenceIssue[]; applicableEntries: StoredEvidence[]; activeValues: StoredEvidence[]; resolutionsDisagree: boolean;
}
export interface EvidenceBundleClosure {
  complete: boolean; entries: StoredEvidence[]; sources: RequestSource[]; missing: string[];
}
let savepoint = 0;
export function evidenceHash(value: unknown): string {
  return createHash('sha256').update(evidenceCanonical(value)).digest('hex');
}
/** Exact revision pin plus the same canonical immutable native entity body preimage. */
export function evidenceAnchor(repository: RoomRepository, revisionId: string, entityId: string,
  target: EvidenceAnchor['target'] = { kind: 'main' }): EvidenceAnchor {
  const entity = repository.view(revisionId).snapshot.entities.find(item => item.id === entityId);
  if (!entity) throw new Error('Evidence anchor requires an existing native entity.');
  const anchor: EvidenceAnchor = { projectId: repository.projectId, revisionId, entityId, bodyHash: evidenceHash(entity), target: parseDesignTarget(target) };
  if (!validAnchor(repository, anchor)) throw new Error('Evidence anchor requires the declared target lineage.');
  return anchor;
}
function ancestor(repository: RoomRepository, before: string, after: string): boolean {
  let current: string | null = after; const visited = new Set<string>();
  while (current !== null && visited.size < 32) {
    if (visited.has(current)) throw new Error('Evidence revision lineage contains a cycle.');
    visited.add(current);
    if (current === before) return true;
    current = repository.view(current).parentId;
  }
  if (current !== null) throw new Error('Evidence revision lineage exceeds 32 refs.');
  return false;
}
function targetLineage(repository: RoomRepository, input: EvidenceAnchor['target']): { target: EvidenceAnchor['target']; revisionId: string }[] {
  let target: EvidenceAnchor['target'] = parseDesignTarget(input);
  let revisionId: string = target.kind === 'baseline' ? repository.designView(target).revisionId : repository.freezeDesignTarget(target).revisionId;
  const state = repository.persistence(); const result: { target: EvidenceAnchor['target']; revisionId: string }[] = [];
  const seen = new Set<string>();
  while (result.length < 32) {
    const key = evidenceCanonical(target);
    if (seen.has(key)) throw new Error('Evidence target lineage contains a cycle.');
    seen.add(key); result.push({ target, revisionId });
    if (target.kind === 'main') return result;
    if (state.version !== 3) throw new Error('Evidence target lineage metadata is missing.');
    if (target.kind === 'alternative') {
      const selectedId = target.id;
      const alternative = state.designTargets.alternatives.find(item => item.id === selectedId);
      const baseline = state.designTargets.baselines.find(item => item.id === alternative?.baselineId);
      if (!baseline || !ancestor(repository, baseline.from.revisionId, revisionId)) throw new Error('Evidence alternative baseline is outside its lineage.');
      target = { kind: 'baseline', id: baseline.id }; revisionId = baseline.from.revisionId;
    } else {
      const selectedId = target.id;
      const baseline = state.designTargets.baselines.find(item => item.id === selectedId);
      if (!baseline || baseline.from.projectId !== repository.projectId || revisionId !== baseline.from.revisionId) throw new Error('Evidence immutable baseline pin mismatch.');
      target = baseline.from.target; revisionId = baseline.from.revisionId;
      if (!ancestor(repository, revisionId, repository.freezeDesignTarget(target).revisionId)) throw new Error('Evidence baseline parent is outside its lineage.');
    }
  }
  throw new Error('Evidence target lineage exceeds 32 refs.');
}
function validAnchor(repository: RoomRepository, anchor: EvidenceAnchor): boolean {
  if (anchor.projectId !== repository.projectId) return false;
  try {
    const own = targetLineage(repository, anchor.target)[0];
    if (!own || (anchor.target.kind === 'baseline' ? anchor.revisionId !== own.revisionId : !ancestor(repository, anchor.revisionId, own.revisionId))) return false;
    const original = repository.view(anchor.revisionId).snapshot.entities.find(item => item.id === anchor.entityId);
    return original !== undefined && evidenceHash(original) === anchor.bodyHash;
  } catch { return false; }
}
export function evidenceApplicable(repository: RoomRepository, anchor: EvidenceAnchor, revisionId: string,
  target: EvidenceAnchor['target'] = { kind: 'main' }): boolean {
  if (!validAnchor(repository, anchor)) return false;
  try {
    const ref = targetLineage(repository, target).find(item => evidenceCanonical(item.target) === evidenceCanonical(anchor.target));
    if (!ref || (anchor.target.kind === 'baseline' ? anchor.revisionId !== ref.revisionId : !ancestor(repository, anchor.revisionId, ref.revisionId))) return false;
    const current = repository.view(revisionId).snapshot.entities.find(item => item.id === anchor.entityId);
    return current !== undefined && evidenceHash(current) === anchor.bodyHash;
  } catch { return false; }
}
function checkNativeProperty(repository: RoomRepository, subject: EvidenceSubject): void {
  const entity = repository.view(subject.anchor.revisionId).snapshot.entities.find(item => item.id === subject.anchor.entityId);
  if (!entity) throw new Error('Evidence property requires an anchored native entity.');
  const parameter = modelParameters(entity).find(item => item.definitionId === subject.property.definitionId);
  if (parameter && parameter.value.kind !== subject.property.valueKind) throw new Error('Evidence property differs from native parameter kind.');
}
function identity(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('Invalid evidence identity.');
  return value;
}
function integer(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Evidence limit must be 1..${max}.`);
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored evidence text.');
  return value;
}
function stored(row: Record<string, unknown>): StoredEvidence {
  const body = text(row.body);
  if (Buffer.byteLength(body) > MAX_EVIDENCE_ENTRY_BYTES) throw new Error('Stored evidence exceeds 16 KiB.');
  const entry = parseEvidenceEntry(JSON.parse(body));
  const pin = parseEvidencePin({ entryId: row.id, hash: row.hash });
  if (entry.id !== pin.entryId || evidenceHash(entry) !== pin.hash) throw new Error('Stored evidence integrity failure.');
  return { entry, pin };
}
function sameSubject(a: EvidenceSubject, b: EvidenceSubject): boolean {
  return a.anchor.projectId === b.anchor.projectId && a.anchor.entityId === b.anchor.entityId
    && evidenceCanonical(a.property) === evidenceCanonical(b.property);
}

/** Project facts only. All writes join the queue-owned DatabaseSync transaction. */
export class ProjectEvidenceStore {
  readonly #db: DatabaseSync;
  readonly #sources: RequestSourceStore;
  constructor(db: DatabaseSync, sources: RequestSourceStore) {
    this.#db = db; this.#sources = sources;
    this.#atomic(() => db.exec(`
      CREATE TABLE IF NOT EXISTS project_evidence_entries (
        sequence INTEGER PRIMARY KEY, project_id TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL,
        entity_id TEXT NOT NULL, property_id TEXT NOT NULL, predecessor_id TEXT, body TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND ${MAX_EVIDENCE_ENTRY_BYTES}),
        UNIQUE(project_id,id), UNIQUE(project_id,predecessor_id)) STRICT;
      CREATE INDEX IF NOT EXISTS project_evidence_page ON project_evidence_entries(project_id,sequence);
      CREATE INDEX IF NOT EXISTS project_evidence_subject ON project_evidence_entries(project_id,entity_id,property_id,sequence);
      CREATE TABLE IF NOT EXISTS project_evidence_receipts (
        project_id TEXT NOT NULL, command_id TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL,
        entry_id TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(project_id,command_id)) STRICT;
      CREATE TABLE IF NOT EXISTS project_evidence_read_sets (
        project_id TEXT NOT NULL, request_id TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL,
        PRIMARY KEY(project_id,request_id)) STRICT;
    `));
  }
  #atomic<T>(operation: () => T): T {
    const name = `project_evidence_${++savepoint}`;
    this.#db.exec(`SAVEPOINT ${name}`);
    try { const result = operation(); this.#db.exec(`RELEASE ${name}`); return result; }
    catch (error) { this.#db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  }
  #entry(projectId: string, entryId: string): StoredEvidence {
    const row = this.#db.prepare('SELECT id,hash,body FROM project_evidence_entries WHERE project_id=? AND id=?')
      .get(identity(projectId), identity(entryId));
    if (!row) throw new Error('Missing project evidence entry.');
    const value = stored(row);
    if (value.entry.anchor.projectId !== projectId) throw new Error('Evidence project integrity failure.');
    return value;
  }
  get({ projectId, pin }: { projectId: string; pin: EvidencePin }): StoredEvidence {
    const checked = parseEvidencePin(pin); const result = this.#entry(projectId, checked.entryId);
    if (result.pin.hash !== checked.hash) throw new Error('Evidence pin hash mismatch.');
    return result;
  }
  #candidates(repository: RoomRepository, revisionId: string, target: EvidenceAnchor['target'], subject: EvidenceSubject): StoredEvidence[] {
    const entries = this.#db.prepare(`SELECT id,hash,body FROM project_evidence_entries
      WHERE project_id=? AND entity_id=? AND property_id=? ORDER BY sequence LIMIT ?`)
      .all(subject.anchor.projectId, subject.anchor.entityId, subject.property.definitionId, MAX_EVIDENCE_ENTRIES + 1).map(stored);
    if (entries.length > MAX_EVIDENCE_ENTRIES) throw new Error('Evidence project bound exceeded.');
    const eligible = entries.filter(item => evidenceApplicable(repository, item.entry.anchor, revisionId, target));
    if (eligible.some(item => !sameSubject(item.entry, subject))) throw new Error('Evidence property kind is immutable.');
    return eligible;
  }
  #verifySources(entry: EvidenceEntry): RequestSource[] {
    if (!('citations' in entry.assertion)) return [];
    return entry.assertion.citations.map(citation => {
      const source = this.#sources.retained(entry.anchor.projectId, citation.sourceId);
      if (source.sha256 !== citation.sha256) throw new Error('Evidence source hash mismatch.');
      return source;
    });
  }
  append({ repository, commandId, actor, entry: input }: {
    repository: RoomRepository; commandId: string; actor: string; entry: EvidenceEntry;
  }): EvidencePin {
    const entry = parseEvidenceEntry(input); const projectId = identity(repository.projectId);
    identity(commandId); identity(actor);
    const payload = evidenceCanonical(entry);
    return this.#atomic(() => {
      const receipt = this.#db.prepare('SELECT actor,payload,entry_id,hash FROM project_evidence_receipts WHERE project_id=? AND command_id=?')
        .get(projectId, commandId);
      // A committed command survives later CAS/anchor advances and lost responses.
      if (receipt) {
        if (receipt.actor !== actor || receipt.payload !== payload) throw new Error('Evidence command identity has different payload or actor.');
        const pin = parseEvidencePin({ entryId: receipt.entry_id, hash: receipt.hash });
        this.get({ projectId, pin }); return pin;
      }
      if (!validAnchor(repository, entry.anchor)) throw new Error('Evidence anchor is missing, cross-project or stale.');
      checkNativeProperty(repository, entry);
      const candidates = this.#candidates(repository, entry.anchor.revisionId, entry.anchor.target, entry);
      if (entry.predecessor) {
        const previous = this.get({ projectId, pin: entry.predecessor });
        if (!sameSubject(previous.entry, entry) || evidenceCanonical(previous.entry.anchor) !== evidenceCanonical(entry.anchor)) {
          throw new Error('Correction must preserve its exact anchor and property.');
        }
        if (candidates.some(item => item.entry.predecessor?.entryId === entry.predecessor?.entryId)) throw new Error('Evidence predecessor CAS failed.');
        if ((previous.entry.assertion.kind === 'resolution') !== (entry.assertion.kind === 'resolution')) throw new Error('Corrections cannot change claim/resolution identity.');
      }
      for (const pin of evidenceDependencies(entry)) this.get({ projectId, pin });
      this.#verifySources(entry);
      if (entry.assertion.kind === 'resolution') {
        for (const id of entry.assertion.candidateIds) {
          const candidate = this.#entry(projectId, id).entry;
          if (!sameSubject(candidate, entry) || !('value' in candidate.assertion)
              || !evidenceApplicable(repository, candidate.anchor, entry.anchor.revisionId, entry.anchor.target)
              || candidates.some(item => item.entry.predecessor?.entryId === id)) throw new Error('Resolution requires active applicable value candidates.');
        }
      }
      const usage = this.#db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(byte_length),0) AS bytes FROM project_evidence_entries WHERE project_id=?').get(projectId);
      const bytes = Buffer.byteLength(payload);
      if (!usage || typeof usage.count !== 'number' || typeof usage.bytes !== 'number'
          || usage.count >= MAX_EVIDENCE_ENTRIES || usage.bytes + bytes > MAX_EVIDENCE_PROJECT_BYTES) throw new Error('Evidence project reached 256 entries or 4 MiB.');
      const pin = { entryId: entry.id, hash: evidenceHash(entry) };
      this.#db.prepare(`INSERT INTO project_evidence_entries(project_id,id,hash,entity_id,property_id,predecessor_id,body,byte_length)
        VALUES(?,?,?,?,?,?,?,?)`).run(projectId, entry.id, pin.hash, entry.anchor.entityId, entry.property.definitionId, entry.predecessor?.entryId ?? null, payload, bytes);
      this.#db.prepare('INSERT INTO project_evidence_receipts(project_id,command_id,actor,payload,entry_id,hash) VALUES(?,?,?,?,?,?)')
        .run(projectId, commandId, actor, payload, entry.id, pin.hash);
      return pin;
    });
  }
  page({ projectId, after = 0, limit = MAX_EVIDENCE_PAGE }: { projectId: string; after?: number; limit?: number }): {
    entries: StoredEvidence[]; next: number | null;
  } {
    identity(projectId); integer(limit, MAX_EVIDENCE_PAGE);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid evidence page cursor.');
    const rows = this.#db.prepare('SELECT sequence,id,hash,body FROM project_evidence_entries WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT ?')
      .all(projectId, after, limit + 1);
    const visible = rows.slice(0, limit); const last = visible.at(-1);
    return { entries: visible.map(stored), next: rows.length > limit && last && typeof last.sequence === 'number' ? last.sequence : null };
  }
  #subjectState(repository: RoomRepository, revisionId: string, target: EvidenceReadSet['target'], subject: EvidenceSubject): SubjectState {
    const checked = plainScopeData(subject);
    if (!Check(EvidenceSubjectSchema, checked)) throw new Error('Invalid evidence subject.');
    if (!evidenceApplicable(repository, checked.anchor, revisionId, target)) throw new Error('Read-set subject anchor is inapplicable.');
    checkNativeProperty(repository, checked);
    const candidates = this.#candidates(repository, revisionId, target, checked);
    const replaced = new Set(candidates.flatMap(item => item.entry.predecessor ? [item.entry.predecessor.entryId] : []));
    const applicable = candidates;
    const active = applicable.filter(item => !replaced.has(item.entry.id));
    const issues: EvidenceIssue[] = [];
    const sources = candidates.map(item => {
      try { return { entryId: item.entry.id, sources: this.#verifySources(item.entry), valid: true }; }
      catch { issues.push({ kind: 'blocking', message: `Unavailable source for ${item.entry.id}.` }); return { entryId: item.entry.id, sources: [], valid: false }; }
    });
    const values = active.filter(item => 'value' in item.entry.assertion);
    const distinct = new Set(values.flatMap(item => 'value' in item.entry.assertion
      ? [evidenceCanonical(normalizedEvidenceValue(item.entry.assertion.value))] : []));
    const resolutions = active.filter(item => item.entry.assertion.kind === 'resolution');
    const selections = new Set(resolutions.flatMap(item => item.entry.assertion.kind === 'resolution'
      && values.every(value => item.entry.assertion.kind === 'resolution' && item.entry.assertion.candidateIds.includes(value.entry.id))
      && values.some(value => item.entry.assertion.kind === 'resolution' && value.entry.id === item.entry.assertion.selectedEntryId)
      ? [item.entry.assertion.selectedEntryId] : []));
    if (distinct.size > 1 && selections.size !== 1) issues.push({ kind: 'value-conflict', subject: checked,
      message: `Unresolved evidence conflict for ${checked.anchor.entityId}/${checked.property.definitionId}.` });
    if (resolutions.length > 1 && selections.size > 1) issues.push({ kind: 'conflicting-resolutions', subject: checked, message: 'Conflicting evidence resolutions.' });
    const resolutionChoices = new Set(resolutions.flatMap(item => item.entry.assertion.kind === 'resolution' ? [item.entry.assertion.selectedEntryId] : []));
    return { signature: evidenceHash({ subject: checked, candidates: candidates.map(item => ({ ...item.pin,
      applicable: true })), sources }), issues,
    applicableEntries: applicable, activeValues: values, resolutionsDisagree: resolutionChoices.size > 1 };
  }
  freezeReadSet(input: { repository: RoomRepository; revisionId: string;
    pins: readonly EvidencePin[]; subjects: readonly EvidenceSubject[]; target?: EvidenceReadSet['target'] }): EvidenceReadSet {
    return this.#atomic(() => this.#freezeReadSet(input));
  }
  #freezeReadSet({ repository, revisionId, pins, subjects, target: inputTarget = { kind: 'main' } }: { repository: RoomRepository; revisionId: string;
    pins: readonly EvidencePin[]; subjects: readonly EvidenceSubject[]; target?: EvidenceReadSet['target'] }): EvidenceReadSet {
    if (pins.length > MAX_EVIDENCE_PINS || subjects.length > MAX_EVIDENCE_PINS) throw new Error('Evidence read set exceeds 32 pins or subjects.');
    const target = parseWritableDesignTarget(inputTarget);
    if (!ancestor(repository, revisionId, repository.freezeDesignTarget(target).revisionId)) throw new Error('Read-set target revision is inapplicable to its current lineage.');
    const selected = [...subjects];
    const closure = this.bundleClosure({ repository, pins });
    if (!closure.complete) throw new Error(closure.missing.join(' '));
    for (const { entry } of closure.entries) {
      if (!evidenceApplicable(repository, entry.anchor, revisionId, target)) throw new Error(`Inapplicable evidence anchor ${entry.id}.`);
      if (!selected.some(subject => evidenceCanonical(subject) === evidenceCanonical({ anchor: entry.anchor, property: entry.property }))) {
        selected.push({ anchor: entry.anchor, property: entry.property });
      }
    }
    if (selected.length > MAX_EVIDENCE_PINS) throw new Error('Evidence read set exceeds 32 subjects.');
    const readSet: EvidenceReadSet = { version: 1, projectId: repository.projectId, revisionId, target, pins: [...pins],
      subjects: selected.map(subject => ({ subject, signature: this.#subjectState(repository, revisionId, target, subject).signature })) };
    return parseEvidenceReadSet(readSet);
  }
  verifyReadSet({ repository, readSet: input }: { repository: RoomRepository; readSet: EvidenceReadSet }): Readiness {
    const readSet = parseEvidenceReadSet(input);
    const { issues } = this.#assessReadSet(repository, readSet);
    return { ready: issues.length === 0, reasons: [...new Set(issues.map(issue => issue.message))] };
  }
  #assessReadSet(repository: RoomRepository, readSet: EvidenceReadSet): {
    issues: EvidenceIssue[]; subjects: { subject: EvidenceSubject; state: SubjectState }[];
  } {
    const issues: EvidenceIssue[] = []; const subjects: { subject: EvidenceSubject; state: SubjectState }[] = [];
    const block = (message: string): void => { issues.push({ kind: 'blocking', message }); };
    if (readSet.projectId !== repository.projectId) {
      block('Evidence read set belongs to another project.'); return { issues, subjects };
    }
    try {
      const frozen = this.freezeReadSet({ repository, revisionId: readSet.revisionId, target: readSet.target, pins: readSet.pins, subjects: readSet.subjects.map(item => item.subject) });
      if (evidenceCanonical(frozen) !== evidenceCanonical(readSet)) block('Evidence candidate set changed, including previously absent facts.');
      for (const item of readSet.subjects) {
        const state = this.#subjectState(repository, readSet.revisionId, readSet.target, item.subject);
        issues.push(...state.issues); subjects.push({ subject: item.subject, state });
      }
      const closure = this.bundleClosure({ repository, pins: readSet.pins });
      for (const message of closure.missing) block(message);
      for (const item of closure.entries) if (!evidenceApplicable(repository, item.entry.anchor, readSet.revisionId, readSet.target)) block(`Inapplicable evidence anchor ${item.entry.id}.`);
      const byId = new Map(closure.entries.map(item => [item.entry.id, item.entry]));
      const required = [...readSet.pins.map(pin => pin.entryId)]; const seen = new Set<string>();
      while (required.length) {
        const id = required.shift(); if (!id || seen.has(id)) continue; seen.add(id);
        const entry = byId.get(id);
        if (entry && this.#candidates(repository, readSet.revisionId, readSet.target, entry).some(item => item.entry.predecessor?.entryId === id)) {
          block(`Superseded consumed evidence ${id}.`);
        }
        if (entry?.assertion.kind === 'unknown') issues.push({ kind: 'unknown-required', entryId: id, message: `Unknown pinned evidence ${id}.` });
        if (entry && 'basis' in entry.assertion) required.push(...entry.assertion.basis.map(pin => pin.entryId));
      }
    } catch (error) { block(error instanceof Error ? error.message : 'Evidence is unavailable.'); }
    return { issues, subjects };
  }
  /** Proposal-local assumptions for human review; strict readiness and global claims stay unchanged. */
  verifyForReview({ repository, readSet: input, uses: inputUses }: {
    repository: RoomRepository; readSet: EvidenceReadSet; uses: readonly EvidenceUse[];
  }): EvidenceReviewReadiness {
    const readSet = parseEvidenceReadSet(input);
    return this.#atomic(() => {
      let uses: EvidenceUse[];
      try { uses = parseEvidenceUses(inputUses); }
      catch (error) { return { ready: false, reasons: [error instanceof Error ? error.message : 'Invalid evidence uses.'], warnings: [] }; }
      const assessment = this.#assessReadSet(repository, readSet);
      const choices = new Map<string, EvidenceUse>(); const reasons: string[] = [];
      for (const issue of assessment.issues) if (issue.kind !== 'value-conflict') reasons.push(issue.message);
      for (const { state } of assessment.subjects) if (state.resolutionsDisagree) reasons.push('Conflicting evidence resolutions.');
      if (reasons.length) return { ready: false, reasons: [...new Set(reasons)], warnings: [] };
      for (const use of uses) {
        const frozen = assessment.subjects.find(item => evidenceCanonical(item.subject) === evidenceCanonical(use.subject));
        const pinned = readSet.pins.some(pin => pin.entryId === use.pin.entryId && pin.hash === use.pin.hash);
        const active = frozen?.state.activeValues.some(item => item.pin.entryId === use.pin.entryId && item.pin.hash === use.pin.hash
          && sameSubject(item.entry, use.subject) && evidenceApplicable(repository, item.entry.anchor, readSet.revisionId, readSet.target));
        if (!frozen || !pinned || !active) reasons.push(`Evidence use ${use.pin.entryId} must select an exact pinned active applicable value on its frozen subject.`);
        else choices.set(evidenceSubjectKey(use.subject), use);
      }
      const warnings: string[] = [];
      for (const issue of assessment.issues) {
        const choice = issue.kind === 'value-conflict' ? choices.get(evidenceSubjectKey(issue.subject)) : undefined;
        if (!choice) reasons.push(issue.message);
        else warnings.push(`Design assumption for human approval: ${choice.pin.entryId} on ${choice.subject.anchor.entityId}/${choice.subject.property.definitionId}. ${choice.rationale} Competing evidence remains unresolved.`);
      }
      return { ready: reasons.length === 0, reasons: [...new Set(reasons)], warnings: reasons.length ? [] : [...new Set(warnings)] };
    });
  }
  /** Bounded generation data includes competing facts; acceptance is a separate policy. */
  reviewContext({ repository, readSet: input }: { repository: RoomRepository; readSet: EvidenceReadSet }): EvidenceReviewContext {
    const readSet = parseEvidenceReadSet(input);
    return this.#atomic(() => {
      const assessment = this.#assessReadSet(repository, readSet);
      const blocking = assessment.issues.filter(issue => issue.kind === 'blocking');
      if (blocking.length) throw new Error(blocking.map(issue => issue.message).join(' '));
      const entries = new Map<string, StoredEvidence>(); const sources = new Map<string, RequestSource>();
      const add = (item: StoredEvidence): void => {
        if (!evidenceApplicable(repository, item.entry.anchor, readSet.revisionId, readSet.target)) throw new Error(`Inapplicable evidence anchor ${item.entry.id}.`);
        entries.set(item.entry.id, item);
        if (entries.size > MAX_EVIDENCE_CONTEXT_ENTRIES) throw new Error('Narrow evidence context: at most 32 entries are supported.');
        for (const source of this.#verifySources(item.entry)) sources.set(source.id, source);
      };
      const closure = this.bundleClosure({ repository, pins: readSet.pins });
      if (!closure.complete) throw new Error(closure.missing.join(' '));
      for (const item of closure.entries) add(item);
      for (const { state } of assessment.subjects) for (const item of state.applicableEntries) add(item);
      const complete = this.bundleClosure({ repository, pins: [...entries.values()].map(item => item.pin) });
      if (!complete.complete) throw new Error(complete.missing.join(' '));
      for (const item of complete.entries) add(item);
      const issues: EvidenceContextIssue[] = [];
      for (const issue of assessment.issues) if (issue.kind !== 'blocking') issues.push(issue);
      for (const { subject, state } of assessment.subjects) if (state.resolutionsDisagree
          && !issues.some(issue => issue.kind === 'conflicting-resolutions' && sameSubject(issue.subject, subject))) {
        issues.push({ kind: 'conflicting-resolutions', subject, message: 'Conflicting evidence resolutions.' });
      }
      const context: EvidenceReviewContext = { entries: [...entries.values()], readSet, sources: [...sources.values()], issues };
      if (Buffer.byteLength(evidenceCanonical(context)) > MAX_EVIDENCE_CONTEXT_BYTES) throw new Error('Narrow evidence context: at most 64 KiB serialized are supported.');
      return context;
    });
  }
  pinReadSet({ requestId, readSet: input }: { requestId: string; readSet: EvidenceReadSet }): void {
    const readSet = parseEvidenceReadSet(input); identity(requestId);
    this.#atomic(() => {
      for (const pin of readSet.pins) this.get({ projectId: readSet.projectId, pin });
      const body = evidenceCanonical(readSet); const hash = evidenceHash(readSet);
      const existing = this.#db.prepare('SELECT body,hash FROM project_evidence_read_sets WHERE project_id=? AND request_id=?').get(readSet.projectId, requestId);
      if (existing) { if (existing.body !== body || existing.hash !== hash) throw new Error('Request evidence pins are immutable.'); return; }
      this.#db.prepare('INSERT INTO project_evidence_read_sets(project_id,request_id,body,hash) VALUES(?,?,?,?)').run(readSet.projectId, requestId, body, hash);
    });
  }
  readPinned({ projectId, requestId }: { projectId: string; requestId: string }): EvidenceReadSet | null {
    const row = this.#db.prepare('SELECT body,hash FROM project_evidence_read_sets WHERE project_id=? AND request_id=?').get(identity(projectId), identity(requestId));
    if (!row) return null;
    const value = parseEvidenceReadSet(JSON.parse(text(row.body)));
    if (value.projectId !== projectId || evidenceHash(value) !== row.hash) throw new Error('Stored evidence read-set integrity failure.');
    return value;
  }
  bundleClosure({ repository, pins }: { repository: RoomRepository; pins: readonly EvidencePin[] }): EvidenceBundleClosure {
    if (pins.length > MAX_EVIDENCE_PINS) throw new Error('Evidence closure exceeds 32 root pins.');
    const entries = new Map<string, StoredEvidence>(); const sources = new Map<string, RequestSource>(); const missing: string[] = [];
    const pending = [...pins]; const visited = new Set<string>();
    while (pending.length) {
      const pin = pending.shift(); if (!pin) break;
      const key = evidenceCanonical(pin); if (visited.has(key)) continue; visited.add(key);
      if (visited.size > MAX_EVIDENCE_ENTRIES) { missing.push('Evidence closure exceeds 256 entries.'); break; }
      try {
        const item = this.get({ projectId: repository.projectId, pin }); entries.set(item.entry.id, item);
        if (!validAnchor(repository, item.entry.anchor)) missing.push(`Missing original native anchor ${item.entry.id}.`);
        pending.push(...evidenceDependencies(item.entry));
        if (item.entry.assertion.kind === 'resolution') for (const id of item.entry.assertion.candidateIds) {
          try { pending.push(this.#entry(repository.projectId, id).pin); } catch { missing.push(`Missing resolution candidate ${id}.`); }
        }
        for (const source of this.#verifySources(item.entry)) sources.set(source.id, source);
      } catch (error) { missing.push(error instanceof Error ? error.message : 'Missing evidence dependency.'); }
    }
    return { complete: missing.length === 0, entries: [...entries.values()], sources: [...sources.values()], missing: [...new Set(missing)] };
  }
}
