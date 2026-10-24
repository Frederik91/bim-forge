import { Engine } from '@babylonjs/core/Engines/engine.js';
import { FileToolsOptions } from '@babylonjs/core/Misc/fileTools.pure.js';
import { modelChanges } from '../src/model-delta-view.ts';
import { ModelScene } from './model-scene.ts';
import type { RenderingMode } from './model-scene.ts';
import type { ModelSnapshot, Point } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';

interface ViewerState {
  snapshot: ModelSnapshot;
  comparison: ModelSnapshot | null;
  selectedId: string;
  mode: RenderingMode;
  cutaway: boolean;
  interactive: boolean;
  reference: SpatialReference | null;
}
interface ViewerActions {
  select: (id: string) => void;
  reference: (reference: SpatialReference) => void;
  keyboardReference: () => void;
}
interface MarkerDrag { id: number; origin: Point; target: SpatialReference | null; moved: boolean }

/** One canvas for the visible workflow page. Camera and GPU resources survive UI refreshes. */
export class ModelViewer {
  readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly handle = document.createElement('button');
  private readonly caption = document.createElement('p');
  private readonly selection = document.createElement('select');
  private objectSignature = '';
  private comparisonSelection: string | null = null;
  private readonly engine: Engine;
  private readonly model: ModelScene;
  private readonly observer: ResizeObserver;
  private state: ViewerState | null = null;
  private drag: MarkerDrag | null = null;
  private pointer: { id: number; origin: Point } | null = null;
  private frames = 2;
  private cameraSignature = '';
  private active = false;
  private readonly actions: ViewerActions;
  private readonly embeddedImages = new Map<string, string>();
  private readonly previousImageUrl = FileToolsOptions.PreprocessUrl;

  private readonly imageUrl = (url: string): string => {
    // Babylon ships its BRDF LUT as an embedded PNG. Blob URLs work under the existing CSP;
    // data-image URLs do not. No CDN, remote model content or security-policy exception.
    const prefix = 'data:image/png;base64,';
    if (!url.startsWith(prefix)) return this.previousImageUrl(url);
    const cached = this.embeddedImages.get(url); if (cached) return cached;
    const bytes = Uint8Array.from(atob(url.slice(prefix.length)), (character) => character.charCodeAt(0));
    const local = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    this.embeddedImages.set(url, local); return local;
  };

  constructor(actions: ViewerActions) {
    this.actions = actions;
    this.root.className = 'babylon-viewer'; this.root.dataset.renderer = 'babylon';
    this.canvas.className = 'model-canvas'; this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D room model. Drag to orbit, right-drag to pan, scroll or pinch to zoom. Use Select 3D object for keyboard selection.');
    this.canvas.setAttribute('role', 'img');
    this.handle.type = 'button'; this.handle.className = 'model-reference-handle'; this.handle.textContent = '+';
    this.caption.className = 'model-selection-caption'; this.caption.setAttribute('aria-live', 'polite');
    this.selection.className = 'model-object-picker'; this.selection.setAttribute('aria-label', 'Select 3D object');
    this.selection.addEventListener('change', () => this.select(this.selection.value));
    this.root.append(this.canvas, this.handle, this.caption, this.selection);
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance' });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 1.5));
    FileToolsOptions.PreprocessUrl = this.imageUrl;
    this.model = new ModelScene(this.engine);
    this.model.camera.attachControl(this.canvas, false);
    this.model.scene.executeWhenReady(() => { this.frames = 3; });
    this.observer = new ResizeObserver(() => { this.engine.resize(); this.frames = 3; });
    this.observer.observe(this.root);
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && event.isPrimary) this.pointer = { id: event.pointerId, origin: [event.clientX, event.clientY] };
      this.frames = 3;
    });
    this.canvas.addEventListener('pointerup', (event) => {
      const start = this.pointer; this.pointer = null;
      if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.origin[0], event.clientY - start.origin[1]) > 5) return;
      const [x, y] = this.local(event); const id = this.model.objectAt(x, y);
      if (id) this.select(id);
    });
    this.canvas.addEventListener('pointercancel', () => { this.pointer = null; });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    for (const type of ['wheel', 'pointermove', 'keydown']) this.canvas.addEventListener(type, () => { this.frames = 3; });
    this.handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary || !this.state?.interactive) return;
      event.preventDefault(); event.stopPropagation();
      this.drag = { id: event.pointerId, origin: [event.clientX, event.clientY], target: null, moved: false };
      this.model.camera.detachControl(); this.handle.setPointerCapture(event.pointerId);
      this.root.dataset.marking = 'true';
    });
    this.handle.addEventListener('pointermove', (event) => {
      if (this.drag?.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      if (!this.drag.moved && Math.hypot(event.clientX - this.drag.origin[0], event.clientY - this.drag.origin[1]) < 5) return;
      this.drag.moved = true;
      const rect = this.canvas.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      const [x, y] = this.local(event);
      this.drag.target = inside ? this.model.referenceAt(x, y) : null;
      this.model.mark(this.drag.target ?? this.state?.reference ?? null); this.frames = 2;
      this.caption.textContent = this.drag.target ? 'Reference location · release to describe the request' : 'Point inside the floor or at a visible wall · Escape to cancel';
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.handle.addEventListener(type, (event) => {
      if (event instanceof PointerEvent && this.drag?.id === event.pointerId) this.endDrag(type === 'pointerup');
    });
    this.handle.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.endDrag(false); }
      if ((event.key === 'Enter' || event.key === ' ') && !this.drag) { event.preventDefault(); this.actions.keyboardReference(); }
    });
    this.root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.endDrag(false); } });
    this.canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.caption.textContent = '3D graphics interrupted. Switch to Plan, or wait for graphics to recover.'; });
    this.canvas.addEventListener('webglcontextrestored', () => { this.frames = 3; this.updateCaption(); });
    document.addEventListener('visibilitychange', this.visibility);
  }

  private readonly visibility = (): void => {
    if (document.hidden) this.engine.stopRenderLoop(this.renderFrame);
    else if (this.active) { this.frames = 3; this.engine.runRenderLoop(this.renderFrame); }
  };

  private local(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  private endDrag(commit: boolean): void {
    const drag = this.drag; if (!drag) return;
    this.drag = null; delete this.root.dataset.marking;
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    this.model.camera.attachControl(this.canvas, false);
    this.model.mark(this.state?.reference ?? null); this.frames = 2; this.updateCaption();
    if (commit && drag.moved && drag.target) this.actions.reference(drag.target);
  }

  private select(id: string): void {
    if (!this.state?.comparison) { this.actions.select(id); return; }
    this.comparisonSelection = id;
    this.state = { ...this.state, selectedId: id };
    this.selection.value = id; this.model.select(id); this.updateCaption(); this.frames = 3;
  }

  private updateCaption(): void {
    const item = this.state?.snapshot.entities.find((candidate) => candidate.id === this.state?.selectedId)
      ?? this.state?.comparison?.entities.find((candidate) => candidate.id === this.state?.selectedId);
    const change = this.state?.comparison ? modelChanges(this.state.comparison, this.state.snapshot).find((entry) => entry.id === item?.id) : null;
    this.caption.textContent = item ? `${item.name} · ${item.id}${change ? ' · ' + (change.status === 'modified' ? 'Changed: wireframe before, solid after' : change.status === 'removed' ? 'Removed: before only' : 'Added: after only') : ''}` : 'Select an object to inspect';
    this.handle.setAttribute('aria-label', `Mark a destination using ${item?.name ?? 'selection'} as reference`);
    this.handle.title = 'Drag to mark a location; Enter for coordinates. No geometry is moved.';
    this.handle.hidden = !item || !this.state?.interactive;
  }

  private readonly renderFrame = (): void => {
    if (!this.active || this.root.clientWidth === 0 || this.root.clientHeight === 0) return;
    const camera = this.model.camera; camera.update();
    const signature = `${camera.alpha}:${camera.beta}:${camera.radius}:${camera.target.toString()}`;
    if (signature !== this.cameraSignature) { this.cameraSignature = signature; this.frames = 2; }
    if (this.frames <= 0 && this.model.scene.isReady()) return;
    this.model.scene.render(false); this.frames -= 1;
    this.root.dataset.sceneReady = String(this.model.scene.isReady());
    this.root.dataset.activeMeshes = String(this.model.scene.getActiveMeshes().length);
    const errors = this.model.scene.meshes.flatMap((mesh) => mesh.subMeshes?.map((part) => part.effect?.getCompilationError() ?? '') ?? []).filter(Boolean);
    if (errors.length) this.caption.textContent = `Graphics shader error: ${errors[0].slice(0, 160)}. Use Basic or Plan.`;
    const position = this.state ? this.model.anchorOnScreen(this.state.selectedId, this.root.clientWidth, this.root.clientHeight) : null;
    if (position) {
      this.handle.style.left = `${Math.max(24, Math.min(this.root.clientWidth - 24, position[0]))}px`;
      this.handle.style.top = `${Math.max(24, Math.min(this.root.clientHeight - 55, position[1]))}px`;
    }
  };

  show(host: HTMLElement, state: ViewerState): void {
    if (this.drag && (!state.interactive || state.selectedId !== this.state?.selectedId)) this.endDrag(false);
    if (!state.comparison || JSON.stringify(this.state?.comparison) !== JSON.stringify(state.comparison) || JSON.stringify(this.state?.snapshot) !== JSON.stringify(state.snapshot)) this.comparisonSelection = null;
    state = { ...state, selectedId: this.comparisonSelection ?? state.selectedId };
    const objects = [...new Map([...(state.comparison?.entities ?? []), ...state.snapshot.entities].map((item) => [item.id, item])).values()];
    const changes = new Map((state.comparison ? modelChanges(state.comparison, state.snapshot) : []).map((item) => [item.id, item.status]));
    if (state.comparison && !this.comparisonSelection && !changes.has(state.selectedId)) state = { ...state, selectedId: changes.keys().next().value ?? state.selectedId };
    this.state = state;
    const objectSignature = JSON.stringify(objects.map((item) => [item.id, item.name, changes.get(item.id)]));
    if (objectSignature !== this.objectSignature) {
      this.selection.replaceChildren(...objects.map((item) => new Option(`${item.name}${changes.has(item.id) ? ' · ' + (changes.get(item.id) === 'modified' ? 'changed' : changes.get(item.id)) : ''}`, item.id)));
      this.objectSignature = objectSignature;
    }
    this.selection.value = state.selectedId;
    if (this.root.parentElement !== host) host.replaceChildren(this.root);
    this.model.setMode(state.mode); this.model.setModel(state.snapshot, state.comparison); this.model.select(state.selectedId);
    this.model.setCutaway(state.cutaway);
    if (!this.drag) this.model.mark(state.reference);
    this.updateCaption(); this.frames = 3; this.engine.resize();
    this.active = true; if (!document.hidden) this.engine.runRenderLoop(this.renderFrame);
  }

  hide(): void { this.endDrag(false); this.active = false; this.engine.stopRenderLoop(this.renderFrame); this.root.remove(); }
  frame(): void { this.model.frame(); this.frames = 3; }
  dispose(): void {
    this.hide(); this.observer.disconnect(); document.removeEventListener('visibilitychange', this.visibility);
    this.model.dispose(); this.engine.dispose();
    if (FileToolsOptions.PreprocessUrl === this.imageUrl) FileToolsOptions.PreprocessUrl = this.previousImageUrl;
    for (const url of this.embeddedImages.values()) URL.revokeObjectURL(url);
    this.embeddedImages.clear();
  }
}
