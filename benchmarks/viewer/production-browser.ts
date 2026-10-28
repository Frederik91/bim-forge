import { Engine } from '@babylonjs/core/Engines/engine.js';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { ModelScene, modelPoint } from '../../demo/model-scene.ts';
import type { RenderingMode } from '../../demo/model-scene.ts';
import { productionViewerFixture } from '../../demo/production-viewer-fixture.ts';
import { ModelViewer } from '../../demo/model-viewer.ts';
import type { ViewerState } from '../../demo/model-viewer.ts';

type Configuration = 'individual' | 'retained';
type Stage = 'baseline' | 'preview' | 'comparison' | 'discard';
interface Sample { operation: string; cpuMs: number; readyFrameMs: number; drawCalls: number; triangles: number; resources: ReturnType<ModelScene['renderResources']> }
declare global {
  interface Window {
    productionViewer: {
      start(configuration: Configuration): Promise<unknown>;
      mode(mode: RenderingMode): Promise<unknown>;
      focus(): Promise<void>;
      stage(stage: Stage): Promise<unknown>;
      cycles(count: number): Promise<unknown>;
      counts(): unknown;
      dispose(): Promise<void>;
      uiStart(): Promise<void>;
      uiSwitch(): Promise<void>;
      uiStatus(): { references: number; marking: boolean };
    };
  }
}
const element = document.querySelector('canvas'); if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
const canvas = element;
let current: {
  viewer: ModelScene; engine: Engine; instrumentation: SceneInstrumentation; configuration: Configuration;
  fixture: Awaited<ReturnType<typeof productionViewerFixture>>; original: string; samples: Sample[];
} | null = null;
let ui: { viewer: ModelViewer; host: HTMLElement; state: ViewerState; references: number } | null = null;
function loaded() { if (!current) throw new Error('No production scene'); return current; }
async function frame(): Promise<void> {
  const { viewer } = loaded();
  // Match ModelViewer's three scheduled frames after a state change, including
  // shadow/projection readiness; a single submitted frame can capture stale light state.
  for (let index=0;index<3;index++) {
    await viewer.scene.whenReadyAsync(); viewer.scene.render();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}
async function measure(operation: string, work: () => void): Promise<void> {
  const state = loaded(); const start = performance.now(); work(); const cpuMs = performance.now() - start;
  const ready = performance.now(); await frame();
  state.samples.push({ operation, cpuMs, readyFrameMs: performance.now() - ready,
    drawCalls: state.instrumentation.drawCallsCounter.current, triangles: state.viewer.scene.getActiveIndices() / 3, resources: state.viewer.renderResources() });
}
function counts() {
  const { viewer } = loaded(); const sun = viewer.scene.lights.find(light => light instanceof DirectionalLight);
  return { meshes: viewer.scene.meshes.length, geometries: viewer.scene.geometries.length, materials: viewer.scene.materials.length,
    textures: viewer.scene.textures.length, parts: viewer.renderResources().parts, cachedVertices: viewer.renderResources().cachedVertices,
    batches: viewer.renderResources().batches,
    shadowCasters: sun instanceof DirectionalLight ? sun.getShadowGenerator()?.getShadowMap()?.renderList?.length ?? 0 : 0 };
}
function sourceRows() {
  return loaded().viewer.scene.meshes.filter(mesh => !mesh.name.startsWith('bim-batch-') && !mesh.name.startsWith('change-path:')).map(mesh => {
    mesh.computeWorldMatrix(true); const box = mesh.getBoundingInfo().boundingBox;
    return { name: mesh.name, min: box.minimumWorld.asArray(), max: box.maximumWorld.asArray(), enabled: mesh.isEnabled(), material: mesh.material?.name ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
async function stage(stage: Stage): Promise<unknown> {
  const state = loaded(); const { viewer, fixture, configuration } = state;
  const snapshot = stage === 'baseline' || stage === 'discard' ? fixture.accepted : fixture.proposed;
  await measure(stage, () => viewer.setModel(snapshot, stage === 'comparison' ? fixture.accepted : null,
    configuration === 'retained' ? fixture.projectId : null));
  if (JSON.stringify(fixture.accepted) !== state.original) throw new Error('Accepted production fixture mutated');
  return { sample: state.samples.at(-1), sourceRows: sourceRows(), counts: counts() };
}
async function dispose(): Promise<void> {
  if (ui) { ui.viewer.dispose(); ui.host.remove(); ui = null; canvas.style.display = 'block'; }
  if (!current) return;
  current.instrumentation.dispose(); current.viewer.dispose(); current.engine.dispose(); current = null;
}
window.productionViewer = {
  async start(configuration) {
    await dispose(); const fixture = await productionViewerFixture();
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }); engine.setHardwareScalingLevel(1);
    const viewer = new ModelScene(engine, configuration === 'individual' ? 'off' : 'auto');
    const instrumentation = new SceneInstrumentation(viewer.scene);
    current = { viewer, fixture, engine, instrumentation, configuration, original: JSON.stringify(fixture.accepted), samples: [] };
    await stage('baseline'); viewer.setCutaway(false); viewer.setLevel(null); viewer.setRoofVisible(true); viewer.frame(); await frame();
    const gl = canvas.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl ? gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : 'unavailable';
    return { qualified: false, source: 'validated production ModelSnapshot fixture', entities: fixture.accepted.entities.length,
      projectId: fixture.projectId, inputSha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([fixture.accepted,fixture.proposed]))))).map(byte => byte.toString(16).padStart(2,'0')).join(''),
      renderer: typeof renderer === 'string' ? renderer : 'unavailable', viewport: [canvas.width,canvas.height], devicePixelRatio,
      initial: { drawCalls: instrumentation.drawCallsCounter.current, triangles: viewer.scene.getActiveIndices()/3, counts: counts(), sourceRows: sourceRows() } };
  },
  async mode(mode) {
    const { viewer, instrumentation } = loaded();
    viewer.setMode(mode); viewer.setCutaway(false); viewer.setRoofVisible(true); viewer.setLevel(null); viewer.frame(); await frame();
    const overview = { drawCalls: instrumentation.drawCallsCounter.current, triangles: viewer.scene.getActiveIndices()/3, sourceRows: sourceRows(), counts: counts() };
    return overview;
  },
  async focus() {
    const { viewer } = loaded(); viewer.setLevel('ground'); viewer.setRoofVisible(false); viewer.setCutaway(true);
    viewer.camera.setPosition(new Vector3(3.6,.9,1.35)); viewer.camera.setTarget(modelPoint(3.34,.3,.32)); await frame();
  },
  stage,
  async cycles(count) {
    for (let index=0;index<count;index++) { await stage('preview'); await stage('comparison'); await stage('discard'); }
    return { counts: counts(), samples: loaded().samples };
  },
  counts,
  dispose,
  async uiStart() {
    await dispose(); canvas.style.display = 'none';
    const fixture = await productionViewerFixture(); const host = document.createElement('div'); document.body.append(host);
    const viewer = new ModelViewer({ select() {}, inspect() {}, keyboardReference() {}, reference() { if (ui) ui.references++; } });
    viewer.root.style.width = '800px'; viewer.root.style.height = '600px';
    const state: ViewerState = { projectId: fixture.projectId, snapshot: fixture.accepted, comparison: null,
      selectedId: 'ground-desk', focusId: null, mode: 'basic', cutaway: true, interactive: true,
      reference: null, levelId: 'ground', roofVisible: false };
    ui = { viewer, host, state, references: 0 }; viewer.show(host, state);
  },
  async uiSwitch() {
    if (!ui) throw new Error('Missing UI fixture');
    const other = await productionViewerFixture(); ui.state = { ...ui.state, projectId: other.projectId };
    ui.viewer.show(ui.host, ui.state);
  },
  uiStatus() { if (!ui) throw new Error('Missing UI fixture'); return { references: ui.references, marking: ui.viewer.root.dataset.marking === 'true' }; },
};
