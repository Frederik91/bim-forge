import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelPlan, hitTestModelPlan } from './model-plan.ts';
import type { PlanInput, PlanPoint } from './model-plan.ts';
import { spatialTokens } from './ui/design-tokens.ts';
import { planFixture } from './model-plan-fixture.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
function at(input: PlanInput, point: readonly [number, number, number]): PlanPoint {
  return createModelPlan(input).projection.project(point);
}
test('native multi-room plan uses actual hosted 1100 mm opening and preserves the 900 mm accepted graph', () => {
  const input = planFixture(); const before = JSON.stringify(input);
  const plan = createModelPlan(input);
  const opening = plan.dimensions.find(item => item.ref?.entityId === 'door-entry');
  assert.equal(opening?.metres, 1.1);
  const profile = plan.primitives.find(item => item.kind === 'path' && item.hit?.ref.entityId === 'door-entry' && item.hit.revisionRole === 'current');
  assert.ok(profile?.kind === 'path');
  assert.ok(Math.abs(Math.hypot(profile.points[1][0] - profile.points[0][0], profile.points[1][1] - profile.points[0][1]) / plan.projection.pixelsPerMetre - 1.1) < 1e-12);
  const acceptedDoor = input.comparison?.snapshot.entities.find(item => item.id === 'door-entry');
  assert.ok(acceptedDoor?.type === 'Door'); assert.equal(acceptedDoor.width, .9);
  assert.equal(JSON.stringify(input), before, 'drawing never mutates either revision');
  assert.ok(plan.primitives.some(item => item.kind === 'text' && item.text === '900 → 1100 mm'));
  assert.ok(plan.primitives.some(item => item.kind === 'text' && item.text === '24.0 m²'));
});
test('wall thickness, gap and swing agree independently with the source model', () => {
  const input = planFixture(); const plan = createModelPlan(input); const s = plan.projection.pixelsPerMetre;
  const wall = plan.primitives.find(p => p.kind === 'path' && p.hit?.ref.entityId === 'level-ground-wall-south' && p.hit.revisionRole === 'current');
  assert.ok(wall?.kind === 'path');
  assert.ok(Math.abs(Math.hypot(wall.points[2][0] - wall.points[1][0], wall.points[2][1] - wall.points[1][1]) / s - .15) < 1e-12);
  const centre = plan.projection.project([2.45, 0, 0]);
  assert.equal(hitTestModelPlan(plan, centre, 0)[0]?.ref.entityId, 'door-entry');
  assert.ok(!hitTestModelPlan(plan, centre, 0).some(hit => hit.ref.entityId === 'level-ground-wall-south'), 'the wall is cut at the opening');
  const hinge = plan.projection.project([1.9, 0, 0]); const leaf = plan.projection.project([1.9, 1.1, 0]);
  assert.ok(plan.primitives.some(p => p.kind === 'path' && !p.closed && p.points.length === 2
    && p.points[0][0] === hinge[0] && p.points[0][1] === hinge[1] && p.points[1][0] === leaf[0] && p.points[1][1] === leaf[1]));
});
test('overall dimensions are wall-axis spans and scale bar is the same projection', () => {
  const plan = createModelPlan(planFixture());
  assert.deepEqual(plan.dimensions.filter(d => d.datum === 'wall-axes').map(d => d.metres), [8, 6]);
  assert.equal(plan.scaleBar.pixels / plan.projection.pixelsPerMetre, plan.scaleBar.metres);
  const a = plan.projection.project([0, 0, 0]); const b = plan.projection.project([1, 0, 0]);
  assert.ok(Math.abs(b[0] - a[0] - plan.projection.pixelsPerMetre) < 1e-12);
  assert.ok(plan.projection.project([0, 1, 0])[1] < a[1], 'north is screen up');
});
test('inverse coordinates retain pinned revision, project and selected elevation through narrow and zoomed views', () => {
  for (const width of [320, 390, 900]) for (const levelId of ['level-basement', 'level-ground', 'level-attic']) {
    const input = { ...planFixture(), levelId, viewport: { width, height: 560 } };
    const plan = createModelPlan(input);
    for (const [x, y] of [[0, 0], [8, 6], [2.45, 1], [-7.8, 32.3]]) {
      const result = plan.projection.inverse(plan.projection.project([x, y, 70]));
      assert.ok(Math.abs(result.point[0] - x) < 1e-12 && Math.abs(result.point[1] - y) < 1e-12);
      assert.equal(result.point[2], levelId === 'level-basement' ? -3 : levelId === 'level-attic' ? 3 : 0);
      assert.equal(result.projectId, input.source.projectId); assert.equal(result.revisionId, input.source.revisionId); assert.equal(result.levelId, levelId);
    }
    assert.ok(plan.primitives.filter(p => p.kind === 'text').every(p => p.size >= 13));
    assert.ok(!plan.hitShapes.some(shape => shape.hit.ref.entityId.startsWith(levelId === 'level-ground' ? 'level-basement-wall' : 'level-ground-wall')));
  }
  const input = planFixture(); const plan = createModelPlan({ ...input, viewport: { width: 390, height: 500, bounds: { minX: 1, maxX: 4, minY: -1, maxY: 3 } } });
  const p = plan.projection.inverse(plan.projection.project([2, 1, 0])); assert.deepEqual(p.point, [2, 1, 0]);
});
test('current and existing hits stay separately revision qualified; stale selected IDs do not highlight current objects', () => {
  const input = planFixture(); const plan = createModelPlan(input);
  const hits = hitTestModelPlan(plan, at(input, [2.45, 0, 0]), 0).filter(hit => hit.ref.entityId === 'door-entry');
  assert.deepEqual(hits.map(hit => [hit.revisionRole, hit.ref.revisionId]), [['current', 'b'.repeat(64)], ['existing', 'a'.repeat(64)]]);
  assert.ok(hits.every(hit => hit.ref.projectId === projectId && hit.levelId === 'level-ground'));
  const selected = { kind: 'native', projectId, target: { kind: 'main' }, revisionId: 'a'.repeat(64), entityId: 'door-entry' } satisfies typeof hits[number]['ref'];
  const stale = createModelPlan({ ...input, selectedTargets: [selected] });
  assert.ok(!stale.primitives.some(p => p.kind === 'path' && p.hit?.revisionRole === 'current' && p.style.stroke === spatialTokens.color.selection));
  const live = createModelPlan({ ...input, selectedTargets: [{ ...selected, revisionId: 'b'.repeat(64) }] });
  assert.ok(live.primitives.some(p => p.kind === 'path' && p.hit?.ref.entityId === 'door-entry' && p.style.stroke === spatialTokens.color.selection));
});
test('moved walls show both source geometries and expand framing without changing wall-axis dimension meaning', () => {
  const input = planFixture(); const snapshot = { ...input.source.snapshot, entities: input.source.snapshot.entities.map(item => item.type === 'Wall'
    && item.id === 'level-ground-wall-east' ? { ...item, start: [9, 0] satisfies [number, number], end: [9, 6] satisfies [number, number] } : item) };
  const plan = createModelPlan({ ...input, source: { ...input.source, snapshot } });
  assert.equal(plan.dimensions.find(item => item.datum === 'wall-axes')?.metres, 9);
  const hits = hitTestModelPlan(plan, plan.projection.project([9, 3, 0]), 0);
  assert.equal(hits[0]?.ref.entityId, 'level-ground-wall-east');
  assert.ok(plan.primitives.some(p => p.kind === 'path' && p.hit?.ref.entityId === 'level-ground-wall-east' && p.style.stroke === spatialTokens.color.proposed));
});
test('slabs, incident stairs, roof projections and furniture proxies report truthful representations', () => {
  const input = planFixture(); const ground = createModelPlan(input);
  assert.ok(ground.hitShapes.some(s => s.hit.ref.entityId === 'level-ground-slab' && s.hit.representation === 'native-footprint'));
  assert.ok(ground.hitShapes.some(s => s.hit.ref.entityId === 'stair-basement-ground'));
  assert.ok(ground.hitShapes.some(s => s.hit.ref.entityId === 'stair-ground-attic'));
  assert.ok(ground.hitShapes.some(s => s.hit.ref.entityId === 'level-ground-plant' && s.hit.representation === 'footprint-proxy'));
  assert.ok(!ground.hitShapes.some(s => s.hit.representation === 'roof-projection'));
  assert.ok(createModelPlan({ ...input, levelId: 'level-attic' }).hitShapes.some(s => s.hit.representation === 'roof-projection'));
  assert.ok(ground.notices.some(text => text.includes('Linked IFC Plan cuts') && text.includes('unsupported')));
});
test('hosted window and rotated-capable asset footprints use native dimensions and source hits', () => {
  const input = planFixture(); const plan = createModelPlan(input);
  const window = plan.primitives.find(p => p.kind === 'path' && p.hit?.ref.entityId === 'window-north');
  assert.ok(window?.kind === 'path');
  assert.ok(Math.abs(Math.hypot(window.points[1][0] - window.points[0][0], window.points[1][1] - window.points[0][1])
    / plan.projection.pixelsPerMetre - 1.2) < 1e-12);
  const hits = hitTestModelPlan(plan, plan.projection.project([5.6, 6, 0]), 0);
  assert.equal(hits[0]?.ref.entityId, 'window-north'); assert.equal(hits[0]?.representation, 'hosted-opening-symbol');
  assert.ok(!hits.some(hit => hit.ref.entityId === 'level-ground-wall-north'));
  const person = hitTestModelPlan(plan, plan.projection.project([3.1, 4.8, 0]), 0)[0];
  assert.equal(person?.ref.entityId, 'person-plan'); assert.equal(person?.representation, 'footprint-proxy');
  assert.equal(person?.ref.revisionId, input.source.revisionId);
});
test('empty/unknown/foreign/nonfinite contexts never resolve to substitute geometry', () => {
  const input = planFixture();
  assert.throws(() => createModelPlan({ ...input, levelId: 'missing' }), /Unknown level/);
  assert.throws(() => createModelPlan({ ...input, levelId: null }), /explicit native level/);
  assert.throws(() => createModelPlan({ ...input, comparison: { ...input.source, projectId: 'foreign' } }), /same project/);
  assert.throws(() => createModelPlan({ ...input, viewport: { width: NaN, height: 500 } }), /finite/);
  const empty = createModelPlan({ ...input, levelId: null, comparison: null, source: { ...input.source, snapshot: { units: 'm', entities: [], relationships: [] } } });
  assert.equal(empty.hitShapes.length, 0); assert.ok(empty.notices.some(text => text.includes('No supported')));
  assert.equal(hitTestModelPlan(empty, [-1, 0]).length, 0);
  assert.throws(() => empty.projection.inverse([NaN, 1]), /finite/);
});
