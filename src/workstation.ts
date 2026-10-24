import { rectangleLayout, previewFurnishings, furnitureFootprint } from './room-model.ts';
import type { EntityId, Furniture, ModelSnapshot, Point, Wall } from './room-model.ts';

export interface Workstation {
  readonly desk: Furniture;
  readonly members: readonly Furniture[];
  readonly chair: Furniture | null;
}
export type WorkstationSelection =
  | { kind: 'ready'; group: Workstation }
  | { kind: 'unavailable'; reason: string };
export interface WorkstationWallMove {
  readonly kind: 'workstation-wall-move';
  readonly deskId: EntityId;
  readonly memberIds: readonly EntityId[];
  readonly targetWallId: EntityId;
  readonly alongWallMm: number;
}

export function discoverWorkstation(snapshot: ModelSnapshot, deskId: string): WorkstationSelection {
  const desk = snapshot.entities.find((item) => item.id === deskId);
  if (desk?.type !== 'Furniture' || desk.kind !== 'desk') return { kind: 'unavailable', reason: 'Select a desk to move its workstation.' };
  const desks = snapshot.entities.filter((item): item is Furniture => item.type === 'Furniture' && item.kind === 'desk');
  const distance = (a: Furniture, b: Furniture): number => Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
  const nearbyChairs = snapshot.entities.filter((item): item is Furniture => item.type === 'Furniture' && item.kind === 'chair' && distance(item, desk) <= 2.5);
  const chairs = nearbyChairs.filter((item) => !desks.some((other) => other.id !== desk.id && distance(item, other) < distance(item, desk) + .3))
    .sort((a, b) => distance(a, desk) - distance(b, desk) || a.id.localeCompare(b.id));
  if (!chairs.length && nearbyChairs.some((item) => desks.some((other) => other.id !== desk.id && Math.abs(distance(item, other) - distance(item, desk)) < .3))) {
    return { kind: 'unavailable', reason: 'A nearby chair could belong to another desk. Ask AI to clarify the workstation before moving it.' };
  }
  if (chairs[0] && chairs[1] && distance(chairs[1], desk) - distance(chairs[0], desk) < .3) {
    return { kind: 'unavailable', reason: 'Several chairs could belong to this desk. Ask AI to clarify the workstation before moving it.' };
  }
  const chair = chairs[0] ?? null;
  const devices = snapshot.entities.filter((item): item is Furniture => item.type === 'Furniture' && item.supportId === desk.id);
  const members = [desk, ...devices, ...(chair ? [chair] : [])].sort((a, b) => a.id.localeCompare(b.id));
  if (members.length > 16) return { kind: 'unavailable', reason: 'This workstation exceeds the 16-object request limit.' };
  return { kind: 'ready', group: { desk, members, chair } };
}

export function wallFrame(snapshot: ModelSnapshot, wallId: string): { wall: Wall; inward: Point; lengthMm: number } {
  const bounds = rectangleLayout(snapshot).boundsMm;
  const wall = snapshot.entities.find((item) => item.id === wallId);
  if (wall?.type !== 'Wall') throw new Error('The workstation destination must identify a wall in this revision.');
  const midX = Math.round((wall.start[0] + wall.end[0]) * 500);
  const midY = Math.round((wall.start[1] + wall.end[1]) * 500);
  const inward: Point = wall.start[0] === wall.end[0]
    ? [midX === bounds.minX ? 1 : -1, 0] : [0, midY === bounds.minY ? 1 : -1];
  return { wall, inward, lengthMm: Math.round(Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) * 1000) };
}

export function workstationIntent(snapshot: ModelSnapshot, deskId: string, wallId: string, alongWallMm: number): WorkstationWallMove {
  const selection = discoverWorkstation(snapshot, deskId);
  if (selection.kind !== 'ready') throw new Error(selection.reason);
  const { wall, lengthMm } = wallFrame(snapshot, wallId);
  if (!Number.isSafeInteger(alongWallMm) || alongWallMm < 0 || alongWallMm > lengthMm) throw new Error('Wall destination must be whole millimetres within the wall span.');
  return { kind: 'workstation-wall-move', deskId: selection.group.desk.id,
    memberIds: selection.group.members.map((item) => item.id), targetWallId: wall.id, alongWallMm };
}

export function parseWorkstationIntent(snapshot: ModelSnapshot, value: unknown): WorkstationWallMove {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workstation move intent.');
  const keys = Object.keys(value);
  if (keys.length !== 5 || !['kind', 'deskId', 'memberIds', 'targetWallId', 'alongWallMm'].every((key) => Object.hasOwn(value, key))) throw new Error('Unexpected workstation intent fields.');
  if (!('kind' in value) || value.kind !== 'workstation-wall-move' || !('deskId' in value) || typeof value.deskId !== 'string'
      || !('targetWallId' in value) || typeof value.targetWallId !== 'string' || !('alongWallMm' in value) || typeof value.alongWallMm !== 'number'
      || !('memberIds' in value) || !Array.isArray(value.memberIds)) throw new Error('Invalid workstation move intent.');
  const intent = workstationIntent(snapshot, value.deskId, value.targetWallId, value.alongWallMm);
  if (value.memberIds.length !== intent.memberIds.length || value.memberIds.some((id, index) => id !== intent.memberIds[index])) {
    throw new Error('Workstation membership is stale or does not match its desk supports and chair.');
  }
  return intent;
}

const quarterTurn = (degrees: number): Furniture['rotationDeg'] => {
  const value = ((degrees % 360) + 360) % 360;
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) throw new Error('Workstation rotation must use quarter turns.');
  return value;
};

/** Intent-only transform. The UI draws this as a ghost; only the preview tool validates model geometry. */
export function workstationGhost(snapshot: ModelSnapshot, intent: WorkstationWallMove, wallGapMm = 150): ModelSnapshot {
  const selection = discoverWorkstation(snapshot, intent.deskId);
  if (selection.kind !== 'ready') throw new Error(selection.reason);
  const { desk, chair, members } = selection.group;
  const { wall, inward, lengthMm } = wallFrame(snapshot, intent.targetWallId);
  const source: Point = chair ? [desk.position[0] - chair.position[0], desk.position[1] - chair.position[1]]
    : [-Math.sin(desk.rotationDeg * Math.PI / 180), Math.cos(desk.rotationDeg * Math.PI / 180)];
  const sourceAngle = Math.abs(source[0]) > Math.abs(source[1]) ? source[0] > 0 ? 0 : 180 : source[1] > 0 ? 90 : 270;
  const targetAngle = inward[0] !== 0 ? inward[0] > 0 ? 180 : 0 : inward[1] > 0 ? 270 : 90;
  const rotation = quarterTurn(targetAngle - sourceAngle);
  const angle = rotation * Math.PI / 180;
  const rotate = ([x, y]: Point): Point => [Math.round((x * Math.cos(angle) - y * Math.sin(angle)) * 1000) / 1000,
    Math.round((x * Math.sin(angle) + y * Math.cos(angle)) * 1000) / 1000];
  const rotatedDesk = { ...desk, rotationDeg: quarterTurn(desk.rotationDeg + rotation), position: [0, 0] satisfies Point };
  const footprint = furnitureFootprint(rotatedDesk);
  const halfDepth = inward[0] !== 0 ? footprint.maxX : footprint.maxY;
  const gap = wall.thickness / 2 + wallGapMm / 1000 + halfDepth;
  const t = intent.alongWallMm / lengthMm;
  const position: Point = [Math.round((wall.start[0] + (wall.end[0] - wall.start[0]) * t + inward[0] * gap) * 1000) / 1000,
    Math.round((wall.start[1] + (wall.end[1] - wall.start[1]) * t + inward[1] * gap) * 1000) / 1000];
  const ids = new Set(members.map((item) => item.id));
  return { ...snapshot, entities: snapshot.entities.map((item) => {
    if (item.type !== 'Furniture' || !ids.has(item.id)) return item;
    const offset = rotate([item.position[0] - desk.position[0], item.position[1] - desk.position[1]]);
    return { ...item, position: [Math.round((position[0] + offset[0]) * 1000) / 1000, Math.round((position[1] + offset[1]) * 1000) / 1000], rotationDeg: quarterTurn(item.rotationDeg + rotation) };
  }) };
}

export function previewWorkstationMove(snapshot: ModelSnapshot, intent: WorkstationWallMove, input: unknown): ModelSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2
      || !('alongWallMm' in input) || typeof input.alongWallMm !== 'number' || !('wallGapMm' in input) || typeof input.wallGapMm !== 'number'
      || !Number.isSafeInteger(input.wallGapMm) || input.wallGapMm < 100 || input.wallGapMm > 600) throw new Error('Provide alongWallMm and a wallGapMm from 100 through 600.');
  const target = workstationIntent(snapshot, intent.deskId, intent.targetWallId, input.alongWallMm);
  const ghost = workstationGhost(snapshot, target, input.wallGapMm);
  return previewFurnishings(snapshot, { furnishings: ghost.entities.filter((item) => item.type === 'Furniture') });
}
