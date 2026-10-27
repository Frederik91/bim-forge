import { assetFixtureEdit } from '../../src/asset-fixture.ts';
import { RoomRepository, diffSnapshots, identifier, previewAssets, previewFurnishings, validateSnapshot } from '../../src/room-model.ts';
import type { Entity, Furniture, ModelSnapshot } from '../../src/room-model.ts';

const PROJECT_ID = '00000000-0000-4000-8000-000000000124';

export function furniture(input: { id: string; kind: Furniture['kind']; position: Furniture['position'];
  width?: number; depth?: number; height?: number }): Furniture {
  return { id: identifier(input.id), type: 'Furniture', name: input.kind,
    kind: input.kind, position: input.position, width: input.width ?? .4,
    depth: input.depth ?? .4, height: input.height ?? .8, rotationDeg: 0, supportId: null };
}

export async function fixture(kind: 'furniture' | 'assets' | 'shell' = 'furniture'): Promise<RoomRepository> {
  const source = await RoomRepository.create('W1 baseline source fixture');
  const shell = source.view(source.head('main')).snapshot;
  const snapshot = kind === 'assets' ? previewAssets(shell, assetFixtureEdit()) : kind === 'shell' ? shell
    : previewFurnishings(shell, { furnishings: [
      furniture({ id: 'desk-one', kind: 'desk', position: [1, 2], width: 1, depth: .6 }),
      furniture({ id: 'bed-one', kind: 'bed', position: [4.5, 2.5], width: 1.2, depth: 1.8, height: .6 }),
      furniture({ id: 'chair-one', kind: 'chair', position: [1, 3.2] }),
      furniture({ id: 'chair-two', kind: 'chair', position: [2.2, 3.2] }),
    ] });
  return RoomRepository.createProject({ projectId: PROJECT_ID, name: 'W1 deterministic baseline', snapshot });
}

export const current = (repo: RoomRepository): ModelSnapshot => repo.view(repo.head('main')).snapshot;

export function entity(snapshot: ModelSnapshot, id: string): Entity {
  const found = snapshot.entities.find((item) => item.id === id);
  if (!found) throw new Error(`Fixture entity missing: ${id}`);
  return found;
}

export function change(snapshot: ModelSnapshot, id: string, edit: (item: Entity) => Entity): ModelSnapshot {
  entity(snapshot, id);
  return validateSnapshot({ ...snapshot, entities: snapshot.entities.map((item) => item.id === id ? edit(item) : item) });
}

export function move(snapshot: ModelSnapshot, id: string, position: Furniture['position']): ModelSnapshot {
  return change(snapshot, id, (item) => {
    if (item.type !== 'Furniture') throw new Error('Move fixture requires furniture.');
    return { ...item, position };
  });
}

export async function propose(repo: RoomRepository, name: string, snapshot: ModelSnapshot,
  assumptions: string[] = []): Promise<RoomRepository> {
  const base = current(repo);
  const delta = diffSnapshots(base, snapshot);
  const selectedObjectIds = [...delta.entities.modified.map((item) => item.id), ...delta.entities.removed.map((item) => item.id)];
  return repo.proposeReviewedModel({ name, from: repo.head('main'), snapshot, review: {
    requestId: `w1-${name}`, selectedObjectIds: selectedObjectIds.length ? selectedObjectIds : ['door-entry'],
    instruction: 'Execute this disposable W1 deterministic fixture operation.',
    summary: 'W1 baseline fixture operation.', rationale: 'Observe the real room repository API.',
    constraints: 'Disposable qualification data only; no human approval is represented.',
    uncertainty: 'No external engine or AI worker was executed.',
    worker: { provider: 'qualification-fixture', model: 'deterministic-no-ai', responseIds: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    toolCalls: [{ name: 'inspect_model', status: 'accepted', error: null }],
    validator: 'room-graph-v1', intent: { interpretation: 'W1 fixture operation.', assumptions,
      certainty: 100, basis: 'Fixed fixture parameters; certainty is not approval.' },
  } });
}

export const decision = (name: string) => ({ decisionId: `w1-fixture-${name}`, actor: 'W1 fixture actor - not human approval' });

export type Attempt<T> = { kind: 'returned'; value: T } | { kind: 'rejected'; error: { name: string; message: string } };
export async function attempt<T>(operation: () => T | Promise<T>): Promise<Attempt<T>> {
  try { return { kind: 'returned', value: await operation() }; }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'rejected', error: { name: error.name, message: error.message } };
  }
}

export function inspectAttempt(outcome: Attempt<RoomRepository>): unknown {
  return outcome.kind === 'rejected' ? outcome : { kind: outcome.kind, repository: outcome.value.serialize() };
}
