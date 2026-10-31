import { Scene } from '@babylonjs/core/scene.js';
import { RegisterFileTools } from '@babylonjs/core/Misc/fileTools.pure.js';
import { RegisterRay } from '@babylonjs/core/Culling/ray.pure.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import type { Camera } from '@babylonjs/core/Cameras/camera.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { FxaaPostProcess } from '@babylonjs/core/PostProcesses/fxaaPostProcess.js';
import { SceneMeshBatches, SourceShadowLight } from './model-scene-batches.ts';
import '@babylonjs/core/Rendering/outlineRenderer.js';
import { modelChanges } from '../src/model-delta-view.ts';
import { furnitureFaces } from '../src/furniture-geometry.ts';
import { assetGeometry } from '../src/asset-family.ts';
import { floorBounds, boundsMm, spaces } from '../src/floor-plan.ts';
import { entityElevation, entityLevel, levels, levelView, roofHeightAt } from '../src/building-levels.ts';
import { slabPieces, wallSections } from '../src/viewer-geometry.ts';
import type { Bounds, Entity, ModelSnapshot, Point, ProjectId, Roof, Slab, Stair, Wall } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';

RegisterFileTools();
RegisterRay();

export type RenderingMode = 'basic' | 'realistic';
export const SELECTION_COLOR = '#1267d6';
export const HOVER_COLOR = '#ac67df';
type Surface = 'floor' | 'roof' | 'stair' | 'asset' | 'wall' | 'wood' | 'metal' | 'glass' | 'screen' | 'fabric' | 'leaf' | 'pot';
interface RenderPart {
  mesh: Mesh; objectId: string | null; wallId: string | null; surface: Surface; color: string; before: boolean;
  levelIds: readonly string[];
}

/** Model coordinates are X east, Y north, Z elevation; Babylon uses Y up. */
export function modelPoint(x: number, y: number, elevation = 0): Vector3 { return new Vector3(x, elevation, y); }

export function entityAnchor(item: Entity, snapshot: ModelSnapshot): Vector3 {
  if (item.type === 'AssetFamily') throw new Error('Asset family definitions are non-spatial.');
  const base = entityElevation(snapshot, item);
  if (item.type === 'AssetInstance') {
    const { bounds } = assetGeometry(snapshot, item);
    return modelPoint((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, base + bounds.maxZ + .15);
  }
  if (item.type === 'Space' || item.type === 'Level') {
    const b = item.type === 'Space' ? item.bounds : floorBounds(levelView(snapshot, item.id));
    return modelPoint((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, base + .15);
  }
  if (item.type === 'Slab' || item.type === 'Roof') {
    const b = item.bounds; const x = (b.minX + b.maxX) / 2; const y = (b.minY + b.maxY) / 2;
    return modelPoint(x, y, base + (item.type === 'Roof' ? roofHeightAt(snapshot, item.levelId, [x, y]) + item.thickness : 0) + .15);
  }
  if (item.type === 'Stair') {
    return modelPoint((item.start[0] + item.end[0]) / 2, (item.start[1] + item.end[1]) / 2,
      (base + entityElevation(snapshot, item.toLevelId)) / 2 + .15);
  }
  if (item.type === 'Furniture') {
    const support = snapshot.entities.find((candidate) => candidate.id === item.supportId);
    return modelPoint(...item.position, base + item.height + (support?.type === 'Furniture' ? support.height : 0) + .15);
  }
  if (item.type === 'Equipment') return modelPoint(...item.position, base + item.elevation + item.height + .15);
  if (item.type === 'Wall') return modelPoint((item.start[0] + item.end[0]) / 2, (item.start[1] + item.end[1]) / 2, base + .6);
  const host = snapshot.relationships.find((link) => link.source === item.id);
  const wall = snapshot.entities.find((candidate) => candidate.id === host?.target);
  if (!host || wall?.type !== 'Wall') throw new Error('Opening has no validated wall host.');
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const t = (host.offset + item.width / 2) / length;
  return modelPoint(wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t, base + .6);
}

export function referencePosition(reference: SpatialReference, snapshot: ModelSnapshot): Vector3 {
  if (reference.kind === 'floor-point') {
    if (snapshot.version === 2 && !('levelId' in reference)) throw new Error('A building floor reference requires its level.');
    const level = 'levelId' in reference ? levels(snapshot).find((item) => item.id === reference.levelId) : null;
    if ('levelId' in reference && !level) throw new Error('Reference level is absent.');
    return modelPoint(reference.positionMm[0] / 1000, reference.positionMm[1] / 1000, (level?.elevation ?? 0) + .025);
  }
  const wall = snapshot.entities.find((item) => item.id === reference.wallId);
  if (wall?.type !== 'Wall') throw new Error('Reference wall is absent.');
  const t = reference.alongWallMm / (Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) * 1000);
  return modelPoint(wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t, entityElevation(snapshot, wall) + .08);
}

/** Projects a ray hit to a domain annotation, never a model edit. */
export function referenceFromHit(snapshot: ModelSnapshot, point: Vector3, wallId: string | null, levelId?: string | null): SpatialReference | null {
  if (wallId) {
    const wall = snapshot.entities.find((item) => item.id === wallId);
    if (wall?.type !== 'Wall') return null;
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dy);
    const along = ((point.x - wall.start[0]) * dx + (point.z - wall.start[1]) * dy) / length;
    return { kind: 'wall-point', wallId, alongWallMm: Math.round(Math.max(0, Math.min(length, along)) * 1000) };
  }
  const level = levelId ? levels(snapshot).find((item) => item.id === levelId) : null;
  if (levelId && !level || snapshot.version === 2 && !level) return null;
  const b = boundsMm(floorBounds(level ? levelView(snapshot, level.id) : snapshot));
  const positionMm: Point = [Math.round(point.x * 1000), Math.round(point.z * 1000)];
  if (positionMm[0] < b.minX || positionMm[0] > b.maxX || positionMm[1] < b.minY || positionMm[1] > b.maxY) return null;
  return snapshot.version === 2 && level ? { kind: 'floor-point', levelId: level.id, positionMm } : { kind: 'floor-point', positionMm };
}

function woodTexture(scene: Scene): RawTexture {
  const size = 256; const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const seam = x % 64 < 2 || (y + Math.floor(x / 64) * 89) % 256 < 2;
    const grain = Math.sin(x * .65 + Math.sin(y * .06) * .9) * 4 + ((x * 13 + y * 7) % 11) * .4;
    const offset = (y * size + x) * 4;
    data[offset] = seam ? 130 : 192 + grain; data[offset + 1] = seam ? 103 : 158 + grain;
    data[offset + 2] = seam ? 75 : 115 + grain; data[offset + 3] = 255;
  }
  const texture = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.uScale = 3; texture.vScale = 2; texture.name = 'local-oak-grain';
  return texture;
}

/** Read-only scene projection. Owns GPU resources; no repository or authoring tools. */
export class ModelScene {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly insideCamera: FreeCamera;
  private antialiasing: FxaaPostProcess | null = null;
  get activeCamera(): Camera { return this.scene.activeCamera ?? this.camera; }

  useCamera(camera: Camera): void {
    if (camera === this.activeCamera) return;
    this.activeCamera.detachControl();
    this.antialiasing?.dispose();
    this.scene.activeCamera = camera;
    this.antialiasing = this.scene.getEngine().getRenderingCanvas() ? new FxaaPostProcess('model-antialiasing', 1, camera) : null;
    this.updateCutaway();
  }
  private readonly sun: DirectionalLight;
  private readonly ambient: HemisphericLight;
  private readonly shadow: ShadowGenerator;
  private readonly wood: RawTexture;
  private readonly parts: RenderPart[] = [];
  private readonly materials = new Map<string, StandardMaterial | PBRMaterial>();
  private readonly walls = new Map<string, Wall>();
  private focusId: string | null = null;
  private signature = '';
  private snapshot: ModelSnapshot | null = null;
  private comparison: ModelSnapshot | null = null;
  private readonly changes = new Map<string, ReturnType<typeof modelChanges>[number]>();
  private readonly comparisonLines: { mesh: Mesh; levelIds: readonly string[] }[] = [];
  private mode: RenderingMode = 'realistic';
  private selectedId = '';
  private hoveredId: string | null = null;
  private readonly pickParts = new Map<number, RenderPart>();
  private readonly batches: SceneMeshBatches;
  private readonly unitParts = new Map<string, RenderPart[]>();
  private projected: ModelSnapshot | null = null;
  private projectedBefore: ModelSnapshot | null = null;
  private beforeFilter = '';
  private projectId: ProjectId | null = null;
  private cutaway = true;
  private levelId: string | null = null;
  private roofVisible = true;
  private markerLevelId: string | null = null;
  private marker: Mesh | null = null;
  private markerLine: Mesh | null = null;
  private readonly markerMaterial: StandardMaterial;

  constructor(engine: AbstractEngine, batching: 'auto' | 'off' = 'auto') {
    this.scene = new Scene(engine);
    this.scene.clearColor = Color4.FromHexString('#e8efedff');
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = 1;
    this.scene.imageProcessingConfiguration.exposure = 1.15;
    this.camera = new ArcRotateCamera('room-camera', -Math.PI / 2.4, .86, 10, new Vector3(3, .5, 2), this.scene);
    this.insideCamera = new FreeCamera('inside-camera', new Vector3(0, 1.6, 0), this.scene);
    this.insideCamera.inputs.clear(); this.insideCamera.minZ = .05; this.insideCamera.maxZ = 500;
    this.scene.activeCamera = this.camera;
    if (engine.getRenderingCanvas()) this.antialiasing = new FxaaPostProcess('model-antialiasing', 1, this.camera);
    this.camera.minZ = .05; this.camera.maxZ = 500;
    this.camera.lowerBetaLimit = .08; this.camera.upperBetaLimit = Math.PI / 2 - .02;
    this.camera.lowerRadiusLimit = 1; this.camera.upperRadiusLimit = 150;
    this.camera.wheelDeltaPercentage = .015; this.camera.panningSensibility = 90;
    this.camera.pinchDeltaPercentage = .008;
    this.ambient = new HemisphericLight('sky-fill', new Vector3(.2, 1, .3), this.scene);
    this.ambient.groundColor = Color3.FromHexString('#778b80'); this.ambient.intensity = .85;
    this.sun = new SourceShadowLight('daylight', new Vector3(-.7, -1.4, .7), this.scene,
      () => this.parts.filter(part => !part.before && part.surface !== 'floor').map(part => part.mesh));
    this.sun.position = new Vector3(8, 12, -6); this.sun.intensity = 2.2;
    this.sun.diffuse = Color3.FromHexString('#fff1db');
    this.shadow = new ShadowGenerator(1024, this.sun);
    this.batches = new SceneMeshBatches(this.scene, this.shadow, batching === 'auto');
    this.shadow.usePercentageCloserFiltering = true; this.shadow.bias = .0005; this.shadow.normalBias = .025;
    this.wood = woodTexture(this.scene);
    this.markerMaterial = new StandardMaterial('annotation-only', this.scene);
    this.markerMaterial.diffuseColor = Color3.FromHexString('#087e70');
    this.markerMaterial.emissiveColor = Color3.FromHexString('#087e70');
    this.scene.onBeforeRenderObservable.add(() => this.updateCutaway());
  }

  private material(surface: Surface, color: string): StandardMaterial | PBRMaterial {
    const key = `${this.mode}:${surface}:${color}`;
    const existing = this.materials.get(key); if (existing) return existing;
    const tone = Color3.FromHexString(color);
    let material: StandardMaterial | PBRMaterial;
    if (this.mode === 'basic') {
      const simple = new StandardMaterial(key, this.scene);
      simple.diffuseColor = tone; simple.specularColor = Color3.Black(); material = simple;
    } else {
      const realistic = new PBRMaterial(key, this.scene);
      realistic.albedoColor = tone;
      realistic.metallic = surface === 'metal' ? .45 : 0;
      realistic.roughness = surface === 'glass' || surface === 'screen' ? .25 : surface === 'metal' ? .4 : .83;
      if (surface === 'floor' || surface === 'wood') { realistic.albedoTexture = this.wood; realistic.albedoColor = Color3.White(); }
      if (surface === 'screen') { realistic.emissiveColor = tone.scale(.28); }
      material = realistic;
    }
    material.backFaceCulling = false;
    this.materials.set(key, material); return material;
  }

  private register(mesh: Mesh, objectId: string | null, wallId: string | null, surface: Surface, color: string, snapshot: ModelSnapshot): void {
    mesh.material = this.material(surface, color); mesh.receiveShadows = true;
    mesh.outlineColor = Color3.FromHexString('#007e70'); mesh.outlineWidth = .012;
    const item = snapshot.entities.find((entity) => entity.id === objectId);
    const level = item ? entityLevel(snapshot, item) : null;
    const levelIds = item?.type === 'Stair' ? [item.fromLevelId, item.toLevelId] : level ? [level.id] : [];
    const part = { mesh, objectId, wallId, surface, color, before: false, levelIds };
    this.parts.push(part); this.pickParts.set(mesh.uniqueId, part);
    if (surface !== 'floor') this.shadow.addShadowCaster(mesh);
  }

  private box(snapshot: ModelSnapshot, name: string, size: Vector3, position: Vector3, objectId: string | null, wallId: string | null, surface: Surface, color: string, angle = 0): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    mesh.position.copyFrom(position); mesh.rotation.y = -angle;
    this.register(mesh, objectId, wallId, surface, color, snapshot); return mesh;
  }

  private solid(snapshot: ModelSnapshot, name: string, faces: Vector3[][], item: Entity, wallId: string | null, surface: Surface, color: string): void {
    const positions: number[] = []; const indices: number[] = [];
    for (const face of faces) {
      const offset = positions.length / 3;
      for (const point of face) positions.push(point.x, point.y, point.z);
      for (let i = 1; i < face.length - 1; i += 1) indices.push(offset, offset + i, offset + i + 1);
    }
    const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals;
    data.uvs = positions.flatMap((_, i) => i % 3 === 0 ? [positions[i] * .4, positions[i + 2] * .4] : []);
    const mesh = new Mesh(name, this.scene); data.applyToMesh(mesh);
    this.register(mesh, item.id, wallId, surface, color, snapshot);
  }

  private slab(slab: Slab, snapshot: ModelSnapshot): void {
    for (const [i, b] of slabPieces(snapshot, slab).entries()) {
      this.box(snapshot, `${slab.id}-solid-${i}`, new Vector3(b.maxX - b.minX, slab.thickness, b.maxY - b.minY),
        modelPoint((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, entityElevation(snapshot, slab) - slab.thickness / 2), slab.id, null, 'floor', '#d1c3a9');
    }
  }

  private stair(stair: Stair, snapshot: ModelSnapshot): void {
    const base = entityElevation(snapshot, stair); const rise = entityElevation(snapshot, stair.toLevelId) - base;
    const dx = stair.end[0] - stair.start[0]; const dy = stair.end[1] - stair.start[1];
    const run = Math.hypot(dx, dy); const angle = Math.atan2(dy, dx);
    for (let i = 0; i < stair.steps; i += 1) {
      const t = (i + .5) / stair.steps; const height = rise * (i + 1) / stair.steps;
      this.box(snapshot, `${stair.id}-step-${i + 1}`, new Vector3(run / stair.steps, height, stair.width),
        modelPoint(stair.start[0] + dx * t, stair.start[1] + dy * t, base + height / 2), stair.id, null, 'stair', '#c69a73', angle);
    }
  }

  private roof(roof: Roof, snapshot: ModelSnapshot): void {
    const b = roof.bounds; const profile = roof.profile;
    const rectangles: Bounds[] = profile.kind === 'flat' ? [b] : profile.ridgeAxis === 'x'
      ? [{ ...b, maxY: (b.minY + b.maxY) / 2 }, { ...b, minY: (b.minY + b.maxY) / 2 }]
      : [{ ...b, maxX: (b.minX + b.maxX) / 2 }, { ...b, minX: (b.minX + b.maxX) / 2 }];
    for (const [i, r] of rectangles.entries()) {
      const xy: Point[] = [[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]];
      const underside = xy.map(([x, y]) => modelPoint(x, y, entityElevation(snapshot, roof) + roofHeightAt(snapshot, roof.levelId, [x, y])));
      const upper = underside.map((point) => point.add(new Vector3(0, roof.thickness, 0)));
      const faces = [underside, [...upper].reverse()];
      for (let j = 0; j < 4; j += 1) faces.push([underside[j], upper[j], upper[(j + 1) % 4], underside[(j + 1) % 4]]);
      this.solid(snapshot, `${roof.id}-pitch-${i}`, faces, roof, null, 'roof', '#64727c');
    }
  }

  private wall(wall: Wall, snapshot: ModelSnapshot): void {
    this.walls.set(wall.id, wall);
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dy); const angle = Math.atan2(dy, dx);
    const base = entityElevation(snapshot, wall);
    let piece = 0;
    const openings = snapshot.relationships.filter((link) => link.target === wall.id).flatMap((link) => {
      const item = snapshot.entities.find((candidate) => candidate.id === link.source);
      return item?.type === 'Door' || item?.type === 'Window' ? [{ item, offset: link.offset, bottom: item.type === 'Window' ? item.sillHeight : 0 }] : [];
    }).sort((a, b) => a.offset - b.offset);
    const segment = (start: number, end: number, bottom: number, top: number): void => {
      if (end - start < .001 || top - bottom < .001) return;
      for (const section of wallSections(snapshot, wall, start, end, bottom, top)) {
        const at = (along: number, height: number, side: number): Vector3 => modelPoint(
          wall.start[0] + dx * along / length - dy / length * side,
          wall.start[1] + dy * along / length + dx / length * side, base + height);
        const half = wall.thickness / 2;
        const a = at(section.start, bottom, -half); const b = at(section.end, bottom, -half);
        const c = at(section.end, section.endTop, -half); const d = at(section.start, section.startTop, -half);
        const e = at(section.start, bottom, half); const f = at(section.end, bottom, half);
        const g = at(section.end, section.endTop, half); const h = at(section.start, section.startTop, half);
        this.solid(snapshot, `${wall.id}-solid-${piece++}`,
          [[a, b, c, d], [f, e, h, g], [e, a, d, h], [b, f, g, c], [d, c, g, h], [e, f, b, a]].map((face) => face.reverse()), wall, wall.id, 'wall', '#eeeae1');
      }
    };
    let cursor = 0;
    for (const { item, offset, bottom } of openings) {
      segment(cursor, offset, 0, wall.height);
      segment(offset, offset + item.width, 0, bottom);
      segment(offset, offset + item.width, bottom + item.height, wall.height);
      const centre = offset + item.width / 2;
      const at = (along: number, elevation: number): Vector3 => modelPoint(wall.start[0] + dx * along / length, wall.start[1] + dy * along / length, base + elevation);
      this.box(snapshot, `${item.id}-leaf`, new Vector3(item.width - .04, item.height - .03, item.type === 'Door' ? .045 : .018),
        at(centre, bottom + item.height / 2), item.id, wall.id, item.type === 'Door' ? 'wood' : 'glass', item.type === 'Door' ? '#be946d' : '#a8d2df', angle);
      for (const along of [offset + .02, offset + item.width - .02]) this.box(snapshot, `${item.id}-jamb-${along}`, new Vector3(.04, item.height, wall.thickness + .025), at(along, bottom + item.height / 2), item.id, wall.id, 'wall', '#faf8f1', angle);
      this.box(snapshot, `${item.id}-header`, new Vector3(item.width, .04, wall.thickness + .025), at(centre, bottom + item.height - .02), item.id, wall.id, 'wall', '#faf8f1', angle);
      cursor = offset + item.width;
    }
    segment(cursor, length, 0, wall.height);
  }

  private addSnapshot(snapshot: ModelSnapshot, unit: (key: string, owners: readonly string[], build: () => void) => void): void {
    const b = boundsMm(floorBounds(snapshot));
    const width = (b.maxX - b.minX) / 1000; const depth = (b.maxY - b.minY) / 1000;
    const rooms = spaces(snapshot);
    if (!rooms.length && snapshot.version !== 2) unit('floor:' + JSON.stringify(b), [], () => {
      this.box(snapshot, 'room-floor', new Vector3(width + .16, .12, depth + .16), modelPoint((b.minX + b.maxX) / 2000, (b.minY + b.maxY) / 2000, -.07), null, null, 'floor', '#d1c3a9');
    });
    for (const room of rooms) {
      if (snapshot.entities.some((item) => item.type === 'Slab' && item.levelId === room.levelId)) continue;
      const r = room.bounds;
      unit('floor:' + room.id, [room.id], () => this.box(snapshot, room.id + '-floor', new Vector3(r.maxX - r.minX, .12, r.maxY - r.minY), modelPoint((r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2, entityElevation(snapshot, room) - .07), room.id, null, 'floor', '#d1c3a9'));
    }
    for (const item of snapshot.entities) {
      const owners = item.type === 'Wall' ? [item.id, ...snapshot.relationships.filter(link => link.target === item.id).map(link => link.source)] : [item.id];
      unit('entity:' + item.id, owners, () => {
      if (item.type === 'Wall') this.wall(item, snapshot);
      else if (item.type === 'Slab') this.slab(item, snapshot);
      else if (item.type === 'Stair') this.stair(item, snapshot);
      else if (item.type === 'Roof') this.roof(item, snapshot);
      else if (item.type === 'AssetInstance') {
        const geometry = assetGeometry(snapshot, item); const base = entityElevation(snapshot, item);
        for (const color of new Set(geometry.faces.map((face) => face.fill))) {
          const faces = geometry.faces.filter((face) => face.fill === color)
            .map((face) => face.points.map(([x, y, z]) => modelPoint(x, y, base + z)).reverse());
          this.solid(snapshot, `${item.id}-${color}`, faces, item, null, 'asset', color);
        }
      }
      else if (item.type === 'Equipment') this.box(snapshot, item.id, new Vector3(item.width, item.height, item.depth), modelPoint(...item.position, entityElevation(snapshot, item) + item.elevation + item.height / 2), item.id, null, 'metal', '#8aabb1');
      else if (item.type === 'Furniture') {
        const faces = furnitureFaces(item, snapshot);
        const colors = new Set(faces.map((face) => face.fill));
        for (const color of colors) {
          const positions: number[] = []; const indices: number[] = [];
          for (const face of faces.filter((part) => part.fill === color)) {
            const offset = positions.length / 3;
            for (const [x, y, z] of face.points) positions.push(x, z + entityElevation(snapshot, item), y);
            for (let i = 1; i < face.points.length - 1; i += 1) indices.push(offset, offset + i + 1, offset + i);
          }
          const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
          const uvs: number[] = [];
          for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] * .4, positions[i + 2] * .4);
          const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs;
          const mesh = new Mesh(`${item.id}-${color}`, this.scene); data.applyToMesh(mesh);
          const surface: Surface = item.kind === 'plant' ? color === '#bb8165' ? 'pot' : 'leaf' : item.kind === 'chair' || item.kind === 'bed' || item.kind === 'sofa' ? 'fabric'
            : color === '#d6b58c' || color === '#c69a73' ? 'wood' : color === '#69b7d0' || color === '#8ccbd4' ? 'screen' : 'metal';
          this.register(mesh, item.id, null, surface, color, snapshot);
        }
      }
      });
    }
  }

  setModel(snapshot: ModelSnapshot, comparison: ModelSnapshot | null = null, projectId: ProjectId | null = null): boolean {
    const signature = JSON.stringify([snapshot, comparison]);
    if (signature === this.signature && projectId === this.projectId) return false;
    const first = !this.snapshot || projectId !== null && projectId !== this.projectId;
    // Snapshots have no project identity. Retention requires the caller's explicit
    // project ID; legacy callers retain conservative full-replacement behavior.
    if (projectId === null || projectId !== this.projectId) this.clearModel();
    this.projectId = projectId; this.mark(null); this.hoveredId = null;
    const invalid = (before: ModelSnapshot | null, after: ModelSnapshot): Set<string> | null =>
      !before || before.version !== after.version ? null : new Set(modelChanges(before, after).map(change => change.id));
    const changed = invalid(this.projected, snapshot);
    const changedBefore = comparison ? invalid(this.projectedBefore, comparison) : null;
    this.snapshot = snapshot; this.comparison = comparison; this.signature = signature;
    this.changes.clear();
    if (comparison) for (const change of modelChanges(comparison, snapshot)) this.changes.set(change.id, change);
    const filter = JSON.stringify([...this.changes.values()].map(change => [change.id, change.status]));
    const nextUnits = new Map<string, RenderPart[]>(); const nextParts: RenderPart[] = [];
    const project = (before: boolean, invalidated: Set<string> | null) => (key: string, owners: readonly string[], build: () => void): void => {
      if (before && !owners.some(id => this.changes.has(id))) return;
      const fullKey = (before ? 'before:' : 'after:') + key; const existing = this.unitParts.get(fullKey);
      if (existing && invalidated && !owners.some(id => invalidated.has(id)) && (!before || filter === this.beforeFilter)) {
        nextUnits.set(fullKey, existing); nextParts.push(...existing); return;
      }
      const start = this.parts.length; build(); const built = this.parts.splice(start);
      const retained = built.filter(part => {
        const change = part.objectId ? this.changes.get(part.objectId) : null;
        if (before && (!change || change.status === 'added')) {
          this.shadow.removeShadowCaster(part.mesh); this.pickParts.delete(part.mesh.uniqueId); part.mesh.dispose(); return false;
        }
        if (before) { this.shadow.removeShadowCaster(part.mesh); part.before = true; part.mesh.name = 'before:' + part.mesh.name; }
        return true;
      });
      nextUnits.set(fullKey, retained); nextParts.push(...retained);
    };
    this.addSnapshot(snapshot, project(false, changed));
    if (comparison) {
      this.addSnapshot(comparison, project(true, changedBefore));
    }
    const live = new Set(nextParts);
    for (const part of this.parts) if (!live.has(part)) {
      this.shadow.removeShadowCaster(part.mesh); this.pickParts.delete(part.mesh.uniqueId); part.mesh.dispose();
    }
    this.parts.length = 0; this.parts.push(...nextParts); this.unitParts.clear();
    for (const [key, parts] of nextUnits) this.unitParts.set(key, parts);
    this.walls.clear(); for (const item of snapshot.entities) if (item.type === 'Wall') this.walls.set(item.id, item);
    for (const line of this.comparisonLines) line.mesh.dispose(); this.comparisonLines.length = 0;
    if (comparison) {
      for (const change of this.changes.values()) {
        if (change.status !== 'modified') continue;
        if (change.before.type === 'AssetFamily' || change.after.type === 'AssetFamily') continue;
        const a = entityAnchor(change.before, comparison); const b = entityAnchor(change.after, snapshot);
        if (Vector3.Distance(a, b) < .002) continue;
        const line = MeshBuilder.CreateDashedLines('change-path:' + change.id, { points: [a, b], dashSize: 2, gapSize: 1, dashNb: 24 }, this.scene);
        line.color = Color3.FromHexString('#a85a00'); line.isPickable = false;
        const owners = [entityLevel(comparison, change.before), entityLevel(snapshot, change.after)].flatMap((level) => level ? [level.id] : []);
        if (change.before.type === 'Stair') owners.push(change.before.toLevelId);
        if (change.after.type === 'Stair') owners.push(change.after.toLevelId);
        this.comparisonLines.push({ mesh: line, levelIds: owners });
      }
    }
    this.projected = structuredClone(snapshot); this.projectedBefore = comparison ? structuredClone(comparison) : null; this.beforeFilter = filter;
    this.applyAppearance(); this.select(this.selectedId);
    if (first) this.frame();
    this.updateCutaway();
    return true;
  }

  private applyAppearance(): void {
    for (const part of this.parts) {
      if (!this.comparison) { part.mesh.material = this.material(part.surface, part.color); continue; }
      const change = part.objectId ? this.changes.get(part.objectId) : null;
      const kind = part.before ? change?.status === 'removed' ? 'removed-before' : 'modified-before' : change?.status ?? 'context';
      const key = 'delta:' + kind;
      let material = this.materials.get(key);
      if (!material) {
        const paint = new StandardMaterial(key, this.scene);
        paint.diffuseColor = Color3.FromHexString(kind.startsWith('removed') ? '#c63f54' : kind.startsWith('modified') ? '#df972c' : kind === 'added' ? '#149e76' : '#bcc9c7');
        paint.specularColor = Color3.Black();
        paint.alpha = kind === 'context' ? .22 : part.before ? .7 : 1;
        paint.wireframe = part.before; paint.backFaceCulling = false;
        paint.disableDepthWrite = part.before || kind === 'context';
        if (part.before) { paint.emissiveColor = paint.diffuseColor.scale(.4); paint.zOffset = -2; }
        this.materials.set(key, paint); material = paint;
      }
      part.mesh.material = material;
    }
  }

  setMode(mode: RenderingMode): void {
    if (mode !== this.mode) this.hover(null);
    this.mode = mode;
    this.scene.shadowsEnabled = mode === 'realistic';
    this.scene.imageProcessingConfiguration.toneMappingEnabled = mode === 'realistic';
    this.scene.imageProcessingConfiguration.exposure = mode === 'realistic' ? 1.15 : 1;
    this.sun.intensity = mode === 'realistic' ? 2.2 : .35;
    this.ambient.intensity = mode === 'realistic' ? .85 : .8;
    this.applyAppearance();
    this.syncBatches();
  }

  select(id: string): void {
    this.selectedId = id;
    this.updateHighlights();
  }

  hover(id: string | null): void {
    if (id === this.hoveredId) return;
    this.hoveredId = id; this.updateHighlights();
  }

  private updateHighlights(): void {
    for (const part of this.parts) {
      const selected = part.objectId === this.selectedId;
      const hovered = part.objectId !== null && part.objectId === this.hoveredId;
      part.mesh.renderOutline = selected || hovered;
      part.mesh.outlineColor = Color3.FromHexString(selected ? SELECTION_COLOR : HOVER_COLOR);
      part.mesh.outlineWidth = selected ? .025 : .018;
      part.mesh.renderOverlay = !part.before && (selected || hovered);
      part.mesh.overlayColor = part.mesh.outlineColor; part.mesh.overlayAlpha = selected ? .3 : .18;
    }
    this.syncBatches();
  }

  frame(focusId: string | null = this.focusId): void {
    this.hover(null);
    this.focusId = focusId;
    if (!this.snapshot) return;
    const focused = spaces(this.snapshot).find((room) => room.id === focusId && (this.levelId === null || room.levelId === this.levelId));
    const after = boundsMm(floorBounds(this.snapshot));
    const before = this.comparison ? boundsMm(floorBounds(this.comparison)) : after;
    let b = focused ? boundsMm(focused.bounds) : { minX: Math.min(before.minX, after.minX), minY: Math.min(before.minY, after.minY), maxX: Math.max(before.maxX, after.maxX), maxY: Math.max(before.maxY, after.maxY) };
    let minZ = 0; let maxZ = 0; let targetZ = .6;
    if (this.snapshot.version === 2 || this.comparison?.version === 2) {
      const owner = this.levelId ?? focused?.levelId ?? null;
      const boxes = this.parts.filter((part) => (owner === null || part.levelIds.includes(owner)) && (this.roofVisible || part.surface !== 'roof')).map((part) => {
        part.mesh.computeWorldMatrix(true); return part.mesh.getBoundingInfo().boundingBox;
      });
      if (boxes.length) {
        minZ = Math.min(...boxes.map((box) => box.minimumWorld.y)); maxZ = Math.max(...boxes.map((box) => box.maximumWorld.y));
        targetZ = (minZ + maxZ) / 2;
        if (!focused) b = { minX: Math.min(...boxes.map((box) => box.minimumWorld.x)) * 1000, maxX: Math.max(...boxes.map((box) => box.maximumWorld.x)) * 1000,
          minY: Math.min(...boxes.map((box) => box.minimumWorld.z)) * 1000, maxY: Math.max(...boxes.map((box) => box.maximumWorld.z)) * 1000 };
      }
    }
    this.camera.setTarget(modelPoint((b.minX + b.maxX) / 2000, (b.minY + b.maxY) / 2000, targetZ));
    this.camera.alpha = -Math.PI / 2.4; this.camera.beta = .86;
    const span = Math.max((b.maxX - b.minX) / 1000, (b.maxY - b.minY) / 1000, maxZ - minZ);
    this.camera.radius = Math.max(4, span * 1.65);
    this.camera.lowerRadiusLimit = Math.max(.4, span * .12); this.camera.upperRadiusLimit = Math.max(20, span * 8);
    this.camera.inertialAlphaOffset = 0; this.camera.inertialBetaOffset = 0; this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = 0; this.camera.inertialPanningY = 0;
  }

  setCutaway(enabled: boolean): void {
    if (enabled !== this.cutaway) this.hover(null);
    this.cutaway = enabled; this.updateCutaway();
  }

  setLevel(levelId: string | null): void {
    if (levelId === this.levelId) return;
    if (levelId !== null && this.snapshot && ![...levels(this.snapshot), ...(this.comparison ? levels(this.comparison) : [])].some((level) => level.id === levelId)) throw new Error('Unknown viewer level.');
    this.hover(null);
    this.levelId = levelId; this.focusId = null; this.updateCutaway(); this.frame(null);
  }

  setRoofVisible(visible: boolean): void {
    if (visible !== this.roofVisible) this.hover(null);
    this.roofVisible = visible; this.updateCutaway();
  }

  private contextBounds(): Bounds {
    if (!this.snapshot) throw new Error('No model to frame.');
    const focused = spaces(this.snapshot).find((room) => room.id === this.focusId && (this.levelId === null || room.levelId === this.levelId));
    if (focused) return focused.bounds;
    for (const snapshot of [this.snapshot, this.comparison]) {
      if (snapshot && this.levelId && levels(snapshot).some((level) => level.id === this.levelId)) return floorBounds(levelView(snapshot, this.levelId));
    }
    return floorBounds(this.snapshot);
  }

  private updateCutaway(): void {
    if (!this.snapshot) return;
    const b = boundsMm(this.contextBounds());
    const centre = modelPoint((b.minX + b.maxX) / 2000, (b.minY + b.maxY) / 2000);
    for (const part of this.parts) {
      const wall = part.wallId ? this.walls.get(part.wallId) : null;
      let visible = (this.levelId === null || part.levelIds.includes(this.levelId)) && (this.roofVisible || part.surface !== 'roof');
      const changedWallPart = this.comparison && part.objectId && this.changes.has(part.objectId);
      if (visible && this.cutaway && this.activeCamera === this.camera && wall && !part.before && !changedWallPart) {
        const midpoint = modelPoint((wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2);
        const outward = wall.start[1] === wall.end[1] ? new Vector3(0, 0, midpoint.z - centre.z) : new Vector3(midpoint.x - centre.x, 0, 0);
        visible = Vector3.Dot(outward, this.activeCamera.position.subtract(midpoint)) <= 0;
      }
      part.mesh.setEnabled(visible);
    }
    for (const line of this.comparisonLines) line.mesh.setEnabled(this.levelId === null || line.levelIds.includes(this.levelId));
    const markerVisible = this.levelId === null || this.markerLevelId === this.levelId;
    this.marker?.setEnabled(markerVisible); this.markerLine?.setEnabled(markerVisible);
    this.syncBatches();
  }

  private syncBatches(): void {
    this.batches.update(this.parts.map(part => ({ mesh: part.mesh, castsShadow: !part.before && part.surface !== 'floor' })), this.comparison === null);
    // Review context and ghosts already require individual sorting. Keep the
    // entire review pass and its caster order consistent with source parts.
    if (this.comparison) {
      const map = this.shadow.getShadowMap();
      if (map) map.renderList = this.parts.filter(part => !part.before && part.surface !== 'floor').map(part => part.mesh);
    }
  }

  renderResources(): ReturnType<SceneMeshBatches['resources']> { return this.batches.resources(); }

  objectAt(x: number, y: number): string | null {
    const hit = this.batches.pick(x, y, mesh => mesh.isPickable && this.pickParts.get(mesh.uniqueId)?.objectId != null);
    return hit ? this.pickParts.get(hit.mesh.uniqueId)?.objectId ?? null : null;
  }

  surfaceAt(x: number, y: number): { position: Vector3; normal: Vector3 } | null {
    const hit = this.batches.pick(x, y, mesh => mesh.isPickable && this.pickParts.get(mesh.uniqueId)?.before === false);
    if (!hit) return null;
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.activeCamera);
    const source = ray.intersectsMesh(hit.mesh, false);
    if (!source.hit || !source.pickedPoint || Vector3.Distance(source.pickedPoint, hit.point) > .00001) return null;
    const normal = source.getNormal(true);
    if (!normal) return null;
    return { position: hit.point, normal: normal.normalize() };
  }

  referenceAt(x: number, y: number): SpatialReference | null {
    if (!this.snapshot) return null;
    const hit = this.batches.pick(x, y, mesh => {
      const part = this.pickParts.get(mesh.uniqueId); return !!part && !part.before && (part.surface === 'floor' || part.wallId !== null);
    });
    if (!hit) return null;
    const part = this.pickParts.get(hit.mesh.uniqueId);
    if (this.snapshot.version === 2 && part?.surface === 'floor') {
      const level = part.levelIds[0];
      if (!level || Math.abs(hit.point.y - entityElevation(this.snapshot, level)) > .03) return null;
    }
    return referenceFromHit(this.snapshot, hit.point, part?.wallId ?? null, part?.levelIds[0]);
  }

  mark(reference: SpatialReference | null): void {
    this.marker?.dispose(); this.markerLine?.dispose(); this.marker = null; this.markerLine = null;
    this.markerLevelId = null;
    if (!reference || !this.snapshot) return;
    const target = referencePosition(reference, this.snapshot);
    this.markerLevelId = reference.kind === 'wall-point' ? entityLevel(this.snapshot, reference.wallId)?.id ?? null
      : 'levelId' in reference ? reference.levelId : null;
    if (reference.kind === 'floor-point' && !('levelId' in reference) && this.snapshot.version !== 2) {
      const storeys = levels(this.snapshot);
      if (storeys.length === 1) this.markerLevelId = storeys[0].id;
    }
    this.marker = MeshBuilder.CreateTorus('request-marker-not-geometry', { diameter: .34, thickness: .025, tessellation: 32 }, this.scene);
    this.marker.position.copyFrom(target); this.marker.material = this.markerMaterial; this.marker.isPickable = false;
    const source = this.snapshot.entities.find((item) => item.id === this.selectedId);
    if (source && source.type !== 'AssetFamily') {
      const line = MeshBuilder.CreateDashedLines('request-reference-line', { points: [entityAnchor(source, this.snapshot), target], dashSize: 2, gapSize: 1, dashNb: 30 }, this.scene);
      line.color = Color3.FromHexString('#087e70'); line.isPickable = false; this.markerLine = line;
    }
    this.updateCutaway();
  }

  anchorOnScreen(id: string, width: number, height: number): Point | null {
    const after = this.snapshot?.entities.find((candidate) => candidate.id === id);
    const item = after ?? this.comparison?.entities.find((candidate) => candidate.id === id);
    const source = after ? this.snapshot : this.comparison;
    if (!item || !source || item.type === 'AssetFamily' || this.levelId !== null && entityLevel(source, item)?.id !== this.levelId
      && !(item.type === 'Stair' && item.toLevelId === this.levelId) || !this.roofVisible && item.type === 'Roof') return null;
    const engine = this.scene.getEngine();
    const projected = Vector3.Project(entityAnchor(item, source), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    if (projected.z < 0 || projected.z > 1) return null;
    return [projected.x / engine.getRenderWidth() * width, projected.y / engine.getRenderHeight() * height];
  }

  private clearModel(): void {
    this.mark(null);
    this.batches.clear(); this.unitParts.clear(); this.projected = null; this.projectedBefore = null;
    for (const part of this.parts) { this.shadow.removeShadowCaster(part.mesh); part.mesh.dispose(); }
    this.parts.length = 0; this.walls.clear(); this.pickParts.clear(); this.hoveredId = null;
    for (const line of this.comparisonLines) line.mesh.dispose();
    this.comparisonLines.length = 0;
  }

  dispose(): void { this.clearModel(); this.scene.dispose(); }
}
