import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import { Check } from 'typebox/value';

const count = Type.Integer({ minimum: 1, maximum: 1_000_000_000 });
const CountsSchema = Type.Object({
  site: count, building: count, level: count, space: count, zone: count, system: count,
  typeDefinition: count, wall: count, stud: count, slab: count, roof: count,
  door: count, window: count, chair: count, desk: count, bed: count, cabinet: count,
  otherFurnishing: count, electricalOutlet: count, switch: count, luminaire: count,
  electricalPanel: count, circuit: count, cableSegment: count, ductSegment: count,
  ductFitting: count, pipeSegment: count, pipeFitting: count, pump: count, valve: count,
  terminal: count, sensor: count, containmentSegment: count, equipment: count,
  connectionPort: count,
}, { additionalProperties: false });
export type Kind = keyof Static<typeof CountsSchema>;
export const KINDS: readonly Kind[] = [
  'site', 'building', 'level', 'space', 'zone', 'system', 'typeDefinition', 'wall',
  'stud', 'slab', 'roof', 'door', 'window', 'chair', 'desk', 'bed', 'cabinet',
  'otherFurnishing', 'electricalOutlet', 'switch', 'luminaire', 'electricalPanel',
  'circuit', 'cableSegment', 'ductSegment', 'ductFitting', 'pipeSegment', 'pipeFitting',
  'pump', 'valve', 'terminal', 'sensor', 'containmentSegment', 'equipment', 'connectionPort',
];
export const OCCURRENCE_KINDS = KINDS.filter((kind) => ![
  'site', 'building', 'level', 'space', 'zone', 'system', 'typeDefinition', 'connectionPort',
].includes(kind));

const fraction = Type.Number({ exclusiveMinimum: 0, maximum: 2 });
const CohortSchema = Type.Object({ fraction, valueCount: count });
const ProfileSchema = Type.Object({
  schemaVersion: Type.Literal(1), id: Type.String({ minLength: 1 }),
  seed: Type.String({ minLength: 1 }),
  scope: Type.Object({ buildings: count, levelsPerBuilding: count, spaces: count }),
  inventory: Type.Object({ countsByKind: CountsSchema, targetEntityCount: count,
    connectionPortsAreEntities: Type.Literal(true),
    sharedDefinitionsAndOccurrencesHaveDistinctIdentities: Type.Literal(true) }),
  relationships: Type.Object({ targetCount: count,
    targetToleranceFraction: Type.Number({ minimum: 0, maximum: 1 }), kinds: Type.Array(Type.String()) }),
  properties: Type.Object({ connectionPortCountPerEntity: count,
    typeDefinitionCountPerEntity: count, otherEntitiesTargetMean: count,
    otherEntityCohorts: Type.Array(CohortSchema, { minItems: 1 }),
    estimatedFullPropertyValueCount: count }),
  parametricData: Type.Object({ targetConstraintRecordCount: count, executeGeometrySolver: Type.Literal(false) }),
  geometryAndArtifacts: Type.Object({ renderableGeometry: Type.Literal(false),
    payloadCohorts: Type.Array(Type.Object({ fraction, bytes: Type.Integer({ minimum: 256, maximum: 65_536 }) }), { minItems: 1 }),
    externalArtifactReferences: count }),
  scales: Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), inventoryFraction: fraction }), { minItems: 1 }),
});
export type Profile = Static<typeof ProfileSchema>;

const OptionsSchema = Type.Object({
  scale: Type.String({ minLength: 1 }), seed: Type.Union([Type.String({ minLength: 1, maxLength: 1024 }), Type.Null()]),
  table: Type.Union([Type.Literal('entities'), Type.Literal('relationships'), Type.Literal('parameters'), Type.Literal('manifest')]),
  profile: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type Options = Static<typeof OptionsSchema>;

export function loadProfile(filename: string): { profile: Profile; sha256: string } {
  const bytes = readFileSync(filename);
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (!Check(ProfileSchema, value)) throw new Error('Hospital profile does not satisfy generator v1 TypeBox boundary.');
  const counts = value.inventory.countsByKind;
  if (KINDS.reduce((sum, kind) => sum + counts[kind], 0) !== value.inventory.targetEntityCount
      || value.inventory.targetEntityCount > 20_000_000
      || counts.site !== 1 || counts.building !== value.scope.buildings
      || counts.level !== value.scope.buildings * value.scope.levelsPerBuilding
      || counts.space !== value.scope.spaces) throw new Error('Profile inventory/scope counts disagree.');
  for (const cohorts of [value.properties.otherEntityCohorts, value.geometryAndArtifacts.payloadCohorts]) {
    if (Math.abs(cohorts.reduce((sum, cohort) => sum + cohort.fraction, 0) - 1) > 1e-9) {
      throw new Error('Cohort fractions must sum to one.');
    }
  }
  if (Math.abs(value.properties.otherEntityCohorts.reduce((sum, cohort) => sum + cohort.fraction * cohort.valueCount, 0)
      - value.properties.otherEntitiesTargetMean) > 1e-9) throw new Error('Property cohort mean disagrees with profile.');
  const propertyCounts = [value.properties.connectionPortCountPerEntity, value.properties.typeDefinitionCountPerEntity,
    ...value.properties.otherEntityCohorts.map((cohort) => cohort.valueCount)];
  if (propertyCounts.some((value) => value < 8 || value > 1024)) throw new Error('Property counts must be between 8 and 1024 per entity.');
  return { profile: value, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function parseOptions(argv: readonly string[]): Options {
  const input: Record<string, string | null> = { scale: 'smoke', seed: null, table: 'manifest', profile: 'benchmarks/hospital/profile.json' };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !flag.startsWith('--') || !value || value.startsWith('--')) throw new Error('Expected --option value pairs.');
    const key = flag.slice(2);
    if (!['scale', 'seed', 'table', 'profile'].includes(key) || seen.has(key)) throw new Error(`Unknown or repeated option: ${flag}`);
    seen.add(key);
    input[key] = value;
  }
  if (!Check(OptionsSchema, input)) throw new Error('Invalid generator options.');
  return input;
}

export type EntityRef = { kind: Kind; ordinal: number; id: number };
export type Range = { kind: Kind; start: number; count: number };
export type Domain = 'electrical' | 'air' | 'water';
export const DOMAINS: readonly Domain[] = ['electrical', 'air', 'water'];
export const DOMAIN_KINDS: Readonly<Record<Domain, readonly Kind[]>> = {
  electrical: ['electricalOutlet', 'switch', 'luminaire', 'electricalPanel', 'circuit', 'cableSegment', 'containmentSegment', 'sensor'],
  air: ['ductSegment', 'ductFitting', 'terminal', 'equipment'],
  water: ['pipeSegment', 'pipeFitting', 'pump', 'valve'],
};
export function domainOf(kind: Kind): Domain | null {
  return DOMAINS.find((domain) => DOMAIN_KINDS[domain].includes(kind)) ?? null;
}

export function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function mix(value: number): number {
  let hash = value >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

// Profile decimal fractions are exact allocation controls, not binary64 estimates.
// Compute once per cohort/kind; keep BigInt and decimal parsing out of row generation.
export function cohortUpperBounds(count: number, fractions: readonly number[]): readonly number[] {
  let upper = 0;
  return fractions.map((fraction, index) => {
    if (index === fractions.length - 1) return count;
    const [significand = '0', exponent = '0'] = fraction.toString().split('e');
    const [integer = '0', decimal = ''] = significand.split('.');
    const numerator = BigInt(count) * BigInt(`${integer}${decimal}`);
    const power = Number(exponent) - decimal.length;
    const allocation = power >= 0 ? numerator * 10n ** BigInt(power) : numerator / 10n ** BigInt(-power);
    upper += Number(allocation);
    return upper;
  });
}

export class Dataset {
  readonly profile: Profile;
  readonly profileSha256: string;
  readonly options: Options;
  readonly ranges: ReadonlyMap<Kind, Range>;
  readonly seed: string;
  readonly salt: number;
  readonly fraction: number;
  readonly entityCount: number;
  readonly occurrenceCount: number;
  readonly parameterCount: number;
  readonly payloadPermutationStride: number;
  readonly propertyCohortBounds: ReadonlyMap<Kind, readonly number[]>;
  readonly payloadCohortBounds: readonly number[];
  constructor(profile: Profile, profileSha256: string, options: Options) {
    this.profile = profile;
    this.profileSha256 = profileSha256;
    this.options = options;
    const named = profile.scales.find((scale) => scale.id === options.scale);
    this.fraction = named?.inventoryFraction ?? Number(options.scale);
    if (!Number.isFinite(this.fraction) || this.fraction <= 0 || this.fraction > 2) throw new Error('Scale must be named or a fraction in (0, 2].');
    this.seed = options.seed ?? profile.seed;
    this.salt = hash32(this.seed);
    const counts = { ...profile.inventory.countsByKind };
    for (const kind of KINDS) counts[kind] = Math.max(1, Math.floor(counts[kind] * this.fraction));
    counts.site = 1;
    counts.level = Math.max(counts.level, counts.building);
    counts.space = Math.max(counts.space, counts.level);
    counts.system = Math.max(3, counts.system);
    counts.typeDefinition = Math.max(OCCURRENCE_KINDS.length, counts.typeDefinition);
    const ranges = new Map<Kind, Range>();
    let start = 1;
    for (const kind of KINDS) { ranges.set(kind, { kind, start, count: counts[kind] }); start += counts[kind]; }
    this.ranges = ranges;
    this.entityCount = start - 1;
    const propertyCohorts = new Map<Kind, readonly number[]>();
    const propertyFractions = profile.properties.otherEntityCohorts.map((cohort) => cohort.fraction);
    for (const kind of KINDS) propertyCohorts.set(kind, cohortUpperBounds(counts[kind], propertyFractions));
    this.propertyCohortBounds = propertyCohorts;
    this.payloadCohortBounds = cohortUpperBounds(this.entityCount, profile.geometryAndArtifacts.payloadCohorts.map((cohort) => cohort.fraction));
    this.occurrenceCount = OCCURRENCE_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
    this.parameterCount = Math.min(this.occurrenceCount, Math.max(1, Math.floor(profile.parametricData.targetConstraintRecordCount * this.fraction)));
    const gcd = (a: number, b: number): number => {
      while (b !== 0) { const remainder = a % b; a = b; b = remainder; }
      return a;
    };
    let stride = 65_537;
    while (gcd(stride, this.entityCount) !== 1) stride += 2;
    this.payloadPermutationStride = stride;
  }
  range(kind: Kind): Range {
    const range = this.ranges.get(kind);
    if (!range) throw new Error(`Missing internal kind: ${kind}`);
    return range;
  }
  ref(kind: Kind, ordinal: number): EntityRef { return { kind, ordinal, id: this.range(kind).start + ordinal - 1 }; }
  locate(id: number): EntityRef {
    for (const range of this.ranges.values()) {
      if (id >= range.start && id < range.start + range.count) return this.ref(range.kind, id - range.start + 1);
    }
    throw new Error(`ID outside admitted dataset: ${id}`);
  }
}
