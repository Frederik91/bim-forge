import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { levels, entityElevation, entityLevel, roofHeightAt, stairFootprint } from '../src/building-levels.ts';
import { slabPieces } from '../src/viewer-geometry.ts';
import type { Bounds, ModelSnapshot, ProjectId } from '../src/room-model.ts';
import type { ModelScene } from './model-scene.ts';

export type NavigationPoint = readonly [number, number, number];
export type InsideMotion = 'walk' | 'fly';
export type ViewIntent = { kind: 'overview' | 'plan' | 'section' }
  | { kind: 'inside'; motion: InsideMotion; entry?: NavigationPoint };
export interface NavigationContext {
  projectId: ProjectId | null; sourcePin: string; levelId: string | null; snapshot: ModelSnapshot;
}
export interface InsidePose {
  kind: 'inside'; projectId: ProjectId | null; sourcePin: string; levelId: string | null;
  eye: NavigationPoint; forward: NavigationPoint; up: NavigationPoint; motion: InsideMotion;
}
export type ViewSession = { kind: 'overview' | 'plan' } | { kind: 'inside'; motion: InsideMotion };
export type NavigationResult = { kind: 'changed'; session: ViewSession }
  | { kind: 'unsupported'; reason: string; alternatives: readonly ['overview', 'fly'] };
const unsupported = (reason: string): NavigationResult => ({ kind: 'unsupported', reason, alternatives: ['overview', 'fly'] });
const world = (p: NavigationPoint): Vector3 => new Vector3(p[0], p[2], p[1]);
const project = (p: Vector3): NavigationPoint => [p.x, p.z, p.y];
const finite = (p: NavigationPoint): boolean => p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1_000_000);
const contains = (b: Bounds, x: number, y: number, margin = 0): boolean => x >= b.minX + margin && x <= b.maxX - margin && y >= b.minY + margin && y <= b.maxY - margin;
const eyeHeight = 1.6;
const radius = .22;

/** Grounded Walk is limited to native slab solids. Stairs, gaps and obstructions block movement. */
export function walkElevation(context: NavigationContext, x: number, y: number): number | null {
  const { snapshot, levelId } = context;
  if (levelId === null) return null;
  const level = levels(snapshot).find(item => item.id === levelId);
  if (!level || roofHeightAt(snapshot, levelId, [x, y]) < eyeHeight + .15) return null;
  const floor = snapshot.entities.some(item => item.type === 'Slab' && item.levelId === levelId
    && slabPieces(snapshot, item).some(b => contains(b, x, y, radius)));
  if (!floor) return null;
  for (const item of snapshot.entities) {
    if (item.type === 'Stair' && (item.fromLevelId === levelId || item.toLevelId === levelId)
      && contains(stairFootprint(item), x, y, -radius)) return null;
    if (entityLevel(snapshot, item)?.id !== levelId) continue;
    if (item.type === 'Wall') {
      const dx = item.end[0] - item.start[0]; const dy = item.end[1] - item.start[1];
      const t = Math.max(0, Math.min(1, ((x - item.start[0]) * dx + (y - item.start[1]) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(x - item.start[0] - t * dx, y - item.start[1] - t * dy) < item.thickness / 2 + radius) return null;
    }
    // Conservative circles avoid claiming exact asset/furniture collision or door traversal.
    if ((item.type === 'Furniture' || item.type === 'Equipment')
      && Math.hypot(x - item.position[0], y - item.position[1]) < Math.hypot(item.width, item.depth) / 2 + radius) return null;
    if (item.type === 'AssetInstance') return null;
  }
  return entityElevation(snapshot, levelId) + eyeHeight;
}

/** Per-viewer/tab camera session; never writes building geometry or task placement. */
export class ViewNavigation {
  private context: NavigationContext | null = null;
  private session: ViewSession = { kind: 'overview' };
  private readonly saved = new Map<ProjectId | null, InsidePose>();
  private readonly keys = new Set<string>();
  private looking: 'off' | 'locked' | 'drag' = 'off';
  private pointer: number | null = null;
  private readonly cleanup: (() => void)[] = [];
  private readonly model: ModelScene;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly stopped: () => void;
  constructor(model: ModelScene, canvas?: HTMLCanvasElement, stopped: () => void = () => {}) {
    this.model = model; this.canvas = canvas; this.stopped = stopped;
    if (!canvas) return;
    const controller = new AbortController(); this.cleanup.push(() => controller.abort());
    const options = { capture: true, signal: controller.signal };
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.stop(); return; }
      if (!this.acceptsInput()) return;
      const key = event.key.toLowerCase();
      if (event.repeat && !this.keys.has(key)) return;
      if (['w', 'a', 's', 'd', 'shift', 'control'].includes(key)) { event.preventDefault(); this.keys.add(key); }
    }, options);
    document.addEventListener('keyup', event => { this.keys.delete(event.key.toLowerCase()); }, options);
    window.addEventListener('blur', () => this.stop(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); }, options);
    document.addEventListener('focusin', () => {
      if (document.activeElement !== canvas && (this.keys.size > 0 || this.looking !== 'off')) this.stop();
    }, options);
    canvas.addEventListener('pointercancel', () => this.stop(), options);
    canvas.addEventListener('lostpointercapture', () => { if (this.pointer !== null) this.stop(); }, options);
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && this.looking === 'locked') this.stop(); }, options);
    canvas.addEventListener('pointerdown', event => {
      if (this.looking !== 'drag' || event.button !== 0) return;
      this.pointer = event.pointerId; canvas.setPointerCapture(event.pointerId); event.preventDefault();
    }, options);
    canvas.addEventListener('pointerup', event => {
      if (event.pointerId !== this.pointer) return;
      this.pointer = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener('pointermove', event => {
      if (this.looking === 'off') return;
      if (!this.acceptsInput()) { this.stop(); return; }
      if (this.looking !== 'locked' && !(this.looking === 'drag' && this.pointer === event.pointerId && event.buttons === 1)) return;
      const camera = model.insideCamera;
      camera.rotation.y += event.movementX * .0025;
      camera.rotation.x = Math.max(-1.48, Math.min(1.48, camera.rotation.x + event.movementY * .0025));
    }, options);
  }
  get state(): ViewSession { return { ...this.session }; }
  get mouseLook(): 'off' | 'locked' | 'drag' { return this.looking; }
  get gesturing(): boolean { return this.looking === 'locked' || this.pointer !== null; }
  private acceptsInput(): boolean {
    return this.session.kind === 'inside' && !!this.canvas && !document.hidden && document.activeElement === this.canvas
      && !document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') && !this.canvas.classList.contains('is-markup-drawing');
  }
  setContext(context: NavigationContext): void {
    const old = this.context;
    if (old?.projectId === context.projectId && old.sourcePin === context.sourcePin && old.levelId === context.levelId) { this.context = context; return; }
    this.remember(); this.stop(); this.context = context; this.session = { kind: 'overview' };
    this.model.useCamera(this.model.camera);
    if (this.canvas) this.model.camera.attachControl(this.canvas, false);
  }
  private compatible(pose: InsidePose): boolean {
    return !!this.context && pose.projectId === this.context.projectId && pose.sourcePin === this.context.sourcePin
      && pose.levelId === this.context.levelId && finite(pose.eye) && finite(pose.forward) && finite(pose.up)
      && Math.abs(world(pose.forward).length() - 1) < .001 && Math.abs(world(pose.up).length() - 1) < .001
      && Math.abs(Vector3.Dot(world(pose.forward), world(pose.up))) < .001;
  }
  capture(): InsidePose | null {
    if (this.session.kind !== 'inside' || !this.context) return null;
    const camera = this.model.insideCamera; camera.getViewMatrix(true);
    const forward = camera.getDirection(Vector3.Forward()).normalize();
    const up = camera.getDirection(Vector3.Up()).normalize();
    return { kind: 'inside', projectId: this.context.projectId, sourcePin: this.context.sourcePin, levelId: this.context.levelId,
      eye: project(camera.position), forward: project(forward), up: project(up), motion: this.session.motion };
  }
  private remember(): void { const pose = this.capture(); if (pose) this.saved.set(pose.projectId, pose); }
  returnTo(pose: InsidePose): NavigationResult {
    this.stop();
    if (!this.compatible(pose)) return unsupported('Saved eye pose belongs to a different project, source or level, or is invalid.');
    const height = pose.motion === 'walk' && this.context ? walkElevation(this.context, pose.eye[0], pose.eye[1]) : null;
    if (pose.motion === 'walk' && (height === null || Math.abs(height - pose.eye[2]) > .01)) return unsupported('Saved Walk position has no supported native floor. Choose Fly or Overview.');
    this.model.insideCamera.position.copyFrom(world(pose.eye));
    const orientation = Matrix.LookAtLH(world(pose.eye), world(pose.eye).add(world(pose.forward)), world(pose.up)).invert();
    Quaternion.FromRotationMatrix(orientation).toEulerAnglesToRef(this.model.insideCamera.rotation);
    this.model.insideCamera.updateUpVectorFromRotation = true;
    this.session = { kind: 'inside', motion: pose.motion }; this.model.useCamera(this.model.insideCamera);
    this.remember(); return { kind: 'changed', session: this.state };
  }
  change(intent: ViewIntent): NavigationResult {
    this.remember(); this.stop();
    if (intent.kind === 'section') return unsupported('Section requires true source-derived section rendering.');
    if (intent.kind !== 'inside') {
      this.session = { kind: intent.kind }; this.model.useCamera(this.model.camera);
      if (intent.kind === 'overview' && this.canvas) this.model.camera.attachControl(this.canvas, false);
      return { kind: 'changed', session: this.state };
    }
    if (!this.context) return unsupported('Open a project before entering Inside.');
    const saved = this.saved.get(this.context.projectId);
    if (!intent.entry && saved && this.compatible(saved) && saved.motion === intent.motion) return this.returnTo(saved);
    const entry = intent.entry;
    if (!entry || !finite(entry)) return unsupported('Choose an explicit project-space entry point for Inside.');
    const elevation = intent.motion === 'walk' ? walkElevation(this.context, entry[0], entry[1]) : entry[2];
    if (elevation === null) return unsupported('Walk requires a clear native slab on the selected level; stairs and linked floors are unsupported. Choose Fly or Overview.');
    return this.returnTo({ kind: 'inside', projectId: this.context.projectId, sourcePin: this.context.sourcePin, levelId: this.context.levelId,
      motion: intent.motion, eye: [entry[0], entry[1], elevation], forward: [0, 1, 0], up: [0, 0, 1] });
  }
  async activateMouseLook(): Promise<'locked' | 'drag' | 'unavailable'> {
    if (!this.canvas || this.session.kind !== 'inside') return 'unavailable';
    this.stop(); this.canvas.focus({ preventScroll: true }); this.looking = 'drag';
    try {
      await this.canvas.requestPointerLock();
      if (this.session.kind === 'inside' && this.mouseLook !== 'off' && document.pointerLockElement === this.canvas) this.looking = 'locked';
      else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    } catch { /* Explicit drag-to-look fallback survives denied/unavailable pointer lock. */ }
    return this.looking === 'locked' ? 'locked' : this.looking === 'drag' ? 'drag' : 'unavailable';
  }
  /** Called before camera update. Capped time prevents jumps after a suspended frame. */
  tick(seconds: number): boolean {
    if (this.session.kind !== 'inside' || !this.context || this.keys.size === 0) return false;
    if (this.canvas && !this.acceptsInput()) { this.stop(); return false; }
    const camera = this.model.insideCamera; camera.getViewMatrix(true);
    const forward = camera.getDirection(Vector3.Forward());
    if (this.session.motion === 'walk') forward.y = 0;
    forward.normalize(); const right = camera.getDirection(Vector3.Right()); right.y = 0; right.normalize();
    const move = forward.scale(Number(this.keys.has('w')) - Number(this.keys.has('s')))
      .add(right.scale(Number(this.keys.has('d')) - Number(this.keys.has('a'))));
    if (this.session.motion === 'fly') move.y += Number(this.keys.has('shift')) - Number(this.keys.has('control'));
    if (move.lengthSquared() === 0) return false;
    move.normalize().scaleInPlace(2 * Math.max(0, Math.min(.05, seconds)));
    const destination = camera.position.add(move);
    if (!finite(project(destination))) return false;
    if (this.session.motion === 'walk') {
      const height = walkElevation(this.context, destination.x, destination.z);
      if (height === null) return false;
      destination.y = height;
    }
    camera.position.copyFrom(destination); return true;
  }
  stop(): void {
    this.keys.clear(); this.looking = 'off';
    const pointer = this.pointer; this.pointer = null;
    if (this.canvas && pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    if (this.canvas && document.pointerLockElement === this.canvas) document.exitPointerLock();
    const orbit = this.model.camera;
    orbit.inertialAlphaOffset = 0; orbit.inertialBetaOffset = 0; orbit.inertialRadiusOffset = 0;
    orbit.inertialPanningX = 0; orbit.inertialPanningY = 0;
    this.model.activeCamera.detachControl();
    this.stopped();
    if (this.session.kind === 'overview' && this.canvas) this.model.camera.attachControl(this.canvas, false);
  }
  dispose(): void { this.remember(); this.stop(); for (const remove of this.cleanup) remove(); this.cleanup.length = 0; this.saved.clear(); }
}
