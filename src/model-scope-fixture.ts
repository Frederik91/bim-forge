import { residentialFloor } from './residential-floor.ts';
import { personFamily, personInstance } from './asset-fixture.ts';
import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

/** Validated rooms, actual desk-supported devices and one shared family in two rooms. */
export function modelScopeFixture(): ModelSnapshot {
  const base = residentialFloor();
  return validateSnapshot({ ...base, entities: [
    ...base.entities.map((entity) => entity.id === 'office-desk' ? { ...entity, parameters: [
      { definitionId: 'service-interval', name: 'Service interval', value: { kind: 'duration', value: 2, unit: 'h' } },
      { definitionId: 'work-group', name: 'Work group', value: { kind: 'text', value: 'design' } },
    ] } : entity),
    personFamily(),
    { ...personInstance(), id: 'living-person', position: [4, 2.8], placement: { kind: 'room', roomId: 'room-living' } },
    { ...personInstance(), id: 'bedroom-person', position: [.7, 6.7], placement: { kind: 'room', roomId: 'room-bedroom-main' } },
  ] });
}
