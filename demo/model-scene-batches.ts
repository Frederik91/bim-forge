import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Culling/ray.js';

export interface BatchSource { mesh: Mesh; castsShadow: boolean }
interface Source {
  mesh: Mesh; castsShadow: boolean; geometry: VertexData; visible: boolean;
  min: Vector3; max: Vector3; world: Matrix; worldFlag: number; batch: Batch | null;
}
interface Range { source: Source; vertexStart: number; vertexCount: number; faceStart: number; faceCount: number }
interface Batch { mesh: Mesh; key: string; sources: Set<Source>; vertices: number; ranges: Range[]; mask: string; castsShadow: boolean }

/** Draw-call grouping must not change the directional light's shadow frustum. */
export class SourceShadowLight extends DirectionalLight {
  private readonly sourceCasters: () => Mesh[];
  constructor(name: string, direction: Vector3, scene: Scene, sourceCasters: () => Mesh[]) {
    super(name, direction, scene); this.sourceCasters = sourceCasters;
  }
  protected override _setDefaultShadowProjectionMatrix(matrix: Matrix, viewMatrix: Matrix, _renderList: AbstractMesh[]): void {
    super._setDefaultShadowProjectionMatrix(matrix, viewMatrix, this.sourceCasters());
  }
}

/** GPU cache only. Logical source meshes retain BIM identity, bounds and interaction state. */
export class SceneMeshBatches {
  private readonly scene: Scene;
  private readonly shadow: ShadowGenerator;
  private readonly enabled: boolean;
  private readonly sources = new Map<Mesh, Source>();
  private readonly groups = new Map<string, Set<Batch>>();
  private readonly batches = new Set<Batch>();
  private sequence = 0;
  private work = { rebuiltBatches: 0, vertexUploads: 0, indexUploads: 0, preservedBatches: 0 };
  private totalVertexUploads = 0;
  private totalIndexUploads = 0;

  constructor(scene: Scene, shadow: ShadowGenerator, enabled: boolean) {
    this.scene = scene; this.shadow = shadow; this.enabled = enabled;
  }

  private capture(part: BatchSource): Source {
    // Builders can compute an identity matrix at the current render ID before
    // the generator assigns placement. A retained scene needs the final matrix.
    const mesh = part.mesh; const world = mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const geometry = VertexData.ExtractFromMesh(mesh, false, false);
    if (!geometry.positions || !geometry.indices) throw new Error('Render part has no triangle geometry');
    return { ...part, geometry, world: world.clone(), worldFlag: world.updateFlag,
      min: bounds.minimum.clone(), max: bounds.maximum.clone(), visible: mesh.isVisible, batch: null };
  }

  private eligible(source: Source, active: boolean): boolean {
    const mesh = source.mesh; const material = mesh.material;
    return active && !!material && !material.wireframe && !material.needAlphaBlendingForMesh(mesh)
      && !mesh.renderOutline && !mesh.renderOverlay && mesh.visibility === 1
      && !!source.geometry.normals && !!source.geometry.indices?.length
      && !source.geometry.colors && !source.geometry.tangents;
  }

  private key(source: Source): string {
    const centre = source.mesh.getBoundingInfo().boundingBox.centerWorld;
    return [Math.floor(centre.x / 20), Math.floor(centre.y / 20), Math.floor(centre.z / 20),
      source.mesh.material?.uniqueId, source.castsShadow, source.mesh.renderingGroupId, !!source.geometry.uvs].join(':');
  }

  private attach(source: Source, key: string, touched: Set<Batch>): void {
    const count = (source.geometry.positions?.length ?? 0) / 3;
    let group = this.groups.get(key); if (!group) { group = new Set(); this.groups.set(key, group); }
    let batch = [...group].find(item => item.sources.size < 128 && item.vertices + count <= 100000);
    if (!batch) {
      const mesh = new Mesh('bim-batch-' + this.sequence++, this.scene);
      mesh.material = source.mesh.material; mesh.receiveShadows = source.mesh.receiveShadows;
      mesh.renderingGroupId = source.mesh.renderingGroupId;
      mesh.freezeWorldMatrix();
      batch = { mesh, key, sources: new Set(), vertices: 0, ranges: [], mask: '', castsShadow: source.castsShadow };
      this.batches.add(batch); group.add(batch);
      if (batch.castsShadow) this.shadow.addShadowCaster(mesh);
    }
    source.batch = batch; batch.sources.add(source); batch.vertices += count; touched.add(batch);
    this.shadow.removeShadowCaster(source.mesh);
    const geometry = source.mesh.geometry;
    if (geometry) {
      geometry.releaseForMesh(source.mesh, false);
      if (!geometry.meshes.length) geometry.dispose();
    }
    // Logical meshes have no draw data. Stale submeshes would make Babylon
    // compile materials against missing attributes during scene readiness checks.
    source.mesh.releaseSubMeshes();
    source.mesh.isVisible = false;
    const bounds = new BoundingInfo(source.min, source.max); bounds.update(source.world); source.mesh.setBoundingInfo(bounds);
  }

  private detach(source: Source, touched: Set<Batch>, restore: boolean): void {
    const batch = source.batch; if (!batch) return;
    batch.sources.delete(source); batch.vertices -= (source.geometry.positions?.length ?? 0) / 3;
    touched.add(batch); source.batch = null;
    if (restore && !source.mesh.isDisposed()) {
      source.geometry.applyToMesh(source.mesh, false); source.mesh.isVisible = source.visible;
      if (source.castsShadow) this.shadow.addShadowCaster(source.mesh);
    }
  }

  private visible(source: Source): boolean {
    return source.mesh.isEnabled() && (source.batch ? source.visible : source.mesh.isVisible) && source.mesh.visibility > 0;
  }

  private indices(batch: Batch, force: boolean): void {
    const mask = [...batch.sources].map(source => this.visible(source) ? '1' : '0').join('');
    const hasVisible = mask.includes('1'); batch.mesh.setEnabled(hasVisible);
    // Hide/restore a whole batch without touching either GPU buffer.
    if (!hasVisible || (!force && mask === batch.mask)) return;
    const count = batch.ranges.reduce((sum, range) => sum + (this.visible(range.source) ? (range.source.geometry.indices?.length ?? 0) : 0), 0);
    const indices = new Uint32Array(count); let cursor = 0;
    for (const range of batch.ranges) {
      range.faceStart = cursor / 3; range.faceCount = 0;
      if (!this.visible(range.source)) continue;
      for (const index of range.source.geometry.indices ?? []) indices[cursor++] = range.vertexStart + index;
      range.faceCount = (range.source.geometry.indices?.length ?? 0) / 3;
    }
    batch.mesh.setIndices(indices, batch.vertices, false);
    batch.mask = mask; this.work.indexUploads += indices.length; this.totalIndexUploads += indices.length;
  }

  private rebuild(batch: Batch): void {
    if (!batch.sources.size) {
      this.shadow.removeShadowCaster(batch.mesh); batch.mesh.dispose(); this.batches.delete(batch);
      const group = this.groups.get(batch.key); group?.delete(batch); if (!group?.size) this.groups.delete(batch.key);
      return;
    }
    const positions = new Float32Array(batch.vertices * 3); const normals = new Float32Array(batch.vertices * 3);
    const uvs = [...batch.sources][0].geometry.uvs ? new Float32Array(batch.vertices * 2) : null;
    const point = new Vector3(); const normal = new Vector3();
    batch.ranges = []; let offset = 0;
    for (const source of batch.sources) {
      const geometry = source.geometry; if (!geometry.positions || !geometry.indices) throw new Error('Missing cached geometry');
      const normalMatrix = Matrix.Transpose(source.world.clone().invert());
      for (let i = 0; i < geometry.positions.length; i += 3) {
        // Read the same float32 input and matrix uploaded by Babylon. Absolute
        // world positions avoid a second rounding step through a batch origin.
        point.set(Math.fround(geometry.positions[i]), Math.fround(geometry.positions[i + 1]), Math.fround(geometry.positions[i + 2]));
        Vector3.TransformCoordinatesToRef(point, source.world, point);
        positions[(offset * 3) + i] = point.x; positions[(offset * 3) + i + 1] = point.y; positions[(offset * 3) + i + 2] = point.z;
        if (geometry.normals) {
          normal.set(geometry.normals[i], geometry.normals[i + 1], geometry.normals[i + 2]);
          Vector3.TransformNormalToRef(normal, normalMatrix, normal); normal.normalize();
          normals[offset * 3 + i] = normal.x; normals[offset * 3 + i + 1] = normal.y; normals[offset * 3 + i + 2] = normal.z;
        }
        const vertex = i / 3;
        if (uvs) {
          uvs[(offset + vertex) * 2] = geometry.uvs?.[vertex * 2] ?? 0;
          uvs[(offset + vertex) * 2 + 1] = geometry.uvs?.[vertex * 2 + 1] ?? 0;
        }
      }
      batch.ranges.push({ source, vertexStart: offset, vertexCount: geometry.positions.length / 3, faceStart: 0, faceCount: 0 });
      offset += geometry.positions.length / 3;
    }
    batch.mesh.geometry?.dispose(); const data = new VertexData();
    data.positions = positions; data.normals = normals; data.uvs = uvs; data.indices = [];
    data.applyToMesh(batch.mesh, false);
    // A hidden rebuild replaced the previous index buffer too. Its previous
    // visibility mask cannot describe the new (initially empty) buffer.
    batch.mask = '';
    this.work.rebuiltBatches++; this.work.vertexUploads += offset; this.totalVertexUploads += offset;
    this.indices(batch, true);
  }

  update(parts: readonly BatchSource[], allowBatching = true): void {
    this.work = { rebuiltBatches: 0, vertexUploads: 0, indexUploads: 0, preservedBatches: 0 };
    const live = new Set(parts.map(part => part.mesh)); const touched = new Set<Batch>();
    for (const [mesh, source] of this.sources) if (!live.has(mesh)) {
      this.detach(source, touched, false); this.sources.delete(mesh);
    }
    // Capture all new users before detaching a geometry shared by several parts.
    for (const part of parts) if (!this.sources.has(part.mesh)) this.sources.set(part.mesh, this.capture(part));
    const active = this.enabled && allowBatching && parts.length >= 128;
    for (const part of parts) {
      const source = this.sources.get(part.mesh); if (!source) throw new Error('Missing source record');
      const world = part.mesh.computeWorldMatrix();
      // Babylon can refresh a matrix's version when enable state changes without
      // changing its values. Visibility must not become a geometry upload.
      const moved = source.worldFlag !== world.updateFlag && !source.world.equals(world);
      source.worldFlag = world.updateFlag;
      if (moved) source.world = world.clone();
      if (!this.eligible(source, active)) { this.detach(source, touched, true); continue; }
      const key = this.key(source);
      if (source.batch && (source.batch.key !== key || moved)) this.detach(source, touched, false);
      if (!source.batch) this.attach(source, key, touched);
    }
    for (const batch of touched) this.rebuild(batch);
    for (const batch of this.batches) if (!touched.has(batch)) { this.indices(batch, false); this.work.preservedBatches++; }
  }

  pick(x: number, y: number, predicate: (mesh: Mesh) => boolean): { mesh: Mesh; point: Vector3 } | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.scene.activeCamera);
    let nearest: { mesh: Mesh; point: Vector3; distance: number } | null = null;
    const accept = (source: Source): boolean => this.visible(source) && predicate(source.mesh);
    for (const batch of this.batches) {
      if (!batch.mesh.isEnabled()) continue;
      const eligible = [...batch.sources].filter(accept); if (!eligible.length) continue;
      const partial = eligible.length !== batch.sources.size;
      const hit = ray.intersectsMesh(batch.mesh, false, partial ? (_a, _b, _c, _ray, i0) => {
        let low = 0; let high = batch.ranges.length;
        while (low < high) { const mid = (low + high) >>> 1; const range = batch.ranges[mid];
          if (i0 < range.vertexStart) high = mid; else if (i0 >= range.vertexStart + range.vertexCount) low = mid + 1; else return accept(range.source); }
        return false;
      } : undefined);
      if (!hit.hit || !hit.pickedPoint || nearest && hit.distance >= nearest.distance) continue;
      const range = batch.ranges.find(item => hit.faceId >= item.faceStart && hit.faceId < item.faceStart + item.faceCount);
      if (range) nearest = { mesh: range.source.mesh, point: hit.pickedPoint, distance: hit.distance };
    }
    for (const source of this.sources.values()) if (!source.batch && accept(source)) {
      const hit = ray.intersectsMesh(source.mesh, false);
      if (hit.hit && hit.pickedPoint && (!nearest || hit.distance < nearest.distance)) nearest = { mesh: source.mesh, point: hit.pickedPoint, distance: hit.distance };
    }
    return nearest;
  }

  resources(): { parts: number; batches: number; batchedParts: number; cachedVertices: number; rebuiltBatches: number; vertexUploads: number; indexUploads: number; preservedBatches: number; totalVertexUploads: number; totalIndexUploads: number } {
    return { ...this.work, parts: this.sources.size, batches: this.batches.size,
      totalVertexUploads: this.totalVertexUploads, totalIndexUploads: this.totalIndexUploads,
      batchedParts: [...this.sources.values()].filter(source => source.batch).length,
      cachedVertices: [...this.sources.values()].reduce((sum, source) => sum + (source.geometry.positions?.length ?? 0) / 3, 0) };
  }

  clear(): void {
    for (const batch of this.batches) { this.shadow.removeShadowCaster(batch.mesh); batch.mesh.dispose(); }
    this.batches.clear(); this.groups.clear(); this.sources.clear();
  }
}
