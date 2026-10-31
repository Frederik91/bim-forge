import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { FileToolsOptions } from '@babylonjs/core/Misc/fileTools.pure.js';
import { modelChanges } from '../src/model-delta-view.ts';
import { entityLevel, levels } from '../src/building-levels.ts';
import { assetGeometry } from '../src/asset-family.ts';
import { ViewNavigation } from './view-navigation.ts';
import type { InsidePose, ViewIntent, ViewSession, NavigationResult } from './view-navigation.ts';
import { ModelScene } from './model-scene.ts';
import { LinkedModelLayer } from './linked-model-render.ts';
import type { LinkedDisplay } from './linked-model-render.ts';
import type { LinkedSelection } from '../src/linked-model.ts';
import type { RenderingMode } from './model-scene.ts';
import type { ModelSnapshot, Point, ProjectId } from '../src/room-model.ts';
import type { SpatialReference } from '../src/visual-request.ts';
import { SpatialMarkupView } from './spatial-markup-view.ts';
import type { MarkupPoint, MarkupTool, SpatialMarkup } from '../src/spatial-markup.ts';

export interface ViewerState {
  projectId?: ProjectId;
  navigationPin?: string;
  snapshot: ModelSnapshot;
  comparison: ModelSnapshot | null;
  selectedId: string;
  focusId: string | null;
  mode: RenderingMode;
  cutaway: boolean;
  interactive: boolean;
  reference: SpatialReference | null;
  levelId?: string | null;
  roofVisible?: boolean;
  markup?: { binding: string; editable: boolean; annotations: readonly SpatialMarkup[]; references: readonly SpatialMarkup[] };
}
type ActiveViewerState = ViewerState & { levelId: string | null; roofVisible: boolean };
interface ViewerActions {
  linkedReference?: (selection: LinkedSelection | null) => void;
  select: (id: string) => void;
  inspect: (id: string, snapshot: ModelSnapshot) => void;
  reference: (reference: SpatialReference) => void;
  keyboardReference: () => void;
  markup?: (annotations: readonly SpatialMarkup[], binding: string) => boolean;
  markupChat?: () => void;
}
interface MarkerDrag { id: number; origin: Point; target: SpatialReference | null; moved: boolean }

type ViewerPointer = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'button' | 'buttons' | 'isPrimary'>;

/** A click must stay within five CSS pixels for the entire single-pointer gesture. */
export class ViewerPointerInteraction {
  private readonly active = new Set<number>();
  private click: { id: number; origin: Point } | null = null;

  get canHover(): boolean { return this.active.size === 0; }

  down(event: ViewerPointer): void {
    this.click = this.active.size === 0 && event.button === 0 && event.isPrimary
      ? { id: event.pointerId, origin: [event.clientX, event.clientY] } : null;
    this.active.add(event.pointerId);
  }

  move(event: ViewerPointer): void {
    if (this.click?.id === event.pointerId && (event.buttons !== 1
      || Math.hypot(event.clientX - this.click.origin[0], event.clientY - this.click.origin[1]) > 5)) this.cancelClick();
  }

  up(event: ViewerPointer): boolean {
    const click = this.click;
    const accepted = this.active.size === 1 && this.active.has(event.pointerId) && click?.id === event.pointerId
      && event.button === 0 && event.isPrimary && Math.hypot(event.clientX - click.origin[0], event.clientY - click.origin[1]) <= 5;
    this.active.delete(event.pointerId); this.cancelClick();
    return accepted;
  }

  cancel(id: number): void { this.active.delete(id); this.cancelClick(); }
  cancelClick(): void { this.click = null; }
  reset(): void { this.active.clear(); this.cancelClick(); }
}

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
  private readonly linked: LinkedModelLayer;
  private readonly navigation: ViewNavigation;
  private previousFrame = 0;
  private readonly markup: SpatialMarkupView | null;
  private linkedSelection: LinkedSelection | null = null;
  private readonly observer: ResizeObserver;
  private state: ActiveViewerState | null = null;
  private drag: MarkerDrag | null = null;
  private readonly pointer = new ViewerPointerInteraction();
  private hoveredId: string | null = null;
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
    this.canvas.style.cursor = 'grab';
    this.canvas.setAttribute('aria-label', '3D model. Click an item to select and inspect it. Drag to orbit, right-drag to pan, scroll or pinch to zoom.');
    this.canvas.setAttribute('role', 'img');
    this.handle.type = 'button'; this.handle.className = 'model-reference-handle'; this.handle.textContent = '+';
    this.caption.className = 'model-selection-caption'; this.caption.setAttribute('aria-live', 'polite');
    this.selection.className = 'model-object-picker'; this.selection.setAttribute('aria-label', 'Select 3D object');
    this.selection.addEventListener('change', () => this.select(this.selection.value));
    this.root.append(this.canvas, this.handle, this.caption, this.selection);
    // ModelScene owns FXAA; the default framebuffer does not need MSAA.
    this.engine = new Engine(this.canvas, false, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance' });
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 1.5));
    FileToolsOptions.PreprocessUrl = this.imageUrl;
    this.model = new ModelScene(this.engine);
    this.linked = new LinkedModelLayer(this.model.scene);
    this.navigation = new ViewNavigation(this.model, this.canvas, () => {
      this.endDrag(false); this.pointer.reset(); this.hover(null); this.markup?.hide(); this.frames = 3;
    });
    this.markup = actions.markup ? new SpatialMarkupView({ scene: this.model.scene, camera: () => this.model.activeCamera, canvas: this.canvas,
      surface: (x, y) => this.markupSurface(x, y), changed: (annotations, binding) => actions.markup?.(annotations, binding) ?? false,
      begin: () => { this.navigation.stop(); this.endDrag(false); this.pointer.reset(); this.hover(null); }, render: () => { this.frames = 3; },
      attach: () => actions.markupChat?.() }) : null;
    if (this.markup) this.root.append(this.markup.root);
    this.model.scene.skipPointerMovePicking = true;
    this.model.camera.attachControl(this.canvas, false);
    this.model.scene.executeWhenReady(() => { this.frames = 3; });
    this.observer = new ResizeObserver(() => { this.engine.resize(); this.frames = 3; });
    this.observer.observe(this.root);
    this.canvas.addEventListener('pointerdown', (event) => {
      this.hover(null);
      this.pointer.down(event);
      this.frames = 3;
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (!this.pointer.up(event) || this.navigation.gesturing) return;
      const [x, y] = this.local(event); const linked = this.linked.objectAt(x, y);
      if (linked) { this.actions.linkedReference?.(linked); return; }
      const id = this.model.objectAt(x, y);
      if (id) this.select(id);
    });
    for (const type of ['pointercancel', 'pointerleave', 'lostpointercapture']) this.canvas.addEventListener(type, event => {
      if (event instanceof PointerEvent) this.pointer.cancel(event.pointerId);
      this.hover(null);
    });
    this.canvas.addEventListener('pointermove', event => {
      this.pointer.move(event);
      if (this.navigation.gesturing || event.buttons || !this.pointer.canHover || this.drag || !['mouse', 'pen'].includes(event.pointerType)) { this.hover(null); return; }
      const [x, y] = this.local(event); const linked = this.linked.objectAt(x, y);
      this.hover(linked ? null : this.model.objectAt(x, y)); this.linked.hover(linked);
      if (linked) { this.canvas.style.cursor = 'pointer'; this.frames = 2; }
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    for (const type of ['wheel', 'pointermove', 'keydown']) this.canvas.addEventListener(type, () => { this.frames = 3; });
    for (const type of ['wheel', 'keydown']) this.canvas.addEventListener(type, () => { this.pointer.cancelClick(); this.hover(null); });
    this.handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary || !this.state?.interactive) return;
      event.preventDefault(); event.stopPropagation();
      this.pointer.cancelClick(); this.hover(null);
      this.navigation.stop();
      this.drag = { id: event.pointerId, origin: [event.clientX, event.clientY], target: null, moved: false };
      this.model.activeCamera.detachControl(); this.handle.setPointerCapture(event.pointerId);
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
    if (document.hidden) { this.navigation.stop(); this.pointer.reset(); this.hover(null); this.endDrag(false); this.markup?.hide(); this.engine.stopRenderLoop(this.renderFrame); }
    else if (this.active) { this.frames = 3; this.engine.runRenderLoop(this.renderFrame); }
  };

  private local(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  private markupSurface(x: number, y: number): { position: MarkupPoint; normal: MarkupPoint } | null {
    const native = this.model.surfaceAt(x, y);
    const linked = this.model.scene.pick(x, y, mesh => this.linked.pick(mesh) !== null);
    const ray = this.model.scene.createPickingRay(x, y, Matrix.Identity(), this.model.activeCamera);
    const picked = linked?.hit && linked.pickedPoint && (!native || linked.distance < Vector3.Distance(ray.origin, native.position))
      ? { position: linked.pickedPoint, normal: linked.getNormal(true) } : native;
    if (!picked?.normal) return null;
    const p = picked.position; const n = picked.normal;
    return { position: [p.x, p.z, p.y], normal: [n.x, n.z, n.y] };
  }

  startMarkup(tool: MarkupTool = 'rectangle'): void { this.navigation.stop(); this.markup?.start(tool); }

  private hover(id: string | null): void {
    this.linked.hover(null);
    this.model.hover(id);
    if (id !== this.hoveredId) this.frames = 2;
    this.hoveredId = id;
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
    this.root.dataset.hoveredId = id ?? '';
  }

  private endDrag(commit: boolean): void {
    const drag = this.drag; if (!drag) return;
    this.drag = null; delete this.root.dataset.marking;
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    if (this.navigation.state.kind === 'overview') this.model.camera.attachControl(this.canvas, false);
    this.model.mark(this.state?.reference ?? null); this.frames = 2; this.updateCaption();
    if (commit && drag.moved && drag.target) this.actions.reference(drag.target);
  }

  private select(id: string): void {
    this.actions.linkedReference?.(null);
    if (!this.state?.comparison) { this.actions.select(id); return; }
    this.comparisonSelection = id;
    this.state = { ...this.state, selectedId: id };
    this.selection.value = id; this.model.select(id); this.updateCaption(); this.frames = 3;
    const source = this.state.snapshot.entities.some(item => item.id === id) ? this.state.snapshot : this.state.comparison;
    if (source) this.actions.inspect(id, source);
  }

  private updateCaption(): void {
    const current = this.state?.snapshot.entities.find((candidate) => candidate.id === this.state?.selectedId);
    const item = current ?? this.state?.comparison?.entities.find((candidate) => candidate.id === this.state?.selectedId);
    const source = current ? this.state?.snapshot : this.state?.comparison;
    const asset = item?.type === 'AssetInstance' && source ? assetGeometry(source, item) : null;
    const dimensions = asset ? ` · ${asset.family.name} · proxy ${asset.dimensions.width} × ${asset.dimensions.depth} × ${asset.dimensions.height} m` : '';
    const change = this.state?.comparison ? modelChanges(this.state.comparison, this.state.snapshot).find((entry) => entry.id === item?.id) : null;
    this.caption.textContent = item ? `${item.name} · ${item.id}${dimensions}${change ? ' · ' + (change.status === 'modified' ? 'Changed: wireframe before, solid after' : change.status === 'removed' ? 'Removed: before only' : 'Added: after only') : ''}` : 'Select an object to inspect';
    this.handle.setAttribute('aria-label', `Mark a destination using ${item?.name ?? 'selection'} as reference`);
    this.handle.title = 'Drag to mark a location; Enter for coordinates. No geometry is moved.';
    this.handle.hidden = !item || !this.state?.interactive;
    if (this.linkedSelection) {
      this.caption.textContent = 'Read-only IFC reference · ' + this.linkedSelection.source.globalId;
      this.handle.hidden = true;
    }
  }

  private readonly renderFrame = (): void => {
    if (!this.active || this.root.clientWidth === 0 || this.root.clientHeight === 0) return;
    const now = performance.now();
    this.navigation.tick(this.previousFrame ? (now - this.previousFrame) / 1000 : 0); this.previousFrame = now;
    const camera = this.model.activeCamera; camera.update();
    const signature = `${camera.uniqueId}:${camera.getViewMatrix().toArray().join(':')}`;
    if (signature !== this.cameraSignature) { this.cameraSignature = signature; this.frames = 2; this.hover(null); }
    this.markup?.flush();
    const ready = this.model.scene.isReady();
    // Async shaders/textures can become ready after the last budgeted frame.
    // Render that transition before publishing readiness or going idle.
    if (ready && this.root.dataset.sceneReady !== 'true') this.frames = Math.max(1, this.frames);
    if (this.frames <= 0 && ready) return;
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
    let next: ActiveViewerState = { ...state, levelId: state.levelId ?? null, roofVisible: state.roofVisible ?? true };
    const projectChanged = this.state?.projectId !== next.projectId;
    if (this.drag && (projectChanged || !state.interactive || state.selectedId !== this.state?.selectedId || next.levelId !== this.state?.levelId || next.roofVisible !== this.state?.roofVisible)) this.endDrag(false);
    if (projectChanged || !state.comparison || JSON.stringify(this.state?.comparison) !== JSON.stringify(state.comparison) || JSON.stringify(this.state?.snapshot) !== JSON.stringify(state.snapshot)) this.comparisonSelection = null;
    next = { ...next, selectedId: this.comparisonSelection ?? state.selectedId };
    const inLevel = (snapshot: ModelSnapshot | null, id: string): boolean => {
      const item = snapshot?.entities.find((candidate) => candidate.id === id);
      return Boolean(snapshot && item && (next.levelId === null || entityLevel(snapshot, item)?.id === next.levelId || item.type === 'Stair' && item.toLevelId === next.levelId)
        && (next.roofVisible || item.type !== 'Roof'));
    };
    const objects = [...new Map([...(state.comparison?.entities ?? []), ...state.snapshot.entities].map((item) => [item.id, item])).values()]
      .filter((item) => item.type !== 'AssetFamily' && (inLevel(state.snapshot, item.id) || inLevel(state.comparison, item.id)));
    const changes = new Map((state.comparison ? modelChanges(state.comparison, state.snapshot) : []).map((item) => [item.id, item.status]));
    if (!objects.some((item) => item.id === next.selectedId) || state.comparison && !this.comparisonSelection && !changes.has(next.selectedId)) {
      next = { ...next, selectedId: objects.find((item) => changes.has(item.id))?.id ?? objects[0]?.id ?? '' };
    }
    const focusChanged = this.state?.focusId !== state.focusId;
    const levelChanged = this.state?.levelId !== next.levelId;
    const viewChanged = !this.active || projectChanged || this.root.parentElement !== host || focusChanged || levelChanged
      || this.state?.mode !== next.mode || this.state?.cutaway !== next.cutaway || this.state?.roofVisible !== next.roofVisible
      || JSON.stringify([this.state?.snapshot, this.state?.comparison]) !== JSON.stringify([next.snapshot, next.comparison]);
    if (viewChanged) this.navigation.stop();
    this.state = next;
    const objectSignature = JSON.stringify(objects.map((item) => [item.id, item.name, changes.get(item.id)]));
    if (objectSignature !== this.objectSignature) {
      this.selection.replaceChildren(...objects.map((item) => new Option(`${item.name}${changes.has(item.id) ? ' · ' + (changes.get(item.id) === 'modified' ? 'changed' : changes.get(item.id)) : ''}`, item.id)));
      this.objectSignature = objectSignature;
    }
    this.selection.value = next.selectedId;
    if (this.root.parentElement !== host) host.replaceChildren(this.root);
    this.model.setMode(state.mode); this.model.setModel(state.snapshot, state.comparison, state.projectId ?? null); this.model.select(this.linkedSelection ? '' : next.selectedId);
    this.model.setRoofVisible(next.roofVisible); this.model.setLevel(next.levelId);
    this.navigation.setContext({ projectId: state.projectId ?? null, sourcePin: state.navigationPin ?? JSON.stringify(state.snapshot),
      levelId: next.levelId, snapshot: state.snapshot });
    if (projectChanged) this.model.frame();
    this.model.setCutaway(state.cutaway);
    const floor = (next.levelId ? levels(state.snapshot).find(level => level.id === next.levelId) : entityLevel(state.snapshot, next.selectedId))
      ?? [...levels(state.snapshot)].sort((a, b) => a.elevation - b.elevation)[0];
    this.markup?.update({ binding: state.markup?.binding ?? '', enabled: !!state.markup?.editable && state.interactive,
      annotations: state.markup?.annotations ?? [], references: state.markup?.references ?? [],
      floor: { elevation: floor?.elevation ?? 0, name: floor?.name ?? 'Model floor' } });
    if (!this.drag) this.model.mark(state.reference);
    this.updateCaption(); this.frames = 3; this.engine.resize();
    this.active = true; if (!document.hidden) this.engine.runRenderLoop(this.renderFrame);
  }

  get navigationState(): ViewSession { return this.navigation.state; }
  captureInsidePose(): InsidePose | null { return this.navigation.capture(); }
  stopNavigation(): void { this.navigation.stop(); }
  async activateMouseLook(): Promise<'locked' | 'drag' | 'unavailable'> { return this.navigation.activateMouseLook(); }
  changeView(intent: ViewIntent): NavigationResult {
    const result = this.navigation.change(intent); this.frames = 3; return result;
  }
  returnToPose(pose: InsidePose): NavigationResult {
    const result = this.navigation.returnTo(pose); this.frames = 3; return result;
  }

  hide(): void { this.navigation.stop(); this.endDrag(false); this.markup?.hide(); this.pointer.reset(); this.hover(null); this.active = false; this.engine.stopRenderLoop(this.renderFrame); this.root.remove(); }
  setLinkedModels(links: readonly LinkedDisplay[]): void {
    this.linked.setLinks(links); this.frames = 3;
    this.root.dataset.linkedModels = String(links.filter(link => link.visible).length);
  }
  selectLinkedReference(selection: LinkedSelection | null): void {
    this.linkedSelection = selection; this.linked.select(selection);
    this.model.select(selection ? '' : this.state?.selectedId ?? ''); this.updateCaption(); this.frames = 3;
  }
  frameLinkedModels(selection: LinkedSelection | null = null): void {
    const meshes = this.model.scene.meshes.filter(mesh => mesh.isEnabled() && mesh.name.startsWith('ifc:')
      && (!selection || mesh.name === 'ifc:' + selection.occurrence.id + ':' + selection.source.globalId));
    if (!meshes.length) return;
    this.changeView({ kind: 'overview' });
    const boxes = meshes.map(mesh => { mesh.computeWorldMatrix(true); return mesh.getBoundingInfo().boundingBox; });
    const minimum = new Vector3(Math.min(...boxes.map(box => box.minimumWorld.x)), Math.min(...boxes.map(box => box.minimumWorld.y)), Math.min(...boxes.map(box => box.minimumWorld.z)));
    const maximum = new Vector3(Math.max(...boxes.map(box => box.maximumWorld.x)), Math.max(...boxes.map(box => box.maximumWorld.y)), Math.max(...boxes.map(box => box.maximumWorld.z)));
    const span = Math.max(.5, maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z);
    this.model.camera.setTarget(Vector3.Center(minimum, maximum));
    this.model.camera.radius = Math.max(2, span * 1.65);
    this.model.camera.lowerRadiusLimit = Math.max(.1, span * .02); this.model.camera.upperRadiusLimit = Math.max(20, span * 8);
    this.frames = 3;
  }
  frame(): void { this.changeView({ kind: 'overview' }); this.pointer.cancelClick(); this.hover(null); this.model.frame(); this.frames = 3; }
  dispose(): void {
    this.hide(); this.observer.disconnect(); document.removeEventListener('visibilitychange', this.visibility);
    this.navigation.dispose(); this.markup?.dispose(); this.linked.dispose(); this.model.dispose(); this.engine.dispose();
    if (FileToolsOptions.PreprocessUrl === this.imageUrl) FileToolsOptions.PreprocessUrl = this.previousImageUrl;
    for (const url of this.embeddedImages.values()) URL.revokeObjectURL(url);
    this.embeddedImages.clear();
  }
}
