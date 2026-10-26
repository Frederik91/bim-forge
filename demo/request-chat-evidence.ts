import { entityElevation, levels } from '../src/building-levels.ts';
import type { ModelGraph } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';
import type { ConversationVisual } from '../src/request-conversation.ts';
import { parseConversationReply } from '../src/request-conversation.ts';

type SnapshotBinding = ConversationVisual['snapshot'];

/** A visual attachment names the exact displayed snapshot; it never grants write access. */
export function captureConversationVisual(input: {
  graph: ModelGraph; snapshot: SnapshotBinding; view: '2d' | '3d'; levelId: string | null;
  selectedObjectIds: readonly string[]; reference: SpatialReference | null;
}): ConversationVisual {
  const { graph, reference } = input;
  const selectedObjectIds = [...new Set(input.selectedObjectIds)];
  if (selectedObjectIds.some(id => !graph.entities.some(entity => entity.id === id))) throw new Error('The selected object is absent from this snapshot. Select it again before attaching.');
  if (input.levelId && !levels(graph).some(level => level.id === input.levelId)) throw new Error('The selected level is absent from this snapshot.');
  const annotations: ConversationVisual['annotations'] = [];
  if (reference?.kind === 'floor-point') {
    const level = reference.levelId ? levels(graph).find(item => item.id === reference.levelId) : null;
    if (graph.version === 2 && !level) throw new Error('Choose the annotation storey before attaching a building pin.');
    annotations.push({ kind: 'pin', position: [reference.positionMm[0] / 1000, reference.positionMm[1] / 1000, level?.elevation ?? 0], label: 'Marked floor location' });
  } else if (reference?.kind === 'wall-point') {
    const wall = graph.entities.find(item => item.id === reference.wallId);
    if (wall?.type !== 'Wall') throw new Error('The annotation wall is absent from this snapshot.');
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const fraction = reference.alongWallMm / (length * 1000);
    if (fraction < 0 || fraction > 1 || !Number.isFinite(fraction)) throw new Error('The annotation lies outside its wall.');
    annotations.push({ kind: 'pin', position: [wall.start[0] + (wall.end[0] - wall.start[0]) * fraction,
      wall.start[1] + (wall.end[1] - wall.start[1]) * fraction, entityElevation(graph, wall)], label: `Marked wall location: ${wall.name}` });
  }
  const visual: ConversationVisual = { snapshot: input.snapshot, view: input.view, levelId: input.levelId, selectedObjectIds, annotations };
  return parseConversationReply({ messageId: 'capture', expectedSequence: 0, baseRevisionId: input.snapshot.revisionId, text: 'Visual evidence', sources: [], visual }).visual ?? visual;
}

export function requireCurrentVisual(visual: ConversationVisual, current: SnapshotBinding): void {
  if (visual.snapshot.kind !== current.kind || visual.snapshot.revisionId !== current.revisionId
      || visual.snapshot.kind === 'proposal' && (current.kind !== 'proposal' || visual.snapshot.proposalName !== current.proposalName)) {
    throw new Error('This attachment belongs to another displayed snapshot. Inspect or remove it, then capture the current view.');
  }
}

export function visualLabel(visual: ConversationVisual): string {
  const snapshot = visual.snapshot.kind === 'accepted' ? 'Accepted model' : `Proposal ${visual.snapshot.proposalName}`;
  return `${snapshot} · ${visual.snapshot.revisionId.slice(0, 10)} · ${visual.view === '2d' ? '2D plan' : '3D'}${visual.levelId ? ` · ${visual.levelId}` : ''}`;
}
