import {
  RoomRepository,
  type EntityId,
  type ProjectId,
  type RevisionId,
} from './room-model.ts';

declare const evidenceIdBrand: unique symbol;
declare const assertionIdBrand: unique symbol;
declare const spatialScopeIdBrand: unique symbol;
declare const timestampBrand: unique symbol;

export type EvidenceId = string & { readonly [evidenceIdBrand]: true };
export type AssertionId = string & { readonly [assertionIdBrand]: true };
export type SpatialScopeId = string & { readonly [spatialScopeIdBrand]: true };
export type IsoTimestamp = string & { readonly [timestampBrand]: true };

export type EvidenceAnchor =
  | { readonly kind: 'scope'; readonly scopeId: SpatialScopeId }
  | { readonly kind: 'entity'; readonly entityId: EntityId };

interface EvidenceBase {
  readonly id: EvidenceId;
  readonly label: string;
  readonly capturedAt: IsoTimestamp;
  readonly revisionId: RevisionId;
  readonly anchor: EvidenceAnchor;
}

export type EvidenceItem =
  | (EvidenceBase & { readonly kind: 'photo'; readonly mediaType: 'image/jpeg' })
  | (EvidenceBase & { readonly kind: 'measurement'; readonly instrument: string })
  | (EvidenceBase & { readonly kind: 'note'; readonly author: string })
  | (EvidenceBase & { readonly kind: 'document'; readonly owner: string; readonly sourceUrl: string });

export type EvidenceOrigin =
  | { readonly kind: 'measured' }
  | { readonly kind: 'observed' }
  | { readonly kind: 'documented'; readonly owner: string }
  | { readonly kind: 'inferred'; readonly rationale: string }
  | { readonly kind: 'assumed'; readonly rationale: string };

export interface AssertionCandidate {
  readonly value: string | number;
  readonly unit: 'm' | 'mm' | 'W' | 'text';
  readonly origin: EvidenceOrigin;
  readonly evidenceId: EvidenceId;
}

interface AssertionBase {
  readonly id: AssertionId;
  readonly subjectId: EntityId;
  readonly property: string;
}

export type PropertyAssertion =
  | (AssertionBase & {
    readonly status: 'supported';
    readonly value: string | number;
    readonly unit: 'm' | 'mm' | 'W' | 'text';
    readonly origin: EvidenceOrigin;
    readonly evidenceIds: readonly [EvidenceId, ...EvidenceId[]];
  })
  | (AssertionBase & {
    readonly status: 'conflicting';
    readonly candidates: readonly [AssertionCandidate, AssertionCandidate, ...AssertionCandidate[]];
  })
  | (AssertionBase & { readonly status: 'unknown'; readonly reason: string });

export interface SpatialScope {
  readonly id: SpatialScopeId;
  readonly kind: 'room';
  readonly name: string;
  readonly revisionId: RevisionId;
  readonly entityIds: readonly EntityId[];
}

export interface HousePilotFixture {
  readonly projectId: ProjectId;
  readonly repository: RoomRepository;
  readonly scope: SpatialScope;
  readonly evidence: readonly EvidenceItem[];
  readonly assertions: readonly PropertyAssertion[];
}

export interface FixtureAssessment {
  readonly conflicts: readonly Extract<PropertyAssertion, { status: 'conflicting' }>[];
  readonly unknowns: readonly Extract<PropertyAssertion, { status: 'unknown' }>[];
}

type SupportedAssertion = Extract<PropertyAssertion, { status: 'supported' }>;
type ConflictingAssertion = Extract<PropertyAssertion, { status: 'conflicting' }>;
type UnknownAssertion = Extract<PropertyAssertion, { status: 'unknown' }>;

export interface EntityKnowledge {
  readonly supported: readonly SupportedAssertion[];
  readonly uncertain: readonly SupportedAssertion[];
  readonly conflicting: readonly ConflictingAssertion[];
  readonly unknown: readonly UnknownAssertion[];
}

const semanticId = /^[a-z][a-z0-9-]{0,63}$/;

function isEvidenceId(value: string): value is EvidenceId { return semanticId.test(value); }
function isAssertionId(value: string): value is AssertionId { return semanticId.test(value); }
function isSpatialScopeId(value: string): value is SpatialScopeId { return semanticId.test(value); }
function isTimestamp(value: string): value is IsoTimestamp {
  const parsed = new Date(value);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function evidenceIdentifier(value: string): EvidenceId {
  if (!isEvidenceId(value)) throw new Error('Invalid evidence identity.');
  return value;
}

function assertionIdentifier(value: string): AssertionId {
  if (!isAssertionId(value)) throw new Error('Invalid assertion identity.');
  return value;
}

function scopeIdentifier(value: string): SpatialScopeId {
  if (!isSpatialScopeId(value)) throw new Error('Invalid spatial scope identity.');
  return value;
}

function timestamp(value: string): IsoTimestamp {
  if (!isTimestamp(value)) throw new Error('Invalid evidence timestamp.');
  return value;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function canonicalSnapshot(): unknown {
  return {
    units: 'm',
    entities: [
      { id: 'wall-south', type: 'Wall', name: 'South wall', start: [0, 0], end: [6, 0], thickness: 0.2, height: 3 },
      { id: 'wall-east', type: 'Wall', name: 'East wall', start: [6, 0], end: [6, 4], thickness: 0.2, height: 3 },
      { id: 'wall-north', type: 'Wall', name: 'North wall', start: [6, 4], end: [0, 4], thickness: 0.2, height: 3 },
      { id: 'wall-west', type: 'Wall', name: 'West wall', start: [0, 4], end: [0, 0], thickness: 0.2, height: 3 },
      { id: 'door-entry', type: 'Door', name: 'Entry door', width: 0.9, height: 2.1 },
      { id: 'window-north', type: 'Window', name: 'North window', width: 1.8, height: 1.2, sillHeight: 0.9 },
      {
        id: 'equipment-radiator', type: 'Equipment', name: 'Panel radiator', category: 'mechanical',
        position: [4.2, 3.82], elevation: 0.12, width: 1.2, depth: 0.12, height: 0.6,
      },
      {
        id: 'equipment-panel', type: 'Equipment', name: 'Electrical distribution panel', category: 'electrical',
        position: [0.22, 1.2], elevation: 1.1, width: 0.45, depth: 0.16, height: 0.7,
      },
    ],
    relationships: [
      { id: 'host-entry', type: 'hosted-by', source: 'door-entry', target: 'wall-south', offset: 2.4 },
      { id: 'host-window-north', type: 'hosted-by', source: 'window-north', target: 'wall-north', offset: 2.1 },
    ],
  };
}

export function assessHousePilotFixture(fixture: HousePilotFixture): FixtureAssessment {
  const revision = fixture.repository.view(fixture.scope.revisionId);
  if (fixture.repository.projectId !== fixture.projectId || revision.id !== fixture.scope.revisionId) {
    throw new Error('House Pilot fixture is not bound to its project revision.');
  }
  const entityIds = new Set(revision.snapshot.entities.map((entity) => entity.id));
  if (fixture.scope.entityIds.some((id) => !entityIds.has(id))) throw new Error('Spatial scope references an unknown entity.');
  const evidenceIds = new Set<EvidenceId>();
  for (const item of fixture.evidence) {
    if (evidenceIds.has(item.id) || item.revisionId !== revision.id) throw new Error('Invalid or duplicate fixture evidence.');
    if (item.anchor.kind === 'scope' && item.anchor.scopeId !== fixture.scope.id) throw new Error('Evidence references an unknown scope.');
    if (item.anchor.kind === 'entity' && !entityIds.has(item.anchor.entityId)) throw new Error('Evidence references an unknown entity.');
    if (item.kind === 'document') {
      const url = new URL(item.sourceUrl);
      if (url.protocol !== 'https:') throw new Error('Document evidence requires an HTTPS source.');
    }
    evidenceIds.add(item.id);
  }
  const assertionIds = new Set<AssertionId>();
  for (const assertion of fixture.assertions) {
    if (assertionIds.has(assertion.id) || !entityIds.has(assertion.subjectId)) throw new Error('Invalid or duplicate fixture assertion.');
    if (assertion.status === 'supported' && assertion.evidenceIds.some((id) => !evidenceIds.has(id))) {
      throw new Error('Supported assertion references unknown evidence.');
    }
    if (assertion.status === 'conflicting'
        && assertion.candidates.some((candidate) => !evidenceIds.has(candidate.evidenceId))) {
      throw new Error('Conflicting assertion references unknown evidence.');
    }
    assertionIds.add(assertion.id);
  }
  return freeze({
    conflicts: fixture.assertions.filter((assertion): assertion is Extract<PropertyAssertion, { status: 'conflicting' }> => assertion.status === 'conflicting'),
    unknowns: fixture.assertions.filter((assertion): assertion is Extract<PropertyAssertion, { status: 'unknown' }> => assertion.status === 'unknown'),
  });
}

export function inspectEntityKnowledge(fixture: HousePilotFixture, entityId: EntityId): EntityKnowledge {
  assessHousePilotFixture(fixture);
  const revision = fixture.repository.view(fixture.scope.revisionId);
  if (!revision.snapshot.entities.some((entity) => entity.id === entityId)) {
    throw new Error('Cannot inspect knowledge for an unknown entity.');
  }
  const supported: SupportedAssertion[] = [];
  const uncertain: SupportedAssertion[] = [];
  const conflicting: ConflictingAssertion[] = [];
  const unknown: UnknownAssertion[] = [];
  for (const assertion of fixture.assertions.filter((item) => item.subjectId === entityId)) {
    if (assertion.status === 'conflicting') conflicting.push(assertion);
    else if (assertion.status === 'unknown') unknown.push(assertion);
    else if (assertion.origin.kind === 'inferred' || assertion.origin.kind === 'assumed') uncertain.push(assertion);
    else supported.push(assertion);
  }
  return freeze({ supported, uncertain, conflicting, unknown });
}

export async function createHousePilotFixture(): Promise<HousePilotFixture> {
  const repository = await RoomRepository.createProject({
    projectId: '00000000-0000-4000-8000-000000000075',
    name: 'House Pilot — reference room',
    snapshot: canonicalSnapshot(),
  });
  const revisionId = repository.head('main');
  const snapshot = repository.view(revisionId).snapshot;
  const entityId = (value: string): EntityId => {
    const entity = snapshot.entities.find((item) => item.id === value);
    if (!entity) throw new Error('Canonical fixture entity is missing.');
    return entity.id;
  };
  const scopeId = scopeIdentifier('room-reference');
  const measuredAt = timestamp('2026-10-24T10:00:00.000Z');
  const photographedAt = timestamp('2026-10-24T10:05:00.000Z');
  const documentedAt = timestamp('2026-10-24T10:10:00.000Z');
  const measurement = evidenceIdentifier('evidence-room-measurement');
  const note = evidenceIdentifier('evidence-owner-note');
  const photo = evidenceIdentifier('evidence-north-photo');
  const productDocument = evidenceIdentifier('evidence-radiator-document');
  const evidence: EvidenceItem[] = [
    {
      id: measurement, kind: 'measurement', label: 'Laser room dimensions', instrument: 'Synthetic laser measure',
      capturedAt: measuredAt, revisionId, anchor: { kind: 'scope', scopeId },
    },
    {
      id: note, kind: 'note', label: 'Owner notebook transcription', author: 'Fixture author',
      capturedAt: measuredAt, revisionId, anchor: { kind: 'entity', entityId: entityId('wall-south') },
    },
    {
      id: photo, kind: 'photo', label: 'North wall reference photograph', mediaType: 'image/jpeg',
      capturedAt: photographedAt, revisionId, anchor: { kind: 'entity', entityId: entityId('window-north') },
    },
    {
      id: productDocument, kind: 'document', label: 'Panel radiator product sheet', owner: 'Fixture manufacturer',
      sourceUrl: 'https://fixtures.invalid/house-pilot/radiator-product-sheet.pdf',
      capturedAt: documentedAt, revisionId, anchor: { kind: 'entity', entityId: entityId('equipment-radiator') },
    },
  ];
  const assertions: PropertyAssertion[] = [
    {
      id: assertionIdentifier('assertion-window-sill'), status: 'supported', subjectId: entityId('window-north'),
      property: 'geometry.sillHeight', value: 900, unit: 'mm', origin: { kind: 'observed' }, evidenceIds: [photo],
    },
    {
      id: assertionIdentifier('assertion-radiator-product'), status: 'supported', subjectId: entityId('equipment-radiator'),
      property: 'product.source', value: 'Panel radiator product sheet', unit: 'text',
      origin: { kind: 'documented', owner: 'Fixture manufacturer' }, evidenceIds: [productDocument],
    },
    {
      id: assertionIdentifier('assertion-south-wall-construction'), status: 'supported', subjectId: entityId('wall-south'),
      property: 'construction.system', value: 'Timber frame', unit: 'text',
      origin: { kind: 'inferred', rationale: 'Inferred from the observed wall thickness and the stated building age.' },
      evidenceIds: [note],
    },
    {
      id: assertionIdentifier('assertion-radiator-output'), status: 'supported', subjectId: entityId('equipment-radiator'),
      property: 'mechanical.nominalOutput', value: 800, unit: 'W',
      origin: { kind: 'assumed', rationale: 'Placeholder capacity until the exact installed product is matched.' },
      evidenceIds: [productDocument],
    },
    {
      id: assertionIdentifier('assertion-south-wall-length'), status: 'conflicting', subjectId: entityId('wall-south'),
      property: 'geometry.length', candidates: [
        { value: 6, unit: 'm', origin: { kind: 'measured' }, evidenceId: measurement },
        { value: 5.98, unit: 'm', origin: { kind: 'observed' }, evidenceId: note },
      ],
    },
    {
      id: assertionIdentifier('assertion-panel-circuit'), status: 'unknown', subjectId: entityId('equipment-panel'),
      property: 'electrical.circuit', reason: 'The panel schedule is not yet available.',
    },
  ];
  const fixture: HousePilotFixture = freeze({
    projectId: repository.projectId,
    repository,
    scope: {
      id: scopeId, kind: 'room', name: 'Reference room', revisionId,
      entityIds: snapshot.entities.map((entity) => entity.id),
    },
    evidence,
    assertions,
  });
  assessHousePilotFixture(fixture);
  return fixture;
}
