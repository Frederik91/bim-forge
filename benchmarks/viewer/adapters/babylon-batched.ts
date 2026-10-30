import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import '@babylonjs/core/Culling/ray.js';
import type { Adapter, Camera, Changes, Element, Geometry, Model, Readback, Vec3 } from '../contract.ts';

interface Range { id: string; vertexStart: number; vertexCount: number; faceStart: number; faceCount: number }
interface Batch { mesh: Mesh; key: string; members: Set<string>; vertices: number; ranges: Range[] }

/** Experimental bounded spatial/material batches, independent of accepted BIM state. */
export class BatchedBabylonAdapter implements Adapter {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly view: FreeCamera;
  private readonly instrumentation: SceneInstrumentation;
  private readonly geometries = new Map<string, Geometry>();
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly groups = new Map<string, Set<Batch>>();
  private readonly batches = new Map<Mesh, Batch>();
  private readonly owners = new Map<string, Batch>();
  private readonly data = new Map<string, Element>();
  private filter: Set<string> | null = null;
  private selection: string | null = null;
  private clipHeight: number | null = null;
  private sequence = 0;
  private work = { rebuiltBatches: 0, uploadedVertices: 0, uploadedIndices: 0, preservedBatches: 0 };

  constructor(surface: HTMLCanvasElement | Engine) {
    this.engine = surface instanceof Engine ? surface : new Engine(surface, true, { preserveDrawingBuffer: false, stencil: true });
    this.engine.setHardwareScalingLevel(1);
    this.scene = new Scene(this.engine); this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(.94, .95, .97, 1);
    this.view = new FreeCamera('benchmark-camera', new Vector3(18, 15, 22), this.scene);
    this.view.minZ = .01; this.view.maxZ = 100000; this.view.fov = Math.PI / 3;
    this.instrumentation = new SceneInstrumentation(this.scene);
  }

  private geometry(item: Element): Geometry {
    const geometry = this.geometries.get(item.geometryId);
    if (!geometry) throw new Error('Missing Babylon geometry: ' + item.geometryId);
    return geometry;
  }

  private key(item: Element): string {
    return item.position.map(value => Math.floor(value / 20)).join(',') + ':'
      + (this.selection === item.id ? 'selected' : item.color.join(','));
  }

  private material(item: Element): StandardMaterial {
    const key = this.selection === item.id ? 'selected' : item.color.join(',');
    let material = this.materials.get(key);
    if (!material) {
      material = new StandardMaterial(key, this.scene); material.disableLighting = true;
      material.emissiveColor = key === 'selected' ? new Color3(0, 1, 1) : new Color3(...item.color);
      material.backFaceCulling = false; this.materials.set(key, material);
    }
    return material;
  }

  private attach(item: Element, touched: Set<Batch>): void {
    const key = this.key(item); const vertices = this.geometry(item).positions.length / 3;
    let group = this.groups.get(key);
    if (!group) { group = new Set(); this.groups.set(key, group); }
    let batch = [...group].find(value => value.members.size < 128 && value.vertices + vertices <= 100000);
    if (!batch) {
      const mesh = new Mesh('batch-' + this.sequence++, this.scene);
      // Rebase geometry within each batch to retain precision at distant origins.
      mesh.position.set(...item.position); mesh.freezeWorldMatrix();
      batch = { mesh, key, members: new Set(), vertices: 0, ranges: [] };
      this.batches.set(mesh, batch); group.add(batch);
    }
    batch.members.add(item.id); batch.vertices += vertices;
    this.owners.set(item.id, batch); this.data.set(item.id, item); touched.add(batch);
  }

  private detach(id: string, touched: Set<Batch>): void {
    const batch = this.owners.get(id); const item = this.data.get(id);
    if (!batch || !item) return;
    batch.members.delete(id); batch.vertices -= this.geometry(item).positions.length / 3;
    this.owners.delete(id); this.data.delete(id); touched.add(batch);
  }

  private rebuild(touched: Set<Batch>): void {
    const preservedBatches = [...this.batches.values()].filter(batch => !touched.has(batch)).length;
    this.work = { rebuiltBatches: 0, uploadedVertices: 0, uploadedIndices: 0, preservedBatches };
    for (const batch of touched) {
      if (!batch.members.size) {
        batch.mesh.dispose(); this.batches.delete(batch.mesh);
        const group = this.groups.get(batch.key); group?.delete(batch);
        if (!group?.size) this.groups.delete(batch.key);
        continue;
      }
      const members = [...batch.members].map(id => {
        const item = this.data.get(id); if (!item) throw new Error('Missing batch element: ' + id);
        return { item, geometry: this.geometry(item), visible: !this.filter || this.filter.has(id) };
      });
      const positions = new Float32Array(batch.vertices * 3);
      const indices = new Uint32Array(members.reduce((sum, member) => sum + (member.visible ? member.geometry.indices.length : 0), 0));
      let vertexOffset = 0; let indexOffset = 0;
      batch.ranges = [];
      for (const { item, geometry, visible } of members) {
        for (let i = 0; i < geometry.positions.length; i += 3) {
          positions[vertexOffset * 3 + i] = geometry.positions[i] * item.scale[0] + item.position[0] - batch.mesh.position.x;
          positions[vertexOffset * 3 + i + 1] = geometry.positions[i + 1] * item.scale[1] + item.position[1] - batch.mesh.position.y;
          positions[vertexOffset * 3 + i + 2] = geometry.positions[i + 2] * item.scale[2] + item.position[2] - batch.mesh.position.z;
        }
        batch.ranges.push({ id: item.id, vertexStart: vertexOffset, vertexCount: geometry.positions.length / 3,
          faceStart: indexOffset / 3, faceCount: visible ? geometry.indices.length / 3 : 0 });
        if (visible) for (const index of geometry.indices) indices[indexOffset++] = vertexOffset + index;
        vertexOffset += geometry.positions.length / 3;
      }
      // Replacing one owned geometry never touches another batch's buffers.
      batch.mesh.geometry?.dispose();
      const vertices = new VertexData(); vertices.positions = positions; vertices.indices = indices;
      vertices.applyToMesh(batch.mesh, false);
      batch.mesh.material = this.material(members[0].item);
      batch.mesh.isVisible = indices.length > 0;
      this.work.rebuiltBatches++; this.work.uploadedVertices += vertexOffset; this.work.uploadedIndices += indices.length;
    }
  }

  async load(model: Model): Promise<void> {
    if (this.data.size || this.geometries.size) throw new Error('Use a fresh adapter for a fresh load');
    for (const geometry of model.geometries) this.geometries.set(geometry.id, geometry);
    await this.apply({ upsert: model.elements, remove: [] });
  }

  async apply(changes: Changes): Promise<void> {
    const touched = new Set<Batch>();
    for (const id of changes.remove) this.detach(id, touched);
    for (const item of changes.upsert) {
      const old = this.data.get(item.id); const owner = this.owners.get(item.id);
      // Metadata-only updates preserve all GPU resources.
      if (old && owner && old.geometryId === item.geometryId && this.key(old) === this.key(item)
        && old.position.every((value, axis) => value === item.position[axis])
        && old.scale.every((value, axis) => value === item.scale[axis]) && old.color.every((value, axis) => value === item.color[axis])) {
        this.data.set(item.id, item); continue;
      }
      this.detach(item.id, touched); this.attach(item, touched);
    }
    if (this.selection && !this.data.has(this.selection)) this.selection = null;
    this.rebuild(touched); await this.frame();
  }

  async camera(camera: Camera): Promise<void> {
    this.view.position.set(...camera.eye); this.view.setTarget(new Vector3(...camera.target)); await this.frame();
  }
  async pick(x: number, y: number): Promise<string | null> {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.view);
    const height = this.clipHeight;
    const hits = [...this.batches.keys()].filter(mesh => mesh.isVisible).map(mesh => ray.intersectsMesh(mesh, false,
      height === null ? undefined : (a, b, c, localRay) => {
        const hit = localRay.intersectsTriangle(a, b, c);
        return !!hit && localRay.origin.y + localRay.direction.y * hit.distance + mesh.position.y <= height;
      }));
    hits.sort((a, b) => a.distance - b.distance);
    for (const hit of hits) {
      if (!(hit.pickedMesh instanceof Mesh) || (this.clipHeight !== null && (!hit.pickedPoint || hit.pickedPoint.y > this.clipHeight))) continue;
      const batch = this.batches.get(hit.pickedMesh);
      const range = batch?.ranges.find(range => hit.faceId >= range.faceStart && hit.faceId < range.faceStart + range.faceCount);
      if (range) return range.id;
    }
    return null;
  }
  async select(id: string | null): Promise<void> {
    if (id && !this.data.has(id)) id = null;
    const previous = this.selection; const touched = new Set<Batch>();
    const items = [...new Set([previous, id])].flatMap(key => key && this.data.has(key) ? [this.data.get(key)] : []).filter(item => item !== undefined);
    for (const item of items) this.detach(item.id, touched);
    this.selection = id;
    for (const item of items) this.attach(item, touched);
    this.rebuild(touched); await this.frame();
  }
  async properties(id: string): Promise<Record<string, string>> {
    const item = this.data.get(id); if (!item) throw new Error('Missing element: ' + id); return { ...item.properties };
  }
  async visible(ids: string[] | null): Promise<void> {
    const next = ids ? new Set(ids) : null; const touched = new Set<Batch>();
    for (const [id, batch] of this.owners) if ((!this.filter || this.filter.has(id)) !== (!next || next.has(id))) touched.add(batch);
    this.filter = next; this.rebuild(touched); await this.frame();
  }
  async section(height: number | null): Promise<void> {
    this.clipHeight = height; this.scene.clipPlane = height === null ? null : new Plane(0, 1, 0, -height); await this.frame();
  }
  async readback(): Promise<Readback[]> {
    const result: Readback[] = [];
    for (const batch of this.batches.values()) {
      const positions = batch.mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) throw new Error('Missing rendered batch vertices');
      for (const range of batch.ranges) {
        const item = this.data.get(range.id); if (!item) throw new Error('Missing rendered element');
        const geometry = this.geometry(item); const origin = batch.mesh.position;
        const min: Vec3 = [Infinity, Infinity, Infinity]; const max: Vec3 = [-Infinity, -Infinity, -Infinity];
        const offset: Vec3 = [origin.x, origin.y, origin.z];
        for (let i = range.vertexStart * 3; i < (range.vertexStart + range.vertexCount) * 3; i += 3) {
          for (let axis = 0; axis < 3; axis++) {
            const value = positions[i + axis] + offset[axis]; min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
          }
        }
        const position: Vec3 = [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) position[axis] = positions[range.vertexStart * 3 + axis] + offset[axis] - geometry.positions[axis] * item.scale[axis];
        result.push({ id: range.id, position, min, max });
      }
    }
    return result;
  }
  async frame(): Promise<void> {
    await this.scene.whenReadyAsync(); this.scene.render(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  stats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.instrumentation.drawCallsCounter.current, triangles: this.scene.getActiveIndices() / 3 };
  }
  resources(): typeof this.work & { batches: number; elements: number; storedTriangles: number } {
    return { ...this.work, batches: this.batches.size, elements: this.data.size,
      storedTriangles: [...this.data.values()].reduce((sum, item) => sum + this.geometry(item).indices.length / 3, 0) };
  }
  async dispose(): Promise<void> {
    this.instrumentation.dispose(); this.scene.dispose(); this.engine.dispose();
    this.batches.clear(); this.groups.clear(); this.owners.clear(); this.data.clear(); this.geometries.clear(); this.materials.clear();
  }
}
