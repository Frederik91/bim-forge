import { identifier, projectIdentifier, revisionIdentifier } from './room-model.ts';
import type { EntityId, ProjectId, RevisionId, BranchName } from './room-model.ts';
import { plainScopeData } from './model-scope-contract.ts';
import { Check } from 'typebox/value';
import { DesignTargetSchema, FrozenDesignTargetSchema } from './design-target-contract.ts';

export type WritableDesignTarget = { readonly kind: 'main' }
  | { readonly kind: 'alternative'; readonly id: EntityId };
export type DesignTarget = WritableDesignTarget | { readonly kind: 'baseline'; readonly id: EntityId };
export interface FrozenDesignTarget {
  readonly projectId: ProjectId;
  readonly target: WritableDesignTarget;
  readonly revisionId: RevisionId;
}
export interface DesignBaseline {
  readonly id: EntityId;
  readonly name: string;
  readonly from: FrozenDesignTarget;
}
export interface DesignAlternative {
  readonly id: EntityId;
  readonly name: string;
  readonly baselineId: EntityId;
  readonly revisionId: RevisionId;
}
export interface TargetProposal {
  readonly proposalName: BranchName;
  readonly target: FrozenDesignTarget;
}
export interface DesignTargetsState {
  readonly baselines: readonly DesignBaseline[];
  readonly alternatives: readonly DesignAlternative[];
  readonly proposals: readonly TargetProposal[];
}
export type DesignTargetView = { readonly target: DesignTarget; readonly name: string; readonly revisionId: RevisionId };

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  value = plainScopeData(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid design target fields.');
  }
  return Object.fromEntries(Object.entries(value));
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 80
      || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid design target name.');
  return value;
}
function collection(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 31) throw new Error('Design target history is full.');
  const items: unknown[] = value;
  return items;
}
export function parseDesignTarget(input: unknown): DesignTarget {
  const value = plainScopeData(input);
  if (!Check(DesignTargetSchema, value)) throw new Error('Invalid design target fields.');
  if (value.kind === 'main') return { kind: 'main' };
  return { kind: value.kind, id: identifier(value.id) };
}
export function parseWritableDesignTarget(input: unknown): WritableDesignTarget {
  const target = parseDesignTarget(input);
  if (target.kind === 'baseline') throw new Error('An immutable baseline cannot accept changes.');
  return target;
}
export function parseFrozenDesignTarget(input: unknown): FrozenDesignTarget {
  const value = plainScopeData(input);
  if (!Check(FrozenDesignTargetSchema, value)) throw new Error('Invalid frozen design target fields.');
  return { projectId: projectIdentifier(value.projectId), target: parseWritableDesignTarget(value.target),
    revisionId: revisionIdentifier(value.revisionId) };
}
export function sameDesignTarget(a: WritableDesignTarget, b: WritableDesignTarget): boolean {
  return a.kind === 'main' ? b.kind === 'main' : b.kind === 'alternative' && a.id === b.id;
}
export function parseDesignTargets(input: unknown, parseBranchName: (value: unknown) => BranchName): DesignTargetsState {
  const value = object(input, ['baselines', 'alternatives', 'proposals']);
  const baselines = collection(value.baselines).map(item => {
    const row = object(item, ['id', 'name', 'from']);
    return { id: identifier(row.id), name: name(row.name), from: parseFrozenDesignTarget(row.from) };
  });
  const alternatives = collection(value.alternatives).map(item => {
    const row = object(item, ['id', 'name', 'baselineId', 'revisionId']);
    return { id: identifier(row.id), name: name(row.name), baselineId: identifier(row.baselineId),
      revisionId: revisionIdentifier(row.revisionId) };
  });
  const proposals = collection(value.proposals).map(item => {
    const row = object(item, ['proposalName', 'target']);
    return { proposalName: parseBranchName(row.proposalName), target: parseFrozenDesignTarget(row.target) };
  });
  if (new Set(baselines.map(item => item.id)).size !== baselines.length
      || new Set(alternatives.map(item => item.id)).size !== alternatives.length
      || new Set(proposals.map(item => item.proposalName)).size !== proposals.length) {
    throw new Error('Duplicate design target identity.');
  }
  for (const alternative of alternatives) {
    if (!baselines.some(item => item.id === alternative.baselineId)) throw new Error('Alternative baseline is missing.');
  }
  return { baselines, alternatives, proposals };
}
