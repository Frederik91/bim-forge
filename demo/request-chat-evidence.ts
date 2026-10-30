import { entityElevation, entityLevel, levels } from '../src/building-levels.ts';
import type { ModelGraph } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';
import type { ConversationVisual } from '../src/request-conversation.ts';
import { parseConversationReply } from '../src/request-conversation.ts';
import type { FrozenModelScope } from '../src/model-scope-contract.ts';
import { entitySpace } from '../src/floor-plan.ts';
import { requestContext } from './request-context.ts';
import { parseSpatialMarkup, spatialMarkupDescription } from '../src/spatial-markup.ts';
import type { SpatialMarkup } from '../src/spatial-markup.ts';

type SnapshotBinding = ConversationVisual['snapshot'];

/** Opening a conversation restores identities against the displayed model, not the last browsing selection. */
export function conversationSelection(input: { graph: ModelGraph; selectedObjectIds: readonly string[];
  visual?: ConversationVisual; scope?: FrozenModelScope }) {
  const context = requestContext(input.graph, input.selectedObjectIds, undefined, input.scope);
  const selected = input.graph.entities.find(entity => entity.id === context.selectedId);
  return { ...context, roomId: context.roomId ?? (selected ? entitySpace(input.graph, selected)?.id ?? null : null),
    view: input.visual?.view ?? null };
}

/** A retained marker is an inspection overlay, never an authored request draft. */
export function conversationInspection(graph: ModelGraph, visual: ConversationVisual): {
  kind: 'inspection'; snapshot: SnapshotBinding; reference: SpatialReference | null;
  context: ReturnType<typeof conversationSelection>;
  annotations: ConversationVisual['annotations'];
} {
  if (visual.selectedObjectIds.some(id => !graph.entities.some(entity => entity.id === id))) throw new Error('The stored selection is absent from its bound snapshot.');
  const context = conversationSelection({ graph, selectedObjectIds: visual.selectedObjectIds, visual });
  const level = visual.levelId ? levels(graph).find(candidate => candidate.id === visual.levelId) : null;
  if (visual.levelId && !level) throw new Error('The stored annotation level is absent from its bound snapshot.');
  const levelId = level?.id ?? context.levelId;
  const pin = visual.annotations.find(annotation => annotation.kind === 'pin');
  if (pin && graph.version === 2 && !levelId) throw new Error('The stored building pin has no bound storey.');
  const reference: SpatialReference | null = pin ? levelId
    ? { kind: 'floor-point', levelId, positionMm: [Math.round(pin.position[0] * 1000), Math.round(pin.position[1] * 1000)] }
    : { kind: 'floor-point', positionMm: [Math.round(pin.position[0] * 1000), Math.round(pin.position[1] * 1000)] } : null;
  return { kind: 'inspection', snapshot: structuredClone(visual.snapshot), reference, context: { ...context, levelId }, annotations: structuredClone(visual.annotations) };
}

/** A visual attachment names the exact displayed snapshot; it never grants write access. */
export function captureConversationVisual(input: {
  graph: ModelGraph; snapshot: SnapshotBinding; view: '2d' | '3d'; levelId: string | null;
  selectedObjectIds: readonly string[]; reference: SpatialReference | null;
  markups?: readonly SpatialMarkup[];
}): ConversationVisual {
  const { graph, reference } = input;
  const selectedObjectIds = [...new Set(input.selectedObjectIds)];
  if (selectedObjectIds.some(id => !graph.entities.some(entity => entity.id === id))) throw new Error('The selected object is absent from this snapshot. Select it again before attaching.');
  if (input.levelId && !levels(graph).some(level => level.id === input.levelId)) throw new Error('The selected level is absent from this snapshot.');
  let levelId = input.levelId;
  const annotations: ConversationVisual['annotations'] = [];
  if (reference?.kind === 'floor-point') {
    const level = reference.levelId ? levels(graph).find(item => item.id === reference.levelId) : null;
    if (graph.version === 2 && !level) throw new Error('Choose the annotation storey before attaching a building pin.');
    if (level && levelId && level.id !== levelId) throw new Error('The marker belongs to another storey. Mark a new location in the current view.');
    levelId ??= level?.id ?? null;
    annotations.push({ kind: 'pin', position: [reference.positionMm[0] / 1000, reference.positionMm[1] / 1000, level?.elevation ?? 0], label: 'Marked floor location' });
  } else if (reference?.kind === 'wall-point') {
    const wall = graph.entities.find(item => item.id === reference.wallId);
    if (wall?.type !== 'Wall') throw new Error('The annotation wall is absent from this snapshot.');
    const owner = entityLevel(graph, wall);
    if (owner && levelId && owner.id !== levelId) throw new Error('The marker belongs to another storey. Mark a new location in the current view.');
    levelId ??= owner?.id ?? null;
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const fraction = reference.alongWallMm / (length * 1000);
    if (fraction < 0 || fraction > 1 || !Number.isFinite(fraction)) throw new Error('The annotation lies outside its wall.');
    annotations.push({ kind: 'pin', position: [wall.start[0] + (wall.end[0] - wall.start[0]) * fraction,
      wall.start[1] + (wall.end[1] - wall.start[1]) * fraction, entityElevation(graph, wall)], label: `Marked wall location: ${wall.name}` });
  }
  annotations.push(...(input.markups ?? []).map(markup => structuredClone(parseSpatialMarkup(markup))));
  const visual: ConversationVisual = { snapshot: input.snapshot, view: input.view, levelId, selectedObjectIds, annotations };
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

export function conversationMarkups(visual: Pick<ConversationVisual, 'annotations'> | null | undefined): SpatialMarkup[] {
  return visual?.annotations.filter(annotation => annotation.kind !== 'pin' && annotation.kind !== 'arrow') ?? [];
}

export function annotationDescription(annotation: ConversationVisual['annotations'][number]): string {
  if (annotation.kind === 'pin') return `● ${annotation.label}: ${annotation.position.join(', ')} m`;
  if (annotation.kind === 'arrow') return `↗ ${annotation.label}: ${annotation.from.join(', ')} → ${annotation.to.join(', ')} m`;
  const location = annotation.kind === 'circle' ? `Centre ${annotation.center.join(', ')} m`
    : annotation.kind === 'rectangle' ? `Corners ${annotation.corners.map(point => `(${point.join(', ')})`).join(' ')} m`
    : annotation.kind === 'line' ? `${annotation.from.join(', ')} → ${annotation.to.join(', ')} m` : annotation.points.map(point => `(${point.join(', ')})`).join(' → ') + ' m';
  return `${spatialMarkupDescription(annotation)} · ${location} · approximate user intent`;
}
