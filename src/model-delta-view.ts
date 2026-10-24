import { diffSnapshots } from './room-model.ts';
import type { Entity, ModelSnapshot } from './room-model.ts';

interface ChangeIdentity { id: string; name: string; reason: 'object' | 'placement' }
export type ModelChange = ChangeIdentity & (
  | { status: 'added'; before: null; after: Entity }
  | { status: 'modified'; before: Entity; after: Entity }
  | { status: 'removed'; before: Entity; after: null }
);

/** Include derived placement/host geometry when a hosting relationship changes. */
export function modelChanges(before: ModelSnapshot, after: ModelSnapshot): ModelChange[] {
  const delta = diffSnapshots(before, after);
  const reasons = new Map<string, 'object' | 'placement'>();
  for (const item of [...delta.entities.added, ...delta.entities.removed, ...delta.entities.modified]) reasons.set(item.id, 'object');
  const links = [...delta.relationships.added, ...delta.relationships.removed, ...delta.relationships.modified.flatMap((item) => [item.before, item.after])];
  const placement = (id: string): void => { if (!reasons.has(id)) reasons.set(id, 'placement'); };
  for (const link of links) for (const id of [link.source, link.target]) placement(id);
  for (const item of [...before.entities, ...after.entities]) {
    if (item.type === 'Door' || item.type === 'Window') {
      const geometry = (snapshot: ModelSnapshot) => {
        const opening = snapshot.entities.find((candidate) => candidate.id === item.id);
        const host = snapshot.relationships.find((link) => link.source === item.id);
        const wall = snapshot.entities.find((candidate) => candidate.id === host?.target);
        if ((opening?.type !== 'Door' && opening?.type !== 'Window') || !host || wall?.type !== 'Wall') return null;
        return { width: opening.width, height: opening.height, sill: opening.type === 'Window' ? opening.sillHeight : 0,
          target: host.target, offset: host.offset, start: wall.start, end: wall.end, thickness: wall.thickness };
      };
      if (JSON.stringify(geometry(before)) !== JSON.stringify(geometry(after))) {
        placement(item.id);
        for (const snapshot of [before, after]) { const host = snapshot.relationships.find((link) => link.source === item.id); if (host) placement(host.target); }
      }
    } else if (item.type === 'Furniture' && item.supportId) {
      const height = (snapshot: ModelSnapshot) => { const support = snapshot.entities.find((candidate) => candidate.id === item.supportId); return support?.type === 'Furniture' ? support.height : null; };
      if (height(before) !== height(after)) placement(item.id);
    }
  }
  return [...reasons].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, reason]): ModelChange[] => {
    const a = before.entities.find((item) => item.id === id); const b = after.entities.find((item) => item.id === id);
    if (a && b) return [{ id, name: b.name, reason, status: 'modified', before: a, after: b }];
    if (a) return [{ id, name: a.name, reason, status: 'removed', before: a, after: null }];
    if (b) return [{ id, name: b.name, reason, status: 'added', before: null, after: b }];
    return [];
  });
}
