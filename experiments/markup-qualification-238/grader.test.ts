import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test, { before } from 'node:test';
import type { MarkupPoint, SpatialMarkup } from '../../src/spatial-markup.ts';
import { TOLERANCE_METRES, gradeCentreDistance, gradeInside, gradeOutside,
  measureFootprintBoundaryDistances, measurePointBoundaryDistance } from './grader.ts';
import type { Footprint, OracleResult, Unsupported } from './grader.ts';

before(() => {
  assert.equal(process.env.QUAL_SERVER_CONTAINER, 'issue238', 'Parent-coordinated server container lease required; no local fallback.');
  assert.equal(process.platform, 'linux');
  assert.ok(existsSync('/.dockerenv'), 'Qualification must run in an isolated server container.');
});

function value<T>(result: OracleResult<T>): T {
  assert.equal(result.kind, 'supported', JSON.stringify(result));
  assert.equal(result.toleranceMetres, 0.002);
  return result.value;
}

function abstains<T>(result: OracleResult<T>, reason: Unsupported['reason']): void {
  assert.equal(result.kind, 'unsupported', JSON.stringify(result));
  if (result.kind === 'unsupported') assert.equal(result.reason, reason);
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from analytical ${expected}`);
}

function box(x: number, y: number, width = 1, depth = 1, yaw = 0, z = 0): Footprint {
  return { kind: 'oriented-rectangle', center: [x, y, z], widthMetres: width, depthMetres: depth, yawRadians: yaw };
}

function rectangle(z = 0): SpatialMarkup {
  return { kind: 'rectangle', corners: [[0, 0, z], [10, 0, z], [10, 10, z], [0, 10, z]], label: '10 m square' };
}

function circle(z = 0): SpatialMarkup {
  return { kind: 'circle', center: [0, 0, z], normal: [0, 0, 1], radius: 5, label: 'Exact 5 m radius' };
}

function path(points: MarkupPoint[]): SpatialMarkup {
  return { kind: 'polyline', points, label: 'Actual vertices' };
}

const lRegion = path([[0, 0, 0], [4, 0, 0], [4, 1, 0], [1, 1, 0], [1, 4, 0], [0, 4, 0], [0, 0, 0]]);

test('circle rejects bounding-box corners and a centre-inside footprint with outside corners', () => {
  assert.equal(value(gradeInside({ markup: circle(), footprint: box(4, 4) })), false);
  assert.equal(value(gradeInside({ markup: circle(), footprint: box(3, 3, 2, 2) })), false);
  assert.equal(value(gradeInside({ markup: circle(), footprint: box(0, 0, 6, 6) })), true);
  assert.equal(value(gradeInside({ markup: circle(), footprint: box(0, 0, 8, 8) })), false);
});

test('actual L-notch excludes an AABB-inside object and admits both arms', () => {
  assert.equal(value(gradeInside({ markup: lRegion, footprint: box(2, 2, 0.5, 0.5) })), false);
  assert.equal(value(gradeInside({ markup: lRegion, footprint: box(0.5, 2, 0.8, 2) })), true);
  assert.equal(value(gradeInside({ markup: lRegion, footprint: box(2, 0.5, 2, 0.8) })), true);
});

test('all four vertices inside does not excuse edges crossing concavity', () => {
  // Each corner is strictly in an arm, but the long edges cross the missing quadrant.
  const footprint: Footprint = { kind: 'polygon', vertices: [[0.5, 3.5, 0], [3.5, 0.5, 0], [3.8, 0.8, 0], [0.8, 3.8, 0]] };
  for (const vertex of footprint.vertices) {
    assert.equal(value(gradeInside({ markup: lRegion, footprint: box(vertex[0], vertex[1], 0.01, 0.01) })), true);
  }
  assert.equal(value(gradeInside({ markup: lRegion, footprint })), false);
  assert.equal(value(gradeInside({ markup: lRegion, footprint: box(2.15, 2.15, Math.sqrt(18), Math.sqrt(0.18), -Math.PI / 4) })), false);
});

test('rotation changes whole-footprint containment even when the centre and dimensions agree', () => {
  assert.equal(value(gradeInside({ markup: rectangle(), footprint: box(5, 0.4, 2, 0.5) })), true);
  assert.equal(value(gradeInside({ markup: rectangle(), footprint: box(5, 0.4, 2, 0.5, Math.PI / 2) })), false);
  const rotated: SpatialMarkup = { kind: 'rectangle', corners: [[0, 2, 0], [2, 0, 0], [4, 2, 0], [2, 4, 0]], label: 'Diamond' };
  assert.equal(value(gradeInside({ markup: rotated, footprint: box(2, 2, 2, 2, Math.PI / 4) })), true);
  assert.equal(value(gradeInside({ markup: rotated, footprint: box(0.3, 0.3, 0.1, 0.1) })), false);
});

test('fixed 2 mm tolerance admits 1 mm and rejects 3 mm outside convex boundaries', () => {
  assert.equal(TOLERANCE_METRES, 0.002);
  assert.equal(value(gradeInside({ markup: rectangle(), footprint: box(0.499, 5) })), true);
  assert.equal(value(gradeInside({ markup: rectangle(), footprint: box(0.497, 5) })), false);
  const circularFootprint: Footprint = { kind: 'polygon', vertices: [[0, 0, 0], [5.001, 0, 0], [0, 1, 0]] };
  assert.equal(value(gradeInside({ markup: circle(), footprint: circularFootprint })), true);
  assert.equal(value(gradeInside({ markup: circle(), footprint: { kind: 'polygon', vertices: [[0, 0, 0], [5.003, 0, 0], [0, 1, 0]] } })), false);
});

test('concave tolerance-only coverage abstains rather than certifying a sealed pocket', () => {
  abstains(gradeInside({ markup: lRegion, footprint: box(0.5005, 2, 1, 1) }), 'tolerance-ambiguity');
  // Nearly closed C-region: footprint perimeter is within the band, its centre is excluded.
  const cRegion = path([[-2, -2, 0], [2, -2, 0], [2, -0.0005, 0], [1.001, -0.0005, 0],
    [1.001, -1.001, 0], [-1.001, -1.001, 0], [-1.001, 1.001, 0], [1.001, 1.001, 0],
    [1.001, 0.0005, 0], [2, 0.0005, 0], [2, 2, 0], [-2, 2, 0], [-2, -2, 0]]);
  abstains(gradeInside({ markup: cRegion, footprint: box(0, 0, 2, 2) }), 'tolerance-ambiguity');
});

test('outside requires disjointness, applies minimum gap, and retains measured shortfalls', () => {
  const good = value(gradeOutside({ markup: rectangle(), footprint: box(11.1, 5), minimumGapMetres: 0.6 }));
  assert.equal(good.satisfied, true); assert.equal(good.disjoint, true); close(good.gapMetres, 0.6);
  const short = value(gradeOutside({ markup: rectangle(), footprint: box(11.097, 5), minimumGapMetres: 0.6 }));
  assert.equal(short.satisfied, false); assert.equal(short.disjoint, true); close(short.gapMetres, 0.597);
  assert.equal(value(gradeOutside({ markup: rectangle(), footprint: box(11.099, 5), minimumGapMetres: 0.6 })).satisfied, true);
  for (const footprint of [box(10.5, 5), box(10.499, 5), box(5, 5), box(5, 5, 30, 30)]) {
    assert.deepEqual(value(gradeOutside({ markup: rectangle(), footprint, minimumGapMetres: 0 })), { satisfied: false, disjoint: false, gapMetres: 0 });
  }
});

test('circle outside checks true radial gap, containing shapes and edge intersections', () => {
  close(value(gradeOutside({ markup: circle(), footprint: box(6, 0), minimumGapMetres: 0.5 })).gapMetres, 0.5);
  assert.equal(value(gradeOutside({ markup: circle(), footprint: box(4, 4), minimumGapMetres: 0.05 })).satisfied, false);
  // Vertices outside the circle while an edge crosses it.
  assert.equal(value(gradeOutside({ markup: circle(), footprint: box(0, 4.9, 12, 0.4), minimumGapMetres: 0 })).disjoint, false);
  assert.equal(value(gradeOutside({ markup: circle(), footprint: box(0, 0, 20, 20), minimumGapMetres: 0 })).disjoint, false);
  assert.equal(value(gradeOutside({ markup: circle(), footprint: box(0, 0), minimumGapMetres: 0 })).disjoint, false);
  assert.equal(value(gradeOutside({ markup: circle(), footprint: box(5.5, 0), minimumGapMetres: 0 })).disjoint, false);
});

test('a footprint in the L-notch is outside with the analytical gap to both arms', () => {
  const result = value(gradeOutside({ markup: lRegion, footprint: box(2, 2, 0.5, 0.5), minimumGapMetres: 0.75 }));
  assert.equal(result.satisfied, true); close(result.gapMetres, 0.75);
});

test('line and open polyline have distances but no inside/outside certainty', () => {
  const line: SpatialMarkup = { kind: 'line', from: [0, 0, 0], to: [4, 0, 0], label: 'Finite line' };
  const open = path([[0, 0, 0], [4, 0, 0], [4, 3, 0]]);
  for (const markup of [line, open]) {
    abstains(gradeInside({ markup, footprint: box(1, 1) }), 'open-path');
    abstains(gradeOutside({ markup, footprint: box(1, 1), minimumGapMetres: 0 }), 'open-path');
  }
  close(value(measurePointBoundaryDistance({ markup: line, point: [7, 4, 0] })), 5);
  close(value(measurePointBoundaryDistance({ markup: open, point: [3, 2, 0] })), 1);
  const closed = path([[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 0, 0]]);
  close(value(measurePointBoundaryDistance({ markup: closed, point: [2, 2, 0] })), 0);
  abstains(gradeInside({ markup: path([[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 0.001, 0]]), footprint: box(1, 1) }), 'open-path');
});

test('centre distance means exact circle or rectangle boundary, with an immutable allowance', () => {
  close(value(measurePointBoundaryDistance({ markup: circle(), point: [0, 0, 0] })), 5);
  close(value(measurePointBoundaryDistance({ markup: circle(), point: [3, 4, 0] })), 0);
  close(value(measurePointBoundaryDistance({ markup: rectangle(), point: [5, 5, 0] })), 5);
  close(value(measurePointBoundaryDistance({ markup: rectangle(), point: [13, 14, 0] })), 5);
  const markup: SpatialMarkup = { kind: 'line', from: [0, 0, 0], to: [10, 0, 0], label: '' };
  assert.equal(value(gradeCentreDistance({ markup, centre: [5, 0.501, 0], targetDistanceMetres: 0.5 })).satisfied, true);
  assert.equal(value(gradeCentreDistance({ markup, centre: [5, 0.503, 0], targetDistanceMetres: 0.5 })).satisfied, false);
});

test('vertex distances cannot replace boundary distances when edges cross', () => {
  const markup: SpatialMarkup = { kind: 'line', from: [-2, 0, 0], to: [2, 0, 0], label: '' };
  const crossed = value(measureFootprintBoundaryDistances({ markup, footprint: box(0, 0, 2, 2) }));
  assert.deepEqual(crossed.vertexDistancesMetres, [1, 1, 1, 1]);
  assert.equal(crossed.boundaryDistanceMetres, 0);
  const enclosed = value(measureFootprintBoundaryDistances({ markup: rectangle(), footprint: box(5, 5, 2, 2) }));
  assert.deepEqual(enclosed.vertexDistancesMetres, [4, 4, 4, 4]); close(enclosed.boundaryDistanceMetres, 4);
  const radial = value(measureFootprintBoundaryDistances({ markup: circle(), footprint: box(0, 0, 2, 2) }));
  close(radial.boundaryDistanceMetres, 5 - Math.sqrt(2));
  radial.vertexDistancesMetres.forEach(d => close(d, 5 - Math.sqrt(2)));
  close(value(measureFootprintBoundaryDistances({ markup: circle(), footprint: box(0, 0, 20, 20) })).boundaryDistanceMetres, 5);
  const circleCrossing = value(measureFootprintBoundaryDistances({ markup: circle(), footprint: box(0, 4.9, 12, 0.4) }));
  assert.ok(circleCrossing.vertexDistancesMetres.every(d => d > 0));
  close(circleCrossing.boundaryDistanceMetres, 0);
});

test('nonzero and negative elevations work; another storey cannot silently project into certainty', () => {
  for (const z of [-3, 3.175, 24]) {
    assert.equal(value(gradeInside({ markup: rectangle(z), footprint: box(5, 5, 1, 1, 0, z) })), true);
    close(value(measurePointBoundaryDistance({ markup: circle(z), point: [3, 4, z] })), 0);
  }
  abstains(gradeInside({ markup: rectangle(3), footprint: box(5, 5) }), 'different-elevation');
  abstains(measurePointBoundaryDistance({ markup: circle(3), point: [0, 0, 0] }), 'different-elevation');
});

test('self-crossing, self-touching, backtracking and noncoplanar shapes abstain', () => {
  const bow = path([[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0], [0, 0, 0]]);
  const touch = path([[0, 0, 0], [4, 0, 0], [2, 2, 0], [4, 4, 0], [0, 4, 0], [2, 2, 0], [0, 0, 0]]);
  const backtrack = path([[0, 0, 0], [4, 0, 0], [2, 0, 0]]);
  for (const markup of [bow, touch, backtrack]) {
    abstains(gradeInside({ markup, footprint: box(1, 1) }), 'self-intersection');
    abstains(measurePointBoundaryDistance({ markup, point: [1, 1, 0] }), 'self-intersection');
  }
  const warped: SpatialMarkup = { kind: 'rectangle', corners: [[0, 0, 3], [4, 0, 3], [4, 4, 3.001], [0, 4, 3]], label: '' };
  abstains(gradeInside({ markup: warped, footprint: box(2, 2, 1, 1, 0, 3) }), 'non-horizontal');
  abstains(gradeInside({ markup: rectangle(), footprint: { kind: 'polygon', vertices: [[1, 1, 0], [2, 1, 0], [2, 2, 0.001]] } }), 'non-horizontal');
  abstains(gradeInside({ markup: { kind: 'circle', center: [0, 0, 0], normal: [0, 1, 0], radius: 5, label: '' }, footprint: box(0, 0) }), 'non-horizontal');
});

test('invalid and degenerate geometry never produces a measured or successful result', () => {
  abstains(gradeInside({ markup: rectangle(), footprint: box(2, 2, 0, 1) }), 'invalid-geometry');
  abstains(gradeInside({ markup: { kind: 'circle', center: [0, 0, 0], normal: [0, 0, 0], radius: 5, label: '' }, footprint: box(0, 0) }), 'invalid-geometry');
  abstains(gradeInside({ markup: rectangle(), footprint: box(Number.NaN, 2) }), 'invalid-geometry');
  abstains(measurePointBoundaryDistance({ markup: circle(), point: [Number.POSITIVE_INFINITY, 0, 0] }), 'invalid-geometry');
  abstains(gradeOutside({ markup: rectangle(), footprint: box(20, 20), minimumGapMetres: -1 }), 'invalid-geometry');
  abstains(gradeCentreDistance({ markup: circle(), centre: [0, 0, 0], targetDistanceMetres: Number.NaN }), 'invalid-geometry');
  abstains(gradeInside({ markup: path([]), footprint: box(1, 1) }), 'invalid-geometry');
  abstains(gradeInside({ markup: path([[0, 0, 0], [0, 0, 0]]), footprint: box(1, 1) }), 'invalid-geometry');
  abstains(gradeInside({ markup: rectangle(), footprint: { kind: 'polygon', vertices: [[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0]] } }), 'self-intersection');
  const skew: SpatialMarkup = { kind: 'rectangle', corners: [[0, 0, 0], [4, 0, 0], [5, 4, 0], [1, 4, 0]], label: '' };
  abstains(gradeInside({ markup: skew, footprint: box(2, 2) }), 'invalid-geometry');
});

test('reversed winding, explicit closing vertex and exact projected concave footprints are supported', () => {
  const vertices: MarkupPoint[] = [[1, 1, 0], [3, 1, 0], [3, 2, 0], [2, 2, 0], [2, 3, 0], [1, 3, 0], [1, 1, 0]];
  assert.equal(value(gradeInside({ markup: rectangle(), footprint: { kind: 'polygon', vertices } })), true);
  assert.equal(value(gradeInside({ markup: rectangle(), footprint: { kind: 'polygon', vertices: [...vertices].reverse() } })), true);
  const reversed = path([[0, 0, 0], [0, 4, 0], [1, 4, 0], [1, 1, 0], [4, 1, 0], [4, 0, 0], [0, 0, 0]]);
  assert.equal(value(gradeInside({ markup: reversed, footprint: box(0.5, 2, 0.5, 0.5) })), true);
});

test('oracle calls do not mutate captured markup or supplied actual footprints', () => {
  const markup = rectangle(); const footprint = box(5, 5);
  const before = JSON.stringify({ markup, footprint });
  gradeInside({ markup, footprint }); gradeOutside({ markup, footprint, minimumGapMetres: 1 });
  measureFootprintBoundaryDistances({ markup, footprint });
  assert.equal(JSON.stringify({ markup, footprint }), before);
});
