import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import * as IFC from 'web-ifc';
import * as THREE from 'three';
import { EditRequestType, EditUtils, GeomsFbUtils, RenderedFaces } from '@thatopen/fragments';
import type { EditRequest } from '@thatopen/fragments';
import { NativeManifestSchema, parseModel } from './contract.ts';
import type { Camera, Geometry, Model, Vec3 } from './contract.ts';

export const sourceRevision = '9ba471a3e38b353a81a1dc9ecb4aa56d2ce0a7fa';
const repository = 'https://huggingface.co/datasets/sylvainHellin/ifc-bench';
const sourcePrefix = 'projects/west_riverside_hospital/';
export const disciplines = [
  { id: 'architecture', file: 'arc_ifc4.ifc' }, { id: 'structure', file: 'str_ifc4.ifc' },
  { id: 'mechanical', file: 'mech_ifc4.ifc' }, { id: 'electrical', file: 'elec_ifc4.ifc' },
  { id: 'plumbing', file: 'plumb_ifc4.ifc' }, { id: 'fire-alarm', file: 'fire_ifc4.ifc' },
  { id: 'sprinklers', file: 'sprinkle_ifc4.ifc' },
];
const listingSchema = Type.Array(Type.Object({ path: Type.String(), size: Type.Integer({ minimum: 0 }),
  lfs: Type.Optional(Type.Object({ oid: Type.String({ pattern: '^[a-f0-9]{64}$' }), size: Type.Integer() })),
}));
const listingURL = `https://huggingface.co/api/datasets/sylvainHellin/ifc-bench/tree/${sourceRevision}/${sourcePrefix.slice(0, -1)}`;
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const valueSchema = Type.Object({ value: Type.String() });
const productSchema = Type.Object({ GlobalId: Type.Optional(valueSchema), Name: Type.Optional(Type.Union([valueSchema, Type.Null()])) });
const sourcesSchema = Type.Object({ sourceRevision: Type.Literal(sourceRevision), files: Type.Array(Type.Object({
  id: Type.String(), file: Type.String(), bytes: Type.Integer({ minimum: 1 }), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
})) });

export function nativeFragments(model: Model): Uint8Array {
  const requests: EditRequest[] = [];
  const geometries = new Map(model.geometries.map(item => [item.id, item]));
  const representations = new Map<string, number>(); const materials = new Map<string, number>();
  // Allocate deterministic native item IDs in source order; stable BIM IDs
  // remain attributes and never depend on a renderer's numeric IDs.
  let nextId = model.elements.length;
  const identity = { position: [0, 0, 0], xDirection: [1, 0, 0], yDirection: [0, 1, 0] };
  for (const [localId, item] of model.elements.entries()) {
    const geometryKey = JSON.stringify([item.geometryId, item.scale]); let representation = representations.get(geometryKey);
    if (representation === undefined) {
      const geometry = geometries.get(item.geometryId); if (!geometry) throw new Error('Missing native source geometry');
      const buffer = new THREE.BufferGeometry();
      buffer.setAttribute('position', new THREE.Float32BufferAttribute(geometry.positions.map((value, index) => value * item.scale[index % 3]), 3));
      buffer.setIndex(geometry.indices); buffer.computeVertexNormals();
      const data = GeomsFbUtils.representationFromGeometry(buffer, undefined, { threshold: 0, precision: 1e6,
        normalPrecision: 1e7, planePrecision: 1e3, faceThreshold: .6, forceTransparentSpaces: false });
      buffer.dispose(); representation = nextId++; representations.set(geometryKey, representation);
      requests.push({ type: EditRequestType.CREATE_REPRESENTATION, localId: representation, data });
    }
    const colorKey = item.color.join(','); let material = materials.get(colorKey);
    if (material === undefined) {
      material = nextId++; materials.set(colorKey, material);
      requests.push({ type: EditRequestType.CREATE_MATERIAL, localId: material,
        data: { r: item.color[0] * 255, g: item.color[1] * 255, b: item.color[2] * 255, a: 255, renderedFaces: RenderedFaces.TWO, stroke: 0 } });
    }
    const globalTransform = nextId++; const localTransform = nextId++; const sample = nextId++;
    requests.push({ type: EditRequestType.CREATE_ITEM, localId,
      data: { category: item.category, guid: item.id, data: { benchmarkId: { value: item.id },
        ...Object.fromEntries(Object.entries(item.properties).map(([key, value]) => ['property:' + key, { value }])) } } });
    requests.push({ type: EditRequestType.CREATE_GLOBAL_TRANSFORM, localId: globalTransform, data: { ...identity, position: item.position, itemId: localId } });
    requests.push({ type: EditRequestType.CREATE_LOCAL_TRANSFORM, localId: localTransform, data: identity });
    requests.push({ type: EditRequestType.CREATE_SAMPLE, localId: sample,
      data: { item: globalTransform, material, representation, localTransform } });
  }
  requests.push({ type: EditRequestType.UPDATE_MAX_LOCAL_ID, localId: nextId });
  const base = EditUtils.getModelFromBuffer(EditUtils.newModel({ raw: true }), true);
  return EditUtils.edit(base, requests, { raw: true, delta: false }).model;
}

export async function prepareNative(input: string, output: string): Promise<void> {
  const started = performance.now(); const text = await fs.readFile(input, 'utf8');
  const preprocessorSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
  const model = parseModel(JSON.parse(text), 'transfer');
  const bytes = nativeFragments(model);
  const trianglesByGeometry = new Map(model.geometries.map(geometry => [geometry.id, geometry.indices.length / 3]));
  const manifest = { version: 1, format: 'fragments-3.6.0-raw', modelId: model.id, revision: model.revision,
    preprocessorSha256,
    sourceSha256: hash(JSON.stringify(model)), sha256: hash(bytes), bytes: bytes.length, elements: model.elements.length,
    triangles: model.elements.reduce((total, item) => total + (trianglesByGeometry.get(item.geometryId) ?? 0), 0),
    disciplines: Object.fromEntries([...new Set(model.elements.map(item => item.discipline))].map(discipline =>
      [discipline, model.elements.filter(item => item.discipline === discipline).length])),
    preparationMs: performance.now() - started, qualified: false, grossFloorAreaM2: model.grossFloorAreaM2 };
  if (!Check(NativeManifestSchema, manifest)) throw new Error('Invalid native preprocessing manifest');
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, bytes, { flag: 'wx' });
  await fs.writeFile(output + '.json', JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(manifest) + '\n');
}

export function transformedPositions(vertices: ArrayLike<number>, matrix: number[]): number[] {
  if (vertices.length % 6 || matrix.length !== 16 || matrix.some(value => !Number.isFinite(value))) throw new Error('Invalid IFC geometry transform');
  const positions: number[] = [];
  for (let i = 0; i < vertices.length; i += 6) {
    const x = vertices[i]; const y = vertices[i + 1]; const z = vertices[i + 2];
    for (const value of [matrix[0] * x + matrix[4] * y + matrix[8] * z,
      matrix[1] * x + matrix[5] * y + matrix[9] * z, matrix[2] * x + matrix[6] * y + matrix[10] * z]) {
      if (!Number.isFinite(value)) throw new Error('Non-finite tessellation vertex');
      positions.push(Math.round(value * 1e6) / 1e6);
    }
  }
  return positions;
}

export async function downloadSources(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const response = await fetch(listingURL); if (!response.ok) throw new Error('Cannot read pinned source listing: ' + response.status);
  const listing: unknown = await response.json(); if (!Check(listingSchema, listing)) throw new Error('Invalid publisher file listing');
  const manifest = [];
  for (const source of disciplines) {
    const entry = listing.find(item => item.path === sourcePrefix + source.file);
    if (!entry?.lfs || entry.lfs.size !== entry.size) throw new Error('Missing source hash: ' + source.file);
    const filename = path.join(directory, source.file);
    let bytes: Uint8Array;
    try { bytes = await fs.readFile(filename); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const file = await fetch(repository + '/resolve/' + sourceRevision + '/' + entry.path);
      if (!file.ok) throw new Error('Cannot download ' + source.file + ': ' + file.status);
      bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== entry.size || hash(bytes) !== entry.lfs.oid) throw new Error('Source integrity mismatch: ' + source.file);
      await fs.writeFile(filename, bytes, { flag: 'wx' });
    }
    if (bytes.length !== entry.size || hash(bytes) !== entry.lfs.oid) throw new Error('Cached source integrity mismatch: ' + source.file);
    manifest.push({ ...source, bytes: bytes.length, sha256: entry.lfs.oid });
    process.stdout.write('Verified source ' + source.file + ' (' + bytes.length + ' bytes)\n');
  }
  for (const filename of ['license.txt', 'model_card.md']) {
    const notice = await fetch(repository + '/raw/' + sourceRevision + '/' + sourcePrefix + filename);
    if (!notice.ok) throw new Error('Cannot retain source notice: ' + filename);
    await fs.writeFile(path.join(directory, filename), await notice.text());
  }
  await fs.writeFile(path.join(directory, 'sources.json'), JSON.stringify({ sourceRevision, listingURL, files: manifest,
    totalBytes: manifest.reduce((sum, file) => sum + file.bytes, 0), usage: 'Human-authorized local-only initial evaluation',
    license: 'Publisher declares CC BY 3.0; upstream rights history unresolved; not cleared for redistribution',
    grossFloorAreaM2: null, qualified: false }, null, 2) + '\n');
}

export async function convertSources(directory: string, output: string): Promise<void> {
  const started = performance.now();
  const sources: unknown = JSON.parse(await fs.readFile(path.join(directory, 'sources.json'), 'utf8'));
  if (!Check(sourcesSchema, sources) || sources.files.length !== disciplines.length) throw new Error('Missing verified seven-discipline source manifest');
  const api = new IFC.IfcAPI(); await api.Init();
  const geometries: Geometry[] = []; const elements: Model['elements'] = [];
  const knownGeometry = new Map<string, Geometry>();
  const inventories = [];
  const worldMin: Vec3 = [Infinity, Infinity, Infinity]; const worldMax: Vec3 = [-Infinity, -Infinity, -Infinity];
  const sourceHashes: string[] = [];
  try {
    for (const source of disciplines) {
      const disciplineStart = performance.now();
      const bytes = await fs.readFile(path.join(directory, source.file));
      const expected = sources.files.filter(file => file.id === source.id && file.file === source.file);
      if (expected.length !== 1 || expected[0].bytes !== bytes.length || expected[0].sha256 !== hash(bytes)) throw new Error('Source integrity mismatch: ' + source.file);
      sourceHashes.push(hash(bytes));
      const modelID = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 12 });
      if (modelID < 0) throw new Error('IFC parse failed: ' + source.file);
      const categoryCounts: Record<string, number> = {}; const omissions: Record<string, number> = {};
      const productIDs = new Set<number>(); let meshParts = 0; let triangles = 0; let transparentParts = 0;
      try {
        api.StreamAllMeshes(modelID, mesh => {
          const category = api.GetNameFromTypeCode(api.GetLineType(modelID, mesh.expressID));
          if (['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCANNOTATION'].includes(category.toUpperCase())) {
            omissions[category] = (omissions[category] ?? 0) + 1; return;
          }
          const value: unknown = api.GetLine(modelID, mesh.expressID);
          if (!Check(productSchema, value)) throw new Error('Invalid product metadata: ' + mesh.expressID);
          const sourceID = value.GlobalId?.value ?? 'express-' + mesh.expressID;
          for (let part = 0; part < mesh.geometries.size(); part++) {
            const placed = mesh.geometries.get(part); const matrix = placed.flatTransformation;
            const key = source.id + ':' + placed.geometryExpressID + ':' + matrix.slice(0, 12).join(',');
            let geometry = knownGeometry.get(key);
            if (!geometry) {
              const native = api.GetGeometry(modelID, placed.geometryExpressID);
              try {
                const vertices = api.GetVertexArray(native.GetVertexData(), native.GetVertexDataSize());
                const indices = Array.from(api.GetIndexArray(native.GetIndexData(), native.GetIndexDataSize()));
                if (!vertices.length || !indices.length) { omissions['empty-geometry-part'] = (omissions['empty-geometry-part'] ?? 0) + 1; continue; }
                geometry = { id: 'geometry-' + geometries.length, positions: transformedPositions(vertices, matrix), indices };
                knownGeometry.set(key, geometry); geometries.push(geometry);
              } finally { native.delete(); }
            }
            if (matrix.length !== 16 || matrix.some(value => !Number.isFinite(value))) throw new Error('Invalid placed IFC matrix');
            const position: Vec3 = [matrix[12], matrix[13], matrix[14]];
            for (let index = 0; index < geometry.positions.length; index += 3) for (let axis = 0; axis < 3; axis++) {
              const world = geometry.positions[index + axis] + position[axis];
              worldMin[axis] = Math.min(worldMin[axis], world); worldMax[axis] = Math.max(worldMax[axis], world);
            }
            if (placed.color.w < 1) transparentParts++;
            elements.push({ id: source.id + ':' + sourceID + ':' + part, category, discipline: source.id, storey: 'unmapped',
              geometryId: geometry.id, position, scale: [1, 1, 1], color: [placed.color.x, placed.color.y, placed.color.z],
              properties: { Name: value.Name?.value ?? sourceID, SourceGlobalId: sourceID, SourceExpressId: String(mesh.expressID),
                SourceFile: source.file, SourceProductId: source.id + ':' + sourceID, OriginalAlpha: String(placed.color.w) } });
            productIDs.add(mesh.expressID); meshParts++; triangles += geometry.indices.length / 3;
          }
          categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
        });
        if (!meshParts) throw new Error('Discipline produced no renderable geometry: ' + source.id);
        const inventory = { ...source, sha256: sourceHashes.at(-1), bytes: bytes.length, schema: api.GetModelSchema(modelID),
          products: api.GetLineIDsWithType(modelID, IFC.IFCPRODUCT, true).size(),
          spaces: api.GetLineIDsWithType(modelID, IFC.IFCSPACE).size(), storeys: api.GetLineIDsWithType(modelID, IFC.IFCBUILDINGSTOREY).size(),
          renderedProducts: productIDs.size, meshParts, triangles, transparentPartsMadeOpaque: transparentParts, categoryCounts, omissions,
          conversionMs: performance.now() - disciplineStart };
        inventories.push(inventory); process.stdout.write(JSON.stringify(inventory) + '\n');
      } finally { api.CloseModel(modelID); }
    }
  } finally { api.Dispose(); }
  const origin: Vec3 = [(worldMin[0] + worldMax[0]) / 2, (worldMin[1] + worldMax[1]) / 2, (worldMin[2] + worldMax[2]) / 2];
  for (const element of elements) element.position = [element.position[0] - origin[0], element.position[1] - origin[1], element.position[2] - origin[2]];
  const radius = Math.max(...worldMax.map((value, axis) => value - worldMin[axis]));
  const cameraPath = Array.from({ length: 30 }, (_, index): Camera => {
    const angle = index / 30 * Math.PI * 2;
    return { eye: [Math.cos(angle) * radius * 1.1, radius * .65, Math.sin(angle) * radius * 1.1], target: [0, 0, 0] };
  });
  const model = parseModel({ version: 1, id: 'west-riverside-seven-ifc4', revision: sourceRevision,
    coordinateSystem: 'right-handed-y-up-metres', grossFloorAreaM2: null, cameraPath,
    provenance: { kind: 'public-unverified', sourceHashes, permissionEvidence: 'sources.json; user authorized local-only evaluation',
      floorAreaEvidence: 'Unknown; no building-level 200,000 m² area proof', coordinateReference: 'web-ifc placed geometry, common origin in conversion.json',
      conversionEvidence: 'conversion.json', inventoryEvidence: 'conversion.json', limitations: [
        'Publisher CC BY 3.0 notice retained locally; upstream authorization history unresolved. No source or derived geometry publication.',
        'Gross floor area and real-building identity unverified. No 200k+ qualification.',
        'Tessellated mesh parts keep source product IDs; part count is not BIM entity count.',
        'Rooms/storey containment, full property sets, textures, transparency and engineering regeneration are not qualified.',
        'web-ifc 0.0.77; 12 circle segments; affine orientation baked; coordinates rounded to 1 micrometre; alpha made opaque.',
      ] }, geometries, elements });
  const json = JSON.stringify(model);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, json, { flag: 'wx' });
  const report = { sourceRevision, qualified: false, grossFloorAreaM2: null, origin, sourceBounds: { min: worldMin, max: worldMax },
    elements: elements.length, geometries: geometries.length, renderedTriangles: inventories.reduce((sum, item) => sum + item.triangles, 0),
    jsonBytes: Buffer.byteLength(json), jsonSha256: hash(json), conversionMs: performance.now() - started, inventories };
  await fs.writeFile(path.join(path.dirname(output), 'conversion.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('Converted all seven disciplines: ' + model.elements.length + ' mesh parts, ' + Buffer.byteLength(json) + ' JSON bytes\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[3] ?? 'artifacts/private/west-riverside/source');
  if (process.argv[2] === 'download') await downloadSources(directory);
  else if (process.argv[2] === 'convert') await convertSources(directory, path.resolve(process.argv[4] ?? 'artifacts/private/west-riverside/prepared/model.json'));
  else if (process.argv[2] === 'native') await prepareNative(directory, path.resolve(process.argv[4] ?? 'artifacts/private/west-riverside/native/model.frag'));
  else throw new Error('Use west-riverside.ts download [directory], convert [directory] [output-model.json], or native input-model.json output.frag');
}
