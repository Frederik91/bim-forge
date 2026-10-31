import { Engine, Scene, ArcRotateCamera, FreeCamera, Camera, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, MeshBuilder, StandardMaterial, Matrix, Plane, Axis } from '@babylonjs/core';
import type { Mesh, AbstractMesh } from '@babylonjs/core';

type PlaceKey = 'door' | 'wall';
type View = 'inside' | 'plan' | 'section' | 'overview';
type Locomotion = 'walk' | 'fly';
type Recipient = 'agent' | 'person';
type Audience = 'personal' | 'discipline' | 'company';
type Message = { who: string; text: string; own: boolean };
type Place = { name: string; owner: string; meshes: Mesh[]; anchor: Vector3; messages: Message[]; draft: string; recipient: Recipient; audience: Audience; state: 'idle' | 'working' | 'ready' };

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${id}`);
  return node;
}
function select(id: string): HTMLSelectElement {
  const node = element(id);
  if (!(node instanceof HTMLSelectElement)) throw new Error(`Expected select: ${id}`);
  return node;
}
function textarea(id: string): HTMLTextAreaElement { const node = element(id); if (!(node instanceof HTMLTextAreaElement)) throw new Error(`Expected textarea: ${id}`); return node; }
function form(id: string): HTMLFormElement { const node = element(id); if (!(node instanceof HTMLFormElement)) throw new Error(`Expected form: ${id}`); return node; }
function modelCanvas(): HTMLCanvasElement { const node = element('model'); if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected model canvas'); return node; }
function connector(): SVGPathElement { const node = document.getElementById('connection'); if (!(node instanceof SVGPathElement)) throw new Error('Expected anchor connector'); return node; }
function placeKey(value: string | undefined): PlaceKey | null { return value === 'door' || value === 'wall' ? value : null; }
function recipient(value: string): Recipient { if (value === 'agent' || value === 'person') return value; throw new Error('Unknown recipient'); }
function audience(value: string): Audience { if (value === 'personal' || value === 'discipline' || value === 'company') return value; throw new Error('Unknown local audience'); }

function start(): void {
  const canvas = modelCanvas();
  const intent = textarea('intent');
  const compose = form('compose');
  const connection = connector();
  const recipientControl = select('recipient');
  const audienceControl = select('audience');
  const bubble = element('conversation');
  const stateLabel = element('area-state');
  const offscreen = element('offscreen-state');
  const returnTask = element('return-task');
  canvas.tabIndex = 0;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.90, .93, .94, 1);
  const inside = new FreeCamera('inside', new Vector3(0, 1.6, 1.15), scene);
  inside.minZ = .04;
  inside.fov = 1.12;
  inside.setTarget(new Vector3(0, 1.2, -2));
  inside.inputs.clear();
  const orbit = new ArcRotateCamera('overview', -Math.PI / 2.2, 1.03, 10.8, new Vector3(0, 1, 0), scene);
  orbit.minZ = .05;
  orbit.lowerRadiusLimit = 4;
  orbit.upperRadiusLimit = 20;
  orbit.lowerBetaLimit = .2;
  orbit.upperBetaLimit = 1.5;
  orbit.wheelPrecision = 40;
  orbit.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  const plan = new FreeCamera('plan', new Vector3(0, 12, 0), scene);
  plan.setTarget(Vector3.Zero());
  plan.mode = Camera.ORTHOGRAPHIC_CAMERA;
  plan.inputs.clear();
  const section = new FreeCamera('section', new Vector3(0, 1.4, 10), scene);
  section.setTarget(new Vector3(0, 1.4, 0));
  section.mode = Camera.ORTHOGRAPHIC_CAMERA;
  section.inputs.clear();
  let view: View = 'inside';
  let locomotion: Locomotion = 'walk';
  let savedInside = { position: inside.position.clone(), rotation: inside.rotation.clone() };
  let active: PlaceKey | null = null;
  let previewAvailable = false;
  let showingPreview = false;
  const keys = new Set<string>();
  let gesture: { x: number; y: number; lastX: number; lastY: number; dragged: boolean; id: number } | null = null;
  const picking = new Map<AbstractMesh, PlaceKey>();
  const originals = new Map<Mesh, StandardMaterial>();
  const sky = new HemisphericLight('sky', new Vector3(.3, 1, -.5), scene);
  sky.intensity = .85;
  sky.groundColor = new Color3(.5, .53, .56);
  new DirectionalLight('sun', new Vector3(-1, -2, 1), scene).intensity = .5;
  new DirectionalLight('interior daylight', new Vector3(.15, -.25, -1), scene).intensity = .55;
  function material(name: string, color: string): StandardMaterial {
    const value = new StandardMaterial(name, scene);
    value.diffuseColor = Color3.FromHexString(color);
    value.specularColor = new Color3(.08, .08, .08);
    return value;
  }
  const wallMat = material('mineral wall', '#d4d9d7');
  const floorMat = material('timber floor', '#c2b39b');
  const doorMat = material('existing door', '#577b9e');
  const selectedMat = material('selected object', '#325cc2');
  const previewMat = material('illustrative width', '#cf8b2b');
  const whiteMat = material('furniture', '#e5e8e6');
  const frameMat = material('door frame', '#344f67');
  previewMat.alpha = .45;
  function box(name: string, size: Vector3, position: Vector3, mat: StandardMaterial, key?: PlaceKey): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene);
    mesh.position.copyFrom(position);
    mesh.material = mat;
    if (key) { mesh.metadata = { key }; picking.set(mesh, key); originals.set(mesh, mat); }
    return mesh;
  }
  box('floor', new Vector3(6.2, .16, 4.2), new Vector3(0, -.08, 0), floorMat);
  box('north wall', new Vector3(6.2, 2.5, .16), new Vector3(0, 1.25, 2), wallMat);
  box('west wall', new Vector3(.16, 2.5, 4), new Vector3(-3, 1.25, 0), wallMat);
  box('east wall', new Vector3(.16, 2.5, 4), new Vector3(3, 1.25, 0), wallMat);
  const wall = box('adjoining entrance wall left', new Vector3(2.55, 2.5, .16), new Vector3(-1.725, 1.25, -2), wallMat, 'wall');
  const wallRight = box('adjoining entrance wall right', new Vector3(2.55, 2.5, .16), new Vector3(1.725, 1.25, -2), wallMat, 'wall');
  box('above entrance opening', new Vector3(.9, .5, .16), new Vector3(0, 2.25, -2), wallMat, 'wall');
  box('partition', new Vector3(.12, 1.4, 1.5), new Vector3(.75, .7, 1.2), wallMat);
  box('bench', new Vector3(1.5, .45, .7), new Vector3(-1.75, .225, 1.35), whiteMat);
  box('table', new Vector3(1.1, .65, .8), new Vector3(1.8, .325, .8), whiteMat);
  const door = box('Entry door D-01', new Vector3(.9, 1.95, .07), new Vector3(0, .975, -2), doorMat, 'door');
  const preview = box('illustrative width 1100 mm', new Vector3(1.1, 1.95, .10), new Vector3(0, .975, -1.92), previewMat);
  preview.isPickable = false;
  preview.setEnabled(false);
  box('frame left', new Vector3(.05, 2, .14), new Vector3(-.475, 1, -2), frameMat, 'door');
  box('frame right', new Vector3(.05, 2, .14), new Vector3(.475, 1, -2), frameMat, 'door');
  box('lintel', new Vector3(1, .06, .14), new Vector3(0, 2, -2), frameMat, 'door');
  const planMat = material('synthetic cut footprint', '#405665');
  const planOnly: AbstractMesh[] = [];
  function planCap(name: string, width: number, depth: number, x: number, z: number, mat: StandardMaterial, key?: PlaceKey): Mesh {
    const cap = box(name, new Vector3(width, .018, depth), new Vector3(x, 1.185, z), mat, key);
    cap.setEnabled(false);
    planOnly.push(cap);
    return cap;
  }
  planCap('plan north wall', 6.2, .16, 0, 2, planMat);
  planCap('plan west wall', .16, 4, -3, 0, planMat);
  planCap('plan east wall', .16, 4, 3, 0, planMat);
  planCap('plan entrance wall left', 2.55, .16, -1.725, -2, planMat, 'wall');
  planCap('plan entrance wall right', 2.55, .16, 1.725, -2, planMat, 'wall');
  planCap('plan partition', .12, 1.5, .75, 1.2, planMat);
  planCap('plan existing door leaf', .9, .07, 0, -1.95, doorMat, 'door');
  const planPreview = planCap('plan illustrative 1100 mm opening', 1.1, .12, 0, -1.82, previewMat);
  const swingPoints = Array.from({length:25}, (_,index) => {
    const angle = index / 24 * Math.PI / 2;
    return new Vector3(-.45 + .9 * Math.cos(angle), 1.198, -2 + .9 * Math.sin(angle));
  });
  const swing = MeshBuilder.CreateLines('plan existing door swing', {points:swingPoints}, scene);
  swing.color = Color3.FromHexString('#405665');
  swing.isPickable = false;
  swing.setEnabled(false);
  planOnly.push(swing);
  function syncPreview(): void {
    preview.setEnabled(showingPreview && view !== 'plan');
    planPreview.setEnabled(showingPreview && view === 'plan');
  }
  const places: Record<PlaceKey, Place> = {
    door: { name: 'Entry door · D-01', owner: 'You', meshes: [door], anchor: new Vector3(0, 1.35, -1.88), messages: [
      { who: 'You', text: 'Could this opening be wider?', own: true },
      { who: 'Agent · simulated', text: 'This task stays at the door. Use Show width demonstration to inspect a centered 900 → 1100 mm example. Free text receives a canned reply only.', own: false }
    ], draft: '', recipient: 'agent', audience: 'personal', state: 'idle' },
    wall: { name: 'Adjoining entrance wall', owner: 'Mira', meshes: [wall, wallRight], anchor: new Vector3(-1.4, 1.4, -1.88), messages: [
      { who: 'Mira · simulated colleague', text: 'I am studying the adjoining entrance wall. Its opening is shared with the entry door task.', own: false },
      { who: 'Coordination example · simulated', text: 'Door width and this wall share the entrance opening. Review the two tasks together before a real model change. No agent coordination or permission check has run.', own: false }
    ], draft: '', recipient: 'person', audience: 'discipline', state: 'idle' }
  };
  const placeKeys: PlaceKey[] = ['door', 'wall'];
  function currentCamera(): Camera { return view === 'inside' ? inside : view === 'plan' ? plan : view === 'section' ? section : orbit; }
  function updateOrtho(): void {
    const aspect = engine.getRenderWidth() / engine.getRenderHeight();
    const halfWidth = Math.max(3.7, 2.6 * aspect);
    for (const camera of [plan, section]) {
      camera.orthoLeft = -halfWidth; camera.orthoRight = halfWidth;
      camera.orthoTop = halfWidth / aspect; camera.orthoBottom = -halfWidth / aspect;
    }
  }
  function saveDraft(): void { if (active) places[active].draft = intent.value; }
  function renderMessages(): void {
    if (!active) return;
    const host = element('messages'); host.replaceChildren();
    for (const message of places[active].messages) {
      const paragraph = document.createElement('p');
      if (message.own) paragraph.className = 'you';
      const who = document.createElement('span'); who.className = 'who'; who.textContent = message.who;
      paragraph.append(who, document.createTextNode(message.text)); host.append(paragraph);
    }
    host.scrollTop = host.scrollHeight;
  }
  function renderList(): void {
    const host = element('threads'); host.replaceChildren(); element('count').textContent = String(placeKeys.length);
    for (const key of placeKeys) {
      const place = places[key];
      const button = document.createElement('button'); button.type = 'button';
      button.setAttribute('aria-current', String(active === key));
      const title = document.createElement('strong'); title.textContent = place.name;
      const detail = document.createElement('span'); detail.textContent = `${place.owner} · ${place.state === 'working' ? 'Reply pending · simulated' : `${place.messages.length} messages`} · Return Inside`;
      button.append(title, detail); button.onclick = () => { frameTask(key); openPlace(key, true); closeList(); }; host.append(button);
    }
  }
  function renderState(): void {
    for (const [mesh, mat] of originals) mesh.material = active && picking.get(mesh) === active ? selectedMat : mat;
    for (const key of placeKeys) {
      const marker = element(`marker-${key}`); marker.classList.toggle('working', places[key].state === 'working'); marker.classList.toggle('active', active === key);
      marker.setAttribute('aria-pressed', String(active === key));
      marker.setAttribute('aria-label', `${places[key].name} · ${places[key].owner} · ${places[key].state === 'working' ? 'Simulated reply pending' : 'Open task'}`);
    }
    document.querySelectorAll<HTMLElement>('[data-pick]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pick === active)));
    element('proposal').hidden = !(active === 'door' && previewAvailable);
    element('width-demo').hidden = active !== 'door';
    if (active) {
      const place = places[active];
      const scope = active === 'door' ? `Your task · ${place.audience} · local label only` : 'Mira’s task · discipline audience example · simulated';
      const activity = place.state === 'working' ? 'Reply pending · simulated' : place.state === 'ready' ? 'Reply ready · simulated' : 'Conversation at this place';
      stateLabel.textContent = `${activity}. ${scope}. ${place.recipient === 'person' ? 'Human text remains local; nothing is sent.' : 'Agent replies are canned, not AI output.'}`;
      stateLabel.classList.toggle('working', place.state === 'working');
      const send = compose.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (send) { send.disabled = place.state === 'working'; send.textContent = place.state === 'working' ? 'Reply pending…' : place.recipient === 'person' ? 'Preview local message' : 'Preview simulated reply'; }
      recipientControl.value = place.recipient; audienceControl.value = place.audience;
      audienceControl.disabled = active === 'wall';
    }
    renderList(); positionUI();
  }
  function openPlace(key: PlaceKey, focusIntent = false): void {
    saveDraft(); active = key; const place = places[key];
    element('thread-title').textContent = place.name;
    intent.value = place.draft; intent.placeholder = key === 'door' ? 'Describe an idea for this opening…' : 'Write about the adjoining entrance wall…';
    renderMessages(); renderState();
    if (focusIntent && !bubble.hidden) intent.focus({ preventScroll: true });
  }
  function closePlace(): void {
    const previous = active; saveDraft(); active = null; bubble.hidden = true;
    offscreen.hidden = true; returnTask.hidden = true; connection.setAttribute('d', ''); renderState();
    if (previous && !element(`marker-${previous}`).hidden) element(`marker-${previous}`).focus({ preventScroll: true });
    else canvas.focus({ preventScroll: true });
  }
  function closeList(): void { element('thread-list').hidden = true; element('list-toggle').setAttribute('aria-expanded', 'false'); }
  function stopNavigation(): void {
    keys.clear();
    if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
    gesture = null;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  function navigationUI(): void {
    const locked = document.pointerLockElement === canvas;
    element('flight-toggle').setAttribute('aria-pressed', String(locomotion === 'fly'));
    element('flight-toggle').textContent = locomotion === 'fly' ? 'Fly on' : 'Fly';
    element('flight-toggle').title = locomotion === 'fly' ? 'Switch to grounded walking' : 'Free roam with flight';
    element('mouse-look').setAttribute('aria-pressed', String(locked));
    element('mouse-look').textContent = locked ? 'Mouse look · Esc' : 'Mouse look';
    element('aim').hidden = !locked;
    for (const id of ['flight-toggle', 'mouse-look']) {
      if (view === 'inside') element(id).removeAttribute('disabled');
      else element(id).setAttribute('disabled', '');
    }
    if (view === 'inside') element('view-hint').textContent = locked
      ? 'Mouse to look · WASD to move · Esc releases the cursor'
      : locomotion === 'fly'
        ? 'Fly · WASD follows your gaze · Space up · Ctrl down · Shift faster'
        : 'Walk · WASD / arrows · drag to look, or enable Mouse look';
  }
  function setLocomotion(next: Locomotion): void {
    stopNavigation();
    locomotion = next;
    if (next === 'walk') {
      inside.position.x = Math.max(-2.7, Math.min(2.7, inside.position.x));
      inside.position.z = Math.max(-1.65, Math.min(1.65, inside.position.z));
      inside.position.y = 1.6;
    }
    navigationUI();
    canvas.focus({preventScroll:true});
  }
  function switchView(next: View): void {
    if (view === 'inside' && next !== 'inside') savedInside = { position: inside.position.clone(), rotation: inside.rotation.clone() };
    if (next === 'inside' && view !== 'inside') { inside.position.copyFrom(savedInside.position); inside.rotation.copyFrom(savedInside.rotation); }
    stopNavigation(); orbit.detachControl(); view = next; scene.activeCamera = currentCamera();
    scene.clipPlane = next === 'plan' ? new Plane(0, 1, 0, -1.2) : next === 'section' ? new Plane(0, 0, 1, 0) : null;
    for (const mesh of planOnly) mesh.setEnabled(next === 'plan');
    syncPreview();
    if (next === 'overview') orbit.attachControl(canvas, true);
    updateOrtho();
    const views: View[] = ['inside', 'plan', 'section', 'overview'];
    for (const key of views) { element(`view-${key}`).setAttribute('aria-pressed', String(key === next)); }
    element('view-hint').textContent = next === 'inside' ? 'Focus model · WASD / arrows to walk · Q/E to turn · drag to look' : next === 'overview' ? 'Drag to orbit · scroll to zoom' : next === 'plan' ? 'Orthographic plan · horizontal cut at 1.2 m' : 'Orthographic section · rear half clipped';
    const location = document.getElementById('location-label'); if (location) location.textContent = `${next === 'inside' ? 'Inside · eye height 1.6 m' : next[0]?.toUpperCase() + next.slice(1)} · Ground floor`;
    navigationUI();
    positionUI();
  }
  function frameTask(key: PlaceKey): void {
    switchView('inside');
    setLocomotion('walk');
    inside.position.set(key === 'door' ? .65 : -.8, 1.6, .5);
    inside.setTarget(places[key].anchor);
    savedInside = { position: inside.position.clone(), rotation: inside.rotation.clone() };
    canvas.focus({ preventScroll: true });
  }
  function project(anchor: Vector3): { x: number; y: number } | null {
    const camera = currentCamera();
    const direction = anchor.subtract(camera.globalPosition);
    if (Vector3.Dot(direction, camera.getForwardRay().direction) <= 0) return null;
    const point = Vector3.Project(anchor, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
    if (point.z < 0 || point.z > 1 || point.x < 0 || point.x > canvas.clientWidth || point.y < 0 || point.y > canvas.clientHeight) return null;
    return { x: point.x, y: point.y };
  }
  function positionUI(): void {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    for (const key of placeKeys) {
      const point = project(places[key].anchor); const marker = element(`marker-${key}`);
      marker.hidden = point === null;
      if (point) { marker.style.left = `${point.x}px`; marker.style.top = `${point.y}px`; }
    }
    if (!active) { bubble.hidden = true; offscreen.hidden = true; returnTask.hidden = true; connection.setAttribute('d', ''); return; }
    const point = project(places[active].anchor);
    offscreen.hidden = point !== null; returnTask.hidden = point !== null; bubble.hidden = point === null;
    if (!point) { connection.setAttribute('d', ''); returnTask.textContent = `Return to ${places[active].name}`; return; }
    const bubbleWidth = bubble.offsetWidth, bubbleHeight = bubble.offsetHeight;
    const desiredX = point.x + 45 + bubbleWidth < width - 12 ? point.x + 45 : point.x - bubbleWidth - 45;
    bubble.style.left = `${Math.max(12, Math.min(width - bubbleWidth - 12, desiredX))}px`;
    bubble.style.top = `${Math.max(92, Math.min(height - bubbleHeight - 48, point.y - bubbleHeight * .42))}px`;
    const stageRect = canvas.getBoundingClientRect(), rect = bubble.getBoundingClientRect();
    const left = rect.left - stageRect.left, top = rect.top - stageRect.top;
    const edgeX = point.x < left ? left : point.x > left + rect.width ? left + rect.width : Math.max(left + 15, Math.min(left + rect.width - 15, point.x));
    const edgeY = point.y < top ? top : point.y > top + rect.height ? top + rect.height : Math.max(top + 16, Math.min(top + rect.height - 16, point.y));
    connection.setAttribute('d', `M ${point.x} ${point.y} L ${edgeX} ${edgeY}`);
  }
  for (const key of placeKeys) element(`marker-${key}`).onclick = () => openPlace(key, true);
  document.querySelectorAll<HTMLElement>('[data-pick]').forEach(button => { button.onclick = () => { const key = placeKey(button.dataset.pick); if (key) { frameTask(key); openPlace(key, true); } }; });
  const views: View[] = ['inside', 'plan', 'section', 'overview'];
  for (const key of views) element(`view-${key}`).onclick = () => switchView(key);
  returnTask.onclick = () => { if (active) { frameTask(active); positionUI(); } };
  element('frame').onclick = () => { if (active) frameTask(active); else { switchView('inside'); setLocomotion('walk'); inside.position.set(0, 1.6, 1.15); inside.setTarget(new Vector3(0, 1.2, -2)); } };
  element('flight-toggle').onclick = () => { if (view === 'inside') setLocomotion(locomotion === 'walk' ? 'fly' : 'walk'); };
  element('mouse-look').onclick = () => {
    if (view !== 'inside') return;
    if (document.pointerLockElement === canvas) { stopNavigation(); return; }
    canvas.focus({preventScroll:true});
    void canvas.requestPointerLock().catch(() => {
      element('view-hint').textContent = 'Mouse look unavailable here. Drag on the model to look instead.';
    });
  };
  document.addEventListener('pointerlockchange', () => { keys.clear(); navigationUI(); });
  document.addEventListener('mousemove', event => {
    if (document.pointerLockElement !== canvas || view !== 'inside') return;
    inside.rotation.y += event.movementX * .003;
    inside.rotation.x = Math.max(-1.35, Math.min(1.35, inside.rotation.x + event.movementY * .003));
  });
  compose.addEventListener('focusin', stopNavigation);
  element('close').onclick = closePlace;
  element('list-toggle').onclick = () => { const list = element('thread-list'); list.hidden = !list.hidden; element('list-toggle').setAttribute('aria-expanded', String(!list.hidden)); renderList(); };
  element('list-close').onclick = () => { closeList(); element('list-toggle').focus(); };
  recipientControl.onchange = () => { if (active) { places[active].recipient = recipient(recipientControl.value); renderState(); } };
  audienceControl.onchange = () => { if (active === 'door') { places.door.audience = audience(audienceControl.value); renderState(); } };
  compose.onsubmit = event => {
    event.preventDefault(); if (!active) return;
    const key = active, place = places[key], text = intent.value.trim();
    if (!text || place.state === 'working') return;
    const target = place.recipient;
    place.messages.push({ who: target === 'person' ? 'You → Mira · local only, not sent' : 'You → Agent · local demonstration', text, own: true });
    intent.value = ''; place.draft = ''; place.state = 'working'; renderMessages(); renderState();
    window.setTimeout(() => {
      place.messages.push({ who: target === 'person' ? 'Mira · canned simulation, not a delivered message' : 'Agent · canned simulation', text: target === 'person' ? 'Illustrative colleague reply: the door and entrance wall share one opening. This prototype sends no messages to anyone.' : key === 'door' ? 'Illustrative reply only: your text was not interpreted. The separate width demonstration shows 900 → 1100 mm centered on this opening; it is not validated, accepted or saved.' : 'Illustrative reply only: this task concerns the wall adjoining the entry door. Their shared opening needs coordinated review; no agents have coordinated or changed geometry.', own: false });
      place.state = 'ready'; if (active === key) renderMessages(); renderState();
    }, 1100);
  };
  element('width-demo').onclick = () => { if (active !== 'door') return; previewAvailable = true; showingPreview = true; syncPreview(); element('preview-toggle').textContent = 'Hide width preview'; renderState(); };
  element('preview-toggle').onclick = () => { showingPreview = !showingPreview; syncPreview(); element('preview-toggle').textContent = showingPreview ? 'Hide width preview' : 'Show width preview'; };
  const helpToggle = document.getElementById('help-toggle'), helpPanel = document.getElementById('help-panel'), helpClose = document.getElementById('help-close');
  if (helpToggle && helpPanel) helpToggle.onclick = () => { helpPanel.hidden = !helpPanel.hidden; helpToggle.setAttribute('aria-expanded', String(!helpPanel.hidden)); };
  if (helpClose && helpPanel) helpClose.onclick = () => { helpPanel.hidden = true; helpToggle?.setAttribute('aria-expanded', 'false'); helpToggle?.focus(); };
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0 || document.pointerLockElement === canvas) return; canvas.focus({ preventScroll: true }); gesture = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false, id: event.pointerId }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.lastX, dy = event.clientY - gesture.lastY;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) gesture.dragged = true;
    if (view === 'inside' && gesture.dragged) { inside.rotation.y += dx * .004; inside.rotation.x = Math.max(-1.35, Math.min(1.35, inside.rotation.x + dy * .004)); }
    gesture.lastX = event.clientX; gesture.lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', event => {
    if (document.pointerLockElement === canvas && event.button === 0) {
      const hit = scene.pick(canvas.clientWidth / 2, canvas.clientHeight / 2);
      stopNavigation();
      if (hit?.pickedMesh) { const key = picking.get(hit.pickedMesh); if (key) openPlace(key, true); }
      return;
    }
    const completed = gesture; gesture = null;
    if (!completed || event.pointerId !== completed.id) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (completed.dragged) return;
    const rect = canvas.getBoundingClientRect(); const hit = scene.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (hit?.pickedMesh) { const key = picking.get(hit.pickedMesh); if (key) openPlace(key); }
  });
  canvas.addEventListener('pointercancel', stopNavigation);
  canvas.addEventListener('blur', stopNavigation);
  canvas.addEventListener('keydown', event => { if (document.activeElement !== canvas || view !== 'inside') return; const key = event.key.toLowerCase(); if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'control', 'shift'].includes(key)) { event.preventDefault(); keys.add(key); } });
  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => { stopNavigation(); gesture = null; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { stopNavigation(); closePlace(); closeList(); if (helpPanel) helpPanel.hidden = true; } });
  scene.onBeforeRenderObservable.add(() => {
    if (view === 'inside') element('location-label').textContent = `${locomotion === 'fly' ? 'Fly · free roam' : 'Inside · Walk'} · height ${inside.position.y.toFixed(1)} m`;
    if (view !== 'inside' || document.activeElement !== canvas || !keys.size) return;
    const turn = Number(keys.has('e')) - Number(keys.has('q'));
    inside.rotation.y += turn * Math.min(engine.getDeltaTime(), 50) * .002;
    const forward = inside.getDirection(Axis.Z); if (locomotion === 'walk') forward.y = 0; forward.normalize();
    const right = inside.getDirection(Axis.X); right.y = 0; right.normalize();
    const movement = Vector3.Zero();
    if (keys.has('w') || keys.has('arrowup')) movement.addInPlace(forward);
    if (keys.has('s') || keys.has('arrowdown')) movement.subtractInPlace(forward);
    if (keys.has('d') || keys.has('arrowright')) movement.addInPlace(right);
    if (keys.has('a') || keys.has('arrowleft')) movement.subtractInPlace(right);
    if (locomotion === 'fly') { if (keys.has(' ')) movement.y += 1; if (keys.has('control')) movement.y -= 1; }
    movement.normalize().scaleInPlace(Math.min(engine.getDeltaTime(), 50) * .0018 * (keys.has('shift') ? 3 : 1));
    inside.position.addInPlace(movement);
    if (locomotion === 'walk') { inside.position.x = Math.max(-2.7, Math.min(2.7, inside.position.x)); inside.position.z = Math.max(-1.65, Math.min(1.65, inside.position.z)); inside.position.y = 1.6; }
  });
  window.addEventListener('resize', () => { engine.resize(); updateOrtho(); positionUI(); });
  switchView('inside'); renderState(); scene.onAfterRenderObservable.add(positionUI); engine.runRenderLoop(() => scene.render());
  window.addEventListener('pagehide', () => engine.dispose(), { once: true });
}
try { start(); } catch (error: unknown) { element('fallback').hidden = false; console.error('Spatial concept startup failed', error); }
