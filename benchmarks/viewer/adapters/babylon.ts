import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Geometry } from '@babylonjs/core/Meshes/geometry.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import '@babylonjs/core/Culling/ray.js';
import type { Adapter, Camera, Changes, Element, Model, Readback } from '../contract.ts';

export class BabylonAdapter implements Adapter {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly view: FreeCamera;
  private readonly instrumentation: SceneInstrumentation;
  private readonly selectionMaterial: StandardMaterial;
  private readonly geometries = new Map<string, Geometry>();
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly meshes = new Map<string, Mesh>();
  private readonly data = new Map<string, Element>();
  private selection: string | null = null;
  private filter: Set<string> | null = null;
  private clipHeight: number | null = null;

  constructor(surface: HTMLCanvasElement | Engine) {
    this.engine = surface instanceof Engine ? surface : new Engine(surface, true, { preserveDrawingBuffer: false, stencil: true });
    this.engine.setHardwareScalingLevel(1);
    this.scene = new Scene(this.engine); this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(.94, .95, .97, 1);
    this.view = new FreeCamera('benchmark-camera', new Vector3(18, 15, 22), this.scene);
    this.view.minZ = .01; this.view.maxZ = 100000; this.view.fov = Math.PI / 3;
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.selectionMaterial = new StandardMaterial('selection', this.scene);
    this.selectionMaterial.disableLighting = true; this.selectionMaterial.emissiveColor = new Color3(0, 1, 1);
    this.selectionMaterial.backFaceCulling = false;
  }

  async load(model: Model): Promise<void> {
    if (this.meshes.size || this.geometries.size) throw new Error('Use a fresh adapter for a fresh load');
    for (const geometry of model.geometries) {
      const vertices = new VertexData(); vertices.positions = geometry.positions; vertices.indices = geometry.indices;
      const normals: number[] = []; VertexData.ComputeNormals(geometry.positions, geometry.indices, normals); vertices.normals = normals;
      this.geometries.set(geometry.id, new Geometry(geometry.id, this.scene, vertices, false));
    }
    await this.apply({ upsert: model.elements, remove: [] });
  }

  async apply(changes: Changes): Promise<void> {
    if (!changes.remove.length && !changes.upsert.length) return;
    for (const id of [...changes.remove, ...changes.upsert.map(item => item.id)]) {
      const mesh = this.meshes.get(id);
      if (mesh) {
        // The adapter owns cached geometry even while it has no mesh instances.
        mesh.geometry?.releaseForMesh(mesh, false); mesh.dispose();
      }
      this.meshes.delete(id); this.data.delete(id);
    }
    for (const item of changes.upsert) {
      const geometry = this.geometries.get(item.geometryId);
      if (!geometry) throw new Error('Missing Babylon geometry: ' + item.geometryId);
      const mesh = new Mesh(item.id, this.scene); geometry.applyToMesh(mesh);
      mesh.position.set(...item.position); mesh.scaling.set(...item.scale);
      const key = item.color.join(','); let material = this.materials.get(key);
      if (!material) {
        material = new StandardMaterial(key, this.scene); material.disableLighting = true;
        material.emissiveColor = new Color3(...item.color); material.backFaceCulling = false;
        this.materials.set(key, material);
      }
      mesh.material = material; mesh.isVisible = !this.filter || this.filter.has(item.id);
      this.meshes.set(item.id, mesh); this.data.set(item.id, item);
    }
    await this.select(this.selection);
  }

  async camera(camera: Camera): Promise<void> {
    this.view.position.set(...camera.eye); this.view.setTarget(new Vector3(...camera.target));
    await this.frame();
  }
  async pick(x: number, y: number): Promise<string | null> {
    const hits = this.scene.multiPick(x, y, mesh => mesh.isVisible && this.meshes.has(mesh.name)) ?? [];
    const visible = hits.filter(hit => this.clipHeight === null || (hit.pickedPoint && hit.pickedPoint.y <= this.clipHeight));
    visible.sort((a, b) => a.distance - b.distance);
    return visible[0]?.pickedMesh?.name ?? null;
  }
  async select(id: string | null): Promise<void> {
    if (id && !this.meshes.has(id)) id = null;
    this.selection = id;
    for (const [key, mesh] of this.meshes) {
      const item = this.data.get(key);
      if (item) mesh.material = key === id ? this.selectionMaterial : this.materials.get(item.color.join(',')) ?? null;
    }
    await this.frame();
  }
  async properties(id: string): Promise<Record<string, string>> {
    const item = this.data.get(id); if (!item) throw new Error('Missing element: ' + id);
    return { ...item.properties };
  }
  async visible(ids: string[] | null): Promise<void> {
    this.filter = ids ? new Set(ids) : null;
    for (const [id, mesh] of this.meshes) mesh.isVisible = !this.filter || this.filter.has(id);
    await this.frame();
  }
  async section(height: number | null): Promise<void> {
    this.clipHeight = height;
    this.scene.clipPlane = height === null ? null : new Plane(0, 1, 0, -height);
    await this.frame();
  }
  async readback(): Promise<Readback[]> {
    return this.scene.meshes.filter(mesh => this.meshes.has(mesh.name)).map(mesh => {
      mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox;
      return { id: mesh.name, position: [mesh.position.x, mesh.position.y, mesh.position.z],
        min: [box.minimumWorld.x, box.minimumWorld.y, box.minimumWorld.z], max: [box.maximumWorld.x, box.maximumWorld.y, box.maximumWorld.z] };
    });
  }
  async frame(): Promise<void> {
    await this.scene.whenReadyAsync(); this.scene.render();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  stats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.instrumentation.drawCallsCounter.current, triangles: this.scene.getActiveIndices() / 3 };
  }
  async dispose(): Promise<void> {
    this.instrumentation.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.scene.dispose(); this.engine.dispose();
    this.meshes.clear(); this.geometries.clear(); this.materials.clear(); this.data.clear();
  }
}
