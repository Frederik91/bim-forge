import { Scene } from '@babylonjs/core/scene.js';
import { RegisterFileTools } from '@babylonjs/core/Misc/fileTools.pure.js';
import { RegisterRay } from '@babylonjs/core/Culling/ray.pure.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';
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
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Rendering/outlineRenderer.js';
import { modelChanges } from '../src/model-delta-view.ts';
import { furnitureFaces } from '../src/furniture-geometry.ts';
import { rectangleLayout } from '../src/room-model.ts';
import type { Entity, ModelSnapshot, Point, Wall } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';

RegisterFileTools();
RegisterRay();

export type RenderingMode = 'basic' | 'realistic';
type Surface = 'floor' | 'wall' | 'wood' | 'metal' | 'glass' | 'screen' | 'fabric' | 'leaf' | 'pot';
interface RenderPart { mesh: Mesh; objectId: string | null; wallId: string | null; surface: Surface; color: string; before: boolean }

/** Model coordinates are X east, Y north, Z elevation; Babylon uses Y up. */
export function modelPoint(x: number, y: number, elevation = 0): Vector3 { return new Vector3(x, elevation, y); }

export function entityAnchor(item: Entity, snapshot: ModelSnapshot): Vector3 {
  if (item.type === 'Furniture') {
    const support = snapshot.entities.find((candidate) => candidate.id === item.supportId);
    return modelPoint(...item.position, item.height + (support?.type === 'Furniture' ? support.height : 0) + .15);
  }
  if (item.type === 'Equipment') return modelPoint(...item.position, item.elevation + item.height + .15);
  if (item.type === 'Wall') return modelPoint((item.start[0] + item.end[0]) / 2, (item.start[1] + item.end[1]) / 2, .6);
  const host = snapshot.relationships.find((link) => link.source === item.id);
  const wall = snapshot.entities.find((candidate) => candidate.id === host?.target);
  if (!host || wall?.type !== 'Wall') throw new Error('Opening has no validated wall host.');
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const t = (host.offset + item.width / 2) / length;
  return modelPoint(wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t, .6);
}

export function referencePosition(reference: SpatialReference, snapshot: ModelSnapshot): Vector3 {
  if (reference.kind === 'floor-point') return modelPoint(reference.positionMm[0] / 1000, reference.positionMm[1] / 1000, .025);
  const wall = snapshot.entities.find((item) => item.id === reference.wallId);
  if (wall?.type !== 'Wall') throw new Error('Reference wall is absent.');
  const t = reference.alongWallMm / (Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) * 1000);
  return modelPoint(wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t, .08);
}

/** Projects a ray hit to a domain annotation, never a model edit. */
export function referenceFromHit(snapshot: ModelSnapshot, point: Vector3, wallId: string | null): SpatialReference | null {
  if (wallId) {
    const wall = snapshot.entities.find((item) => item.id === wallId);
    if (wall?.type !== 'Wall') return null;
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dy);
    const along = ((point.x - wall.start[0]) * dx + (point.z - wall.start[1]) * dy) / length;
    return { kind: 'wall-point', wallId, alongWallMm: Math.round(Math.max(0, Math.min(length, along)) * 1000) };
  }
  const b = rectangleLayout(snapshot).boundsMm;
  const positionMm: Point = [Math.round(point.x * 1000), Math.round(point.z * 1000)];
  if (positionMm[0] < b.minX || positionMm[0] > b.maxX || positionMm[1] < b.minY || positionMm[1] > b.maxY) return null;
  return { kind: 'floor-point', positionMm };
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
  private readonly sun: DirectionalLight;
  private readonly ambient: HemisphericLight;
  private readonly shadow: ShadowGenerator;
  private readonly wood: RawTexture;
  private readonly parts: RenderPart[] = [];
  private readonly materials = new Map<string, StandardMaterial | PBRMaterial>();
  private readonly walls = new Map<string, Wall>();
  private signature = '';
  private snapshot: ModelSnapshot | null = null;
  private comparison: ModelSnapshot | null = null;
  private readonly changes = new Map<string, ReturnType<typeof modelChanges>[number]>();
  private readonly comparisonLines: Mesh[] = [];
  private mode: RenderingMode = 'realistic';
  private selectedId = '';
  private cutaway = true;
  private marker: Mesh | null = null;
  private markerLine: Mesh | null = null;
  private readonly markerMaterial: StandardMaterial;

  constructor(engine: AbstractEngine) {
    this.scene = new Scene(engine);
    this.scene.clearColor = Color4.FromHexString('#e8efedff');
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = 1;
    this.scene.imageProcessingConfiguration.exposure = 1.15;
    this.camera = new ArcRotateCamera('room-camera', -Math.PI / 2.4, .86, 10, new Vector3(3, .5, 2), this.scene);
    this.camera.minZ = .05; this.camera.maxZ = 500;
    this.camera.lowerBetaLimit = .08; this.camera.upperBetaLimit = Math.PI / 2 - .02;
    this.camera.lowerRadiusLimit = 1; this.camera.upperRadiusLimit = 150;
    this.camera.wheelDeltaPercentage = .015; this.camera.panningSensibility = 90;
    this.camera.pinchDeltaPercentage = .008;
    this.ambient = new HemisphericLight('sky-fill', new Vector3(.2, 1, .3), this.scene);
    this.ambient.groundColor = Color3.FromHexString('#778b80'); this.ambient.intensity = .85;
    this.sun = new DirectionalLight('daylight', new Vector3(-.7, -1.4, .7), this.scene);
    this.sun.position = new Vector3(8, 12, -6); this.sun.intensity = 2.2;
    this.sun.diffuse = Color3.FromHexString('#fff1db');
    this.shadow = new ShadowGenerator(1024, this.sun);
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

  private register(mesh: Mesh, objectId: string | null, wallId: string | null, surface: Surface, color: string): void {
    mesh.material = this.material(surface, color); mesh.receiveShadows = true;
    mesh.outlineColor = Color3.FromHexString('#007e70'); mesh.outlineWidth = .012;
    this.parts.push({ mesh, objectId, wallId, surface, color, before: false });
    if (surface !== 'floor') this.shadow.addShadowCaster(mesh);
  }

  private box(name: string, size: Vector3, position: Vector3, objectId: string | null, wallId: string | null, surface: Surface, color: string, angle = 0): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
    mesh.position.copyFrom(position); mesh.rotation.y = -angle;
    this.register(mesh, objectId, wallId, surface, color); return mesh;
  }

  private wall(wall: Wall, snapshot: ModelSnapshot): void {
    this.walls.set(wall.id, wall);
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dy); const angle = Math.atan2(dy, dx);
    const openings = snapshot.relationships.filter((link) => link.target === wall.id).flatMap((link) => {
      const item = snapshot.entities.find((candidate) => candidate.id === link.source);
      return item?.type === 'Door' || item?.type === 'Window' ? [{ item, offset: link.offset, bottom: item.type === 'Window' ? item.sillHeight : 0 }] : [];
    }).sort((a, b) => a.offset - b.offset);
    const segment = (start: number, end: number, bottom: number, top: number): void => {
      if (end - start < .001 || top - bottom < .001) return;
      const mid = (start + end) / 2;
      this.box(`${wall.id}-solid-${this.parts.length}`, new Vector3(end - start, top - bottom, wall.thickness),
        modelPoint(wall.start[0] + dx * mid / length, wall.start[1] + dy * mid / length, (bottom + top) / 2), wall.id, wall.id, 'wall', '#eeeae1', angle);
    };
    let cursor = 0;
    for (const { item, offset, bottom } of openings) {
      segment(cursor, offset, 0, wall.height);
      segment(offset, offset + item.width, 0, bottom);
      segment(offset, offset + item.width, bottom + item.height, wall.height);
      const centre = offset + item.width / 2;
      const at = (along: number, elevation: number): Vector3 => modelPoint(wall.start[0] + dx * along / length, wall.start[1] + dy * along / length, elevation);
      this.box(`${item.id}-leaf`, new Vector3(item.width - .04, item.height - .03, item.type === 'Door' ? .045 : .018),
        at(centre, bottom + item.height / 2), item.id, wall.id, item.type === 'Door' ? 'wood' : 'glass', item.type === 'Door' ? '#be946d' : '#a8d2df', angle);
      for (const along of [offset + .02, offset + item.width - .02]) this.box(`${item.id}-jamb-${along}`, new Vector3(.04, item.height, wall.thickness + .025), at(along, bottom + item.height / 2), item.id, wall.id, 'wall', '#faf8f1', angle);
      this.box(`${item.id}-header`, new Vector3(item.width, .04, wall.thickness + .025), at(centre, bottom + item.height - .02), item.id, wall.id, 'wall', '#faf8f1', angle);
      cursor = offset + item.width;
    }
    segment(cursor, length, 0, wall.height);
  }

  private addSnapshot(snapshot: ModelSnapshot): void {
    const b = rectangleLayout(snapshot).boundsMm;
    const width = (b.maxX - b.minX) / 1000; const depth = (b.maxY - b.minY) / 1000;
    this.box('room-floor', new Vector3(width + .16, .12, depth + .16), modelPoint((b.minX + b.maxX) / 2000, (b.minY + b.maxY) / 2000, -.07), null, null, 'floor', '#d1c3a9');
    for (const item of snapshot.entities) {
      if (item.type === 'Wall') this.wall(item, snapshot);
      else if (item.type === 'Equipment') this.box(item.id, new Vector3(item.width, item.height, item.depth), modelPoint(...item.position, item.elevation + item.height / 2), item.id, null, 'metal', '#8aabb1');
      else if (item.type === 'Furniture') {
        const faces = furnitureFaces(item, snapshot);
        const colors = new Set(faces.map((face) => face.fill));
        for (const color of colors) {
          const positions: number[] = []; const indices: number[] = [];
          for (const face of faces.filter((part) => part.fill === color)) {
            const offset = positions.length / 3;
            for (const [x, y, z] of face.points) positions.push(x, z, y);
            for (let i = 1; i < face.points.length - 1; i += 1) indices.push(offset, offset + i + 1, offset + i);
          }
          const normals: number[] = []; VertexData.ComputeNormals(positions, indices, normals);
          const uvs: number[] = [];
          for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] * .4, positions[i + 2] * .4);
          const data = new VertexData(); data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs;
          const mesh = new Mesh(`${item.id}-${color}`, this.scene); data.applyToMesh(mesh);
          const surface: Surface = item.kind === 'plant' ? color === '#bb8165' ? 'pot' : 'leaf' : item.kind === 'chair' ? 'fabric'
            : color === '#d6b58c' || color === '#c69a73' ? 'wood' : color === '#69b7d0' || color === '#8ccbd4' ? 'screen' : 'metal';
          this.register(mesh, item.id, null, surface, color);
        }
      }
    }
  }

  setModel(snapshot: ModelSnapshot, comparison: ModelSnapshot | null = null): boolean {
    const signature = JSON.stringify([snapshot, comparison]);
    if (signature === this.signature) return false;
    const first = !this.snapshot; this.clearModel();
    this.snapshot = snapshot; this.comparison = comparison; this.signature = signature;
    this.changes.clear();
    if (comparison) for (const change of modelChanges(comparison, snapshot)) this.changes.set(change.id, change);
    this.addSnapshot(snapshot);
    if (comparison) {
      const afterCount = this.parts.length;
      this.addSnapshot(comparison);
      for (let i = this.parts.length - 1; i >= afterCount; i -= 1) {
        const part = this.parts[i]; const change = part.objectId ? this.changes.get(part.objectId) : null;
        this.shadow.removeShadowCaster(part.mesh);
        if (!change || change.status === 'added') { part.mesh.dispose(); this.parts.splice(i, 1); continue; }
        part.before = true; part.mesh.name = 'before:' + part.mesh.name;
      }
      this.walls.clear();
      for (const item of snapshot.entities) if (item.type === 'Wall') this.walls.set(item.id, item);
      for (const change of this.changes.values()) {
        if (change.status !== 'modified') continue;
        const a = entityAnchor(change.before, comparison); const b = entityAnchor(change.after, snapshot);
        if (Vector3.Distance(a, b) < .002) continue;
        const line = MeshBuilder.CreateDashedLines('change-path:' + change.id, { points: [a, b], dashSize: 2, gapSize: 1, dashNb: 24 }, this.scene);
        line.color = Color3.FromHexString('#a85a00'); line.isPickable = false; this.comparisonLines.push(line);
      }
    }
    this.applyAppearance(); this.select(this.selectedId);
    if (first) this.frame();
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
    this.mode = mode;
    this.scene.shadowsEnabled = mode === 'realistic';
    this.scene.imageProcessingConfiguration.toneMappingEnabled = mode === 'realistic';
    this.scene.imageProcessingConfiguration.exposure = mode === 'realistic' ? 1.15 : 1;
    this.sun.intensity = mode === 'realistic' ? 2.2 : .35;
    this.ambient.intensity = mode === 'realistic' ? .85 : .8;
    this.applyAppearance();
  }

  select(id: string): void {
    this.selectedId = id;
    for (const part of this.parts) part.mesh.renderOutline = part.objectId === id;
  }

  frame(): void {
    if (!this.snapshot) return;
    const after = rectangleLayout(this.snapshot).boundsMm;
    const before = this.comparison ? rectangleLayout(this.comparison).boundsMm : after;
    const b = { minX: Math.min(before.minX, after.minX), minY: Math.min(before.minY, after.minY), maxX: Math.max(before.maxX, after.maxX), maxY: Math.max(before.maxY, after.maxY) };
    this.camera.setTarget(modelPoint((b.minX + b.maxX) / 2000, (b.minY + b.maxY) / 2000, .6));
    this.camera.alpha = -Math.PI / 2.4; this.camera.beta = .86;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 1000;
    this.camera.radius = Math.max(4, span * 1.65);
    this.camera.lowerRadiusLimit = Math.max(.4, span * .12); this.camera.upperRadiusLimit = Math.max(20, span * 8);
    this.camera.inertialAlphaOffset = 0; this.camera.inertialBetaOffset = 0; this.camera.inertialRadiusOffset = 0;
    this.camera.inertialPanningX = 0; this.camera.inertialPanningY = 0;
  }

  setCutaway(enabled: boolean): void { this.cutaway = enabled; this.updateCutaway(); }

  private updateCutaway(): void {
    if (!this.snapshot) return;
    const b = rectangleLayout(this.snapshot).boundsMm;
    const centre = modelPoint((b.minX + b.maxX) / 2000, (b.minY + b.maxY) / 2000);
    for (const part of this.parts) {
      const wall = part.wallId ? this.walls.get(part.wallId) : null;
      let visible = true;
      const changedWallPart = this.comparison && part.objectId && this.changes.has(part.objectId);
      if (this.cutaway && wall && !part.before && !changedWallPart) {
        const midpoint = modelPoint((wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2);
        const outward = midpoint.subtract(centre); outward.y = 0;
        visible = Vector3.Dot(outward, this.camera.position.subtract(midpoint)) <= 0;
      }
      part.mesh.setEnabled(visible);
    }
  }

  objectAt(x: number, y: number): string | null {
    const hit = this.scene.pick(x, y, (mesh) => mesh.isEnabled() && mesh.isVisible && this.parts.some((part) => part.mesh === mesh && part.objectId !== null));
    return this.parts.find((part) => part.mesh === hit?.pickedMesh)?.objectId ?? null;
  }

  referenceAt(x: number, y: number): SpatialReference | null {
    if (!this.snapshot) return null;
    const hit = this.scene.pick(x, y, (mesh) => mesh.isEnabled() && mesh.isVisible && this.parts.some((part) => part.mesh === mesh && (part.surface === 'floor' || part.wallId !== null)));
    if (!hit?.pickedPoint) return null;
    const part = this.parts.find((candidate) => candidate.mesh === hit.pickedMesh);
    return referenceFromHit(this.snapshot, hit.pickedPoint, part?.wallId ?? null);
  }

  mark(reference: SpatialReference | null): void {
    this.marker?.dispose(); this.markerLine?.dispose(); this.marker = null; this.markerLine = null;
    if (!reference || !this.snapshot) return;
    const target = referencePosition(reference, this.snapshot);
    this.marker = MeshBuilder.CreateTorus('request-marker-not-geometry', { diameter: .34, thickness: .025, tessellation: 32 }, this.scene);
    this.marker.position.copyFrom(target); this.marker.material = this.markerMaterial; this.marker.isPickable = false;
    const source = this.snapshot.entities.find((item) => item.id === this.selectedId);
    if (source) {
      const line = MeshBuilder.CreateDashedLines('request-reference-line', { points: [entityAnchor(source, this.snapshot), target], dashSize: 2, gapSize: 1, dashNb: 30 }, this.scene);
      line.color = Color3.FromHexString('#087e70'); line.isPickable = false; this.markerLine = line;
    }
  }

  anchorOnScreen(id: string, width: number, height: number): Point | null {
    const after = this.snapshot?.entities.find((candidate) => candidate.id === id);
    const item = after ?? this.comparison?.entities.find((candidate) => candidate.id === id);
    const source = after ? this.snapshot : this.comparison;
    if (!item || !source) return null;
    const engine = this.scene.getEngine();
    const projected = Vector3.Project(entityAnchor(item, source), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    if (projected.z < 0 || projected.z > 1) return null;
    return [projected.x / engine.getRenderWidth() * width, projected.y / engine.getRenderHeight() * height];
  }

  private clearModel(): void {
    this.mark(null);
    for (const part of this.parts) { this.shadow.removeShadowCaster(part.mesh); part.mesh.dispose(); }
    this.parts.length = 0; this.walls.clear();
    for (const line of this.comparisonLines) line.dispose();
    this.comparisonLines.length = 0;
  }

  dispose(): void { this.clearModel(); this.scene.dispose(); }
}
