import { Type } from 'typebox';
import type { Static } from 'typebox';

const identifier = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
const name = Type.String({ minLength: 1, maxLength: 80 });
const coordinate = Type.Integer({ minimum: -1000000, maximum: 1000000 });
const dimension = Type.Integer({ minimum: 1, maximum: 100000 });
const bounds = Type.Object({ minX: coordinate, minY: coordinate, maxX: coordinate, maxY: coordinate }, { additionalProperties: false, title: 'LayoutBounds' });
const side = Type.Union([Type.Literal('north'), Type.Literal('south'), Type.Literal('east'), Type.Literal('west')], { title: 'OpeningSide' });
const opening = { id: identifier, name, roomId: identifier, side,
  offsetMm: Type.Integer({ minimum: 0, maximum: 1000000 }), widthMm: dimension, heightMm: dimension };
const floorFields = {
  rooms: Type.Array(Type.Object({ id: identifier, name, boundsMm: bounds }, { additionalProperties: false, title: 'LayoutRoom' }), { minItems: 2, maxItems: 12 }),
  wallThicknessMm: dimension, heightMm: dimension,
  openings: Type.Array(Type.Union([
    Type.Object({ ...opening, type: Type.Literal('Door') }, { additionalProperties: false }),
    Type.Object({ ...opening, type: Type.Literal('Window'), sillHeightMm: Type.Integer({ minimum: 0, maximum: 100000 }) }, { additionalProperties: false }),
  ], { title: 'FloorOpening' }), { maxItems: 100 }),
};
export const FloorLayoutSchema = Type.Object({
  level: Type.Object({ id: identifier, name }, { additionalProperties: false }), ...floorFields,
}, { title: 'FloorLayout', additionalProperties: false });
export type FloorLayout = Static<typeof FloorLayoutSchema>;

export const RoofLayoutProfileSchema = Type.Union([
  Type.Object({ kind: Type.Literal('flat'), heightMm: dimension }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('gable'), eaveHeightMm: dimension, ridgeHeightMm: dimension,
    ridgeAxis: Type.Union([Type.Literal('x'), Type.Literal('y')], { title: 'RidgeAxis' }) }, { additionalProperties: false }),
], { title: 'RoofLayoutProfile' });
export const BuildingLayoutSchema = Type.Object({
  levels: Type.Array(Type.Object({
    level: Type.Object({ id: identifier, name, elevationMm: Type.Integer({ minimum: -100000, maximum: 100000 }) }, { additionalProperties: false }),
    ...floorFields, slabThicknessMm: Type.Integer({ minimum: 1, maximum: 5000 }),
    roof: Type.Union([Type.Object({ boundsMm: bounds, thicknessMm: Type.Integer({ minimum: 1, maximum: 5000 }),
      profile: RoofLayoutProfileSchema }, { additionalProperties: false }), Type.Null()], { title: 'LevelRoofLayout' }),
  }, { additionalProperties: false, title: 'BuildingLevelLayout' }), { minItems: 1, maxItems: 6 }),
  stairs: Type.Array(Type.Object({ id: identifier, name, fromLevelId: identifier, toLevelId: identifier,
    startMm: Type.Tuple([coordinate, coordinate]), endMm: Type.Tuple([coordinate, coordinate]),
    widthMm: Type.Integer({ minimum: 100, maximum: 5000 }), steps: Type.Integer({ minimum: 1, maximum: 100 }),
  }, { additionalProperties: false, title: 'StairLayout' }), { maxItems: 10 }),
}, { title: 'BuildingLayout', additionalProperties: false });
export type BuildingLayout = Static<typeof BuildingLayoutSchema>;
