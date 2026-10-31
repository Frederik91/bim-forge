import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { SpatialTaskLayer } from './spatial-task-layer.ts';
import type { TaskAgentDescriptor, TaskAgentIdentity } from './spatial-task-layer.ts';
import { spatialTokens, spatialTokenCss } from './ui/design-tokens.ts';

// Isolated visual/interaction fixture. No production task store, model edits or worker calls.
const style = document.createElement('style');
style.textContent = spatialTokenCss() + `
*{box-sizing:border-box} body{margin:0;background:var(--spatial-color-canvas);color:var(--spatial-color-ink);font:var(--spatial-type-body)/var(--spatial-type-line-height) var(--spatial-font-ui)}
::selection{background:var(--spatial-color-selection-fill)} button{font:inherit;color:inherit;background:var(--spatial-color-paper);border:1px solid var(--spatial-color-border);border-radius:var(--spatial-radius-control);min-height:var(--spatial-control-target);padding:8px 12px;cursor:pointer;text-align:left}button:hover{background:var(--spatial-color-hover)}button:focus-visible{outline:var(--spatial-control-focus-width) solid var(--spatial-color-focus);outline-offset:var(--spatial-control-focus-offset)}
header{padding:16px 24px;background:var(--spatial-color-paper)}h1{font-size:var(--spatial-type-heading);margin:0 0 4px}p{margin:0}main{display:grid;grid-template-columns:minmax(0,1fr) 358px;min-height:740px}#stage{position:relative;min-width:0}canvas{display:block;width:100%;height:740px;touch-action:none}aside{padding:24px;background:var(--spatial-color-paper);overflow:auto}h2{font-size:var(--spatial-type-heading);margin:0 0 12px}#tasks{display:grid;gap:8px;margin-bottom:24px}#tasks button span{display:block;font-variant-numeric:tabular-nums}#tasks button[aria-pressed=true]{border-color:var(--spatial-color-selection);background:var(--spatial-color-selection-fill)}#anchors{position:absolute;inset:0;pointer-events:none}.anchor{position:absolute;transform:translate(-50%,-100%);background:var(--spatial-color-paper);border:1px solid var(--spatial-color-border);border-radius:6px;padding:4px 8px;white-space:nowrap;font-size:13px}#chooser{display:grid;gap:8px;margin:16px 0}#conversation{padding-top:16px;border-top:1px solid var(--spatial-color-border)}#conversation p{margin-top:8px}#controls{margin-top:24px;display:grid;gap:8px}footer{padding:12px 24px;color:var(--spatial-color-muted)}@media(max-width:700px){header{padding:16px}main{display:block;min-height:0}canvas{height:430px}aside{padding:16px}footer{padding:12px 16px}}
`;
document.head.append(style);
document.body.innerHTML = `<header><h1>Task agents</h1><p>Conversations stay where they started. Select an agent or its task below.</p></header><main><div id="stage"><canvas aria-label="3D room with hovering task agents"></canvas><div id="anchors"></div></div><aside><h2>Conversations</h2><div id="tasks"></div><div id="chooser" aria-label="Tasks at this place"></div><section id="conversation" aria-live="polite"><h2>No conversation selected</h2><p>Same-place agents offer a choice of tasks.</p></section><div id="controls"><button id="working">Report T-01 working</button><button id="ready">Report T-01 ready</button><button id="occlude">Toggle wall occlusion</button><button id="dispose">Dispose task layer</button></div></aside></main><footer>Isolated graphics fixture · reported state samples · no AI calls or model changes</footer>`;
const canvas = document.querySelector('canvas');
function element(id: string): HTMLElement { const value = document.getElementById(id); if (!value) throw new Error('Gallery surface missing'); return value; }
const tasks = element('tasks'); const chooser = element('chooser');
const conversation = element('conversation'); const anchors = element('anchors');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Gallery canvas missing');
const engine = new Engine(canvas, true); const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString(spatialTokens.color.canvas + 'ff');
const camera = new FreeCamera('gallery-camera', new Vector3(0, 1.6, 2.6), scene);
camera.setTarget(new Vector3(-.2, 1.3, -1.5)); camera.minZ = .01;
new HemisphericLight('gallery-light', new Vector3(.3, 1, .4), scene);
function material(name: string, color: string): StandardMaterial {
  const value = new StandardMaterial(name, scene); value.diffuseColor = Color3.FromHexString(color); value.specularColor = Color3.Black(); return value;
}
const wallMat = material('wall', spatialTokens.color.wall); const doorMat = material('door', spatialTokens.color.furniture);
const selectedMat = material('target-selection', spatialTokens.color.selection);
const floor = MeshBuilder.CreateBox('floor', { width: 8, height: .08, depth: 8 }, scene); floor.position.y = -.04; floor.material = material('floor', spatialTokens.color.floor);
const wall = MeshBuilder.CreateBox('wall', { width: 6, height: 2.7, depth: .15 }, scene); wall.position.set(0, 1.35, -2); wall.material = wallMat;
const door = MeshBuilder.CreateBox('door-D01', { width: .9, height: 2.1, depth: .08 }, scene); door.position.set(0, 1.05, -1.88); door.material = doorMat;
const occluder = MeshBuilder.CreateBox('occlusion-wall', { width: 4, height: 3, depth: .1 }, scene); occluder.position.set(0, 1.5, 1.7); occluder.material = wallMat; occluder.setEnabled(false);
const construction = new Set<AbstractMesh>([floor, wall, door, occluder]);
const layer = new SpatialTaskLayer({ scene, tokens: spatialTokens.color, isConstructionMesh: mesh => construction.has(mesh), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
let descriptors: TaskAgentDescriptor[] = [
  { identity: { kind: 'task', projectId: 'sample', ticketId: 'T-01' }, title: 'Widen entry door', state: 'queued', placement: { kind: 'placed', origin: [-.55, .5, 1.05] }, selected: false, visible: true },
  { identity: { kind: 'task', projectId: 'sample', ticketId: 'T-02' }, title: 'Check door clearance', state: 'needs-input', placement: { kind: 'placed', origin: [-.55, .5, 1.05] }, selected: false, visible: true },
  { identity: { kind: 'draft', projectId: 'sample', draftId: 'Draft-03' }, title: 'Unsent wall question', state: 'unsent', placement: { kind: 'placed', origin: [.65, -.2, 1.05] }, selected: false, visible: true },
  { identity: { kind: 'task', projectId: 'sample', ticketId: 'T-04' }, title: 'Legacy conversation', state: 'failed', placement: { kind: 'unplaced' }, selected: false, visible: true },
];
const id = (identity: TaskAgentIdentity) => identity.kind === 'task' ? identity.ticketId : identity.draftId;
function open(identity: TaskAgentIdentity): void {
  const entry = descriptors.find(value => id(value.identity) === id(identity)); if (!entry) return;
  descriptors = descriptors.map(value => ({ ...value, selected: id(value.identity) === id(identity) }));
  door.material = ['T-01', 'T-02'].includes(id(identity)) ? selectedMat : doorMat;
  conversation.replaceChildren(); const heading = document.createElement('h2'); heading.textContent = id(identity) + ' · ' + entry.title;
  const text = document.createElement('p'); text.textContent = identity.kind === 'draft' ? 'Unsent draft. No worker has started.' : 'Conversation selected. Only its associated entry door is highlighted. The camera stays in place.';
  conversation.append(heading, text); chooser.replaceChildren(); sync();
}
function sync(): void {
  layer.replace('sample', descriptors); tasks.replaceChildren();
  for (const entry of layer.listEntries()) {
    const button = document.createElement('button'); button.setAttribute('aria-pressed', String(entry.selected));
    const title = document.createElement('span'); title.textContent = id(entry.identity) + ' · ' + entry.title;
    const state = document.createElement('span'); state.textContent = entry.stateLabel + (entry.selected ? ' · Selected' : '') + (entry.placement === 'unplaced' ? ' · Unplaced' : '');
    button.append(title, state); button.onclick = () => open(entry.identity); tasks.append(button);
  }
}
sync();
canvas.addEventListener('click', event => {
  const bounds = canvas.getBoundingClientRect();
  const ray = scene.createPickingRay((event.clientX - bounds.left) * engine.getRenderWidth() / bounds.width,
    (event.clientY - bounds.top) * engine.getRenderHeight() / bounds.height, null, camera);
  const hit = layer.pick(ray, 'idle');
  if (hit.kind === 'task') open(hit.identity);
  if (hit.kind === 'chooser') {
    chooser.replaceChildren(); const label = document.createElement('p'); label.textContent = 'Choose a conversation at this place'; chooser.append(label);
    for (const identity of hit.candidates) { const button = document.createElement('button'); button.textContent = id(identity); button.onclick = () => open(identity); chooser.append(button); }
  }
});
for (const [control, state] of [['working', 'working'], ['ready', 'ready']] satisfies [string, 'working' | 'ready'][]) {
  document.getElementById(control)?.addEventListener('click', () => {
    descriptors = descriptors.map(value => value.identity.kind === 'task' && value.identity.ticketId === 'T-01' ? { ...value, identity: value.identity, state } : value); sync();
  });
}
document.getElementById('occlude')?.addEventListener('click', () => occluder.setEnabled(!occluder.isEnabled()));
let disposed = false;
document.getElementById('dispose')?.addEventListener('click', () => { layer.dispose(); disposed = true; anchors.replaceChildren(); tasks.replaceChildren(); });
const resize = () => engine.resize(); window.addEventListener('resize', resize);
engine.runRenderLoop(() => {
  layer.renderFrame(performance.now()); scene.render();
  if (disposed) return;
  anchors.replaceChildren(); const seen = new Set<string>();
  for (const anchor of layer.anchors(camera, canvas.clientWidth, canvas.clientHeight)) {
    if (anchor.kind !== 'visible') continue;
    const key = anchor.candidates.map(id).join(','); if (seen.has(key)) continue; seen.add(key);
    const label = document.createElement('span'); label.className = 'anchor';
    label.textContent = anchor.candidates.length > 1 ? `${anchor.candidates.length} conversations · T-01 / T-02` : id(anchor.identity);
    label.style.left = anchor.x + 'px'; label.style.top = anchor.y - 8 + 'px';
    label.dataset.task = id(anchor.identity); anchors.append(label);
  }
  document.body.dataset.ready = 'true';
});
window.addEventListener('pagehide', () => { window.removeEventListener('resize', resize); engine.stopRenderLoop(); layer.dispose(); scene.dispose(); engine.dispose(); }, { once: true });
