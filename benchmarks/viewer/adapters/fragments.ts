import * as THREE from 'three';
import { EditRequestType, EditUtils, FragmentsModels, LodMode, RenderedFaces } from '@thatopen/fragments';
import type { EditRequest, Element as FragmentElement, FragmentsModel, NewElementData } from '@thatopen/fragments';
import type { Adapter, Camera, Changes, Element, Geometry, Model, Readback } from '../contract.ts';
import { parseFragmentsInput } from '../contract.ts';

type ReviewRecord = { kind: 'review'; localId: number; samples: number[]; globalTransforms: number[]; localTransforms: number[] };
type ElementRecord = { kind: 'base'; localId: number } | ReviewRecord;

export class FragmentsAdapter implements Adapter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly view: THREE.PerspectiveCamera;
  private readonly fragments: FragmentsModels;
  private model: FragmentsModel | null = null;
  private nativeBase: FragmentsModel | null = null;
  private readonly elements = new Map<string, ElementRecord>();
  private readonly baseline = new Map<string, { element: Element; record: Extract<ElementRecord, { kind: 'base' }> }>();
  private readonly geometries = new Map<string, string | number>();
  private readonly sourceGeometries = new Map<string, Geometry>();
  private readonly materials = new Map<string, string | number>();
  private filter: string[] | null = null;
  private selection: string | null = null;
  private readonly clippingPlanes: THREE.Plane[] = [];
  private readonly configuredModels = new WeakSet<FragmentsModel>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(1); this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.localClippingEnabled = true;
    this.scene.background = new THREE.Color(.94, .95, .97);
    this.scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
    this.view = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, .01, 100000);
    this.fragments = new FragmentsModels(new URL('./fragments-worker.mjs', location.href).href, { maxWorkers: 2 });
    this.fragments.settings.autoCoordinate = false;
    this.fragments.settings.graphicsQuality = 1;
  }

  private loaded(): FragmentsModel {
    if (!this.model) throw new Error('Fragments model is not loaded');
    return this.model;
  }
  async load(model: Model): Promise<void> {
    if (this.model) throw new Error('Use a fresh adapter for a fresh load');
    for (const geometry of model.geometries) this.sourceGeometries.set(geometry.id, geometry);
    const configuration = await fetch('/fragments-input.json');
    if (!configuration.ok) throw new Error('Fragments input configuration unavailable');
    const input = parseFragmentsInput(await configuration.json());
    if (input.kind === 'native') {
      if (input.manifest.modelId !== model.id || input.manifest.revision !== model.revision || input.manifest.elements !== model.elements.length) throw new Error('Native Fragments model identity mismatch');
      const response = await fetch('/native.frag'); if (!response.ok) throw new Error('Native Fragments download failed');
      const buffer = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), value => value.toString(16).padStart(2, '0')).join('');
      if (buffer.byteLength !== input.manifest.bytes || digest !== input.manifest.sha256) throw new Error('Native Fragments binary integrity mismatch');
      console.info('[viewer-benchmark] fragments native-load ' + buffer.byteLength);
      this.nativeBase = await this.fragments.load(new Uint8Array(buffer), { modelId: model.id, camera: this.view, raw: true, clippingPlanes: this.clippingPlanes });
      this.scene.add(this.nativeBase.object);
      const records = await this.nativeBase.getItems();
      const source = new Map(model.elements.map(item => [item.id, item]));
      for (const [localId, record] of records) {
        const id = record.data.benchmarkId?.value;
        const element = typeof id === 'string' ? source.get(id) : null;
        if (typeof id !== 'string' || !element || this.elements.has(id)) throw new Error('Native Fragments element identity mismatch');
        const baseRecord: Extract<ElementRecord, { kind: 'base' }> = { kind: 'base', localId };
        this.elements.set(id, baseRecord); this.baseline.set(id, { element, record: baseRecord });
      }
      if (this.elements.size !== model.elements.length) throw new Error('Native Fragments element count mismatch');
      this.model = await this.fragments.load(EditUtils.newModel({ raw: true }), { modelId: model.id + ':review', camera: this.view, raw: true, clippingPlanes: this.clippingPlanes });
      this.scene.add(this.model.object);
      console.info('[viewer-benchmark] fragments native-indexed ' + this.elements.size);
      await this.frame(); return;
    }
    console.info('[viewer-benchmark] fragments empty-model-load');
    this.model = await this.fragments.load(EditUtils.newModel({ raw: true }), {
      modelId: model.id, camera: this.view, raw: true, clippingPlanes: this.clippingPlanes,
    });
    this.scene.add(this.model.object);
    console.info('[viewer-benchmark] fragments empty-model-ready');
    await this.apply({ upsert: model.elements, remove: [] });
  }

  async apply(changes: Changes): Promise<void> {
    if (!changes.remove.length && !changes.upsert.length) return;
    const model = this.loaded(); const editor = this.fragments.editor;
    const deleted: ReviewRecord[] = [];
    for (const id of [...changes.remove, ...changes.upsert.map(item => item.id)]) {
      const element = this.elements.get(id); if (element?.kind === 'review') deleted.push(element);
      this.elements.delete(id);
    }
    const removals: EditRequest[] = [];
    for (const element of deleted) {
      // Element.delete also deletes its shared representation/material. Keep those
      // resources alive for other instances and for restoring a discarded proposal.
      for (const localId of element.samples) removals.push({ type: EditRequestType.DELETE_SAMPLE, localId });
      for (const localId of element.globalTransforms) removals.push({ type: EditRequestType.DELETE_GLOBAL_TRANSFORM, localId });
      for (const localId of element.localTransforms) removals.push({ type: EditRequestType.DELETE_LOCAL_TRANSFORM, localId });
      removals.push({ type: EditRequestType.DELETE_ITEM, localId: element.localId });
    }
    const upserts = changes.upsert.filter(item => {
      const base = this.baseline.get(item.id);
      if (!base || JSON.stringify(base.element) !== JSON.stringify(item)) return true;
      this.elements.set(item.id, base.record); return false;
    });
    if (this.nativeBase && !upserts.length && ![...this.elements.values()].some(item => item.kind === 'review')) {
      // A discarded review has no overlay geometry. Reset the editable root
      // instead of retaining a delta with unused representations and no samples.
      await editor.reset(model.modelId); this.geometries.clear(); this.materials.clear();
      console.info('[viewer-benchmark] fragments overlay-reset');
      await this.visible(this.filter); await this.select(this.selection); return;
    }
    if (removals.length) await editor.edit(model.modelId, removals);
    const definitions: NewElementData[] = upserts.map((item, index) => {
      if (index % 1000 === 0) console.info('[viewer-benchmark] fragments definitions ' + index + '/' + changes.upsert.length);
      return this.definition(item);
    });
    console.info('[viewer-benchmark] fragments create-elements ' + definitions.length);
    const edited = (): void => console.info('[viewer-benchmark] fragments edit-committed');
    editor.onEdit.add(edited);
    let created: FragmentElement[] | null;
    try { created = definitions.length ? await editor.createElements(model.modelId, definitions) : []; }
    finally { editor.onEdit.remove(edited); }
    console.info('[viewer-benchmark] fragments elements-created ' + (created?.length ?? 0));
    if (!created || created.length !== definitions.length) throw new Error('Fragments element creation failed');
    for (let i = 0; i < upserts.length; i++) {
      const item = upserts[i]; const element = created[i];
      this.elements.set(item.id, { kind: 'review', localId: element.localId, samples: Object.keys(element.core.samples).map(Number),
        globalTransforms: Object.keys(element.core.globalTransforms).map(Number), localTransforms: Object.keys(element.core.localTransforms).map(Number) });
      const sample = Object.values(element.core.samples)[0];
      if (!sample) throw new Error('Fragments element has no geometry sample');
      this.geometries.set(JSON.stringify([item.geometryId, item.scale]), sample.representation); this.materials.set(item.color.join(','), sample.material);
    }
    for (const runtime of this.fragments.models.list.values()) runtime.useClippingPlanes(this.clippingPlanes);
    await this.visible(this.filter);
    await this.select(this.selection);
  }

  private definition(item: Element): NewElementData {
    const model = this.loaded(); const editor = this.fragments.editor;
    const geometryKey = JSON.stringify([item.geometryId, item.scale]);
    let representation = this.geometries.get(geometryKey);
    if (representation === undefined) {
      const geometry = this.sourceGeometries.get(item.geometryId);
      if (!geometry) throw new Error('Missing Fragments geometry: ' + item.geometryId);
      // Raw Fragments transforms store coordinate directions, not a general
      // nonuniform scale. Bake dimensions once per geometry/scale combination.
      const buffer = new THREE.BufferGeometry();
      buffer.setAttribute('position', new THREE.Float32BufferAttribute(geometry.positions.map((value, index) => value * item.scale[index % 3]), 3));
      buffer.setIndex(geometry.indices); buffer.computeVertexNormals();
      representation = editor.createShell(model.modelId, buffer); buffer.dispose(); this.geometries.set(geometryKey, representation);
    }
    const key = item.color.join(','); let material = this.materials.get(key);
    if (material === undefined) {
      const color = new THREE.Color(...item.color);
      const temporary = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
      material = editor.createMaterial(model.modelId, temporary); temporary.dispose(); this.materials.set(key, material);
    }
    return { attributes: { _category: { value: item.category }, benchmarkId: { value: item.id },
      ...Object.fromEntries(Object.entries(item.properties).map(([name, value]) => ['property:' + name, { value }])) },
      globalTransform: new THREE.Matrix4().makeTranslation(...item.position),
      samples: [{ representation, material, localTransform: new THREE.Matrix4() }] };
  }
  async camera(camera: Camera): Promise<void> {
    this.view.position.set(...camera.eye); this.view.lookAt(...camera.target); this.view.updateMatrixWorld(true);
    await this.frame();
  }
  async pick(x: number, y: number): Promise<string | null> {
    const rectangle = this.renderer.domElement.getBoundingClientRect();
    let nearest: { id: string; distance: number } | null = null;
    for (const model of this.fragments.models.list.values()) {
      if (model === this.model) continue;
      if (!model.object.visible) continue;
      const hit = await model.raycast({ camera: this.view, mouse: new THREE.Vector2(x + rectangle.left, y + rectangle.top), dom: this.renderer.domElement });
      if (!hit) continue;
      const records = await model.getItemsData([hit.localId]);
      const attribute = records[0]?.benchmarkId;
      const id = attribute && !Array.isArray(attribute) ? attribute.value : null;
      const active = typeof id === 'string' ? this.elements.get(id) : null;
      if (typeof id !== 'string' || !active || active.localId !== hit.localId
        || active.kind !== (model === this.nativeBase ? 'base' : 'review')) throw new Error('Picked Fragments element has no active benchmark identity');
      if (!nearest || hit.distance < nearest.distance) nearest = { id, distance: hit.distance };
    }
    return nearest?.id ?? null;
  }
  async select(id: string | null): Promise<void> {
    const element = id ? this.elements.get(id) : null;
    this.selection = element ? id : null;
    for (const model of this.fragments.models.list.values()) {
      if (model === this.model) continue;
      await model.resetHighlight();
      if (element) {
        const records = await model.getItems();
        const ids = [...records].filter(([localId, record]) => record.data.benchmarkId?.value === id && localId === element.localId
          && element.kind === (model === this.nativeBase ? 'base' : 'review')).map(([localId]) => localId);
        if (ids.length) await model.highlight(ids, { color: new THREE.Color(0, 1, 1), renderedFaces: RenderedFaces.TWO, opacity: 1, transparent: false });
      }
    }
    await this.frame();
  }
  async properties(id: string): Promise<Record<string, string>> {
    const element = this.elements.get(id); if (!element) throw new Error('Missing element: ' + id);
    const model = element.kind === 'base' ? this.nativeBase : this.loaded(); if (!model) throw new Error('Native base unavailable');
    const records = await model.getItemsData([element.localId]); const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(records[0] ?? {})) {
      if (key.startsWith('property:') && !Array.isArray(value) && typeof value.value === 'string') result[key.slice(9)] = value.value;
    }
    return result;
  }
  async visible(ids: string[] | null): Promise<void> {
    this.filter = ids;
    for (const model of this.fragments.models.list.values()) {
      if (model === this.model) continue;
      await model.setVisible(undefined, false);
      const records = await model.getItems(); const selected = ids ? new Set(ids) : null;
      const localIds = [...records].filter(([localId, record]) => {
        const id = record.data.benchmarkId?.value;
        return typeof id === 'string' && this.elements.get(id)?.localId === localId
          && this.elements.get(id)?.kind === (model === this.nativeBase ? 'base' : 'review') && (!selected || selected.has(id));
      }).map(([localId]) => localId);
      if (localIds.length) await model.setVisible(localIds, true);
    }
    await this.frame();
  }
  async section(height: number | null): Promise<void> {
    this.clippingPlanes.length = 0;
    if (height !== null) this.clippingPlanes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), height));
    this.renderer.clippingPlanes = this.clippingPlanes;
    await this.frame();
  }
  async readback(): Promise<Readback[]> {
    const result: Readback[] = []; const filter = this.filter ? new Set(this.filter) : null;
    for (const model of this.fragments.models.list.values()) {
      // The editing root is empty; its logical getters include pending changes,
      // but the actual geometry and bounds belong to the runtime delta models.
      if (model === this.model) continue;
      const owner = model === this.nativeBase ? 'base' : 'review';
      const transforms = [...(await model.getGlobalTransforms()).values()]; const records = await model.getItems();
      const ids = transforms.map(transform => {
        if (typeof transform.itemId !== 'number') throw new Error('Unresolved Fragments item ID');
        return transform.itemId;
      });
      const boxes = await model.getBoxes(ids); const visible = await model.getVisible(ids);
      if (boxes.length !== ids.length || visible.length !== ids.length) throw new Error('Fragments readback batch lost item identities');
      for (let index = 0; index < transforms.length; index++) {
        const transform = transforms[index]; const box = boxes[index];
        const id = records.get(ids[index])?.data.benchmarkId?.value;
        if (typeof id !== 'string' || transform.position.length !== 3) throw new Error('Fragments identity/transform readback failed');
        const active = this.elements.get(id);
        if (!active || active.kind !== owner || active.localId !== ids[index]) {
          if (visible[index]) throw new Error('Inactive Fragments geometry remains visible: ' + id);
          continue;
        }
        if (visible[index] !== (!filter || filter.has(id))) throw new Error('Active Fragments visibility mismatch: ' + id);
        if (box.isEmpty()) throw new Error('Active Fragments geometry has no bounds: ' + id);
        result.push({ id, position: [transform.position[0], transform.position[1], transform.position[2]],
          min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
      }
    }
    return result;
  }
  async frame(): Promise<void> {
    for (const model of this.fragments.models.list.values()) {
      if (this.configuredModels.has(model)) continue;
      await model.setLodMode(LodMode.ALL_GEOMETRY); this.configuredModels.add(model);
    }
    await this.fragments.update(true);
    this.renderer.render(this.scene, this.view);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  stats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
  async dispose(): Promise<void> {
    await this.fragments.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.scene.clear(); this.elements.clear(); this.baseline.clear(); this.geometries.clear(); this.sourceGeometries.clear(); this.materials.clear(); this.model = null; this.nativeBase = null;
  }
}
