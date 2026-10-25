import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { sha256 } from '../contracts/records.ts';
import { parseFixture } from '../fixtures/fixture.ts';
import type { Fixture } from '../fixtures/fixture.ts';
import { diffSnapshots, furnitureFootprint, rectangleLayout, validateSnapshot } from '../../src/room-model.ts';
import type { Entity, Furniture, ModelDelta, ModelSnapshot } from '../../src/room-model.ts';

const exact = { additionalProperties: false };
const id = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const hash = Type.String({ pattern: '^[a-f0-9]{64}$' });
const text = Type.String({ minLength: 1, maxLength: 128 });
const bounds = Type.Object({ minX: Type.Number(), minY: Type.Number(), maxX: Type.Number(), maxY: Type.Number() }, exact);
export const PredicateSchema = Type.Union([
  Type.Object({ kind: Type.Literal('empty-region'), bounds, exceptId: id }, exact),
  Type.Object({ kind: Type.Literal('north-wall-gap'), wallId: id, furnitureId: id,
    metres: Type.Number({ minimum: 0 }) }, exact),
]);
export type Predicate = Static<typeof PredicateSchema>;
export const LineageSchema = Type.Union([
  Type.Object({ kind: Type.Literal('replace'), sources: Type.Tuple([id]), targets: Type.Tuple([id]) }, exact),
  Type.Object({ kind: Type.Literal('split'), sources: Type.Tuple([id]), targets: Type.Array(id, { minItems: 2, maxItems: 16 }) }, exact),
  Type.Object({ kind: Type.Literal('merge'), sources: Type.Array(id, { minItems: 2, maxItems: 16 }), targets: Type.Tuple([id]) }, exact),
]);
export type Lineage = Static<typeof LineageSchema>;
const rules = Type.Union([Type.Literal('whole-entity'), Type.Literal('isolated-furniture-name-kind-v1')]);
const fields = { id, snapshot: Type.Unknown(), predicates: Type.Array(PredicateSchema, { maxItems: 16 }),
  fieldRule: rules, lineage: Type.Array(LineageSchema, { maxItems: 16 }) };
const ProposalInputSchema = Type.Object(fields, exact);
export const DraftSchema = Type.Object({ ...fields, baseRevisionId: hash }, exact);
export type Draft = Omit<Static<typeof DraftSchema>, 'snapshot'> & { snapshot: ModelSnapshot };
const CommandSchema = Type.Object({ commandId: text, actor: text, draft: DraftSchema }, exact);

export interface CandidateRevision {
  id: string;
  parentId: string | null;
  snapshot: ModelSnapshot;
  lineage: Lineage[];
  predicates: Predicate[];
}
export interface Receipt {
  commandId: string;
  payloadHash: string;
  actor: string;
  proposalId: string;
  baseRevisionId: string;
  appliedRevisionId: string;
  delta: ModelDelta;
  lineage: Lineage[];
  equivalence: { rule: 'native-delta-and-predicates-v1'; fieldRule: Draft['fieldRule'];
    reconciled: boolean; checks: Array<{ predicate: Predicate; observed: number | boolean; passed: boolean }>;
    humanApproval: false };
}
interface State { revisions: CandidateRevision[]; receipts: Receipt[] }

export function canonical(value: unknown): string {
  if (value === undefined) return '<absent>';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

function evaluate(snapshot: ModelSnapshot, predicate: Predicate): Receipt['equivalence']['checks'][number] {
  let observed: number | boolean;
  switch (predicate.kind) {
    case 'empty-region': {
      const box = predicate.bounds;
      if (box.minX >= box.maxX || box.minY >= box.maxY) throw new Error('Invalid empty-region predicate bounds.');
      // A conservative predicate: unsupported occupier types cannot silently count as empty.
      if (snapshot.entities.some((item) => item.type === 'AssetInstance' || item.type === 'Equipment')) {
        throw new Error('Empty-region predicate does not support asset or equipment occupancy.');
      }
      if (!snapshot.entities.some((item) => item.id === predicate.exceptId && item.type === 'Furniture')) {
        throw new Error('Empty-region predicate must bind its excluded furniture.');
      }
      const walls = snapshot.entities.filter((item) => item.type === 'Wall');
      const inset = Math.max(...walls.map((item) => item.thickness / 2));
      if (box.minX < Math.min(...walls.flatMap((item) => [item.start[0], item.end[0]])) + inset
        || box.maxX > Math.max(...walls.flatMap((item) => [item.start[0], item.end[0]])) - inset
        || box.minY < Math.min(...walls.flatMap((item) => [item.start[1], item.end[1]])) + inset
        || box.maxY > Math.max(...walls.flatMap((item) => [item.start[1], item.end[1]])) - inset) {
        throw new Error('Empty-region predicate must stay within clear native room bounds.');
      }
      observed = !snapshot.entities.some((item) => {
        if (item.type !== 'Furniture' || item.id === predicate.exceptId) return false;
        const footprint = furnitureFootprint(item);
        return footprint.minX < box.maxX && footprint.maxX > box.minX && footprint.minY < box.maxY && footprint.maxY > box.minY;
      });
      return { predicate, observed, passed: observed };
    }
    case 'north-wall-gap': {
      const wall = snapshot.entities.find((item) => item.id === predicate.wallId);
      const furniture = snapshot.entities.find((item) => item.id === predicate.furnitureId);
      if (wall?.type !== 'Wall' || furniture?.type !== 'Furniture' || wall.start[1] !== wall.end[1]
        || snapshot.entities.some((item) => item.type === 'Space' || item.type === 'Level')) {
        throw new Error('Wall-gap predicate requires a native single-room horizontal wall and furniture.');
      }
      const north = Math.max(...snapshot.entities.filter((item) => item.type === 'Wall').flatMap((item) => [item.start[1], item.end[1]]));
      if (wall.start[1] !== north) throw new Error('Wall-gap predicate must reference the north boundary.');
      observed = wall.start[1] - wall.thickness / 2 - furnitureFootprint(furniture).maxY;
      return { predicate, observed, passed: Math.abs(observed - predicate.metres) < 1e-9 };
    }
    default: { const unreachable: never = predicate; return unreachable; }
  }
}

function mergeFields(base: Entity, current: Entity, proposed: Entity, draft: Draft, snapshot: ModelSnapshot): Entity {
  if (draft.fieldRule !== 'isolated-furniture-name-kind-v1' || base.type !== 'Furniture'
    || current.type !== 'Furniture' || proposed.type !== 'Furniture') throw new Error(`Entity conflict: ${base.id}`);
  const shape = (item: Furniture) => { const { name, kind, ...rest } = item; return rest; };
  const kinds = [base.kind, current.kind, proposed.kind];
  if (base.supportId !== null || kinds.some((kind) => kind !== 'chair' && kind !== 'plant')
    || !equal(shape(base), shape(current)) || !equal(shape(base), shape(proposed))
    || snapshot.entities.some((item) => item.type === 'Furniture' && item.supportId === base.id)
    || snapshot.relationships.some((item) => item.source === base.id || item.target === base.id)) {
    throw new Error(`Field rule cannot establish independence for ${base.id}.`);
  }
  if ((base.name !== current.name && base.name !== proposed.name && current.name !== proposed.name)
    || (base.kind !== current.kind && base.kind !== proposed.kind && current.kind !== proposed.kind)) {
    throw new Error(`Divergent field conflict: ${base.id}`);
  }
  return { ...current, name: base.name !== proposed.name ? proposed.name : current.name,
    kind: base.kind !== proposed.kind ? proposed.kind : current.kind };
}

function mergeItems<T extends { id: string }>(base: T[], current: T[], proposed: T[],
  conflict: (base: T, current: T, proposed: T) => T): T[] {
  const original = new Map(base.map((item) => [item.id, item]));
  const accepted = new Map(current.map((item) => [item.id, item]));
  const incoming = new Map(proposed.map((item) => [item.id, item]));
  return [...new Set([...original.keys(), ...accepted.keys(), ...incoming.keys()])].sort().flatMap((id): T[] => {
    const b = original.get(id); const c = accepted.get(id); const p = incoming.get(id);
    if (equal(b, p) || equal(c, p)) return c ? [c] : [];
    if (equal(b, c)) return p ? [p] : [];
    if (!b || !c || !p) throw new Error(`Addition/deletion conflict: ${id}`);
    return [conflict(b, c, p)];
  });
}

function verifyLineage(delta: ModelDelta, lineage: Lineage[], prior: CandidateRevision[]): void {
  const removed = new Set<string>(delta.entities.removed.map((item) => item.id));
  const added = new Set<string>(delta.entities.added.map((item) => item.id));
  const used = new Set<string>(prior.flatMap((revision) => revision.snapshot.entities.map((item) => item.id)));
  if (delta.entities.added.some((item) => used.has(item.id))) throw new Error('Historical native identity cannot be reused.');
  const sources = lineage.flatMap((item) => item.sources); const targets = lineage.flatMap((item) => item.targets);
  if (new Set(sources).size !== sources.length || new Set(targets).size !== targets.length
    || sources.some((id) => !removed.has(id)) || targets.some((id) => !added.has(id))) throw new Error('Lineage endpoints must uniquely match actual removed and added identities.');
  if ((removed.size > 0 && added.size > 0) && (sources.length !== removed.size || targets.length !== added.size)) {
    throw new Error('Replacement, split or merge requires complete explicit object lineage.');
  }
}

function revision(parentId: string | null, snapshot: ModelSnapshot, lineage: Lineage[], predicates: Predicate[]): CandidateRevision {
  return { id: sha256(canonical({ parentId, snapshot, lineage, predicates })), parentId, snapshot, lineage, predicates };
}

function nativeSnapshot(input: unknown): ModelSnapshot {
  const snapshot = validateSnapshot(input);
  if (snapshot.version === 2 || snapshot.entities.some((item) => item.type === 'Level' || item.type === 'Space')) {
    throw new Error('Candidate is restricted to native single-room snapshots.');
  }
  rectangleLayout(snapshot);
  return snapshot;
}

/** Experimental synchronous in-memory state. This is not a storage or authority adapter. */
export class SemanticCandidate {
  #state: State;
  private constructor(state: State) { this.#state = freeze(state); Object.freeze(this); }
  static create(input: unknown): SemanticCandidate {
    const snapshot = nativeSnapshot(input);
    return new SemanticCandidate({ revisions: [revision(null, snapshot, [], [])], receipts: [] });
  }
  head(): CandidateRevision {
    const latest = this.#state.revisions.at(-1);
    if (!latest) throw new Error('Candidate requires its root revision.');
    return latest;
  }
  serialize(): string { return canonical(this.#state); }
  receipts(): readonly Receipt[] { return this.#state.receipts; }
  draft(input: unknown): Draft {
    if (!Check(ProposalInputSchema, input)) throw new Error('Invalid candidate proposal boundary.');
    const snapshot = nativeSnapshot(input.snapshot);
    const draft = { ...structuredClone(input), snapshot, baseRevisionId: this.head().id };
    verifyLineage(diffSnapshots(this.head().snapshot, snapshot), draft.lineage, this.#state.revisions);
    for (const predicate of draft.predicates) if (!evaluate(snapshot, predicate).passed) throw new Error('Proposal predicate fails before review.');
    return freeze(draft);
  }
  apply(input: unknown): { state: SemanticCandidate; receipt: Receipt } {
    if (!Check(CommandSchema, input)) throw new Error('Invalid candidate command boundary.');
    const draft: Draft = { ...structuredClone(input.draft), snapshot: nativeSnapshot(input.draft.snapshot) };
    const payloadHash = sha256(canonical({ actor: input.actor, draft }));
    const previous = this.#state.receipts.find((item) => item.commandId === input.commandId);
    if (previous) {
      if (previous.payloadHash !== payloadHash) throw new Error('Command identity reused with changed payload.');
      return { state: this, receipt: previous };
    }
    if (this.#state.receipts.some((item) => item.proposalId === draft.id)) throw new Error('Proposal already has an application receipt.');
    const base = this.#state.revisions.find((item) => item.id === draft.baseRevisionId);
    if (!base) throw new Error('Proposal base is not in candidate ancestry.');
    if (draft.snapshot.version !== base.snapshot.version) throw new Error('Candidate cannot change native representation.');
    const head = this.head();
    const concurrentRevisions = new Set(this.#state.revisions.slice(this.#state.revisions.indexOf(base) + 1).map((item) => item.id));
    const entities = mergeItems<Entity>(base.snapshot.entities, head.snapshot.entities, draft.snapshot.entities,
      (b, c, p) => {
        if (draft.fieldRule !== 'whole-entity' && this.#state.receipts.some((receipt) => concurrentRevisions.has(receipt.appliedRevisionId)
          && receipt.delta.entities.modified.some((item) => item.id === b.id) && receipt.equivalence.fieldRule !== draft.fieldRule)) {
          throw new Error('Field independence was not declared by the prior application.');
        }
        return mergeFields(b, c, p, draft, head.snapshot);
      });
    const relationships = mergeItems(base.snapshot.relationships, head.snapshot.relationships, draft.snapshot.relationships,
      (b) => { throw new Error(`Relationship conflict: ${b.id}`); });
    const snapshot = validateSnapshot({ ...head.snapshot, entities, relationships });
    // Native family identity remains immutable across every retained revision.
    for (const item of snapshot.entities) if (item.type === 'AssetFamily' && this.#state.revisions.some((revision) =>
      revision.snapshot.entities.some((old) => old.id === item.id && !equal(old, item)))) throw new Error('Family identity remains immutable.');
    const delta = diffSnapshots(head.snapshot, snapshot);
    verifyLineage(delta, draft.lineage, this.#state.revisions);
    const predicates = [...head.predicates, ...draft.predicates].filter((item, index, all) => all.findIndex((other) => equal(item, other)) === index);
    const checks = predicates.map((predicate) => evaluate(snapshot, predicate));
    if (checks.some((check) => !check.passed)) throw new Error('Changed assumption: candidate predicate requires renewed review.');
    const applied = revision(head.id, snapshot, draft.lineage, predicates);
    const receipt: Receipt = { commandId: input.commandId, payloadHash, actor: input.actor, proposalId: draft.id,
      baseRevisionId: base.id, appliedRevisionId: applied.id, delta, lineage: draft.lineage,
      equivalence: { rule: 'native-delta-and-predicates-v1', fieldRule: draft.fieldRule,
        reconciled: base.id !== head.id, checks, humanApproval: false } };
    const state = new SemanticCandidate({ revisions: [...this.#state.revisions, applied],
      receipts: [...this.#state.receipts, receipt] });
    return { state, receipt };
  }
}

const sharedId = Type.String({ minLength: 1, maxLength: 128 });
const propertyKey = Type.String({ pattern: '^(?!__proto__$|constructor$|prototype$).{1,128}$' });
const sharedValueSchema = Type.Union([
  Type.Object({ kind: Type.Literal('number'), value: Type.Number() }, exact),
  Type.Object({ kind: Type.Literal('string'), value: Type.String() }, exact),
  Type.Object({ kind: Type.Literal('boolean'), value: Type.Boolean() }, exact),
  Type.Object({ kind: Type.Literal('null'), value: Type.Null() }, exact),
]);
export type SharedValue = Static<typeof sharedValueSchema>;
const sharedBagSchema = Type.Record(propertyKey, sharedValueSchema);
export type SharedBag = Static<typeof sharedBagSchema>;
const sharedDefinitionSchema = Type.Object({ id: sharedId, contentHash: hash,
  slots: Type.Record(propertyKey, Type.Union([Type.Literal('number'), Type.Literal('string'), Type.Literal('boolean'), Type.Literal('null')])),
}, exact);
type SharedDefinition = Static<typeof sharedDefinitionSchema>;
const sharedOccurrenceSchema = Type.Object({ id: sharedId, definitionId: sharedId, own: sharedBagSchema, overrides: sharedBagSchema }, exact);
type SharedOccurrence = Static<typeof sharedOccurrenceSchema>;
const sharedCommandSchema = Type.Union([
  Type.Object({ kind: Type.Literal('occurrence-override'), occurrenceId: sharedId, values: sharedBagSchema }, exact),
  Type.Object({ kind: Type.Literal('type-edit'), definitionId: sharedId, values: sharedBagSchema,
    impactedInstanceIds: Type.Array(sharedId, { maxItems: 256 }) }, exact),
  Type.Object({ kind: Type.Literal('fork-definition'), sourceDefinitionId: sharedId, targetDefinitionId: sharedId,
    occurrenceIds: Type.Array(sharedId, { minItems: 1, maxItems: 256 }) }, exact),
]);
type SharedCommand = Static<typeof sharedCommandSchema>;
interface SharedState {
  fixture: Fixture;
  definitions: SharedDefinition[];
  occurrences: SharedOccurrence[];
  contents: Array<{ hash: string; values: SharedBag }>;
}
export interface SharedPropertyDelta {
  command: SharedCommand;
  beforeRevisionId: string;
  afterRevisionId: string;
  impactedInstanceIds: string[];
  definitions: ReturnType<typeof sharedChanges<SharedDefinition>>;
  occurrences: ReturnType<typeof sharedChanges<SharedOccurrence>>;
  contentAdded: string[];
  effectiveChanges: Array<{ id: string; before: SharedBag; after: SharedBag }>;
}
function sharedChanges<T extends { id: string }>(before: T[], after: T[]) {
  return { added: after.filter((item) => !before.some((old) => old.id === item.id)),
    modified: after.flatMap((item) => {
      const old = before.find((value) => value.id === item.id);
      return old && !equal(old, item) ? [{ id: item.id, before: old, after: item }] : [];
    }) };
}
export function sharedValue(value: Fixture['entities'][number]['properties'][string]): SharedValue {
  if (value === null) return { kind: 'null', value };
  switch (typeof value) {
    case 'number': return { kind: 'number', value };
    case 'string': return { kind: 'string', value };
    case 'boolean': return { kind: 'boolean', value };
    default: { const unreachable: never = value; return unreachable; }
  }
}
function sharedBag(properties: Fixture['entities'][number]['properties']): SharedBag {
  const bag = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, sharedValue(value)]));
  if (!Check(sharedBagSchema, bag) || Object.keys(bag).length > 64) throw new Error('Invalid or oversized typed property bag.');
  return bag;
}
function sharedDefinition(state: SharedState, id: string): SharedDefinition {
  const definition = state.definitions.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown shared definition: ${id}`);
  return definition;
}
function sharedContent(state: SharedState, definition: SharedDefinition): SharedBag {
  const content = state.contents.find((item) => item.hash === definition.contentHash);
  if (!content) throw new Error('Missing immutable shared content.');
  return content.values;
}
function effectiveProperties(state: SharedState, occurrence: SharedOccurrence): SharedBag {
  const definition = sharedDefinition(state, occurrence.definitionId);
  return { ...sharedContent(state, definition), ...occurrence.own, ...occurrence.overrides };
}
function internSharedContent(contents: SharedState['contents'], values: SharedBag): string {
  const hash = sha256(canonical(values));
  const previous = contents.find((item) => item.hash === hash);
  if (previous && !equal(previous.values, values)) throw new Error('Shared content hash collision.');
  if (!previous) contents.push({ hash, values });
  return hash;
}
function validateSharedPatch(definition: SharedDefinition, values: SharedBag): void {
  const keys = Object.keys(values);
  if (keys.length === 0 || keys.length > 64 || keys.some((key) => !Object.hasOwn(definition.slots, key)
    || definition.slots[key] !== values[key]?.kind)) throw new Error('Shared-property patch must use declared keys and value types.');
}

/** W0 property-graph experiment only. The native geometry candidate above is unchanged. */
export class SharedPropertyCandidate {
  #state: SharedState;
  readonly revisionId: string;
  private constructor(state: SharedState, parentId: string | null) {
    this.#state = freeze(state);
    this.revisionId = sha256(canonical({ parentId, state }));
    Object.freeze(this);
  }
  static fromFixture(input: unknown): SharedPropertyCandidate {
    const fixture = parseFixture(structuredClone(input));
    const contents: SharedState['contents'] = [];
    const definitions = fixture.entities.filter((item) => item.kind === 'type').map((item): SharedDefinition => {
      const values = sharedBag(item.properties);
      return { id: item.id, slots: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.kind])),
        contentHash: internSharedContent(contents, values) };
    });
    const occurrences = fixture.relationships.filter((item) => item.kind === 'instanceOf').map((relation): SharedOccurrence => {
      const instance = fixture.entities.find((item) => item.id === relation.source);
      const definition = definitions.find((item) => item.id === relation.target);
      if (!instance || !definition) throw new Error('Invalid shared occurrence binding.');
      const own = sharedBag(instance.properties);
      for (const [key, value] of Object.entries(own)) if (Object.hasOwn(definition.slots, key) && definition.slots[key] !== value.kind) {
        throw new Error('Authored occurrence property disagrees with its shared definition type.');
      }
      return { id: instance.id, definitionId: definition.id, own, overrides: {} };
    });
    if (definitions.length < 1 || definitions.length > 64 || occurrences.length > 256
      || new Set(occurrences.map((item) => item.id)).size !== occurrences.length) throw new Error('Shared fixture needs bounded definitions and unique occurrence ownership.');
    return new SharedPropertyCandidate({ fixture, definitions, occurrences, contents }, null);
  }
  view(): SharedState { return this.#state; }
  serialize(): string { return canonical({ revisionId: this.revisionId, state: this.#state }); }
  effective(id: string): SharedBag {
    const occurrence = this.#state.occurrences.find((item) => item.id === id);
    if (!occurrence) throw new Error(`Unknown shared occurrence: ${id}`);
    return freeze(effectiveProperties(this.#state, occurrence));
  }
  apply(input: unknown): { state: SharedPropertyCandidate; delta: SharedPropertyDelta } {
    if (!Check(sharedCommandSchema, input)) throw new Error('Invalid shared-property command boundary.');
    const command = structuredClone(input);
    const before = this.#state;
    let definitions = [...before.definitions]; let occurrences = [...before.occurrences];
    const contents = [...before.contents];
    let impactedInstanceIds: string[];
    switch (command.kind) {
      case 'occurrence-override': {
        const occurrence = occurrences.find((item) => item.id === command.occurrenceId);
        if (!occurrence) throw new Error('Unknown shared occurrence.');
        validateSharedPatch(sharedDefinition(before, occurrence.definitionId), command.values);
        occurrences = occurrences.map((item) => item.id === occurrence.id ? { ...item, overrides: { ...item.overrides, ...command.values } } : item);
        impactedInstanceIds = [occurrence.id];
        break;
      }
      case 'type-edit': {
        const definition = sharedDefinition(before, command.definitionId);
        validateSharedPatch(definition, command.values);
        impactedInstanceIds = occurrences.filter((item) => item.definitionId === definition.id).map((item) => item.id).sort();
        if (!equal([...command.impactedInstanceIds].sort(), impactedInstanceIds)) throw new Error('Type edit must declare every impacted occurrence exactly once, including overridden occurrences.');
        const contentHash = internSharedContent(contents, { ...sharedContent(before, definition), ...command.values });
        definitions = definitions.map((item) => item.id === definition.id ? { ...item, contentHash } : item);
        break;
      }
      case 'fork-definition': {
        const definition = sharedDefinition(before, command.sourceDefinitionId);
        if (before.fixture.entities.some((item) => item.id === command.targetDefinitionId)
          || definitions.some((item) => item.id === command.targetDefinitionId)) throw new Error('Definition identity is already in use.');
        const selected = new Set(command.occurrenceIds);
        if (selected.size !== command.occurrenceIds.length || command.occurrenceIds.some((id) => !occurrences.some((item) => item.id === id && item.definitionId === definition.id))) {
          throw new Error('Definition fork must select unique existing source occurrences.');
        }
        definitions.push({ ...definition, id: command.targetDefinitionId });
        occurrences = occurrences.map((item) => selected.has(item.id) ? { ...item, definitionId: command.targetDefinitionId } : item);
        impactedInstanceIds = [...selected].sort();
        break;
      }
      default: { const unreachable: never = command; return unreachable; }
    }
    if (definitions.length > 64 || contents.length > 256) throw new Error('Shared candidate capacity limit reached.');
    const state = new SharedPropertyCandidate({ ...before, definitions, occurrences, contents }, this.revisionId);
    const delta: SharedPropertyDelta = { command, beforeRevisionId: this.revisionId, afterRevisionId: state.revisionId, impactedInstanceIds,
      definitions: sharedChanges(before.definitions, definitions), occurrences: sharedChanges(before.occurrences, occurrences),
      contentAdded: contents.filter((item) => !before.contents.some((old) => old.hash === item.hash)).map((item) => item.hash),
      effectiveChanges: occurrences.flatMap((item) => {
        const old = this.effective(item.id); const after = state.effective(item.id);
        return equal(old, after) ? [] : [{ id: item.id, before: old, after }];
      }) };
    return { state, delta: freeze(delta) };
  }
}
