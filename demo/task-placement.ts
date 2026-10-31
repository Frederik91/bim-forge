import { isDeepStrictEqual } from 'node:util';
import type { GeometryRef } from '../src/geometry-contract.ts';
import type { PlacedTask, TaskPlacement } from '../src/task-placement.ts';
import type { RoomRepository } from '../src/room-model.ts';
import type { GeometryReadSnapshot } from '../src/geometry-evidence.ts';
import { geometryDigest } from '../src/geometry-query.ts';

export type TaskPinResolution = { status: 'current' | 'stale' | 'missing' | 'unavailable'; detail: string };
export type TaskPlacementResolution = { kind: 'unplaced' } | { kind: 'placed'; origin: TaskPinResolution;
  objects: TaskPinResolution[]; regions: TaskPinResolution[]; requiresRecovery: boolean };
const current: TaskPinResolution = { status: 'current', detail: 'The exact pinned context is current.' };

/** Resolves exact identities only; correspondence never substitutes another source or revision. */
export function resolveTaskPlacement(placement: TaskPlacement, repository: RoomRepository,
  linked?: GeometryReadSnapshot): TaskPlacementResolution {
  if (placement.kind === 'unplaced') return { kind: 'unplaced' };
  const snapshot = (pin: PlacedTask['origin']['snapshot']): TaskPinResolution => {
    if (pin.projectId !== repository.projectId) return { status: 'missing', detail: 'The project does not match.' };
    try {
      return repository.freezeDesignTarget(pin.target).revisionId === pin.revisionId ? current
        : { status: 'stale', detail: 'The pinned design revision is historical. Refresh context explicitly.' };
    } catch { return { status: 'missing', detail: 'The pinned design is unavailable.' }; }
  };
  const ref = (pin: GeometryRef): TaskPinResolution => {
    if (pin.projectId !== repository.projectId) return { status: 'missing', detail: 'The object belongs to another project.' };
    if (pin.kind === 'native') {
      try {
        const head = repository.freezeDesignTarget(pin.target).revisionId;
        if (!repository.view(head).snapshot.entities.some(entity => entity.id === pin.entityId)) return { status: 'missing', detail: 'The native target is missing; its historical identity is retained.' };
        return head === pin.revisionId ? current : { status: 'stale', detail: 'The native target revision changed.' };
      } catch { return { status: 'missing', detail: 'The native target design is unavailable.' }; }
    }
    if (!linked) return { status: 'unavailable', detail: 'Linked source verification is unavailable.' };
    const source = linked.input.linked?.find(item => item.manifest.source.namespace === pin.namespace && item.manifest.occurrence.id === pin.occurrenceId);
    if (!source) return { status: linked.input.unavailableSources?.length ? 'unavailable' : 'missing', detail: 'The linked occurrence is unavailable; the exact pin is retained.' };
    if (source.manifest.source.revision !== pin.revision || source.manifest.source.originalSha256 !== pin.originalSha256
        || geometryDigest(source.manifest.occurrence.sourceToProjectMetres) !== pin.placementDigest) return { status: 'stale', detail: 'The linked source revision, bytes, or occurrence placement changed.' };
    return source.index.objects.some(object => object.ref.globalId === pin.globalId) ? current
      : { status: 'missing', detail: 'The linked object is missing from its pinned source.' };
  };
  const combine = (a: TaskPinResolution, b?: TaskPinResolution): TaskPinResolution => a.status !== 'current' ? a : b ?? a;
  const origin = combine(snapshot(placement.origin.snapshot), placement.origin.source ? ref(placement.origin.source) : undefined);
  const objects = placement.targets.objects.map(ref);
  const regions = placement.targets.regions.map(region => combine(snapshot(region.snapshot), region.source ? ref(region.source) : undefined));
  return { kind: 'placed', origin, objects, regions, requiresRecovery: [...objects, ...regions].some(item => item.status !== 'current') };
}

export function assertTaskPlacementBinding(placement: TaskPlacement, input: {
  repository: RoomRepository; baseRevisionId: string; target: PlacedTask['origin']['snapshot']['target']; selectedObjectIds: readonly string[];
}): void {
  if (placement.kind === 'unplaced') return;
  const { repository, baseRevisionId, target } = input;
  const assertSnapshot = (pin: PlacedTask['origin']['snapshot']): void => {
    if (pin.projectId !== repository.projectId || pin.revisionId !== baseRevisionId || !isDeepStrictEqual(pin.target, target)) throw new Error('Task placement must bind the authoritative project, design and current request base.');
  };
  assertSnapshot(placement.origin.snapshot);
  const refs = [...placement.targets.objects, ...placement.targets.regions.flatMap(region => region.source ? [region.source] : []), ...(placement.origin.source ? [placement.origin.source] : [])];
  for (const pin of refs) {
    if (pin.projectId !== repository.projectId) throw new Error('Task geometry references must belong to this project.');
    if (pin.kind === 'native') {
      if (pin.revisionId !== baseRevisionId || !isDeepStrictEqual(pin.target, target)) throw new Error('Task native targets must bind the current request design and base.');
      if (!repository.view(baseRevisionId).snapshot.entities.some(entity => entity.id === pin.entityId)) throw new Error('Task placement references a missing native object.');
    }
  }
  placement.targets.regions.forEach(region => assertSnapshot(region.snapshot));
  const nativeIds = placement.targets.objects.flatMap(ref => ref.kind === 'native' ? [ref.entityId] : []).sort();
  if (!isDeepStrictEqual(nativeIds, [...input.selectedObjectIds].sort())) throw new Error('Explicit native task targets must match the request selection; region-only tasks require zero selected IDs.');
  if (placement.origin.levelId && !repository.view(baseRevisionId).snapshot.entities.some(entity => entity.id === placement.origin.levelId && entity.type === 'Level')) throw new Error('Task creation level must name a Level in the bound snapshot.');
}
