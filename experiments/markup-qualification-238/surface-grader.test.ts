import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { gradeBelowWall } from './surface-grader.ts';
import type { Footprint } from './grader.ts';
import type { SpatialMarkup } from '../../src/spatial-markup.ts';

before(() => {
  assert.equal(process.env.QUAL_SERVER_CONTAINER, 'issue238');
  assert.equal(process.platform, 'linux'); assert.ok(existsSync('/.dockerenv'));
});

const wall: SpatialMarkup = { kind: 'rectangle', label: 'Wall outline', corners: [[1,4,1],[3,4,1],[3,4,2],[1,4,2]] };
function cabinet(x = 2, y = 3.75, z = 0): Footprint {
  return { kind: 'oriented-rectangle', center: [x,y,z], widthMetres: .6, depthMetres: .3, yawRadians: 0 };
}
test('a cabinet below a vertical wall outline uses its plane, width and actual closest gap', () => {
  const result = gradeBelowWall({ markup: wall, footprint: cabinet(), heightMetres: .8, gapMetres: .1 });
  assert.equal(result.kind, 'supported'); assert.equal(result.value, true);
  assert.ok(Math.abs((result.gapMetres ?? Infinity) - .1) < 1e-10);
});
test('wrong centring, gap, floor, height and crossing the wall each fail independently', () => {
  for (const [footprint, heightMetres] of [[cabinet(2.2), .8], [cabinet(2,3.6),.8], [cabinet(2,3.75,.1),.8],
    [cabinet(),1.2], [cabinet(2,4),.8]] satisfies Array<[Footprint, number]>) {
    const result = gradeBelowWall({ markup: wall, footprint, heightMetres, gapMetres: .1 });
    assert.equal(result.kind, 'supported'); assert.equal(result.value, false);
  }
});
test('horizontal outlines abstain instead of projecting them into a wall', () => {
  const floor: SpatialMarkup = { kind: 'rectangle', label: 'Floor', corners: [[1,1,0],[3,1,0],[3,2,0],[1,2,0]] };
  assert.equal(gradeBelowWall({ markup: floor, footprint: cabinet(), heightMetres: .8, gapMetres: .1 }).kind, 'unsupported');
});
