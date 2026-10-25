import { validateSnapshot } from '../src/room-model.ts';
import { assetFixtureEdit } from '../src/asset-fixture.ts';
import type { AssetInstance, ModelSnapshot, Point } from '../src/room-model.ts';

/** Boundary data: the normal snapshot validator supplies all native identities and ownership. */
export function familyViewerSnapshot(base: ModelSnapshot, roomId?: string): ModelSnapshot {
  const edit = assetFixtureEdit();
  const room = base.entities.find((item) => item.type === 'Space' && item.id === roomId);
  if (roomId && room?.type !== 'Space') throw new Error('Viewer fixture room is missing.');
  const placement: AssetInstance['placement'] = room?.type === 'Space' ? { kind: 'room', roomId: room.id } : { kind: 'single-room' };
  const positions: Point[] = [[3.6, .8], [4.5, .8], [5.4, .8]];
  const instances = edit.instances.map((item, index) => ({ ...item, placement, position: positions[index], rotationDeg: index === 2 ? 90 : 0,
    size: index === 2 ? { ...item.size, width: .6, depth: .4 } : item.size }));
  return validateSnapshot({ ...base, entities: [...base.entities, ...edit.families, ...instances] });
}
