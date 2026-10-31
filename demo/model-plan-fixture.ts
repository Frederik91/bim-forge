import { multiStoreySnapshot } from '../src/multi-storey-house.ts';
import { identifier, validateSnapshot } from '../src/room-model.ts';
import { personFamily, personInstance } from '../src/asset-fixture.ts';
import type { PlanInput } from './model-plan.ts';
import { spatialTokens } from './ui/design-tokens.ts';

/** Disposable validated native building; source coordinates never come from the visual study. */
export function planFixture(): PlanInput {
  const building = multiStoreySnapshot();
  const snapshot = validateSnapshot({ ...building, entities: [...building.entities,
    { id: 'window-north', type: 'Window', name: 'North window', width: 1.2, height: 1.2, sillHeight: .9 },
    ...[
      { id: 'desk-plan', name: 'Writing desk', kind: 'desk', position: [1.8, 3.5], width: 1.4, depth: .7, height: .75 },
      { id: 'chair-plan', name: 'Desk chair', kind: 'chair', position: [1.8, 2.7], width: .5, depth: .5, height: .8 },
      { id: 'bed-plan', name: 'Bed', kind: 'bed', position: [6, 4.5], width: 1.6, depth: 2, height: .5 },
    ].map(item => ({ ...item, type: 'Furniture', levelId: 'level-ground', rotationDeg: 0, supportId: null })),
    personFamily(), { ...personInstance('person-plan', 1.87, { kind: 'room', roomId: identifier('level-ground-west') }), position: [3.1, 4.8] },
  ], relationships: [...building.relationships, { id: 'host-window-north', type: 'hosted-by', source: 'window-north', target: 'level-ground-wall-north', offset: 5 }] });
  const proposed = validateSnapshot({ ...snapshot, entities: snapshot.entities.map(item => item.id === 'door-entry'
    ? { ...item, width: 1.1 } : item), relationships: snapshot.relationships.map(link => link.source === 'door-entry'
      ? { ...link, offset: link.offset - .1 } : link) });
  const projectId = '11111111-1111-4111-8111-111111111111';
  return { source: { snapshot: proposed, projectId, target: { kind: 'main' }, revisionId: 'b'.repeat(64) },
    comparison: { snapshot, projectId, target: { kind: 'main' }, revisionId: 'a'.repeat(64) },
    levelId: 'level-ground', viewport: { width: 900, height: 650 }, selectedTargets: [], tokens: spatialTokens };
}
