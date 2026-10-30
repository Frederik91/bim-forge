/** Disposable browser qualification mount; production uses the existing viewer's scene. */
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { ModelScene } from './model-scene.ts';
import { LinkedModelLayer } from './linked-model-render.ts';
import { LinkedModelPanel } from './linked-model-ui.ts';
import { LinkedModelClient } from './linked-model-client.ts';
import { RoomRepository } from '../src/room-model.ts';
import { linkedReferenceText } from '../src/linked-model.ts';
import { parseLinkedJob, parseLinkedPrepared } from '../src/linked-model.ts';
import type { LinkedJob, LinkedPrepared } from '../src/linked-model.ts';

const canvas = document.querySelector('canvas'); const host = document.getElementById('links'); const context = document.getElementById('context');
if (!canvas || !host || !context) throw new Error('Qualification mount missing.');
if (document.body.dataset.pollFixture === 'true') {
  const value: unknown = await (await fetch('/poll-fixture')).json();
  if (typeof value !== 'object' || value === null || !('readyA' in value) || !('readyB' in value) || !('runningC' in value) || !('mismatchedD' in value) || !('prepared' in value)) throw new Error('Invalid poll qualification fixture.');
  const readyA = parseLinkedJob(value.readyA); const readyB = parseLinkedJob(value.readyB);
  const runningC = parseLinkedJob(value.runningC); const mismatchedD = parseLinkedJob(value.mismatchedD); const prepared = parseLinkedPrepared(value.prepared);
  let advanced = false;
  class PartialArtifactClient extends LinkedModelClient {
    override async list(): Promise<LinkedJob[]> { return [readyA, readyB, { ...runningC, kind: 'running', progress: advanced ? 'geometry' : 'index' }, mismatchedD]; }
    override async prepared(_projectId: string, id: string): Promise<LinkedPrepared> {
      if (id === readyB.id) throw new Error('Ready B artifact read failed.');
      return prepared;
    }
  }
  const panel = new LinkedModelPanel({ host, client: new PartialArtifactClient(),
    changed: links => { host.dataset.displayed = links.map(link => link.id).join(','); },
    selected: selection => { host.dataset.selected = selection?.source.globalId ?? ''; },
    reference: selection => { context.textContent = linkedReferenceText(selection); } });
  panel.setProject(readyA.projectId);
  const advance = document.createElement('button'); advance.textContent = 'Advance running C';
  advance.addEventListener('click', () => { advanced = true; void panel.refresh(); }); document.body.append(advance);
} else {
const repository = await RoomRepository.create('Native preservation fixture');
const native = repository.captureBaseline({ id: 'as-is', name: 'As-is', from: repository.freezeDesignTarget({ kind: 'main' }) });
const original = native.serialize();
const engine = new Engine(canvas, true); const model = new ModelScene(engine); model.setMode('basic'); model.setModel(native.view(native.head('main')).snapshot);
const layer = new LinkedModelLayer(model.scene);
const panel = new LinkedModelPanel({ host, client: new LinkedModelClient(), changed: links => {
  layer.setLinks(links); canvas.dataset.linkMeshes = String(model.scene.meshes.filter(mesh => mesh.name.startsWith('ifc:') && mesh.isEnabled()).length);
  canvas.dataset.nativePreserved = String(native.serialize() === original);
}, selected: selection => layer.select(selection), reference: selection => { context.textContent = linkedReferenceText(selection); } });
panel.setProject(document.body.dataset.project ?? null);
model.camera.target = new Vector3(6, 1.5, 12); model.camera.radius = 45; model.camera.attachControl(canvas, false);
canvas.addEventListener('click', event => { const rect = canvas.getBoundingClientRect(); const selection = layer.objectAt(event.clientX - rect.left, event.clientY - rect.top); if (selection) { canvas.dataset.pickedSource = JSON.stringify(selection); panel.select(selection); } });
engine.runRenderLoop(() => {
  model.scene.render(); canvas.dataset.sceneReady = String(model.scene.isReady());
  const points = model.scene.meshes.filter(mesh => mesh.name.startsWith('ifc:') && mesh.isEnabled()).map(mesh => {
    const positions = mesh.getVerticesData('position') ?? []; const indices = mesh.getIndices() ?? [];
    const vertices = Array.from(indices).slice(0, 3).map(i => new Vector3(positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0));
    const center = vertices.reduce((sum, point) => sum.add(point), Vector3.Zero()).scale(1 / 3);
    const screen = Vector3.Project(center, Matrix.Identity(), model.scene.getTransformMatrix(), model.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    return { x: screen.x, y: screen.y, globalId: layer.pick(mesh)?.source.globalId };
  }); canvas.dataset.pickPoints = JSON.stringify(points);
});
}
