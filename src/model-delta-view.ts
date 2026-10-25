import { diffSnapshots } from './room-model.ts';
import { entityElevation } from './building-levels.ts';
import { slabPieces, wallSections } from './viewer-geometry.ts';
import type { Entity, ModelSnapshot } from './room-model.ts';

interface ChangeIdentity { id: string; name: string; reason: 'object' | 'placement' }
export type ModelChange = ChangeIdentity & (
  | { status: 'added'; before: null; after: Entity }
  | { status: 'modified'; before: Entity; after: Entity }
  | { status: 'removed'; before: Entity; after: null }
);

function derivedGeometry(snapshot: ModelSnapshot, id: string) {
  const item = snapshot.entities.find((entity) => entity.id === id);
  if (!item) return null;
  const base = entityElevation(snapshot, item);
  if (item.type === 'Stair') return { base, upper: entityElevation(snapshot, item.toLevelId) };
  if (item.type === 'Slab') return { base, pieces: slabPieces(snapshot, item) };
  if (item.type === 'Furniture') {
    const support = snapshot.entities.find((entity) => entity.id === item.supportId);
    return { base, supportHeight: support?.type === 'Furniture' ? support.height : 0 };
  }
  if (item.type === 'Door' || item.type === 'Window') {
    const host = snapshot.relationships.find((link) => link.source === item.id);
    const wall = snapshot.entities.find((entity) => entity.id === host?.target);
    return wall?.type === 'Wall' && host ? { base, host: wall.id, offset: host.offset, start: wall.start, end: wall.end, thickness: wall.thickness } : null;
  }
  if (item.type === 'Wall') {
    const openings = snapshot.relationships.filter((link) => link.target === item.id).flatMap((link) => {
      const opening = snapshot.entities.find((entity) => entity.id === link.source);
      return opening?.type === 'Door' || opening?.type === 'Window'
        ? [{ id: opening.id, offset: link.offset, width: opening.width, height: opening.height, bottom: opening.type === 'Window' ? opening.sillHeight : 0 }] : [];
    }).sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
    const solids = []; let cursor = 0;
    for (const opening of openings) {
      solids.push(...wallSections(snapshot, item, cursor, opening.offset, 0, item.height),
        ...wallSections(snapshot, item, opening.offset, opening.offset + opening.width, 0, opening.bottom),
        ...wallSections(snapshot, item, opening.offset, opening.offset + opening.width, opening.bottom + opening.height, item.height));
      cursor = opening.offset + opening.width;
    }
    solids.push(...wallSections(snapshot, item, cursor, Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]), 0, item.height));
    return { base, solids };
  }
  return { base };
}

/** Compare full snapshots, including level, roof, support and stair-void dependencies. */
export function modelChanges(before: ModelSnapshot, after: ModelSnapshot): ModelChange[] {
  const delta = diffSnapshots(before, after);
  const reasons = new Map<string, 'object' | 'placement'>();
  for (const item of [...delta.entities.added, ...delta.entities.removed, ...delta.entities.modified]) reasons.set(item.id, 'object');
  const links = [...delta.relationships.added, ...delta.relationships.removed, ...delta.relationships.modified.flatMap((item) => [item.before, item.after])];
  const placement = (id: string): void => { if (!reasons.has(id)) reasons.set(id, 'placement'); };
  for (const link of links) for (const id of [link.source, link.target]) placement(id);
  for (const id of new Set([...before.entities, ...after.entities].map((item) => item.id))) {
    if (JSON.stringify(derivedGeometry(before, id)) !== JSON.stringify(derivedGeometry(after, id))) placement(id);
  }
  return [...reasons].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, reason]): ModelChange[] => {
    const a = before.entities.find((item) => item.id === id); const b = after.entities.find((item) => item.id === id);
    if (a && b) return [{ id, name: b.name, reason, status: 'modified', before: a, after: b }];
    if (a) return [{ id, name: a.name, reason, status: 'removed', before: a, after: null }];
    if (b) return [{ id, name: b.name, reason, status: 'added', before: null, after: b }];
    return [];
  });
}
