import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { levels } from '../src/building-levels.ts';
import type { ModelSnapshot, ProjectId } from '../src/room-model.ts';
import type { ModelScene } from './model-scene.ts';
import { compileNativeWalk } from './native-walk.ts';
import type { NativeWalk, WalkBookmark, WalkPlacement } from './native-walk.ts';

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
  /** Local transient traversal checkpoint; older floor-only poses remain supported. */
  walk?: WalkBookmark;
}
export type ViewSession = { kind: 'overview' | 'plan' } | { kind: 'inside'; motion: InsideMotion };
export type NavigationResult = { kind: 'changed'; session: ViewSession }
  | { kind: 'unsupported'; reason: string; alternatives: readonly ['overview', 'fly'] };
const unsupported = (reason: string): NavigationResult => ({ kind: 'unsupported', reason, alternatives: ['overview', 'fly'] });
const world = (p: NavigationPoint): Vector3 => new Vector3(p[0], p[2], p[1]);
const project = (p: Vector3): NavigationPoint => [p.x, p.z, p.y];
const finite = (p: NavigationPoint): boolean => p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1_000_000);
/** Explicit entry samples native floor support; movement uses the same traversal owner. */
export function walkElevation(context: NavigationContext, x: number, y: number): number | null {
  return compileNativeWalk(context.snapshot, context.sourcePin).enter({ levelId: context.levelId, point: [x, y] })?.pose.eye[2] ?? null;
}

/** Per-viewer/tab camera session; never writes building geometry or task placement. */
export class ViewNavigation {
  private context: NavigationContext | null = null;
  private walk: NativeWalk | null = null;
  private walkPlacement: WalkPlacement | null = null;
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
    window.addEventListener('blur', () => this.stop(), { signal: controller.signal });
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
  get walkView(): { levelId: string; visibleLevelIds: readonly string[] } | null {
    if (this.session.kind !== 'inside' || this.session.motion !== 'walk' || !this.walkPlacement) return null;
    const { levelId, support } = this.walkPlacement.pose;
    return { levelId, visibleLevelIds: support.kind === 'stair' ? [support.fromLevelId, support.toLevelId] : [levelId] };
  }
  get mouseLook(): 'off' | 'locked' | 'drag' { return this.looking; }
  get gesturing(): boolean { return this.looking === 'locked' || this.pointer !== null; }
  private acceptsInput(): boolean {
    return this.session.kind === 'inside' && !!this.canvas && !document.hidden && document.activeElement === this.canvas
      && !document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') && !this.canvas.classList.contains('is-markup-drawing');
  }
  setContext(context: NavigationContext): void {
    const old = this.context;
    if (old?.projectId === context.projectId && old.sourcePin === context.sourcePin && old.levelId === context.levelId) { this.context = context; return; }
    this.remember(); this.stop(); this.context = context; this.session = { kind: 'overview' }; this.walkPlacement = null;
    if (!old || old.projectId !== context.projectId || old.sourcePin !== context.sourcePin) {
      this.walk = compileNativeWalk(context.snapshot, JSON.stringify([context.projectId, context.sourcePin]));
    }
    this.model.useCamera(this.model.camera);
    if (this.canvas) this.model.camera.attachControl(this.canvas, false);
  }
  private compatible(pose: InsidePose, allowLevelChange = false): boolean {
    return !!this.context && pose.projectId === this.context.projectId && pose.sourcePin === this.context.sourcePin
      && (pose.levelId === this.context.levelId || allowLevelChange && pose.levelId !== null && levels(this.context.snapshot).some(level => level.id === pose.levelId))
      && finite(pose.eye) && finite(pose.forward) && finite(pose.up)
      && Math.abs(world(pose.forward).length() - 1) < .001 && Math.abs(world(pose.up).length() - 1) < .001
      && Math.abs(Vector3.Dot(world(pose.forward), world(pose.up))) < .001;
  }
  capture(): InsidePose | null {
    if (this.session.kind !== 'inside' || !this.context) return null;
    const camera = this.model.insideCamera; camera.getViewMatrix(true);
    const forward = camera.getDirection(Vector3.Forward()).normalize();
    const up = camera.getDirection(Vector3.Up()).normalize();
    return { kind: 'inside', projectId: this.context.projectId, sourcePin: this.context.sourcePin, levelId: this.context.levelId,
      eye: project(camera.position), forward: project(forward), up: project(up), motion: this.session.motion,
      ...(this.session.motion === 'walk' && this.walk && this.walkPlacement ? { walk: this.walk.bookmark(this.walkPlacement.state) } : {}) };
  }
  private remember(): void { const pose = this.capture(); if (pose) this.saved.set(pose.projectId, pose); }
  returnTo(pose: InsidePose, options?: { allowLevelChange: boolean }): NavigationResult {
    this.stop();
    if (!this.compatible(pose, options?.allowLevelChange)) return unsupported('Saved eye pose belongs to a different project, source or level, or is invalid.');
    let placement: WalkPlacement | null = null;
    if (pose.motion === 'walk' && this.walk) {
      placement = pose.walk ? this.walk.restore(pose.walk) : null;
      if (!placement || placement.pose.levelId !== pose.levelId || placement.pose.eye.some((value, axis) => Math.abs(value - pose.eye[axis]) > .01)) {
        placement = this.walk.enter({ levelId: pose.levelId, point: [pose.eye[0], pose.eye[1]] });
      }
      if (!placement || placement.pose.eye.some((value, axis) => Math.abs(value - pose.eye[axis]) > .01)) return unsupported('Saved Walk position has no clear native support. Choose Fly or Overview.');
    }
    if (pose.motion === 'walk' && !placement) return unsupported('Walk requires supported native floor or stair geometry. Choose Fly or Overview.');
    this.walkPlacement = placement;
    if (this.context) this.context = { ...this.context, levelId: pose.levelId };
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
      this.session = { kind: intent.kind }; this.walkPlacement = null; this.model.useCamera(this.model.camera);
      if (intent.kind === 'overview' && this.canvas) this.model.camera.attachControl(this.canvas, false);
      return { kind: 'changed', session: this.state };
    }
    if (!this.context) return unsupported('Open a project before entering Inside.');
    const saved = this.saved.get(this.context.projectId);
    if (!intent.entry && saved && this.compatible(saved) && saved.motion === intent.motion) return this.returnTo(saved);
    const entry = intent.entry;
    if (!entry || !finite(entry)) return unsupported('Choose an explicit project-space entry point for Inside.');
    const placement = intent.motion === 'walk' ? this.walk?.enter({ levelId: this.context.levelId, point: [entry[0], entry[1]] }) : null;
    const elevation = intent.motion === 'walk' ? placement?.pose.eye[2] ?? null : entry[2];
    if (elevation === null) return unsupported('Walk requires a clear supported native floor entry. Linked floors remain unsupported; choose Fly or Overview.');
    return this.returnTo({ kind: 'inside', projectId: this.context.projectId, sourcePin: this.context.sourcePin, levelId: this.context.levelId,
      motion: intent.motion, eye: [entry[0], entry[1], elevation], forward: [0, 1, 0], up: [0, 0, 1],
      ...(placement && this.walk ? { walk: this.walk.bookmark(placement.state) } : {}) });
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
    if (this.session.kind !== 'inside' || !this.context) return false;
    if (this.canvas && !this.acceptsInput()) {
      if (this.keys.size > 0 || this.looking !== 'off') this.stop();
      return false;
    }
    const camera = this.model.insideCamera; camera.getViewMatrix(true);
    const forward = camera.getDirection(Vector3.Forward());
    if (this.session.motion === 'walk') forward.y = 0;
    forward.normalize(); const right = camera.getDirection(Vector3.Right()); right.y = 0; right.normalize();
    const move = forward.scale(Number(this.keys.has('w')) - Number(this.keys.has('s')))
      .add(right.scale(Number(this.keys.has('d')) - Number(this.keys.has('a'))));
    if (this.session.motion === 'fly') move.y += Number(this.keys.has('shift')) - Number(this.keys.has('control'));
    const elapsed = Number.isFinite(seconds) ? Math.max(0, Math.min(.05, seconds)) : 0;
    if (move.lengthSquared() > 0) move.normalize().scaleInPlace(2 * elapsed);
    if (this.session.motion === 'walk' && this.walk && this.walkPlacement) {
      const next = this.walk.advance(this.walkPlacement.state, [move.x, move.z], elapsed);
      this.walkPlacement = next; this.context = { ...this.context, levelId: next.pose.levelId };
      const position = world(next.pose.eye); const changed = !camera.position.equalsWithEpsilon(position, 1e-8);
      camera.position.copyFrom(position); return changed;
    }
    if (move.lengthSquared() === 0) return false;
    const destination = camera.position.add(move);
    if (!finite(project(destination))) return false;
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
