import { compileFloorLayout } from './floor-layout.ts';
import { validateSnapshot } from './room-model.ts';
import type { ModelSnapshot } from './room-model.ts';

/** Invented, metre-scaled two-room fixture; no surveyed-house or source authority. */
export function roomDimensionFixture(): ModelSnapshot {
  return validateSnapshot({ units: 'm', ...compileFloorLayout({
    level: { id: 'level-dimension', name: 'Synthetic dimension floor' }, heightMm: 2700, wallThicknessMm: 150,
    rooms: [
      { id: 'room-a', name: 'Room A', boundsMm: { minX: 0, minY: 0, maxX: 3000, maxY: 4000 } },
      { id: 'room-b', name: 'Room B', boundsMm: { minX: 3000, minY: 0, maxX: 6000, maxY: 4000 } },
    ], openings: [
      { id: 'door-exit', name: 'Exit', type: 'Door', roomId: 'room-b', side: 'east', offsetMm: 1000, widthMm: 900, heightMm: 2100 },
      { id: 'door-between', name: 'Connecting door', type: 'Door', roomId: 'room-a', side: 'east', offsetMm: 1000, widthMm: 900, heightMm: 2100 },
      { id: 'window-between', name: 'Borrowed light', type: 'Window', roomId: 'room-a', side: 'east', offsetMm: 2400, widthMm: 600, heightMm: 500, sillHeightMm: 1300 },
    ],
  }, { kind: 'legacy' }) });
}
