import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { RoomRepository, diffSnapshots } from '../../src/room-model.ts';
import type { Entity, ModelSnapshot } from '../../src/room-model.ts';
import { entityLevel } from '../../src/building-levels.ts';
import { parseConversationVisual } from '../../src/request-conversation.ts';
import type { MarkupPoint, SpatialMarkup } from '../../src/spatial-markup.ts';
import { gradeInside, gradeOutside, gradeCentreDistance, measureFootprintBoundaryDistances, TOLERANCE_METRES } from './grader.ts';
import type { Footprint } from './grader.ts';
import { gradeBelowWall } from './surface-grader.ts';

const CaseSchema = Type.Object({ id: Type.String(), relation: Type.Union([Type.Literal('inside'), Type.Literal('outside-gap'), Type.Literal('edge-centres'),
  Type.Literal('undefined-region'), Type.Literal('outside-within-bounds'), Type.Literal('impossible-inside'), Type.Literal('surface-wall')]),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })), gap: Type.Optional(Type.Number({ minimum: 0 })), instruction: Type.String(),
  widthMetres: Type.Optional(Type.Number({ minimum: .001 })), depthMetres: Type.Optional(Type.Number({ minimum: .001 })), heightMetres: Type.Optional(Type.Number({ minimum: .001 })) });
const TicketSchema = Type.Object({ id: Type.String(), project: Type.String(), state: Type.String(), error: Type.Union([Type.String(), Type.Null()]),
  request: Type.Object({ baseRevisionId: Type.String(), proposalName: Type.String(), conversationVisual: Type.Optional(Type.Unknown()) }), result: Type.Unknown() });
const EnvelopeSchema = Type.Object({ capturedAt: Type.String(), entries: Type.Array(Type.Object({ case: CaseSchema, status: Type.String(),
  acceptedHeadUnchanged: Type.Optional(Type.Boolean()), ticket: Type.Optional(TicketSchema) }), { maxItems: 32 }) });
const ReadySchema = Type.Object({ status: Type.Literal('ready'), project: Type.String(), review: Type.Unknown() });
const DeclinedSchema = Type.Object({ status: Type.Literal('declined'), project: Type.String(), review: Type.Unknown() });
type SpatialEntity = Extract<Entity, { type: 'Furniture' | 'AssetInstance' | 'Equipment' }>;

function location(entity: SpatialEntity, snapshot: ModelSnapshot): MarkupPoint {
  return [entity.position[0], entity.position[1], (entityLevel(snapshot, entity)?.elevation ?? 0) + (entity.type === 'Equipment' ? entity.elevation : 0)];
}
function footprint(entity: SpatialEntity, snapshot: ModelSnapshot): Footprint {
  return { kind: 'oriented-rectangle', center: location(entity, snapshot), widthMetres: entity.type === 'AssetInstance' ? entity.size.width : entity.width,
    depthMetres: entity.type === 'AssetInstance' ? entity.size.depth : entity.depth, yawRadians: entity.type === 'Equipment' ? 0 : entity.rotationDeg / 180 * Math.PI };
}
function enclosingRectangle(shape: SpatialMarkup): SpatialMarkup {
  const points = shape.kind === 'circle' ? [[shape.center[0] - shape.radius, shape.center[1] - shape.radius, shape.center[2]],
    [shape.center[0] + shape.radius, shape.center[1] + shape.radius, shape.center[2]]] : shape.kind === 'rectangle' ? shape.corners : shape.kind === 'line' ? [shape.from, shape.to] : shape.points;
  const minX = Math.min(...points.map(p => p[0])); const maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])); const maxY = Math.max(...points.map(p => p[1])); const z = points[0]?.[2]; assert.ok(z !== undefined);
  return { kind: 'rectangle', corners: [[minX,minY,z],[maxX,minY,z],[maxX,maxY,z],[minX,maxY,z]], label: 'Independent bounding square/rectangle' };
}
const distance = (a: MarkupPoint, b: MarkupPoint): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function station(shape: SpatialMarkup, point: MarkupPoint): { station: number; perimeter: number; closed: boolean } {
  if (shape.kind === 'circle') {
    const angle = (Math.atan2(point[1] - shape.center[1], point[0] - shape.center[0]) + 2 * Math.PI) % (2 * Math.PI);
    return { station: angle * shape.radius, perimeter: 2 * Math.PI * shape.radius, closed: true };
  }
  const points = shape.kind === 'rectangle' ? [...shape.corners, shape.corners[0]] : shape.kind === 'line' ? [shape.from, shape.to] : shape.points;
  let total = 0; let closest = Infinity; let result = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i]; if (!a || !b) continue;
    const length = distance(a, b); const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / length ** 2));
    const projected: MarkupPoint = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
    const gap = distance(point, projected); if (gap < closest) { closest = gap; result = total + t * length; } total += length;
  }
  const first = points[0]; const last = points.at(-1);
  return { station: result, perimeter: total, closed: !!first && !!last && distance(first, last) < 1e-10 };
}

function spacing(shape: SpatialMarkup, points: MarkupPoint[]) {
  if (points.length < 2) return { satisfied: true, gaps: [] };
  if (shape.kind === 'rectangle') {
    const edges = shape.corners.map((a, i) => { const b = shape.corners[(i + 1) % 4]; assert.ok(b); return { a, b, length: distance(a, b) }; });
    const longest = Math.max(...edges.map(edge => edge.length));
    for (const edge of edges.filter(edge => Math.abs(edge.length - longest) < TOLERANCE_METRES)) {
      const line: SpatialMarkup = { kind: 'line', from: edge.a, to: edge.b, label: 'Candidate longest edge' };
      const aligned = points.every(point => { const grade = gradeCentreDistance({ markup: line, centre: point, targetDistanceMetres: 0 }); return grade.kind === 'supported' && grade.value.satisfied; });
      if (!aligned) continue;
      const stations = points.map(point => station(line, point).station).sort((a,b) => a-b);
      const gaps = stations.slice(1).map((value,i) => value - (stations[i] ?? value));
      return { satisfied: Math.min(...gaps) > TOLERANCE_METRES && Math.max(...gaps) - Math.min(...gaps) <= 2 * TOLERANCE_METRES, gaps };
    }
    return { satisfied: false, gaps: [], reason: 'Centres are not on one longest edge.' };
  }
  const stations = points.map(point => station(shape, point)); const first = stations[0]; assert.ok(first);
  const sorted = stations.map(item => item.station).sort((a,b) => a-b);
  const gaps = sorted.slice(1).map((value,i) => value - (sorted[i] ?? value));
  if (first.closed) gaps.push(first.perimeter - (sorted.at(-1) ?? 0) + (sorted[0] ?? 0));
  const expected = first.perimeter / (first.closed ? points.length : points.length - 1);
  return { satisfied: gaps.every(gap => Math.abs(gap - expected) <= 2 * TOLERANCE_METRES)
    && (first.closed || Math.abs(sorted[0] ?? Infinity) <= TOLERANCE_METRES && Math.abs((sorted.at(-1) ?? 0) - first.perimeter) <= TOLERANCE_METRES), gaps, expected };
}

assert.equal(process.env.QUAL_SERVER_CONTAINER, 'issue238'); assert.equal(process.platform, 'linux'); assert.ok(fs.existsSync('/.dockerenv'));
const input = process.env.MARKUP_EVIDENCE_INPUT; const output = process.env.MARKUP_EVIDENCE_OUTPUT; assert.ok(input && output);
assert.ok(fs.statSync(input).size <= 32 * 1024 ** 2);
const bytes = fs.readFileSync(input); const value: unknown = JSON.parse(bytes.toString('utf8'));
assert.ok(Check(EnvelopeSchema, value), 'The collected live evidence is malformed.');
const results = [];
for (const entry of value.entries) {
  const ticket = entry.ticket;
  if (ticket && entry.status === 'needs-input' && entry.case.relation === 'impossible-inside' && Check(DeclinedSchema, ticket.result)) {
    const shape = parseConversationVisual(ticket.request.conversationVisual).annotations[0];
    assert.ok(shape?.kind === 'circle' && entry.case.widthMetres && entry.case.depthMetres);
    const requiredRadius = Math.hypot(entry.case.widthMetres, entry.case.depthMetres) / 2;
    const before = await RoomRepository.restore(ticket.project); const declined = await RoomRepository.restore(ticket.result.project);
    const preserved = entry.acceptedHeadUnchanged === true && before.serialize() === declined.serialize();
    results.push({ case: entry.case.id, ticketId: ticket.id, outcome: preserved && requiredRadius > shape.radius + TOLERANCE_METRES ? 'infeasibility-proved-needs-semantic-review' : 'fail',
      preserved, requiredRadius, actualRadius: shape.radius, review: ticket.result.review }); continue;
  }
  if (!ticket || entry.status !== 'ready') {
    results.push({ case: entry.case.id, state: entry.status, outcome: ['undefined-region','impossible-inside'].includes(entry.case.relation) && entry.status === 'needs-input' ? 'manual-semantic-review' : 'not-qualified', error: ticket?.error }); continue;
  }
  assert.ok(Check(ReadySchema, ticket.result));
  const before = await RoomRepository.restore(ticket.project); const proposal = await RoomRepository.restore(ticket.result.project);
  const base = before.view(ticket.request.baseRevisionId).snapshot; const after = proposal.view(proposal.head(ticket.request.proposalName)).snapshot;
  const delta = diffSnapshots(base, after);
  const entities = delta.entities.added.filter(entity => entity.type === 'AssetInstance' || entity.type === 'Furniture' || entity.type === 'Equipment');
  const visual = parseConversationVisual(ticket.request.conversationVisual);
  const shapes = visual.annotations.filter(shape => shape.kind !== 'pin' && shape.kind !== 'arrow');
  assert.equal(shapes.length, 1); const shape = shapes[0]; assert.ok(shape);
  const measurements = entities.map(entity => {
    const region = footprint(entity, after);
    const centre = location(entity, after);
    const midpoint = shape.kind === 'line' ? [(shape.from[0] + shape.to[0]) / 2, (shape.from[1] + shape.to[1]) / 2, (shape.from[2] + shape.to[2]) / 2] satisfies MarkupPoint : null;
    const grade = entry.case.relation === 'undefined-region' ? { kind: 'supported', value: midpoint !== null && distance(centre, midpoint) <= TOLERANCE_METRES } satisfies { kind: 'supported'; value: boolean }
      : entry.case.relation === 'surface-wall' ? gradeBelowWall({ markup: shape, footprint: region, heightMetres: entry.case.heightMetres ?? 0, gapMetres: entry.case.gap ?? 0 })
      : entry.case.relation === 'inside' || entry.case.relation === 'impossible-inside' ? gradeInside({ markup: shape, footprint: region })
      : entry.case.relation === 'outside-gap' || entry.case.relation === 'outside-within-bounds' ? shape.kind === 'line'
        ? measureFootprintBoundaryDistances({ markup: shape, footprint: region }) : gradeOutside({ markup: shape, footprint: region, minimumGapMetres: entry.case.gap ?? 0 })
      : gradeCentreDistance({ markup: shape, centre: location(entity, after), targetDistanceMetres: 0 });
    const satisfied = grade.kind === 'supported' && (typeof grade.value === 'boolean' ? grade.value
      : 'satisfied' in grade.value ? grade.value.satisfied : grade.value.boundaryDistanceMetres + TOLERANCE_METRES >= (entry.case.gap ?? 0));
    const boundingSquare = entry.case.relation === 'outside-within-bounds' ? gradeInside({ markup: enclosingRectangle(shape), footprint: region }) : null;
    const size = entity.type === 'AssetInstance' ? entity.size : entity;
    const dimensions = (entry.case.widthMetres === undefined || Math.abs(size.width - entry.case.widthMetres) <= TOLERANCE_METRES)
      && (entry.case.depthMetres === undefined || Math.abs(size.depth - entry.case.depthMetres) <= TOLERANCE_METRES)
      && (entry.case.heightMetres === undefined || Math.abs(size.height - entry.case.heightMetres) <= TOLERANCE_METRES);
    return { id: entity.id, footprint: region, grade, boundingSquare, dimensions,
      satisfied: satisfied && dimensions && (!boundingSquare || boundingSquare.kind === 'supported' && boundingSquare.value) };
  });
  const separation = entry.case.relation === 'edge-centres' ? spacing(shape, entities.map(entity => location(entity, after))) : null;
  const preserved = entry.acceptedHeadUnchanged === true && delta.entities.modified.length === 0 && delta.entities.removed.length === 0
    && delta.relationships.modified.length === 0 && delta.relationships.removed.length === 0;
  const expectedCount = entry.case.count ?? (entry.case.relation === 'undefined-region' ? 1 : undefined);
  const passed = preserved && entities.length === expectedCount && measurements.every(item => item.satisfied) && (!separation || separation.satisfied);
  results.push({ case: entry.case.id, ticketId: ticket.id, outcome: passed ? entry.case.relation === 'undefined-region' ? 'midpoint-proved-needs-semantic-review' : 'pass' : 'fail', preserved, expectedCount,
    count: entities.length, shape, measurements, spacing: separation, review: ticket.result.review });
}
const receipt = { capturedAt: value.capturedAt, evidenceSha256: createHash('sha256').update(bytes).digest('hex'),
  graderSha256: createHash('sha256').update(fs.readFileSync(new URL('./grader.ts', import.meta.url))).digest('hex'), results };
fs.writeFileSync(output, JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(results.map(row => ({ case: row.case, outcome: row.outcome }))));
