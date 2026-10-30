import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { createMarkupPlane, createSpatialMarkup, parseSpatialMarkup, spatialMarkupDescription, spatialMarkupVertices, MARKUP_LIMITS } from '../src/spatial-markup.ts';
import type { MarkupPlane, MarkupPoint, MarkupTool, SpatialMarkup } from '../src/spatial-markup.ts';

interface MarkupState {
  binding: string; enabled: boolean; floor: { elevation: number; name: string };
  annotations: readonly SpatialMarkup[]; references: readonly SpatialMarkup[];
}
interface MarkupActions {
  scene: Scene; camera: ArcRotateCamera; canvas: HTMLCanvasElement;
  surface: (x: number, y: number) => { position: MarkupPoint; normal: MarkupPoint } | null;
  changed: (annotations: readonly SpatialMarkup[], binding: string) => boolean;
  begin: () => void; render: () => void; attach: () => void;
}
interface Gesture { id: number; plane: MarkupPlane; start: MarkupPoint }
const world = (p: MarkupPoint): Vector3 => new Vector3(p[0], p[2], p[1]);
const project = (p: Vector3): MarkupPoint => [p.x, p.z, p.y];
const toolNames: Record<MarkupTool, string> = { line: 'Line', rectangle: 'Rectangle', circle: 'Circle', polyline: 'Polyline' };

/** Owns only approximate request overlays and their interaction, never BIM entities. */
export class SpatialMarkupView {
  readonly root = document.createElement('div');
  private readonly panel = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private readonly message = document.createElement('span');
  private readonly planeChoice = document.createElement('select');
  private readonly tools = new Map<MarkupTool, HTMLButtonElement>();
  private readonly selectButton: HTMLButtonElement;
  private readonly finish: HTMLButtonElement;
  private readonly undo: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly attach: HTMLButtonElement;
  private readonly actions: MarkupActions;
  private state: MarkupState | null = null;
  private tool: MarkupTool | null = null;
  private gesture: Gesture | null = null;
  private polyline: { plane: MarkupPlane; points: MarkupPoint[]; cursor: MarkupPoint | null } | null = null;
  private candidate: SpatialMarkup | null = null;
  private committedSignature = '';
  private readonly committed: Mesh[] = [];
  private readonly previewMeshes: Mesh[] = [];
  private readonly material: StandardMaterial;
  private readonly ghost: StandardMaterial;
  private previewDirty = false;

  constructor(actions: MarkupActions) {
    this.actions = actions; this.root.className = 'model-markup-controls';
    this.toggle.type = 'button'; this.toggle.textContent = '✎ Markup'; this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-label', '3D markup');
    this.panel.className = 'model-markup-toolbar'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'toolbar'); this.panel.setAttribute('aria-label', '3D markup tools');
    this.toggle.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden; this.toggle.setAttribute('aria-expanded', String(!this.panel.hidden));
      if (this.panel.hidden) this.choose(null);
    });
    const button = (name: string, action: () => void): HTMLButtonElement => {
      const item = document.createElement('button'); item.type = 'button'; item.textContent = name; item.setAttribute('aria-label', name);
      item.addEventListener('click', action); this.panel.append(item); return item;
    };
    this.selectButton = button('Select', () => this.choose(null));
    const toolList: readonly MarkupTool[] = ['line', 'rectangle', 'circle', 'polyline'];
    for (const tool of toolList) {
      this.tools.set(tool, button(toolNames[tool], () => this.choose(tool)));
    }
    this.planeChoice.setAttribute('aria-label', 'Markup drawing plane'); this.planeChoice.append(new Option('Floor', 'floor'), new Option('Pick surface', 'surface'));
    this.planeChoice.addEventListener('change', () => { this.cancelGesture(); this.refresh(); }); this.panel.append(this.planeChoice);
    this.finish = button('Finish polyline', () => this.finishPolyline());
    this.undo = button('Undo markup', () => {
      if (this.polyline?.points.length) { this.polyline.points.pop(); this.candidate = null; this.previewDirty = true; this.refresh(); this.actions.render(); return; }
      if (this.state?.annotations.length) this.actions.changed(this.state.annotations.slice(0, -1), this.state.binding);
    });
    this.clear = button('Clear markup', () => { this.choose(null); if (this.state) this.actions.changed([], this.state.binding); });
    this.attach = button('Describe this markup in chat', () => { this.choose(null); this.actions.attach(); });
    this.message.className = 'model-markup-status'; this.message.setAttribute('role', 'status');
    this.root.append(this.toggle, this.panel, this.message);
    this.material = new StandardMaterial('request-markup-orange', actions.scene);
    this.material.emissiveColor = Color3.FromHexString('#ff6800'); this.material.diffuseColor = Color3.FromHexString('#ff6800'); this.material.disableLighting = true;
    this.ghost = new StandardMaterial('request-markup-reference', actions.scene);
    this.ghost.emissiveColor = Color3.FromHexString('#a95b17'); this.ghost.disableLighting = true; this.ghost.alpha = .55;
    actions.canvas.addEventListener('pointerdown', this.down, true);
    actions.canvas.addEventListener('pointermove', this.move, true);
    actions.canvas.addEventListener('pointerup', this.up, true);
    actions.canvas.addEventListener('pointercancel', this.cancelPointer, true);
    actions.canvas.addEventListener('lostpointercapture', this.cancelPointer, true);
    actions.canvas.addEventListener('keydown', this.keydown, true);
    this.root.addEventListener('keydown', this.keydown, true);
  }

  update(state: MarkupState): void {
    if (this.state?.annotations.length && !state.annotations.length && state.references.length) {
      this.panel.hidden = true; this.toggle.setAttribute('aria-expanded', 'false');
    }
    if (this.state && (state.binding !== this.state.binding || !state.enabled || state.floor.elevation !== this.state.floor.elevation)) this.choose(null);
    this.state = state;
    const signature = JSON.stringify([state.annotations, state.references]);
    if (signature !== this.committedSignature) {
      this.disposeMeshes(this.committed); this.committedSignature = signature;
      state.references.forEach(mark => this.draw(mark, this.ghost, this.committed));
      state.annotations.forEach(mark => this.draw(mark, this.material, this.committed));
    }
    this.root.hidden = !state.enabled && !state.annotations.length && !state.references.length;
    const floorOption = this.planeChoice.options[0]; if (floorOption) floorOption.text = `Floor · ${state.floor.name}`;
    this.root.dataset.markupCount = String(state.annotations.length);
    this.root.dataset.referenceMarkupCount = String(state.references.length);
    this.refresh();
  }

  start(tool: MarkupTool = 'rectangle'): void {
    if (!this.state?.enabled) return;
    this.panel.hidden = false; this.toggle.setAttribute('aria-expanded', 'true'); this.choose(tool); this.actions.canvas.focus();
  }

  private choose(tool: MarkupTool | null): void {
    this.cancelGesture();
    this.tool = this.state?.enabled ? tool : null;
    if (this.tool) { this.actions.begin(); this.actions.camera.detachControl(); }
    else this.actions.camera.attachControl(this.actions.canvas, false);
    this.actions.canvas.classList.toggle('is-markup-drawing', this.tool !== null);
    this.root.dataset.tool = this.tool ?? 'select'; this.refresh(); this.actions.render();
  }

  private refresh(): void {
    const enabled = this.state?.enabled ?? false;
    for (const [tool, button] of this.tools) { button.disabled = !enabled; button.setAttribute('aria-pressed', String(this.tool === tool)); }
    this.selectButton.setAttribute('aria-pressed', String(this.tool === null));
    this.planeChoice.disabled = !enabled;
    this.finish.hidden = this.tool !== 'polyline'; this.finish.disabled = !enabled || (this.polyline?.points.length ?? 0) < 2;
    this.undo.disabled = !enabled || !this.state?.annotations.length && !this.polyline?.points.length;
    this.clear.disabled = !enabled || !this.state?.annotations.length;
    this.attach.disabled = !enabled || !this.state?.annotations.length;
    const last = this.state?.annotations.at(-1);
    this.message.textContent = this.candidate ? `${spatialMarkupDescription(this.candidate)} · approximate`
      : this.tool === 'polyline' ? 'Click points · Enter or Finish · Escape cancels'
      : this.tool ? 'Drag to draw · Escape cancels · approximate metres'
      : last ? `${spatialMarkupDescription(last)} · attached to chat`
      : this.state?.references.length ? 'Saved markup · inspect its bound chat snapshot' : '';
  }

  private location(event: PointerEvent): { x: number; y: number; inside: boolean } {
    const rect = this.actions.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top,
      inside: event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom };
  }

  private planeAt(event: PointerEvent): MarkupPlane | null {
    if (!this.state) return null;
    if (this.planeChoice.value === 'floor') return createMarkupPlane({ origin: [0, 0, this.state.floor.elevation], normal: [0, 0, 1] });
    const { x, y } = this.location(event); const hit = this.actions.surface(x, y);
    return hit ? createMarkupPlane({ origin: hit.position, normal: hit.normal }) : null;
  }

  private point(event: PointerEvent, plane: MarkupPlane): MarkupPoint | null {
    const { x, y, inside } = this.location(event); if (!inside) return null;
    const ray = this.actions.scene.createPickingRay(x, y, Matrix.Identity(), this.actions.camera);
    const distance = ray.intersectsPlane(Plane.FromPositionAndNormal(world(plane.origin), world(plane.normal)));
    if (distance === null || !Number.isFinite(distance) || distance < 0 || distance > MARKUP_LIMITS.spanMetres * 2) return null;
    const point = project(ray.origin.add(ray.direction.scale(distance)));
    return point.every(n => Number.isFinite(n) && Math.abs(n) <= MARKUP_LIMITS.coordinateMetres) ? point : null;
  }

  private readonly down = (event: PointerEvent): void => {
    if (!this.tool || !this.state?.enabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.isPrimary || event.button !== 0 || this.gesture) { this.choose(null); return; }
    const plane = this.polyline?.plane ?? this.planeAt(event);
    const start = plane ? this.point(event, plane) : null;
    if (!plane || !start) { this.message.textContent = 'Choose a visible surface, or use the Floor plane.'; return; }
    this.gesture = { id: event.pointerId, plane, start };
    this.actions.canvas.setPointerCapture(event.pointerId);
  };

  private readonly move = (event: PointerEvent): void => {
    if (!this.tool) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (this.gesture?.id === event.pointerId) {
      const end = this.point(event, this.gesture.plane);
      if (this.tool !== 'polyline') {
        try { this.candidate = end ? createSpatialMarkup({ tool: this.tool, plane: this.gesture.plane, start: this.gesture.start, end, label: toolNames[this.tool] }) : null; }
        catch { this.candidate = null; }
      }
    } else if (this.polyline) this.polyline.cursor = this.point(event, this.polyline.plane);
    this.previewDirty = true; this.refresh(); this.actions.render();
  };

  private readonly up = (event: PointerEvent): void => {
    if (!this.tool || !this.gesture || this.gesture.id !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const gesture = this.gesture; const tool = this.tool; const end = this.point(event, gesture.plane);
    this.gesture = null;
    if (this.actions.canvas.hasPointerCapture(event.pointerId)) this.actions.canvas.releasePointerCapture(event.pointerId);
    if (!end) { this.choose(null); return; }
    if (tool === 'polyline') {
      this.polyline ??= { plane: gesture.plane, points: [], cursor: null };
      const previous = this.polyline.points.at(-1);
      if (!previous || Math.hypot(end[0] - previous[0], end[1] - previous[1], end[2] - previous[2]) >= MARKUP_LIMITS.minimumMetres) {
        if (this.polyline.points.length < MARKUP_LIMITS.points) this.polyline.points.push(end);
      }
      this.previewDirty = true; this.refresh(); this.actions.render(); return;
    }
    try { this.commit(createSpatialMarkup({ tool, plane: gesture.plane, start: gesture.start, end, label: toolNames[tool] })); }
    catch (error) { this.choose(null); this.message.textContent = error instanceof Error ? error.message : 'Draw a larger shape.'; }
  };

  private readonly cancelPointer = (event: PointerEvent): void => {
    if (this.gesture?.id === event.pointerId) this.choose(null);
  };

  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.tool) { event.preventDefault(); event.stopPropagation(); this.choose(null); }
    if (event.key === 'Enter' && this.tool === 'polyline') { event.preventDefault(); event.stopPropagation(); this.finishPolyline(); }
  };

  private finishPolyline(): void {
    if (!this.polyline || this.polyline.points.length < 2) return;
    try { this.commit(parseSpatialMarkup({ kind: 'polyline', points: this.polyline.points, label: 'Polyline' })); }
    catch (error) { this.message.textContent = error instanceof Error ? error.message : 'Invalid polyline.'; }
  }

  private commit(markup: SpatialMarkup): void {
    const state = this.state; if (!state?.enabled) return;
    if (state.annotations.length >= 16) { this.message.textContent = 'Up to sixteen markup shapes can be attached. Undo or clear a shape first.'; return; }
    const accepted = this.actions.changed([...state.annotations, markup], state.binding);
    this.choose(null);
    if (!accepted) this.message.textContent = 'Markup was not attached. Inspect the chat error and try again.';
  }

  private cancelGesture(): void {
    const gesture = this.gesture; this.gesture = null; this.polyline = null; this.candidate = null;
    if (gesture && this.actions.canvas.hasPointerCapture(gesture.id)) this.actions.canvas.releasePointerCapture(gesture.id);
    this.disposeMeshes(this.previewMeshes); this.previewDirty = false;
  }

  private draw(markup: SpatialMarkup, material: StandardMaterial, target: Mesh[]): void {
    const points = spatialMarkupVertices(markup).map(world);
    const mesh = MeshBuilder.CreateTube('request-markup-not-model', { path: points, radius: .012, tessellation: 6, cap: Mesh.CAP_ALL }, this.actions.scene);
    mesh.material = material; mesh.isPickable = false; mesh.renderingGroupId = 2;
    target.push(mesh);
  }

  flush(): void {
    if (!this.previewDirty) return;
    this.disposeMeshes(this.previewMeshes);
    if (this.candidate) this.draw(this.candidate, this.material, this.previewMeshes);
    else if (this.polyline && this.polyline.points.length) {
      const points = [...this.polyline.points, ...(this.polyline.cursor ? [this.polyline.cursor] : [])];
      if (points.length >= 2) {
        try { this.draw(parseSpatialMarkup({ kind: 'polyline', points, label: 'Polyline' }), this.material, this.previewMeshes); } catch { /* Cursor may coincide with the last vertex. */ }
      } else if (points[0]) {
        const dot = MeshBuilder.CreateSphere('request-markup-vertex', { diameter: .05, segments: 6 }, this.actions.scene);
        dot.position.copyFrom(world(points[0])); dot.material = this.material; dot.isPickable = false; dot.renderingGroupId = 2; this.previewMeshes.push(dot);
      }
    }
    this.previewDirty = false;
  }

  private disposeMeshes(meshes: Mesh[]): void { for (const mesh of meshes) mesh.dispose(); meshes.length = 0; }
  hide(): void { this.choose(null); }
  dispose(): void {
    this.hide(); this.disposeMeshes(this.committed); this.disposeMeshes(this.previewMeshes); this.material.dispose(); this.ghost.dispose(); this.root.remove();
    const canvas = this.actions.canvas;
    canvas.removeEventListener('pointerdown', this.down, true); canvas.removeEventListener('pointermove', this.move, true);
    canvas.removeEventListener('pointerup', this.up, true); canvas.removeEventListener('pointercancel', this.cancelPointer, true);
    canvas.removeEventListener('lostpointercapture', this.cancelPointer, true); canvas.removeEventListener('keydown', this.keydown, true);
    this.root.removeEventListener('keydown', this.keydown, true);
  }
}
