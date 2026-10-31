import type { Camera } from '@babylonjs/core/Cameras/camera.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { RequestState } from './change-requests.ts';
import type { SpatialTokens } from './ui/design-tokens.ts';

export type TaskAgentTokens = Readonly<Pick<SpatialTokens['color'],
  'agentBody' | 'agentFace' | 'agentEyes' | 'ink' | 'focus' | 'selection' |
  'primary' | 'warning' | 'error' | 'proposed' | 'success' | 'muted'>>;
export type TaskAgentIdentity =
  | { readonly kind: 'task'; readonly projectId: string; readonly ticketId: string }
  | { readonly kind: 'draft'; readonly projectId: string; readonly draftId: string };
export type TaskAgentPlacement =
  | { readonly kind: 'placed'; readonly origin: readonly [number, number, number] }
  | { readonly kind: 'unplaced' };
type FigureDetails = {
  readonly title: string;
  readonly placement: TaskAgentPlacement;
  readonly selected: boolean;
  readonly visible: boolean;
};
export type TaskAgentDescriptor = FigureDetails & (
  | { readonly identity: Extract<TaskAgentIdentity, { kind: 'task' }>; readonly state: RequestState }
  | { readonly identity: Extract<TaskAgentIdentity, { kind: 'draft' }>; readonly state: 'unsent' }
);
export type TaskAgentListEntry = {
  readonly identity: TaskAgentIdentity;
  readonly title: string;
  readonly stateLabel: string;
  readonly selected: boolean;
  readonly placement: TaskAgentPlacement['kind'];
};
export type TaskAgentHit =
  | { readonly kind: 'none' }
  | { readonly kind: 'task'; readonly identity: TaskAgentIdentity }
  | { readonly kind: 'chooser'; readonly candidates: readonly TaskAgentIdentity[] };
export type TaskAgentAnchor = {
  readonly identity: TaskAgentIdentity;
  readonly candidates: readonly TaskAgentIdentity[];
} & (
  | { readonly kind: 'visible'; readonly x: number; readonly y: number }
  | { readonly kind: 'hidden'; readonly reason: 'unplaced' | 'hidden' | 'offscreen' | 'occluded' }
);

const stateLabels: Readonly<Record<TaskAgentDescriptor['state'], string>> = {
  unsent: 'Unsent draft', queued: 'Queued', working: 'Working', 'needs-input': 'Needs input',
  ready: 'Ready for review', completed: 'Accepted', rejected: 'Rejected', cancelled: 'Cancelled', failed: 'Failed',
};

function identityKey(identity: TaskAgentIdentity): string {
  return JSON.stringify([identity.projectId, identity.kind, identity.kind === 'task' ? identity.ticketId : identity.draftId]);
}

function placeKey(placement: TaskAgentPlacement): string {
  return placement.kind === 'placed' ? JSON.stringify(placement.origin) : 'unplaced';
}

type Figure = {
  descriptor: TaskAgentDescriptor;
  readonly root: TransformNode;
  readonly meshes: readonly Mesh[];
  readonly materials: readonly StandardMaterial[];
  readonly body: StandardMaterial;
  readonly ring: Mesh;
};

/** Presentation only. The caller retains construction picks, highlights, chat and camera intent. */
export class SpatialTaskLayer {
  readonly #scene: Scene;
  readonly #tokens: TaskAgentTokens;
  readonly #isConstructionMesh: (mesh: AbstractMesh) => boolean;
  readonly #figures = new Map<string, Figure>();
  readonly #hits = new Map<AbstractMesh, string>();
  readonly #owned = new Set<AbstractMesh>();
  #projectId: string | null = null;
  #disposed = false;
  #reducedMotion: boolean;

  constructor(options: {
    readonly scene: Scene;
    readonly tokens: TaskAgentTokens;
    readonly isConstructionMesh: (mesh: AbstractMesh) => boolean;
    readonly reducedMotion?: boolean;
  }) {
    this.#scene = options.scene;
    this.#tokens = options.tokens;
    this.#isConstructionMesh = options.isConstructionMesh;
    this.#reducedMotion = options.reducedMotion ?? true;
  }

  /** Validated projection input; checks rendering safety before changing the current layer. */
  replace(projectId: string, descriptors: readonly TaskAgentDescriptor[]): void {
    if (this.#disposed) throw new Error('Task layer is disposed');
    const next = new Map<string, TaskAgentDescriptor>();
    for (const input of descriptors) {
      const key = identityKey(input.identity);
      if (input.identity.projectId !== projectId || next.has(key)) throw new Error('Task identity/project conflict');
      if (input.placement.kind === 'placed' && !input.placement.origin.every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) {
        throw new Error('Task origin is outside the project coordinate envelope');
      }
      const previous = this.#projectId === projectId ? this.#figures.get(key) : undefined;
      if (previous?.descriptor.placement.kind === 'placed' && placeKey(previous.descriptor.placement) !== placeKey(input.placement)) {
        throw new Error('A captured task origin cannot move');
      }
      next.set(key, structuredClone(input));
    }
    for (const [key, figure] of this.#figures) {
      if (this.#projectId !== projectId || !next.has(key)) { this.#remove(figure); this.#figures.delete(key); }
    }
    this.#projectId = projectId;
    for (const [key, descriptor] of next) {
      let figure = this.#figures.get(key);
      if (!figure) { figure = this.#create(key, descriptor); this.#figures.set(key, figure); }
      figure.descriptor = descriptor;
      figure.root.setEnabled(descriptor.visible && descriptor.placement.kind === 'placed');
      figure.body.diffuseColor = Color3.FromHexString(descriptor.state === 'unsent' ? this.#tokens.muted : this.#tokens.agentBody);
      const color = this.#stateColor(descriptor.state);
      if (figure.ring.material instanceof StandardMaterial) figure.ring.material.diffuseColor = Color3.FromHexString(color);
      figure.ring.scaling.setAll(descriptor.selected ? 1.25 : 1);
      // A wire torso distinguishes an unsent local draft even in a monochrome capture.
      figure.body.wireframe = descriptor.state === 'unsent';
    }
    this.renderFrame(0);
  }

  ownsMesh(mesh: AbstractMesh): boolean { return this.#owned.has(mesh); }

  listEntries(): readonly TaskAgentListEntry[] {
    return [...this.#figures.values()].map(({ descriptor }) => ({ identity: structuredClone(descriptor.identity),
      title: descriptor.title, stateLabel: stateLabels[descriptor.state], selected: descriptor.selected, placement: descriptor.placement.kind }));
  }

  setReducedMotion(value: boolean): void { this.#reducedMotion = value; this.renderFrame(0); }

  /** Caller supplies time from its existing render loop. Only reported working state can bob. */
  renderFrame(timeMs: number): void {
    for (const { root, descriptor } of this.#figures.values()) {
      if (descriptor.placement.kind !== 'placed') continue;
      const [x, y, z] = descriptor.placement.origin;
      const bob = !this.#reducedMotion && descriptor.state === 'working' ? Math.sin(timeMs / 550) * .018 : 0;
      root.position.set(x, z + .24 + bob, y);
      root.computeWorldMatrix(true);
    }
  }

  pick(ray: Ray, interaction: 'idle' | 'markup' | 'navigation'): TaskAgentHit {
    if (this.#disposed || interaction !== 'idle') return { kind: 'none' };
    const hit = this.#scene.pickWithRay(ray, mesh => this.#hits.has(mesh) && mesh.isEnabled() && mesh.isVisible);
    if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint || this.#occluded(ray.origin, hit.pickedPoint)) return { kind: 'none' };
    const key = this.#hits.get(hit.pickedMesh);
    const figure = key === undefined ? undefined : this.#figures.get(key);
    if (!figure) return { kind: 'none' };
    const candidates = this.#candidates(figure.descriptor);
    const first = candidates[0];
    return candidates.length > 1 ? { kind: 'chooser', candidates } : first ? { kind: 'task', identity: first } : { kind: 'none' };
  }

  /** Coordinates use the caller's canvas/render units. CSS overlays must scale them to CSS pixels. */
  anchors(camera: Camera, width: number, height: number): readonly TaskAgentAnchor[] {
    if (this.#disposed) return [];
    const viewport = camera.viewport.toGlobal(width, height);
    const transform = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
    return [...this.#figures.values()].map(({ descriptor, root }) => {
      const base = { identity: structuredClone(descriptor.identity), candidates: this.#candidates(descriptor) };
      if (descriptor.placement.kind === 'unplaced') return { ...base, kind: 'hidden', reason: 'unplaced' };
      if (!descriptor.visible) return { ...base, kind: 'hidden', reason: 'hidden' };
      const point = root.position.add(new Vector3(0, .34, 0));
      const projected = Vector3.Project(point, Matrix.IdentityReadOnly, transform, viewport);
      const facing = Vector3.Dot(point.subtract(camera.globalPosition), camera.getForwardRay().direction);
      if (width <= 0 || height <= 0 || facing <= 0 || projected.z < 0 || projected.z > 1 ||
          projected.x < viewport.x || projected.y < viewport.y || projected.x > viewport.x + viewport.width || projected.y > viewport.y + viewport.height) {
        return { ...base, kind: 'hidden', reason: 'offscreen' };
      }
      if (this.#occluded(camera.globalPosition, point)) return { ...base, kind: 'hidden', reason: 'occluded' };
      return { ...base, kind: 'visible', x: projected.x, y: projected.y };
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const figure of this.#figures.values()) this.#remove(figure);
    this.#figures.clear(); this.#hits.clear(); this.#owned.clear();
  }

  #candidates(descriptor: TaskAgentDescriptor): readonly TaskAgentIdentity[] {
    if (descriptor.placement.kind === 'unplaced') return [];
    return [...this.#figures.values()].filter(({ descriptor: other }) => other.visible &&
      other.placement.kind === 'placed' && placeKey(other.placement) === placeKey(descriptor.placement))
      .map(({ descriptor: other }) => structuredClone(other.identity));
  }

  #occluded(from: Vector3, to: Vector3): boolean {
    const direction = to.subtract(from); const length = direction.length();
    if (length <= .0001) return false;
    const hit = this.#scene.pickWithRay(new Ray(from, direction.scale(1 / length), length), mesh =>
      !this.#owned.has(mesh) && mesh.isEnabled() && mesh.isVisible && mesh.visibility > 0 && this.#isConstructionMesh(mesh));
    return Boolean(hit?.hit && hit.distance < length - .0001);
  }

  #stateColor(state: TaskAgentDescriptor['state']): string {
    switch (state) {
      case 'working': return this.#tokens.primary;
      case 'needs-input': return this.#tokens.warning;
      case 'failed': return this.#tokens.error;
      case 'ready': return this.#tokens.proposed;
      case 'completed': return this.#tokens.success;
      case 'queued': case 'rejected': case 'cancelled': case 'unsent': return this.#tokens.muted;
      default: { const exhaustive: never = state; return exhaustive; }
    }
  }

  #create(key: string, descriptor: TaskAgentDescriptor): Figure {
    const root = new TransformNode(`task-agent:${key}`, this.#scene); root.doNotSerialize = true;
    const materials: StandardMaterial[] = [];
    const material = (name: string, color: string) => {
      const value = new StandardMaterial(`task-agent:${key}:${name}`, this.#scene);
      value.diffuseColor = Color3.FromHexString(color); value.specularColor = Color3.Black();
      value.doNotSerialize = true; materials.push(value); return value;
    };
    const body = material('body', this.#tokens.agentBody);
    const face = material('face', this.#tokens.agentFace);
    const eyes = material('eyes', this.#tokens.agentEyes);
    const status = material('status', this.#tokens.muted);
    const meshes: Mesh[] = [];
    const part = (mesh: Mesh, position: Vector3, mat: StandardMaterial, pickable = true) => {
      mesh.parent = root; mesh.position.copyFrom(position); mesh.material = mat;
      mesh.isPickable = pickable; mesh.checkCollisions = false; mesh.doNotSerialize = true;
      mesh.metadata = { kind: 'spatial-task-overlay' };
      meshes.push(mesh); this.#owned.add(mesh); if (pickable) this.#hits.set(mesh, key);
      return mesh;
    };
    part(MeshBuilder.CreateCylinder('task-agent:torso', { height: .24, diameterTop: .19, diameterBottom: .12, tessellation: 24 }, this.#scene), Vector3.Zero(), body);
    part(MeshBuilder.CreateSphere('task-agent:head', { diameter: .17, segments: 20 }, this.#scene), new Vector3(0, .22, 0), face);
    for (const x of [-.04, .04]) part(MeshBuilder.CreateSphere('task-agent:eye', { diameter: .022, segments: 8 }, this.#scene), new Vector3(x, .235, .073), eyes);
    for (const x of [-.145, .145]) part(MeshBuilder.CreateSphere('task-agent:hand', { diameter: .065, segments: 12 }, this.#scene), new Vector3(x, -.015, .015), body);
    const ring = part(MeshBuilder.CreateTorus('task-agent:hover-ring', { diameter: .32, thickness: .014, tessellation: 32 }, this.#scene), new Vector3(0, -.22, 0), status, false);
    return { descriptor, root, meshes, materials, body, ring };
  }

  #remove(figure: Figure): void {
    for (const mesh of figure.meshes) { this.#hits.delete(mesh); this.#owned.delete(mesh); mesh.dispose(false, false); }
    figure.root.dispose();
    for (const material of figure.materials) material.dispose(false, false);
  }
}
