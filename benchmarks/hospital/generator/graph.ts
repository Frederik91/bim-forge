import { Dataset, DOMAINS, DOMAIN_KINDS, KINDS, OCCURRENCE_KINDS, domainOf } from './profile.ts';
import type { Domain, EntityRef, Kind } from './profile.ts';

type Segment = { kind: Kind; first: number; stride: number; count: number };
export class Collection {
  readonly dataset: Dataset;
  readonly segments: readonly Segment[];
  readonly length: number;
  constructor(dataset: Dataset, segments: readonly Segment[]) {
    this.dataset = dataset;
    this.segments = segments;
    this.length = segments.reduce((sum, segment) => sum + segment.count, 0);
  }
  at(index: number): EntityRef {
    for (const segment of this.segments) {
      if (index < segment.count) return this.dataset.ref(segment.kind, segment.first + index * segment.stride);
      index -= segment.count;
    }
    throw new Error('Collection index outside admitted inventory.');
  }
  indexOf(entity: EntityRef): number {
    let offset = 0;
    for (const segment of this.segments) {
      const local = (entity.ordinal - segment.first) / segment.stride;
      if (segment.kind === entity.kind && Number.isInteger(local) && local >= 0 && local < segment.count) return offset + local;
      offset += segment.count;
    }
    return -1;
  }
  every(residue: number, stride: number): Collection {
    const segments: Segment[] = [];
    let offset = 0;
    for (const segment of this.segments) {
      const local = ((residue - offset) % stride + stride) % stride;
      if (local < segment.count) segments.push({ kind: segment.kind, first: segment.first + local * segment.stride,
        stride: segment.stride * stride, count: Math.floor((segment.count - 1 - local) / stride) + 1 });
      offset += segment.count;
    }
    return new Collection(this.dataset, segments);
  }
}

function collection(dataset: Dataset, kinds: readonly Kind[]): Collection {
  return new Collection(dataset, kinds.map((kind) => ({ kind, first: 1, stride: 1, count: dataset.range(kind).count })));
}

export class Sequence {
  readonly collection: Collection;
  readonly count: number;
  readonly mode: 'cycle' | 'hot' | 'quantile';
  readonly offset: number;
  constructor(collection: Collection, count: number,
    mode: 'cycle' | 'hot' | 'quantile' = 'cycle', offset = 0) {
    this.collection = collection;
    this.count = count;
    this.mode = mode;
    this.offset = offset;
    if (collection.length < 1) throw new Error('Empty endpoint collection.');
  }
  at(index: number): EntityRef {
    const length = this.collection.length;
    if (this.mode === 'quantile') return this.collection.at(Math.floor(index * length / this.count));
    if (this.mode === 'hot' && length > 1) {
      return this.collection.at(index % 5 === 0 ? 0 : 1 + (index - Math.floor(index / 5) - 1 + this.offset) % (length - 1));
    }
    return this.collection.at((index + this.offset) % length);
  }
  *positions(entity: EntityRef): Generator<number> {
    const index = this.collection.indexOf(entity);
    if (index < 0) return;
    const length = this.collection.length;
    if (this.mode === 'quantile') {
      const candidate = Math.ceil(index * this.count / length);
      if (candidate < this.count && Math.floor(candidate * length / this.count) === index) yield candidate;
      return;
    }
    if (this.mode === 'hot' && length > 1) {
      if (index === 0) { for (let position = 0; position < this.count; position += 5) yield position; }
      else {
        const first = ((index - 1 - this.offset) % (length - 1) + length - 1) % (length - 1);
        const nonHotCount = this.count - Math.ceil(this.count / 5);
        for (let rank = first; rank < nonHotCount; rank += length - 1) yield Math.floor(rank / 4) * 5 + rank % 4 + 1;
      }
      return;
    }
    const first = ((index - this.offset) % length + length) % length;
    for (let position = first; position < this.count; position += length) yield position;
  }
  countAt(entity: EntityRef): number {
    const index = this.collection.indexOf(entity);
    if (index < 0) return 0;
    const length = this.collection.length;
    if (this.mode === 'quantile') {
      const candidate = Math.ceil(index * this.count / length);
      return candidate < this.count && Math.floor(candidate * length / this.count) === index ? 1 : 0;
    }
    if (this.mode === 'hot' && length > 1) {
      if (index === 0) return Math.ceil(this.count / 5);
      const first = ((index - 1 - this.offset) % (length - 1) + length - 1) % (length - 1);
      const nonHotCount = this.count - Math.ceil(this.count / 5);
      return first >= nonHotCount ? 0 : Math.floor((nonHotCount - 1 - first) / (length - 1)) + 1;
    }
    const first = ((index - this.offset) % length + length) % length;
    return first >= this.count ? 0 : Math.floor((this.count - 1 - first) / length) + 1;
  }
}

export type RelationKind = 'containedIn' | 'instanceOf' | 'hostedBy' | 'supportedBy' | 'hasPort'
  | 'connectedTo' | 'memberOfSystem' | 'boundsSpace' | 'parameterDependsOn' | 'externalBinding' | 'provenance';
export type Edge = { kind: RelationKind; source: EntityRef; target: EntityRef; properties: object };
type Rule = { kind: RelationKind; source: Sequence; target: Sequence };
type PortGroup = { domain: Domain; system: EntityRef; owners: Collection; ports: Collection;
  first: number; count: number; pairs: number; ownerSequence: Sequence };
const HOSTS: Partial<Record<Kind, Kind>> = { stud: 'wall', door: 'wall', window: 'wall',
  electricalOutlet: 'wall', switch: 'wall', sensor: 'wall', electricalPanel: 'wall' };
const SUPPORTS: Partial<Record<Kind, Kind>> = { chair: 'slab', desk: 'slab', bed: 'slab',
  cabinet: 'slab', otherFurnishing: 'slab', luminaire: 'slab', cableSegment: 'containmentSegment',
  ductSegment: 'slab', pipeSegment: 'slab' };

export class Graph {
  readonly dataset: Dataset;
  readonly rules: Rule[] = [];
  readonly portGroups: PortGroup[] = [];
  readonly domainPools: Readonly<Record<Domain, Collection>>;
  readonly domainSystems: Readonly<Record<Domain, Collection>>;
  readonly domainGroups: Record<Domain, PortGroup[]> = { electrical: [], air: [], water: [] };
  readonly occurrences: Collection;
  readonly parameterOwners: Sequence;
  readonly externalOwners: Sequence;
  readonly types = new Map<Kind, Sequence>();
  readonly containment = new Map<Kind, Sequence>();
  readonly systems = new Map<Kind, Sequence>();
  readonly sourceRules = new Map<Kind, Rule[]>();
  readonly targetRules = new Map<Kind, Rule[]>();
  constructor(dataset: Dataset) {
    this.dataset = dataset;
    this.occurrences = collection(dataset, OCCURRENCE_KINDS);
    this.parameterOwners = new Sequence(this.occurrences, dataset.parameterCount, 'quantile');
    this.externalOwners = new Sequence(this.occurrences,
      Math.min(this.occurrences.length, Math.max(1, Math.floor(dataset.profile.geometryAndArtifacts.externalArtifactReferences * dataset.fraction))), 'quantile');
    this.domainPools = { electrical: collection(dataset, DOMAIN_KINDS.electrical),
      air: collection(dataset, DOMAIN_KINDS.air), water: collection(dataset, DOMAIN_KINDS.water) };
    const allSystems = collection(dataset, ['system']);
    this.domainSystems = { electrical: allSystems.every(0, 3), air: allSystems.every(1, 3), water: allSystems.every(2, 3) };
    for (const domain of DOMAINS) {
      if (this.domainPools[domain].length < this.domainSystems[domain].length * 2) throw new Error('Each system needs at least two compatible port owners.');
    }
    const add = (kind: RelationKind, source: Sequence, target: Sequence): void => { this.rules.push({ kind, source, target }); };
    for (const kind of KINDS) {
      if (kind === 'site' || kind === 'connectionPort') continue;
      const own = collection(dataset, [kind]);
      const host = HOSTS[kind];
      const support = SUPPORTS[kind];
      let parent: Kind;
      switch (kind) {
        case 'building': case 'typeDefinition': parent = 'site'; break;
        case 'level': case 'system': parent = 'building'; break;
        case 'zone': parent = 'level'; break;
        case 'space': parent = 'zone'; break;
        default: parent = host ?? support ?? 'space';
      }
      const target = new Sequence(collection(dataset, [parent]), own.length,
        parent === 'space' || parent === 'zone' ? 'hot' : 'cycle', dataset.salt % dataset.range(parent).count);
      this.containment.set(kind, target);
      add('containedIn', new Sequence(own, own.length), target);
      if (host) add('hostedBy', new Sequence(own, own.length), target);
      if (support) add('supportedBy', new Sequence(own, own.length), target);
      if (OCCURRENCE_KINDS.includes(kind)) {
        const classIndex = OCCURRENCE_KINDS.indexOf(kind);
        const typePool = collection(dataset, ['typeDefinition']).every(classIndex, OCCURRENCE_KINDS.length);
        const typeSequence = new Sequence(typePool, own.length, 'hot', dataset.salt % typePool.length);
        this.types.set(kind, typeSequence);
        add('instanceOf', new Sequence(own, own.length), typeSequence);
      }
    }
    for (const domain of DOMAINS) {
      const pool = this.domainPools[domain];
      const systemPool = this.domainSystems[domain];
      for (const segment of pool.segments) {
        const own = collection(dataset, [segment.kind]);
        const before = pool.indexOf(dataset.ref(segment.kind, 1));
        const target = new Sequence(systemPool, own.length, 'cycle', before % systemPool.length);
        this.systems.set(segment.kind, target);
        add('memberOfSystem', new Sequence(own, own.length), target);
      }
    }
    const wall = collection(dataset, ['wall']);
    const wallSpace = this.containment.get('wall');
    if (!wallSpace) throw new Error('Missing wall containment.');
    add('boundsSpace', new Sequence(wall, wall.length), wallSpace);
    let portOrdinal = 1;
    let globalSystem = 0;
    const portCount = dataset.range('connectionPort').count;
    const pairCount = Math.floor(portCount / 2);
    const systemCount = allSystems.length;
    for (const domain of DOMAINS) {
      const systemPool = this.domainSystems[domain];
      for (let index = 0; index < systemPool.length; index += 1) {
        const pairs = Math.floor(pairCount / systemCount) + (globalSystem < pairCount % systemCount ? 1 : 0);
        const count = pairs * 2 + (globalSystem === systemCount - 1 ? portCount % 2 : 0);
        const owners = this.domainPools[domain].every(index, systemPool.length);
        const ports = new Collection(dataset, [{ kind: 'connectionPort', first: portOrdinal, stride: 1, count }]);
        const group: PortGroup = { domain, system: systemPool.at(index), owners, ports, first: portOrdinal,
          count, pairs, ownerSequence: new Sequence(owners, count, 'cycle', dataset.salt % owners.length) };
        this.portGroups.push(group);
        this.domainGroups[domain].push(group);
        portOrdinal += count;
        globalSystem += 1;
      }
    }
    for (const rule of this.rules) {
      for (const kind of new Set(rule.source.collection.segments.map((segment) => segment.kind))) {
        this.sourceRules.set(kind, [...(this.sourceRules.get(kind) ?? []), rule]);
      }
      for (const kind of new Set(rule.target.collection.segments.map((segment) => segment.kind))) {
        this.targetRules.set(kind, [...(this.targetRules.get(kind) ?? []), rule]);
      }
    }
  }
  portGroup(port: EntityRef): PortGroup {
    let low = 0;
    let high = this.portGroups.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const group = this.portGroups[middle];
      if (!group) throw new Error('Internal port partition missing.');
      if (port.ordinal < group.first) high = middle - 1;
      else if (port.ordinal >= group.first + group.count) low = middle + 1;
      else return group;
    }
    throw new Error('Port not in an admitted system partition.');
  }
  ownerOf(port: EntityRef): EntityRef { const group = this.portGroup(port); return group.ownerSequence.at(port.ordinal - group.first); }
  typeOf(entity: EntityRef): EntityRef | null { return this.types.get(entity.kind)?.at(entity.ordinal - 1) ?? null; }
  parentOf(entity: EntityRef): EntityRef | null { return this.containment.get(entity.kind)?.at(entity.ordinal - 1) ?? null; }
  spaceOf(entity: EntityRef): EntityRef | null {
    if (entity.kind === 'space') return entity;
    if (entity.kind === 'connectionPort') return this.spaceOf(this.ownerOf(entity));
    if (!OCCURRENCE_KINDS.includes(entity.kind)) return null;
    const parent = this.parentOf(entity);
    return parent ? this.spaceOf(parent) : null;
  }
  systemOf(entity: EntityRef): EntityRef | null {
    if (entity.kind === 'connectionPort') return this.portGroup(entity).system;
    return this.systems.get(entity.kind)?.at(entity.ordinal - 1) ?? null;
  }
  parameterIndex(entity: EntityRef): number | null {
    const position = this.parameterOwners.positions(entity).next();
    return position.done ? null : position.value;
  }
  parameter(index: number): { owner: EntityRef; dependency: EntityRef; kind: string } {
    const owner = this.parameterOwners.at(index);
    const type = this.typeOf(owner);
    if (!type) throw new Error('Parameter owner must be a typed occurrence.');
    const host = HOSTS[owner.kind] ?? SUPPORTS[owner.kind];
    if (index % 5 === 2 && host) {
      const parent = this.parentOf(owner);
      if (!parent) throw new Error('Host offset requires a host.');
      return { owner, dependency: parent, kind: 'hostOffset' };
    }
    const forms = ['dimension', 'typeReference', 'dimension', 'dependencyInput', 'recipe'];
    return { owner, dependency: type, kind: forms[index % 5] ?? 'dimension' };
  }
  externalUri(entity: EntityRef): string { return `synthetic://hospital/${this.dataset.profile.id}/${this.dataset.salt}/${entity.kind}/${entity.ordinal}/r1`; }
  secondBoundary(wall: EntityRef): EntityRef {
    const first = this.parentOf(wall);
    if (!first) throw new Error('Wall needs space.');
    return this.dataset.ref('space', first.ordinal % this.dataset.range('space').count + 1);
  }
  *edges(): Generator<Edge> {
    for (const rule of this.rules) {
      for (let index = 0; index < rule.source.count; index += 1) {
        yield { kind: rule.kind, source: rule.source.at(index), target: rule.target.at(index), properties: {} };
      }
    }
    if (this.dataset.range('space').count > 1) {
      for (let ordinal = 1; ordinal <= this.dataset.range('wall').count; ordinal += 1) {
        const wall = this.dataset.ref('wall', ordinal);
        yield { kind: 'boundsSpace', source: wall, target: this.secondBoundary(wall), properties: { side: 'opposite' } };
      }
    }
    for (const group of this.portGroups) {
      for (let index = 0; index < group.count; index += 1) {
        yield { kind: 'hasPort', source: group.ownerSequence.at(index), target: group.ports.at(index), properties: {} };
      }
      for (let index = 0; index < group.pairs; index += 1) {
        yield { kind: 'connectedTo', source: group.ports.at(index * 2), target: group.ports.at(index * 2 + 1), properties: { domain: group.domain } };
      }
    }
    for (let index = 0; index < this.dataset.parameterCount; index += 1) {
      const parameter = this.parameter(index);
      yield { kind: 'parameterDependsOn', source: parameter.owner, target: parameter.dependency, properties: { parameterId: index + 1 } };
    }
    for (let index = 0; index < this.externalOwners.count; index += 1) {
      const source = this.externalOwners.at(index);
      const type = this.typeOf(source);
      if (!type) throw new Error('External binding must have a class-compatible definition.');
      yield { kind: 'externalBinding', source, target: type, properties: { uri: this.externalUri(source), mediaType: 'application/x-bim-forge-synthetic-reference' } };
      yield { kind: 'provenance', source, target: this.dataset.ref('site', 1), properties: { sourceId: `${source.kind}:${source.ordinal}`, sourceRevision: 1 } };
    }
  }
  degrees(entity: EntityRef): Map<string, { incoming: number; outgoing: number }> {
    const result = new Map<string, { incoming: number; outgoing: number }>();
    const add = (kind: string, incoming: number, outgoing: number): void => {
      if (incoming === 0 && outgoing === 0) return;
      const previous = result.get(kind) ?? { incoming: 0, outgoing: 0 };
      result.set(kind, { incoming: previous.incoming + incoming, outgoing: previous.outgoing + outgoing });
    };
    for (const rule of this.sourceRules.get(entity.kind) ?? []) add(rule.kind, 0, rule.source.countAt(entity));
    for (const rule of this.targetRules.get(entity.kind) ?? []) add(rule.kind, rule.target.countAt(entity), 0);
    if (entity.kind === 'connectionPort') {
      const group = this.portGroup(entity);
      const index = entity.ordinal - group.first;
      add('hasPort', 1, 0);
      if (index < group.pairs * 2) add('connectedTo', index % 2, 1 - index % 2);
    } else {
      const domain = domainOf(entity.kind);
      if (domain) {
        const index = this.domainPools[domain].indexOf(entity);
        const group = this.domainGroups[domain][index % this.domainSystems[domain].length];
        if (group) add('hasPort', 0, group.ownerSequence.countAt(entity));
      }
    }
    if (this.dataset.range('space').count > 1) {
      if (entity.kind === 'wall') add('boundsSpace', 0, 1);
      if (entity.kind === 'space') {
        const previous = this.dataset.ref('space', (entity.ordinal + this.dataset.range('space').count - 2) % this.dataset.range('space').count + 1);
        const walls = this.containment.get('wall');
        if (walls) add('boundsSpace', walls.countAt(previous), 0);
      }
    }
    const parameter = this.parameterIndex(entity);
    add('parameterDependsOn', 0, parameter === null ? 0 : 1);
    // Invert existing type/host sequences, rather than retaining one counter per entity.
    let dependencies = 0;
    for (const rule of this.targetRules.get(entity.kind) ?? []) {
      if (rule.kind !== 'instanceOf' && rule.kind !== 'hostedBy' && rule.kind !== 'supportedBy') continue;
      for (const position of rule.target.positions(entity)) {
        const source = rule.source.at(position);
        const index = this.parameterIndex(source);
        if (index !== null && this.parameter(index).dependency.id === entity.id) dependencies += 1;
      }
    }
    add('parameterDependsOn', dependencies, 0);
    add('externalBinding', 0, this.externalOwners.countAt(entity));
    add('provenance', entity.kind === 'site' ? this.externalOwners.count : 0, this.externalOwners.countAt(entity));
    if (entity.kind === 'typeDefinition') {
      let bindings = 0;
      for (const rule of this.targetRules.get(entity.kind) ?? []) {
        if (rule.kind !== 'instanceOf') continue;
        for (const position of rule.target.positions(entity)) bindings += this.externalOwners.countAt(rule.source.at(position));
      }
      add('externalBinding', bindings, 0);
    }
    return result;
  }
}
