import { entityLevel, levels } from '../src/building-levels.ts';
import type { ModelGraph } from '../src/room-model.ts';
import type { VisualRequest } from '../src/visual-request.ts';

/** Restore the ticket's context before UI filtering can replace its selected object. */
export function requestContext(snapshot: ModelGraph, selectedIds: readonly string[], visual?: VisualRequest) {
  const selected = selectedIds.flatMap(id => {
    const item = snapshot.entities.find(entity => entity.id === id);
    return item ? [item] : [];
  });
  const explicitLevels = selected.filter(item => item.type === 'Level');
  const destination = visual?.kind === 'spatial-reference' ? visual.destination : null;
  const spatialLevel = destination?.kind === 'wall-point' ? entityLevel(snapshot, destination.wallId)
    : destination?.kind === 'floor-point' && destination.levelId ? levels(snapshot).find(level => level.id === destination.levelId) : null;
  const owners = new Set(selected.flatMap(item => {
    const level = entityLevel(snapshot, item); return level ? [level.id] : [];
  }));
  const levelId = explicitLevels.length === 1 ? explicitLevels[0].id : explicitLevels.length > 1 ? null
    : spatialLevel?.id ?? (owners.size === 1 ? [...owners][0] : null);
  const room = selected.find(item => item.type === 'Space' && item.levelId === levelId);
  return { selectedId: selected[0]?.id ?? levelId, levelId, roomId: room?.id ?? null };
}
