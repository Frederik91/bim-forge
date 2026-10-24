import { validateSnapshot, RoomRepository } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

/** A connected concept floor, not surveyed dimensions or product specifications. */
export function residentialFloor(): ModelSnapshot {
  const wall = (id: string, name: string, start: number[], end: number[], thickness = .15) => ({ id, type: 'Wall', name, start, end, thickness, height: 2.7 });
  const room = (id: string, name: string, minX: number, minY: number, maxX: number, maxY: number) =>
    ({ id, type: 'Space', name, levelId: 'level-ground', bounds: { minX, minY, maxX, maxY } });
  const furnishing = (id: string, name: string, kind: string, x: number, y: number, width: number, depth: number, height: number, supportId: string | null = null) =>
    ({ id, type: 'Furniture', name, kind, position: [x, y], width, depth, height, rotationDeg: 0, supportId });
  const openings = [
    { id: 'door-entry', name: 'Main entrance', wall: 'wall-west', offset: 4.3, width: 1 },
    { id: 'door-living', name: 'Living room door', wall: 'wall-south-hall', offset: 2.1, width: .9 },
    { id: 'door-kitchen', name: 'Kitchen door', wall: 'wall-south-hall', offset: 6.1, width: .9 },
    { id: 'door-office', name: 'Home office door', wall: 'wall-south-hall', offset: 10.1, width: .9 },
    { id: 'door-bedroom-main', name: 'Main bedroom door', wall: 'wall-north-hall', offset: 1.5, width: .9 },
    { id: 'door-bedroom-two', name: 'Second bedroom door', wall: 'wall-north-hall', offset: 5.5, width: .9 },
    { id: 'door-bath', name: 'Bathroom door', wall: 'wall-north-hall', offset: 8.5, width: .85 },
    { id: 'door-utility', name: 'Utility door', wall: 'wall-north-hall', offset: 10.5, width: .85 },
  ];
  const windows = [
    { id: 'window-living', name: 'Living room window', wall: 'wall-south', offset: 1.3, width: 2 },
    { id: 'window-kitchen', name: 'Kitchen window', wall: 'wall-south', offset: 6, width: 2 },
    { id: 'window-office', name: 'Office window', wall: 'wall-east', offset: 1.1, width: 1.6 },
    { id: 'window-bedroom-main', name: 'Main bedroom window', wall: 'wall-north', offset: .8, width: 1.8 },
    { id: 'window-bedroom-two', name: 'Second bedroom window', wall: 'wall-north', offset: 4.8, width: 1.8 },
  ];
  return validateSnapshot({ units: 'm', entities: [
    { id: 'level-ground', type: 'Level', name: 'Ground floor', elevation: 0 },
    room('room-living', 'Living room', 0, 0, 5, 4),
    room('room-kitchen', 'Kitchen / dining', 5, 0, 9, 4),
    room('room-office', 'Home office', 9, 0, 12, 4),
    room('room-hall', 'Hallway', 0, 4, 12, 5.5),
    room('room-bedroom-main', 'Main bedroom', 0, 5.5, 4, 9),
    room('room-bedroom-two', 'Bedroom 2', 4, 5.5, 8, 9),
    room('room-bath', 'Bathroom', 8, 5.5, 10, 9),
    room('room-utility', 'Utility', 10, 5.5, 12, 9),
    wall('wall-south', 'South exterior', [0, 0], [12, 0], .2),
    wall('wall-north', 'North exterior', [0, 9], [12, 9], .2),
    wall('wall-west', 'West exterior', [0, 0], [0, 9], .2),
    wall('wall-east', 'East exterior', [12, 0], [12, 9], .2),
    wall('wall-south-hall', 'Hall / south rooms', [0, 4], [12, 4]),
    wall('wall-north-hall', 'Hall / north rooms', [0, 5.5], [12, 5.5]),
    wall('wall-living-kitchen', 'Living / kitchen partition', [5, 0], [5, 4]),
    wall('wall-kitchen-office', 'Kitchen / office partition', [9, 0], [9, 4]),
    wall('wall-bedrooms', 'Bedroom partition', [4, 5.5], [4, 9]),
    wall('wall-bedroom-bath', 'Bedroom / bathroom partition', [8, 5.5], [8, 9]),
    wall('wall-bath-utility', 'Bathroom / utility partition', [10, 5.5], [10, 9]),
    ...openings.map(({ id, name, width }) => ({ id, type: 'Door', name, width, height: 2.1 })),
    ...windows.map(({ id, name, width }) => ({ id, type: 'Window', name, width, height: 1.2, sillHeight: .9 })),
    furnishing('living-sofa', 'Living room sofa', 'sofa', 2.2, .85, 2.4, .9, .85),
    furnishing('living-table', 'Coffee table', 'table', 2.2, 2, 1.1, .6, .45),
    furnishing('living-plant', 'Living room plant', 'plant', .55, 3.3, .45, .45, 1.2),
    furnishing('kitchen-counter', 'Kitchen cabinetry', 'cabinet', 7, .5, 3, .65, .9),
    furnishing('dining-table', 'Dining table', 'table', 7.2, 2.1, 1.4, .8, .75),
    furnishing('dining-chair-one', 'Dining chair', 'chair', 7.2, 1.3, .5, .5, .85),
    furnishing('dining-chair-two', 'Dining chair 2', 'chair', 7.2, 2.85, .5, .5, .85),
    furnishing('office-desk', 'Office desk', 'desk', 10.4, .9, 1.6, .8, .75),
    furnishing('office-monitor', 'Office monitor', 'monitor', 10.15, .85, .55, .2, .45, 'office-desk'),
    furnishing('office-laptop', 'Office laptop', 'laptop', 10.85, 1, .35, .25, .24, 'office-desk'),
    furnishing('office-chair', 'Office chair', 'chair', 10.4, 1.9, .6, .6, 1),
    furnishing('office-plant', 'Office plant', 'plant', 11.5, 3.3, .45, .45, 1.2),
    furnishing('main-bed', 'Double bed', 'bed', 2, 7.8, 1.8, 2, .6),
    furnishing('second-bed', 'Single bed', 'bed', 6.5, 7.7, 1.1, 2, .6),
    furnishing('bath-cabinet', 'Bathroom vanity placeholder', 'cabinet', 9, 8.4, 1.2, .6, .85),
    furnishing('utility-cabinet', 'Utility storage', 'cabinet', 11, 8.4, 1.4, .6, 1.8),
  ], relationships: [...openings, ...windows].map(({ id, wall, offset }) => ({ id: 'host-' + id, type: 'hosted-by', source: id, target: wall, offset })) });
}

export async function createResidentialProject(name: string): Promise<RoomRepository> {
  return RoomRepository.createProject({ projectId: globalThis.crypto.randomUUID(), name, snapshot: residentialFloor() });
}
