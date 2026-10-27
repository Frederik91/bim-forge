import { isDeepStrictEqual } from 'node:util';
import type { Model, Node } from './contract.ts';

export type Evaluated =
  | { kind: 'position'; elevationMm: number }
  | { kind: 'distance'; distanceMm: number };
export interface State { authored: Node; evaluated: Evaluated }
export interface Snapshot { model: Model; states: State[] }
export interface Delta { id: string; before: State | null; after: State | null }
type Plan = { kind: 'ordered'; nodes: Node[] } | { kind: 'fatal'; diagnostic: string };
type ValueResult = { kind: 'ready'; value: Evaluated }
  | { kind: 'fatal' | 'pending'; diagnostic: string };
export type Evaluation =
  | { kind: 'evaluated'; candidate: Snapshot; delta: Delta[]; evaluationOrder: string[] }
  | { kind: 'fatal' | 'pending'; retained: Snapshot; attemptedDelta: Delta[];
      evaluationOrder: string[]; diagnostic: string };

function dependencies(node: Node): string[] {
  switch (node.kind) {
    case 'level': return [];
    case 'hosted': return [node.hostId];
    case 'dimension': return [node.fromId, node.toId];
    default: { const unreachable: never = node; return unreachable; }
  }
}

function plan(model: Model): Plan {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  if (byId.size !== model.nodes.length) return { kind: 'fatal', diagnostic: 'duplicate-entity-id' };
  for (const [a, b] of model.connectivity) {
    if (!byId.has(a) || !byId.has(b)) return { kind: 'fatal', diagnostic: 'missing-connectivity-endpoint' };
  }
  const ordered: Node[] = [];
  const visited = new Set<string>();
  const active: string[] = [];
  function visit(id: string): string | null {
    if (visited.has(id)) return null;
    if (active.includes(id)) return `dependency-cycle:${[...active, id].join('->')}`;
    const node = byId.get(id);
    if (!node) return `missing-dependency:${id}`;
    active.push(id);
    for (const dependency of dependencies(node).sort()) {
      const error = visit(dependency);
      if (error) return error;
    }
    active.pop();
    visited.add(id);
    ordered.push(node);
    return null;
  }
  for (const id of [...byId.keys()].sort()) {
    const error = visit(id);
    if (error) return { kind: 'fatal', diagnostic: error };
  }
  return { kind: 'ordered', nodes: ordered };
}

function position(states: Map<string, State>, id: string): number | null {
  const value = states.get(id)?.evaluated;
  return value?.kind === 'position' ? value.elevationMm : null;
}

function evaluate(node: Node, states: Map<string, State>): ValueResult {
  switch (node.kind) {
    case 'level': return { kind: 'ready', value: { kind: 'position', elevationMm: node.elevationMm } };
    case 'hosted': {
      if (node.attachment.kind === 'unresolved') {
        return { kind: 'pending', diagnostic: `unresolved-attachment:${node.id}:${node.attachment.reason}` };
      }
      const hostZ = position(states, node.hostId);
      if (hostZ === null) return { kind: 'fatal', diagnostic: `non-positional-host:${node.id}` };
      const elevationMm = hostZ + node.offsetMm;
      if (elevationMm > node.ceilingMm) return { kind: 'fatal', diagnostic: `ceiling-exceeded:${node.id}` };
      return { kind: 'ready', value: { kind: 'position', elevationMm } };
    }
    case 'dimension': {
      const from = position(states, node.fromId);
      const to = position(states, node.toId);
      if (from === null || to === null) return { kind: 'fatal', diagnostic: `non-positional-dimension:${node.id}` };
      return { kind: 'ready', value: { kind: 'distance', distanceMm: Math.abs(to - from) } };
    }
    default: { const unreachable: never = node; return unreachable; }
  }
}

function difference(before: State[], after: State[]): Delta[] {
  const old = new Map(before.map((state) => [state.authored.id, state]));
  const next = new Map(after.map((state) => [state.authored.id, state]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((id) => {
    const previous = old.get(id) ?? null;
    const following = next.get(id) ?? null;
    return isDeepStrictEqual(previous, following) ? [] : [{ id, before: previous, after: following }];
  });
}

// The baseline is never mutated. Only a complete evaluation exposes a candidate.
// A candidate is experimental output, not an engineer's accepted model revision.
export function regenerate(input: { accepted: Snapshot; candidate: Model }): Evaluation {
  const candidate = structuredClone(input.candidate);
  const ordering = plan(candidate);
  if (ordering.kind === 'fatal') return { kind: 'fatal', retained: input.accepted,
    attemptedDelta: [], evaluationOrder: [], diagnostic: ordering.diagnostic };
  const staged = new Map<string, State>();
  const evaluationOrder: string[] = [];
  for (const node of ordering.nodes) {
    evaluationOrder.push(node.id);
    const result = evaluate(node, staged);
    if (result.kind !== 'ready') {
      // Do not report not-yet-evaluated entities as deleted in partial staging.
      const partial = input.accepted.states.map((state) => staged.get(state.authored.id) ?? state);
      const additions = [...staged.values()].filter((state) => !input.accepted.states.some((old) => old.authored.id === state.authored.id));
      return { kind: result.kind, retained: input.accepted,
        attemptedDelta: difference(input.accepted.states, [...partial, ...additions]),
        evaluationOrder, diagnostic: result.diagnostic };
    }
    staged.set(node.id, { authored: node, evaluated: result.value });
  }
  const states = [...staged.values()].sort((a, b) => a.authored.id < b.authored.id ? -1 : a.authored.id > b.authored.id ? 1 : 0);
  return { kind: 'evaluated', candidate: { model: candidate, states },
    delta: difference(input.accepted.states, states), evaluationOrder };
}

export function initialize(model: Model): Snapshot {
  const result = regenerate({ accepted: { model: { nodes: [], connectivity: [] }, states: [] }, candidate: model });
  if (result.kind !== 'evaluated') throw new Error(`Invalid baseline: ${result.diagnostic}`);
  return result.candidate;
}
