import * as THREE from 'three';
import { EditRequestType, EditUtils, FragmentsModels, RenderedFaces } from '@thatopen/fragments';
import type { EditRequest, Element as FragmentElement, FragmentsModel, NewElementData } from '@thatopen/fragments';
import type { Adapter, Camera, Changes, Element, Geometry, Model, Readback } from '../contract.ts';

export class FragmentsAdapter implements Adapter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly view: THREE.PerspectiveCamera;
  private readonly fragments: FragmentsModels;
  private model: FragmentsModel | null = null;
  private readonly elements = new Map<string, FragmentElement>();
  private readonly geometries = new Map<string, string | number>();
  private readonly sourceGeometries = new Map<string, Geometry>();
  private readonly materials = new Map<string, string | number>();
  private filter: string[] | null = null;
  private selection: string | null = null;
  private readonly clippingPlanes: THREE.Plane[] = [];

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
    this.model = await this.fragments.load(EditUtils.newModel({ raw: true }), {
      modelId: model.id, camera: this.view, raw: true, clippingPlanes: this.clippingPlanes,
    });
    this.scene.add(this.model.object);
    for (const geometry of model.geometries) this.sourceGeometries.set(geometry.id, geometry);
    await this.apply({ upsert: model.elements, remove: [] });
  }

  async apply(changes: Changes): Promise<void> {
    if (!changes.remove.length && !changes.upsert.length) return;
    const model = this.loaded(); const editor = this.fragments.editor;
    const deleted: FragmentElement[] = [];
    for (const id of [...changes.remove, ...changes.upsert.map(item => item.id)]) {
      const element = this.elements.get(id); if (element) deleted.push(element);
      this.elements.delete(id);
    }
    const removals: EditRequest[] = [];
    for (const element of deleted) {
      // Element.delete also deletes its shared representation/material. Keep those
      // resources alive for other instances and for restoring a discarded proposal.
      for (const localId of Object.keys(element.core.samples).map(Number)) removals.push({ type: EditRequestType.DELETE_SAMPLE, localId });
      for (const localId of Object.keys(element.core.globalTransforms).map(Number)) removals.push({ type: EditRequestType.DELETE_GLOBAL_TRANSFORM, localId });
      for (const localId of Object.keys(element.core.localTransforms).map(Number)) removals.push({ type: EditRequestType.DELETE_LOCAL_TRANSFORM, localId });
      removals.push({ type: EditRequestType.DELETE_ITEM, localId: element.localId });
    }
    if (removals.length) await editor.edit(model.modelId, removals);
    const definitions: NewElementData[] = changes.upsert.map(item => this.definition(item));
    const created = definitions.length ? await editor.createElements(model.modelId, definitions) : [];
    if (!created || created.length !== definitions.length) throw new Error('Fragments element creation failed');
    for (let i = 0; i < changes.upsert.length; i++) {
      const item = changes.upsert[i]; const element = created[i];
      this.elements.set(item.id, element);
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
      if (!model.object.visible) continue;
      const hit = await model.raycast({ camera: this.view, mouse: new THREE.Vector2(x + rectangle.left, y + rectangle.top), dom: this.renderer.domElement });
      if (!hit) continue;
      const records = await model.getItemsData([hit.localId]);
      const attribute = records[0]?.benchmarkId;
      const id = attribute && !Array.isArray(attribute) ? attribute.value : null;
      if (typeof id !== 'string' || !this.elements.has(id)) throw new Error('Picked Fragments element has no benchmark identity');
      if (!nearest || hit.distance < nearest.distance) nearest = { id, distance: hit.distance };
    }
    return nearest?.id ?? null;
  }
  async select(id: string | null): Promise<void> {
    const element = id ? this.elements.get(id) : null;
    this.selection = element ? id : null;
    for (const model of this.fragments.models.list.values()) {
      await model.resetHighlight();
      if (element) {
        const records = await model.getItems();
        const ids = [...records].filter(([, record]) => record.data.benchmarkId?.value === id).map(([localId]) => localId);
        if (ids.length) await model.highlight(ids, { color: new THREE.Color(0, 1, 1), renderedFaces: RenderedFaces.TWO, opacity: 1, transparent: false });
      }
    }
    await this.frame();
  }
  async properties(id: string): Promise<Record<string, string>> {
    const element = this.elements.get(id); if (!element) throw new Error('Missing element: ' + id);
    const records = await this.loaded().getItemsData([element.localId]); const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(records[0] ?? {})) {
      if (key.startsWith('property:') && !Array.isArray(value) && typeof value.value === 'string') result[key.slice(9)] = value.value;
    }
    return result;
  }
  async visible(ids: string[] | null): Promise<void> {
    this.filter = ids;
    for (const model of this.fragments.models.list.values()) {
      await model.setVisible(undefined, ids === null);
      if (ids) {
        const records = await model.getItems(); const selected = new Set(ids);
        const localIds = [...records].filter(([, record]) => {
          const id = record.data.benchmarkId?.value; return typeof id === 'string' && selected.has(id);
        }).map(([localId]) => localId);
        if (localIds.length) await model.setVisible(localIds, true);
      }
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
    const result: Readback[] = [];
    for (const model of this.fragments.models.list.values()) {
      const transforms = await model.getGlobalTransforms(); const records = await model.getItems();
      for (const transform of transforms.values()) {
        if (typeof transform.itemId !== 'number') throw new Error('Unresolved Fragments item ID');
        const box = await model.getMergedBox([transform.itemId]);
        if (box.isEmpty()) continue;
        const record = records.get(transform.itemId); const id = record?.data.benchmarkId?.value;
        if (typeof id !== 'string' || transform.position.length !== 3) throw new Error('Fragments identity/transform readback failed');
        result.push({ id, position: [transform.position[0], transform.position[1], transform.position[2]],
          min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
      }
    }
    return result;
  }
  async frame(): Promise<void> {
    await this.fragments.update(true);
    this.renderer.render(this.scene, this.view);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  stats(): { drawCalls: number; triangles: number } {
    return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
  async dispose(): Promise<void> {
    await this.fragments.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.scene.clear(); this.elements.clear(); this.geometries.clear(); this.sourceGeometries.clear(); this.materials.clear(); this.model = null;
  }
}
