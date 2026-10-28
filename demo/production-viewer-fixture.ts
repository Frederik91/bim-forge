import { RoomRepository, validateSnapshot } from '../src/room-model.ts';
import { viewerBuilding } from './building-viewer-fixture.ts';
import type { ModelSnapshot, ProjectId } from '../src/room-model.ts';

/** Validated authored building input, not a synthetic floor-area qualification. */
export async function productionViewerFixture(count = 48): Promise<{ projectId: ProjectId; accepted: ModelSnapshot; proposed: ModelSnapshot }> {
  const repository = await RoomRepository.create('Production renderer fixture');
  const base = viewerBuilding();
  const equipment = Array.from({ length: count }, (_, index) => ({ id: 'batch-equipment-' + index, type: 'Equipment',
    name: 'Batch equipment ' + index, levelId: 'ground', category: 'mechanical',
    position: [3.3 + index % 12 * .2, .3 + Math.floor(index / 12) % 16 * .2],
    elevation: .2, width: .12, depth: .12, height: .2 }));
  const accepted = validateSnapshot({ ...base, entities: [...base.entities, ...equipment] });
  const proposed = validateSnapshot({ ...accepted, entities: [
    ...accepted.entities.filter(item => item.id !== 'batch-equipment-1').map(item => item.id === 'batch-equipment-0' && item.type === 'Equipment'
      ? { ...item, position: [item.position[0] + .08, item.position[1]], height: .3 } : item),
    { ...equipment[1], id: 'batch-added-equipment', position: [3.5, .15] },
  ] });
  return { projectId: repository.projectId, accepted, proposed };
}
