import { Check } from 'typebox/value';
import { ModelParametersSchema, plainScopeData } from './model-scope-contract.ts';
import type { ModelParameter, ParameterizedEntity } from './model-scope-contract.ts';
import { identifier, validateSnapshot } from './room-model.ts';
import type { Entity, ModelSnapshot } from './room-model.ts';

const builtins = new Set(['geometry-width', 'geometry-depth', 'geometry-height', 'geometry-thickness',
  'geometry-elevation', 'geometry-rotation', 'geometry-sill-height']);

export function parseModelParameters(input: unknown): ModelParameter[] {
  const value = plainScopeData(input);
  if (!Check(ModelParametersSchema, value)) throw new Error('Parameters require exact bounded typed values and units.');
  const ids = new Set<string>();
  for (const item of value) {
    if (ids.has(item.definitionId)) throw new Error('Parameter definition IDs must be unique.');
    if (!item.name.trim() || /[\u0000-\u001f\u007f]/.test(item.name)) throw new Error('Parameter names must be readable.');
    ids.add(item.definitionId);
  }
  return structuredClone(value);
}

export function parseCustomModelParameters(value: unknown): ModelParameter[] {
  const parameters = parseModelParameters(value);
  if (parameters.some((item) => builtins.has(item.definitionId))) throw new Error('Custom parameters cannot shadow geometric built-ins.');
  return parameters;
}

/** Optional metadata is never synthesized on legacy records. */
export function retainModelParameters<T extends ParameterizedEntity>(before: ParameterizedEntity | undefined, after: T): T {
  return after.parameters === undefined && before?.parameters !== undefined
    ? { ...after, parameters: structuredClone(before.parameters) } : after;
}

export function modelParameters(entity: Entity): ModelParameter[] {
  const parameters: ModelParameter[] = [];
  const length = (id: string, value: number): void => { parameters.push({ definitionId: 'geometry-' + id,
    name: id, value: { kind: 'length', value, unit: 'm' } }); };
  if ('width' in entity) length('width', entity.width);
  if ('depth' in entity) length('depth', entity.depth);
  if ('height' in entity) length('height', entity.height);
  if ('thickness' in entity) length('thickness', entity.thickness);
  if ('elevation' in entity) length('elevation', entity.elevation);
  if (entity.type === 'Window') length('sill-height', entity.sillHeight);
  if (entity.type === 'Wall') length('width', Math.hypot(entity.end[0] - entity.start[0], entity.end[1] - entity.start[1]));
  if ('bounds' in entity) { length('width', entity.bounds.maxX - entity.bounds.minX); length('depth', entity.bounds.maxY - entity.bounds.minY); }
  if (entity.type === 'AssetInstance') { length('width', entity.size.width); length('depth', entity.size.depth); length('height', entity.size.height); }
  if (entity.type === 'Roof' && entity.profile.kind === 'flat') length('height', entity.profile.height);
  if ('rotationDeg' in entity) parameters.push({ definitionId: 'geometry-rotation', name: 'rotation',
    value: { kind: 'angle', value: entity.rotationDeg, unit: 'deg' } });
  return [...parameters, ...parseCustomModelParameters(entity.parameters ?? [])];
}

function editGeometry(entity: Entity, edit: ModelParameter): Entity {
  const supported = modelParameters(entity).find((item) => item.definitionId === edit.definitionId);
  if (!supported || supported.value.kind !== edit.value.kind) throw new Error('Unsupported geometric parameter or value kind.');
  const value = edit.value;
  if (edit.definitionId === 'geometry-rotation') {
    if (value.kind !== 'angle' || !('rotationDeg' in entity)) throw new Error('Rotation requires an angle.');
    const angle = value.value;
    if (angle !== 0 && angle !== 90 && angle !== 180 && angle !== 270) throw new Error('Rotation requires a supported cardinal angle.');
    return { ...entity, rotationDeg: angle };
  }
  if (value.kind !== 'length') throw new Error('Geometric dimensions require a length.');
  const metres = value.unit === 'mm' ? value.value / 1000 : value.value;
  switch (edit.definitionId) {
    case 'geometry-width':
      if (entity.type === 'AssetInstance') return { ...entity, size: { ...entity.size, width: metres } };
      if ('width' in entity) return { ...entity, width: metres };
      if ('bounds' in entity) return { ...entity, bounds: { ...entity.bounds, maxX: entity.bounds.minX + metres } };
      if (entity.type === 'Wall') {
        if (entity.start[1] === entity.end[1]) return { ...entity, end: [entity.start[0] + Math.sign(entity.end[0] - entity.start[0]) * metres, entity.end[1]] };
        if (entity.start[0] === entity.end[0]) return { ...entity, end: [entity.end[0], entity.start[1] + Math.sign(entity.end[1] - entity.start[1]) * metres] };
      }
      break;
    case 'geometry-depth':
      if (entity.type === 'AssetInstance') return { ...entity, size: { ...entity.size, depth: metres } };
      if ('depth' in entity) return { ...entity, depth: metres };
      if ('bounds' in entity) return { ...entity, bounds: { ...entity.bounds, maxY: entity.bounds.minY + metres } };
      break;
    case 'geometry-height':
      if (entity.type === 'AssetInstance') return { ...entity, size: { ...entity.size, height: metres } };
      if ('height' in entity) return { ...entity, height: metres };
      if (entity.type === 'Roof' && entity.profile.kind === 'flat') return { ...entity, profile: { ...entity.profile, height: metres } };
      break;
    case 'geometry-thickness': if ('thickness' in entity) return { ...entity, thickness: metres }; break;
    case 'geometry-elevation': if ('elevation' in entity) return { ...entity, elevation: metres }; break;
    case 'geometry-sill-height': if (entity.type === 'Window') return { ...entity, sillHeight: metres }; break;
  }
  throw new Error('This geometric edit has no safe authored-field mapping.');
}

/** Regenerate existing derived geometry through authored fields; validate the whole delta atomically. */
export function applyModelParameterEdits({ snapshot, targetIds, edits }: {
  snapshot: ModelSnapshot; targetIds: readonly string[]; edits: ModelParameter[];
}): ModelSnapshot {
  const base = validateSnapshot(snapshot);
  const parameters = parseModelParameters(edits);
  const targets = new Set(targetIds.map(identifier));
  if (!targets.size || targets.size !== targetIds.length || targets.size > 100
      || [...targets].some((id) => !base.entities.some((item) => item.id === id))) throw new Error('Parameter targets must be existing unique entity IDs.');
  for (const edit of parameters.filter((item) => !builtins.has(item.definitionId))) {
    for (const entity of base.entities) {
      const existing = entity.parameters?.find((item) => item.definitionId === edit.definitionId);
      if (existing && (existing.value.kind !== edit.value.kind || existing.name !== edit.name)) throw new Error('Parameter definition identity and value kind are immutable.');
    }
  }
  const entities = base.entities.map((entity): Entity => {
    if (!targets.has(entity.id)) return entity;
    if (entity.type === 'AssetFamily' && parameters.length) throw new Error('Family definitions are immutable; create an explicit subset variant.');
    let updated: Entity = entity;
    for (const edit of parameters) {
      if (builtins.has(edit.definitionId)) updated = editGeometry(updated, edit);
      else {
        const custom = updated.parameters ?? [];
        const existing = custom.some((item) => item.definitionId === edit.definitionId);
        updated = { ...updated, parameters: parseCustomModelParameters(existing
          ? custom.map((item) => item.definitionId === edit.definitionId ? edit : item) : [...custom, edit]) };
      }
    }
    return updated;
  });
  return validateSnapshot({ ...base, entities });
}
