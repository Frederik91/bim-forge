import { RoomRepository, rectangleLayout, previewRectangle, diffSnapshots } from '../src/room-model.mjs';
import { RoomStore, MAX_PROJECT_BYTES } from './room-store.mjs';

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'project-form', 'project-name', 'create-project', 'load-sample', 'proposal-form',
  'door-width', 'proposal-name', 'request-text', 'save-proposal', 'export-project', 'import-project',
  'import-file', 'status', 'error', 'recover-save', 'project-title', 'study-caption',
  'original-drawing', 'proposal-drawing', 'selected-title', 'selected-badge', 'change-count',
  'property-rows', 'comparison-note', 'history-list', 'branch-count', 'conflict-left',
  'conflict-right', 'check-conflicts', 'conflict-result', 'discard-preview', 'editor-base',
  'selected-object', 'door-offset', 'wall-position', 'wall-length', 'door-fields',
  'wall-fields', 'wall-position-label', 'selection-help', 'edit-feedback',
  'review-panel', 'review-status', 'review-summary', 'review-rationale', 'review-uncertainty',
  'review-constraints', 'review-binding', 'accept-proposal', 'request-revision', 'review-drawing',
  'request-page', 'review-page', 'history-page', 'nav-request', 'nav-review', 'nav-history',
  'view-original', 'view-changes', 'new-project', 'start-dialog', 'start-close',
  'original-dialog', 'changes-dialog', 'working-dialog', 'editor-panel',
].map((id) => [id, byId(id)]));

let store = null;
let repo = null;
let generation = 0;
let savedText = null;
let recoveryText = null;
let selectedRevision = null;
let selectedBranch = 'main';
let busy = true;
let writesBlocked = false;
let layout = null;
let preview = null;
let selectedObject = 'door-entry';
let invalidInput = false;
let gesture = null;
let activeReview = null;
let currentPage = 'request';
const planCameras = new WeakMap();
const encoder = new TextEncoder();
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const millimetres = (metres) => number.format(Math.round(metres * 1000));

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(message) { ui.status.textContent = message; }
function clearError() { ui.error.replaceChildren(); ui.error.hidden = true; }
function report(error, prefix = '') {
  ui.error.textContent = `${prefix}${error instanceof Error ? error.message : 'An unexpected error occurred.'}`;
  ui.error.hidden = false;
  if (error?.code === 'stale' || error?.code === 'corrupt') writesBlocked = true;
  if (typeof error?.savedText === 'string') showRecovery(error.savedText);
  updateControls();
}

function showRecovery(text) {
  recoveryText = text;
  ui['recover-save'].hidden = false;
}

function reviewState(review) {
  return review?.decision?.status ?? review?.status ?? null;
}

function showPage(name) {
  if (!['request', 'review', 'history'].includes(name)) return;
  if (name === 'review' && !activeReview) return;
  if (name === 'history' && !repo) return;
  currentPage = name;
  for (const page of ['request', 'review', 'history']) {
    ui[`${page}-page`].hidden = page !== name;
    ui[`nav-${page}`].setAttribute('aria-pressed', String(page === name));
  }
  document.getElementById('workbench').focus({ preventScroll: true });
}

function openDialog(dialog) {
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

function updateControls() {
  const writable = Boolean(store) && !busy && !writesBlocked && !gesture;
  for (const id of ['project-name', 'create-project', 'load-sample', 'import-project']) ui[id].disabled = !writable;
  for (const id of ['door-width', 'door-offset', 'wall-position', 'wall-length', 'proposal-name', 'request-text', 'selected-object']) ui[id].disabled = !writable || !layout || Boolean(gesture);
  ui['save-proposal'].disabled = !writable || !layout || invalidInput || Boolean(gesture);
  ui['discard-preview'].disabled = busy || !repo || !dirty() || Boolean(gesture);
  ui['export-project'].disabled = busy || !repo || savedText === null;
  ui['new-project'].disabled = !store || busy || writesBlocked;
  ui['view-original'].disabled = busy || !repo;
  ui['nav-request'].disabled = busy || !repo;
  ui['nav-history'].disabled = busy || !repo;
  ui['nav-review'].disabled = busy || !activeReview;
  ui['view-changes'].disabled = busy || !activeReview || activeReview.proposalRevisionId === null;
  const alternatives = repo ? repo.branches().filter((branch) => branch.name !== 'main') : [];
  const canCompare = !busy && alternatives.length >= 2;
  ui['conflict-left'].disabled = !canCompare;
  ui['conflict-right'].disabled = !canCompare;
  ui['check-conflicts'].disabled = !canCompare;
  ui['recover-save'].disabled = busy;
  const reviewMatches = activeReview?.proposalRevisionId === null || activeReview?.proposalRevisionId === selectedRevision;
  ui['accept-proposal'].disabled = !writable || !reviewMatches || selectedBranch === 'main' || reviewState(activeReview) !== 'pending';
  ui['request-revision'].disabled = !writable || !reviewMatches || !['pending', 'declined'].includes(reviewState(activeReview));
  ui['project-form'].setAttribute('aria-busy', String(busy));
  ui['proposal-form'].setAttribute('aria-busy', String(busy));
  for (const button of ui['history-list'].querySelectorAll('button')) button.disabled = busy || Boolean(gesture);
}

function dirty() {
  return invalidInput || Boolean(repo && preview && JSON.stringify(preview) !== JSON.stringify(repo.view(selectedRevision).snapshot));
}

function feedback(message, invalid = false) {
  ui['edit-feedback'].textContent = message;
  ui['edit-feedback'].dataset.invalid = String(invalid);
}

function resetEditor() {
  invalidInput = false; layout = null; preview = null;
  if (!repo) return;
  preview = repo.view(selectedRevision).snapshot;
  try { layout = rectangleLayout(preview); feedback('Select an object and sketch the intent. The sketch is not authoritative model geometry.'); }
  catch (error) { feedback(`This saved layout is view-only: ${error.message}`, true); }
  const objects = preview.entities;
  ui['selected-object'].replaceChildren(...objects.map((object) => {
    const option = element('option', object.name); option.value = object.id; return option;
  }));
  if (!objects.some((object) => object.id === selectedObject)) selectedObject = objects[0]?.id;
  syncInspector();
}

function wallSide(wall, current = layout) {
  const b = current.boundsMm;
  if (wall.start[0] === wall.end[0]) return Math.round(wall.start[0] * 1000) === b.minX ? 'minX' : 'maxX';
  return Math.round(wall.start[1] * 1000) === b.minY ? 'minY' : 'maxY';
}

function syncInspector() {
  ui['selected-object'].value = selectedObject;
  for (const id of ['door-width', 'door-offset', 'wall-position', 'wall-length']) ui[id].removeAttribute('aria-invalid');
  const object = preview?.entities.find((item) => item.id === selectedObject);
  const isDoor = object?.type === 'Door';
  ui['door-fields'].hidden = !isDoor;
  ui['wall-fields'].hidden = isDoor || !object;
  ui['editor-base'].textContent = `Request bound to ${selectedBranch} · ${selectedRevision.slice(0, 10)}. The original is preserved in history. Unsaved request sketches are lost on reload.`;
  if (!layout || !object) {
    for (const id of ['door-width', 'door-offset', 'wall-position', 'wall-length']) ui[id].value = '';
    ui['selection-help'].textContent = 'This saved revision is view-only. Its geometry and changed properties remain available below.';
    return;
  }
  if (isDoor) {
    ui['door-width'].value = layout.door.widthMm;
    ui['door-offset'].value = layout.door.offsetMm;
    const host = hostFor(preview, object);
    ui['selection-help'].textContent = `Drag the round handle to slide along ${host.wall.name}; drag the square handle to resize. Offset is measured from the arrow at the wall start. Height and host stay unchanged.`;
  } else {
    const side = wallSide(object);
    ui['wall-position'].value = layout.boundsMm[side];
    ui['wall-length'].value = side.endsWith('X') ? layout.boundsMm.maxY - layout.boundsMm.minY : layout.boundsMm.maxX - layout.boundsMm.minX;
    ui['wall-position-label'].textContent = `Wall ${side.endsWith('X') ? 'X' : 'Y'} position (mm)`;
    ui['selection-help'].textContent = 'Drag the round handle to move this wall. Connected corners follow. Length expands towards increasing coordinates, anchored at the minimum coordinate. Door offsets stay relative to their host start.';
  }
}

function chooseObject(id) {
  if (!repo || busy || !layout || gesture) return;
  if (invalidInput && !window.confirm('Discard the incomplete or invalid input and select another object?')) return;
  invalidInput = false; clearError(); selectedObject = id; syncInspector(); renderComparison(); updateControls();
}

ui['selected-object'].addEventListener('change', () => {
  const id = ui['selected-object'].value;
  chooseObject(id); ui['selected-object'].value = selectedObject;
});

function acceptLayout(candidate) {
  const next = previewRectangle(repo.view(selectedRevision).snapshot, candidate);
  layout = rectangleLayout(next); preview = next; invalidInput = false;
  feedback(dirty() ? 'Visual request sketch updated. AI must still prepare and validate a separate proposal.' : 'The request sketch matches the selected revision. Describe any additional intent in words.');
  renderComparison(); updateControls();
}

function editFields(event) {
  if (!repo || busy || writesBlocked || !layout || gesture) return;
  const object = preview.entities.find((item) => item.id === selectedObject);
  const ids = object.type === 'Door' ? ['door-width', 'door-offset'] : ['wall-position', 'wall-length'];
  try {
    const values = ids.map((id) => ui[id].valueAsNumber);
    if (values.some((value) => !Number.isSafeInteger(value))) throw new Error('Enter complete, whole millimetres in both fields.');
    const next = structuredClone(layout);
    if (object.type === 'Door') [next.door.widthMm, next.door.offsetMm] = values;
    else {
      const side = wallSide(object); next.boundsMm[side] = values[0];
      const axis = side.endsWith('X') ? 'Y' : 'X'; next.boundsMm[`max${axis}`] = next.boundsMm[`min${axis}`] + values[1];
    }
    acceptLayout(next);
    for (const id of ids) ui[id].removeAttribute('aria-invalid');
  } catch (error) {
    invalidInput = true; event.target.setAttribute('aria-invalid', 'true');
    feedback(`${error.message} Last valid geometry is still shown; fix the input or discard.`, true); updateControls();
  }
}
for (const id of ['door-width', 'door-offset', 'wall-position', 'wall-length']) ui[id].addEventListener('input', editFields);
ui['discard-preview'].addEventListener('click', () => {
  if (busy || gesture || !repo) return;
  resetEditor(); renderComparison(); updateControls(); status('Visual request sketch discarded. Saved model history is unchanged.');
});
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });

async function perform(action) {
  if (busy || gesture) return;
  busy = true;
  clearError();
  updateControls();
  try { await action(); }
  catch (error) { status('Action did not complete. The displayed project has not been replaced.'); report(error); }
  finally { closeDialog(ui['working-dialog']); busy = false; updateControls(); }
}

function writableStore() {
  if (!store || writesBlocked) throw new Error('Saving is blocked. Download any recovery data or export your current project, then reload.');
}

// This is the only publication path for a new repository. Never assign repo before saveCAS resolves.
async function persist(next, branch = 'main') {
  writableStore();
  const text = next.serialize();
  const nextGeneration = await store.saveCAS(text, generation);
  generation = nextGeneration;
  savedText = text;
  repo = next;
  selectedBranch = branch;
  selectedRevision = repo.head(branch);
  resetEditor();
  render();
}

function confirmReplacement() {
  return !repo || window.confirm('Replace the locally saved project and discard any unsaved request sketch? Export saved work first if you want to keep it.');
}

async function createProject(name) {
  writableStore();
  if (!confirmReplacement()) { status('Project creation cancelled. Your current project is unchanged.'); return; }
  status('Creating and saving your original room…');
  const next = await RoomRepository.create(name);
  activeReview = null;
  await persist(next);
  ui['project-name'].value = repo.name;
  closeDialog(ui['start-dialog']);
  showPage('request');
  status('Original room saved locally. Select a wall or door and describe a request to begin.');
}

ui['project-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(() => createProject(ui['project-name'].value.trim()));
});

ui['load-sample'].addEventListener('click', () => { void perform(() => createProject('Courtyard room study')); });

ui['new-project'].addEventListener('click', () => {
  ui['start-close'].hidden = !repo;
  openDialog(ui['start-dialog']);
});
ui['start-close'].addEventListener('click', () => closeDialog(ui['start-dialog']));
ui['view-original'].addEventListener('click', () => openDialog(ui['original-dialog']));
ui['view-changes'].addEventListener('click', () => openDialog(ui['changes-dialog']));
ui['nav-request'].addEventListener('click', () => showPage('request'));
ui['nav-review'].addEventListener('click', () => showPage('review'));
ui['nav-history'].addEventListener('click', () => showPage('history'));
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => closeDialog(byId(button.dataset.close)));
}
ui['start-dialog'].addEventListener('cancel', (event) => {
  if (!repo) event.preventDefault();
});

ui['proposal-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(async () => {
    writableStore();
    if (!repo) throw new Error('Create a project first.');
    if (!layout || invalidInput) throw new Error('Fix the visual request input before asking AI to prepare a proposal.');
    const name = ui['proposal-name'].value.trim();
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(name) || name === 'main') throw new Error('Use lowercase words separated by hyphens, and choose a name other than main.');
    const instruction = ui['request-text'].value.trim();
    if (!instruction || instruction.length > 1000) throw new Error('Describe the requested outcome in 1 to 1000 characters.');
    status('The model-working AI is inspecting the bound revision and preparing a validated proposal…');
    openDialog(ui['working-dialog']);
    const response = await fetch('/api/proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: repo.serialize(),
        request: {
          requestId: globalThis.crypto.randomUUID(), proposalName: name, baseRevisionId: selectedRevision,
          selectedObjectIds: [selectedObject], instruction,
          visualIntent: { kind: 'rectangle-layout-sketch', layout },
        },
      }),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The proposal service returned unreadable data.'); }
    if (!response.ok) throw new Error(result?.error ?? `The proposal service failed with HTTP ${response.status}.`);
    if (!result || typeof result.project !== 'string' || !result.review || !['ready', 'declined'].includes(result.status)) {
      throw new Error('The proposal service returned an unsupported result.');
    }
    const review = { ...result.review, status: result.status };
    if (result.status === 'declined') {
      activeReview = review;
      renderReview();
      showPage('review');
      status('The AI could not prepare a proposal with the bounded model tools. Review the reason and revise the request.');
      return;
    }
    const next = await RoomRepository.restore(result.project);
    if (next.head(name) !== result.review.proposalRevisionId) throw new Error('The returned proposal is not bound to its claimed revision.');
    await persist(next, name);
    activeReview = repo.review(name);
    renderReview();
    showPage('review');
    status(`AI proposal “${name}” is validated and saved separately. Review it before accepting or requesting a revision.`);
  });
});

function renderReview() {
  const review = activeReview;
  ui['review-panel'].hidden = !review;
  if (!review) return;
  const state = reviewState(review);
  ui['review-status'].textContent = state === 'accepted' ? 'Accepted version'
    : state === 'superseded' ? 'Earlier accepted version'
      : state === 'declined' ? 'No proposal prepared' : 'Ready for review';
  ui['review-summary'].textContent = review.summary;
  ui['review-rationale'].textContent = review.rationale;
  ui['review-constraints'].textContent = review.constraints;
  ui['review-uncertainty'].textContent = review.uncertainty;
  const evidence = review.worker ? ` · ${review.worker.provider}/${review.worker.model} · ${review.validator}` : '';
  ui['review-binding'].textContent = `Request ${review.requestId} · base ${review.baseRevisionId.slice(0, 10)} · objects ${review.selectedObjectIds.join(', ')}${evidence}`;
  updateControls();
}

ui['accept-proposal'].addEventListener('click', () => {
  void perform(async () => {
    writableStore();
    if (!activeReview || activeReview.proposalRevisionId !== selectedRevision || selectedBranch === 'main') {
      throw new Error('Select the AI-prepared proposal before accepting it.');
    }
    const acceptedName = selectedBranch;
    const next = repo.accept(acceptedName, { decisionId: globalThis.crypto.randomUUID(), actor: 'local-human' });
    await persist(next, 'main');
    activeReview = repo.review(acceptedName);
    renderReview();
    showPage('review');
    status(`Accepted “${acceptedName}” as the current model version. The original and proposal branch remain in history.`);
  });
});

ui['request-revision'].addEventListener('click', () => {
  if (busy || !activeReview || (activeReview.proposalRevisionId !== null && activeReview.proposalRevisionId !== selectedRevision)) return;
  activeReview = null;
  ui['proposal-name'].value = '';
  ui['request-text'].value = `Revise the selected AI proposal. ${ui['request-text'].value.trim()}`.slice(0, 1000);
  renderReview(); updateControls();
  showPage('request');
  ui['proposal-name'].focus();
  status('Revision request started from the selected proposal. Choose a new proposal name; the earlier proposal remains unchanged.');
});

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ui['export-project'].addEventListener('click', () => {
  if (!repo || savedText === null || busy) return;
  try {
    const stem = repo.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'room-study';
    download(savedText, `${stem}.room-demo.json`);
    status('Saved project JSON prepared for download, including review evidence and human decisions. Unsaved request sketches are not included. This is demo data, not IFC.');
  } catch (error) { report(error, 'Export failed: '); }
});

ui['recover-save'].addEventListener('click', () => {
  if (recoveryText === null || busy) return;
  try { download(recoveryText, 'unreadable-room-save.json'); status('Unreadable saved text prepared for download. The stored record remains untouched.'); }
  catch (error) { report(error, 'Recovery download failed: '); }
});

ui['import-project'].addEventListener('click', () => {
  if (busy || !store || writesBlocked) return;
  ui['import-file'].value = '';
  ui['import-file'].click();
});

ui['import-file'].addEventListener('change', () => {
  const file = ui['import-file'].files?.[0];
  if (!file) return;
  void perform(async () => {
    writableStore();
    if (file.size > MAX_PROJECT_BYTES) throw new Error('Import is too large. Choose a demo JSON file of at most 256 KiB.');
    status('Validating the imported project…');
    const text = await file.text();
    if (encoder.encode(text).byteLength > MAX_PROJECT_BYTES) throw new Error('Encoded import exceeds the 256 KiB limit.');
    const next = await RoomRepository.restore(text);
    if (!confirmReplacement()) { status('Import cancelled. Your current project is unchanged.'); return; }
    activeReview = null;
    await persist(next);
    ui['project-name'].value = repo.name;
    activeReview = repo.reviews().find((review) => review.proposalRevisionId === selectedRevision) ?? null;
    renderReview();
    closeDialog(ui['start-dialog']);
    showPage(activeReview ? 'review' : 'request');
    status('Imported project validated and saved locally. Its original room is preserved.');
  });
});

function entry(snapshot) { return snapshot.entities.find((entity) => entity.type === 'Door' && entity.id === 'door-entry'); }
function hostFor(snapshot, door) {
  if (!door) return null;
  const link = snapshot.relationships.find((relation) => relation.type === 'hosted-by' && relation.source === door.id);
  const wall = link && snapshot.entities.find((entity) => entity.id === link.target && entity.type === 'Wall');
  return wall ? { link, wall } : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawPlan(snapshot, reference, identifier, label) {
  const editable = identifier === 'selected' && Boolean(layout);
  const svg = svgNode('svg', { viewBox: '0 0 600 400', role: editable ? 'group' : 'img', 'aria-labelledby': `${identifier}-title ${identifier}-desc` });
  const door = entry(snapshot);
  svg.append(svgNode('title', { id: `${identifier}-title` }, label));
  svg.append(svgNode('desc', { id: `${identifier}-desc` }, `Top-down room plan. ${door ? `Entry door width ${millimetres(door.width)} millimetres.` : 'Entry door absent.'} ${reference ? 'Dashed grey outlines show the original. Teal shows the selected revision.' : 'The original room is preserved.'}`));
  const definitions = svgNode('defs');
  const minorGrid = svgNode('pattern', { id: `${identifier}-grid`, width: 15, height: 15, patternUnits: 'userSpaceOnUse' });
  minorGrid.append(svgNode('path', { d: 'M 15 0 L 0 0 0 15', fill: 'none', stroke: '#eaf0ed', 'stroke-width': .65 }));
  const majorGrid = svgNode('pattern', { id: `${identifier}-major`, width: 75, height: 75, patternUnits: 'userSpaceOnUse' });
  majorGrid.append(svgNode('rect', { width: 75, height: 75, fill: `url(#${identifier}-grid)` }));
  majorGrid.append(svgNode('path', { d: 'M 75 0 L 0 0 0 75', fill: 'none', stroke: '#dbe5e0', 'stroke-width': .8 }));
  definitions.append(minorGrid, majorGrid);
  svg.append(definitions, svgNode('rect', { width: 600, height: 400, fill: `url(#${identifier}-major)` }));

  const walls = snapshot.entities.filter((entity) => entity.type === 'Wall');
  const allWalls = [...walls, ...(reference ? reference.entities.filter((entity) => entity.type === 'Wall') : [])];
  const coordinates = allWalls.flatMap((wall) => [wall.start, wall.end]);
  if (!coordinates.length) return svg;
  const camera = editable && gesture ? gesture.camera : {
    minX: Math.min(...coordinates.map(([x]) => x)), maxX: Math.max(...coordinates.map(([x]) => x)),
    minY: Math.min(...coordinates.map(([, y]) => y)), maxY: Math.max(...coordinates.map(([, y]) => y)),
  };
  const { minX, maxX, minY, maxY } = camera;
  const scale = Math.min((editable ? 350 : 430) / Math.max(maxX - minX, 1), (editable ? 190 : 245) / Math.max(maxY - minY, 1));
  planCameras.set(svg, { ...camera, scale });
  const transform = ([x, y]) => [300 + (x - (minX + maxX) / 2) * scale, 193 - (y - (minY + maxY) / 2) * scale];
  const points = (items) => items.map((point) => transform(point).join(',')).join(' ');
  const line = (start, end, attributes = {}) => {
    const [x1, y1] = transform(start); const [x2, y2] = transform(end);
    return svgNode('line', { x1, y1, x2, y2, ...attributes });
  };

  for (const wall of walls) {
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dy);
    const px = -dy / length * wall.thickness / 2; const py = dx / length * wall.thickness / 2;
    const outline = [[wall.start[0] + px, wall.start[1] + py], [wall.end[0] + px, wall.end[1] + py],
      [wall.end[0] - px, wall.end[1] - py], [wall.start[0] - px, wall.start[1] - py]];
    svg.append(svgNode('polygon', { points: points(outline), fill: reference ? '#e2ede8' : '#e5eae8', stroke: reference ? '#4f7e72' : '#516873', 'stroke-width': 1.2 }));
  }
  if (reference) for (const wall of reference.entities.filter((item) => item.type === 'Wall')) {
    svg.append(line(wall.start, wall.end, { stroke: '#87979b', 'stroke-width': 1.3, 'stroke-dasharray': '5 4', class: 'selection-outline' }));
  }

  function drawDoors(room, ghost = false) {
    for (const item of room.entities.filter((entity) => entity.type === 'Door')) {
      const host = hostFor(room, item);
      if (!host) continue;
      const { wall, link } = host;
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      const ux = (wall.end[0] - wall.start[0]) / length; const uy = (wall.end[1] - wall.start[1]) / length;
      const hinge = [wall.start[0] + ux * link.offset, wall.start[1] + uy * link.offset];
      const jamb = [hinge[0] + ux * item.width, hinge[1] + uy * item.width];
      const leaf = [hinge[0] - uy * item.width, hinge[1] + ux * item.width];
      const color = ghost ? '#87979b' : reference ? '#167d78' : '#516873';
      const style = { stroke: color, 'stroke-width': ghost ? 1.3 : 1.8, ...(ghost ? { 'stroke-dasharray': '5 4' } : {}) };
      if (!ghost) {
        svg.append(line(hinge, jamb, { stroke: '#fff', 'stroke-width': wall.thickness * scale + 2 }));
        svg.append(line(hinge, [hinge[0] - uy * wall.thickness / 2, hinge[1] + ux * wall.thickness / 2], style));
        svg.append(line(jamb, [jamb[0] - uy * wall.thickness / 2, jamb[1] + ux * wall.thickness / 2], style));
      }
      svg.append(line(hinge, leaf, style));
      const arc = Array.from({ length: 25 }, (_, index) => {
        const angle = index * Math.PI / 48;
        return [hinge[0] + item.width * (ux * Math.cos(angle) - uy * Math.sin(angle)),
          hinge[1] + item.width * (uy * Math.cos(angle) + ux * Math.sin(angle))];
      });
      svg.append(svgNode('polyline', { points: points(arc), fill: 'none', ...style }));
      if (!ghost && item.id === 'door-entry') {
        const offset = .58;
        const a = [hinge[0] + uy * offset, hinge[1] - ux * offset];
        const b = [jamb[0] + uy * offset, jamb[1] - ux * offset];
        svg.append(line(a, b, { stroke: color, 'stroke-width': .9 }));
        for (const point of [a, b]) svg.append(line([point[0] - uy * .07, point[1] + ux * .07], [point[0] + uy * .07, point[1] - ux * .07], { stroke: color, 'stroke-width': 1 }));
        const [tx, ty] = transform([(a[0] + b[0]) / 2 + uy * .18, (a[1] + b[1]) / 2 - ux * .18]);
        svg.append(svgNode('text', { x: tx, y: ty, fill: color, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 11, 'font-weight': 600, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 4 }, `${millimetres(item.width)} mm`));
      }
    }
  }
  drawDoors(snapshot);
  if (reference) drawDoors(reference, true);

  const ownCoordinates = walls.flatMap((wall) => [wall.start, wall.end]);
  const ownMinX = Math.min(...ownCoordinates.map(([x]) => x)); const ownMaxX = Math.max(...ownCoordinates.map(([x]) => x));
  const ownMinY = Math.min(...ownCoordinates.map(([, y]) => y)); const ownMaxY = Math.max(...ownCoordinates.map(([, y]) => y));
  const [left, top] = transform([ownMinX, ownMaxY]);
  const [right, bottom] = transform([ownMaxX, ownMinY]);
  svg.append(svgNode('line', { x1: left, y1: top - 30, x2: right, y2: top - 30, stroke: '#a6b8af', 'stroke-width': .8 }));
  for (const x of [left, right]) svg.append(svgNode('line', { x1: x, y1: top - 35, x2: x, y2: top - 25, stroke: '#a6b8af', 'stroke-width': .8 }));
  svg.append(svgNode('text', { x: (left + right) / 2, y: top - 38, 'text-anchor': 'middle', fill: '#6b8075', 'font-size': 10 }, `${number.format(ownMaxX - ownMinX)} m`));
  svg.append(svgNode('text', { x: left - 30, y: (top + bottom) / 2, 'text-anchor': 'middle', fill: '#6b8075', 'font-size': 10, transform: `rotate(-90 ${left - 30} ${(top + bottom) / 2})` }, `${number.format(ownMaxY - ownMinY)} m`));
  svg.append(svgNode('text', { x: 300, y: 185, 'text-anchor': 'middle', fill: '#779086', 'font-size': 11, 'letter-spacing': 2 }, 'ROOM STUDY'));
  svg.append(svgNode('text', { x: 300, y: 204, 'text-anchor': 'middle', fill: '#8b9d94', 'font-size': 9 }, 'Concept plan · dimensions in metres'));
  svg.append(svgNode('path', { d: 'M552 350 V325 M548 333 L552 325 L556 333', stroke: '#8ba096', 'stroke-width': 1, fill: 'none' }));
  svg.append(svgNode('text', { x: 552, y: 365, 'text-anchor': 'middle', fill: '#83968c', 'font-size': 8 }, 'Y'));
  if (editable) {
    const cssScale = 600 / Math.max(ui['proposal-drawing'].clientWidth, 200);
    const targetWidth = 44 * cssScale;
    for (const wall of walls) {
      if (wall.id === selectedObject) svg.append(line(wall.start, wall.end, { stroke: '#e1a12e', 'stroke-width': 5, class: 'selection-outline' }));
      svg.append(line(wall.start, wall.end, { stroke: 'transparent', 'stroke-width': targetWidth, class: 'edit-target',
        'data-object': wall.id, role: 'button', tabindex: 0, 'aria-label': `Select ${wall.name}`, 'aria-pressed': String(wall.id === selectedObject) }));
    }
    const doorHost = hostFor(snapshot, door);
    const { wall, link } = doorHost;
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const unit = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
    const hinge = wall.start.map((v, i) => v + unit[i] * link.offset);
    const jamb = hinge.map((v, i) => v + unit[i] * door.width);
    const centre = hinge.map((v, i) => v + unit[i] * door.width / 2);
    svg.append(line(hinge, jamb, { stroke: selectedObject === door.id ? '#e1a12e' : 'transparent', 'stroke-opacity': .25, 'stroke-width': targetWidth,
      class: 'edit-target', 'data-object': door.id, role: 'button', tabindex: 0, 'aria-label': 'Select Entry door', 'aria-pressed': String(selectedObject === door.id) }));
    const selected = snapshot.entities.find((item) => item.id === selectedObject);
    const handle = (location, operation, caption, square = false) => {
      const [x, y] = transform(location);
      const group = svgNode('g', { class: 'edit-handle', 'data-handle': operation, 'data-object': selectedObject, 'aria-label': caption, role: 'button', tabindex: 0 });
      group.append(svgNode('circle', { cx: x, cy: y, r: targetWidth / 2, fill: '#167d78', 'fill-opacity': .06 }));
      group.append(square ? svgNode('rect', { x: x - 6, y: y - 6, width: 12, height: 12, rx: 2, fill: '#167d78', stroke: 'white', 'stroke-width': 2 })
        : svgNode('circle', { cx: x, cy: y, r: 7, fill: '#167d78', stroke: 'white', 'stroke-width': 2 }));
      svg.append(group);
    };
    if (selected.type === 'Wall') handle(selected.start.map((v, i) => (v + selected.end[i]) / 2), 'wall', `Move ${selected.name}`);
    else {
      const origin = transform(wall.start); const arrow = transform(wall.start.map((v, i) => v + unit[i] * .5));
      svg.append(svgNode('line', { x1: origin[0], y1: origin[1], x2: arrow[0], y2: arrow[1], stroke: '#c27d1a', 'stroke-width': 3 }));
      const tangent = [unit[0], -unit[1]];
      const head = [[arrow[0], arrow[1]], [arrow[0] - tangent[0] * 8 - tangent[1] * 4, arrow[1] - tangent[1] * 8 + tangent[0] * 4],
        [arrow[0] - tangent[0] * 8 + tangent[1] * 4, arrow[1] - tangent[1] * 8 - tangent[0] * 4]];
      svg.append(svgNode('polygon', { points: head.map((p) => p.join(',')).join(' '), fill: '#c27d1a' }));
      svg.append(svgNode('text', { x: origin[0], y: origin[1] + 25, fill: '#986312', 'font-size': 10 }, 'HOST START'));
      // Separate move and resize targets from the opening so small doors remain usable on phones.
      const normal = [-unit[1], unit[0]];
      handle(centre.map((v, i) => v + normal[i] * 36 * cssScale / scale), 'door-move', 'Move Entry door');
      handle(jamb.map((v, i) => v - normal[i] * 36 * cssScale / scale), 'door-width', 'Resize Entry door', true);
    }
  }
  return svg;
}

function pointerPlan(event, root, camera) {
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(root.getScreenCTM().inverse());
  return [(point.x - 300) / camera.scale + (camera.minX + camera.maxX) / 2,
    (193 - point.y) / camera.scale + (camera.minY + camera.maxY) / 2];
}

ui['proposal-drawing'].addEventListener('pointerdown', (event) => {
  if (!repo || busy || writesBlocked || !layout || gesture || event.button !== 0 || !event.isPrimary) return;
  const target = event.target.closest('[data-object]'); if (!target) return;
  const operation = target.dataset.handle;
  if (!operation) { chooseObject(target.dataset.object); return; }
  if (invalidInput) { feedback('Fix or discard the invalid input before dragging.', true); return; }
  event.preventDefault();
  const root = ui['proposal-drawing'].querySelector('svg'); const camera = planCameras.get(root);
  gesture = { id: event.pointerId, root, camera, operation, layout, preview, origin: pointerPlan(event, root, camera),
    client: [event.clientX, event.clientY], moved: false, rejected: false };
  root.setPointerCapture(event.pointerId); updateControls();
});
ui['proposal-drawing'].addEventListener('pointermove', (event) => {
  if (!gesture || gesture.id !== event.pointerId) return;
  if (!gesture.moved && Math.hypot(event.clientX - gesture.client[0], event.clientY - gesture.client[1]) < 6) return;
  gesture.moved = true; event.preventDefault();
  const current = pointerPlan(event, gesture.root, gesture.camera);
  const delta = current.map((v, i) => v - gesture.origin[i]); const candidate = structuredClone(gesture.layout);
  if (gesture.operation === 'wall') {
    const wall = gesture.preview.entities.find((item) => item.id === selectedObject);
    const side = wallSide(wall, gesture.layout);
    candidate.boundsMm[side] += Math.round(delta[side.endsWith('X') ? 0 : 1] * 1000);
  } else {
    const host = hostFor(gesture.preview, entry(gesture.preview));
    const dx = host.wall.end[0] - host.wall.start[0]; const dy = host.wall.end[1] - host.wall.start[1];
    const along = Math.round((delta[0] * dx + delta[1] * dy) / Math.hypot(dx, dy) * 1000);
    candidate.door[gesture.operation === 'door-move' ? 'offsetMm' : 'widthMm'] += along;
  }
  try { acceptLayout(candidate); gesture.rejected = false; }
  catch (error) { gesture.rejected = true; feedback(`${error.message} Last valid request sketch retained.`, true); }
});
function endGesture(cancel = false) {
  if (!gesture) return;
  const previous = gesture; gesture = null;
  if (cancel) { layout = previous.layout; preview = previous.preview; feedback('Drag cancelled. Pre-drag request sketch restored.'); }
  else if (previous.rejected) feedback('Move stopped at the last valid request sketch. Review it before submitting.');
  if (previous.root.hasPointerCapture(previous.id)) previous.root.releasePointerCapture(previous.id);
  syncInspector(); renderComparison(); updateControls();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) ui['proposal-drawing'].addEventListener(type, (event) => {
  if (gesture?.id === event.pointerId) endGesture(type !== 'pointerup');
});
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && gesture) { event.preventDefault(); endGesture(true); } });
ui['proposal-drawing'].addEventListener('keydown', (event) => {
  const target = event.target.closest('[data-object]');
  if (target && ['Enter', ' '].includes(event.key)) {
    event.preventDefault(); chooseObject(target.dataset.object);
    const control = ui[selectedObject === 'door-entry' ? 'door-width' : 'wall-position'];
    if (!control.disabled) control.focus();
  }
});

function renderProperties(original, selected, delta) {
  const a = entry(original); const b = entry(selected);
  const ah = hostFor(original, a); const bh = hostFor(selected, b);
  const displayMM = (value) => value === undefined ? 'Absent' : `${millimetres(value)} mm`;
  const difference = a && b ? Math.round((b.width - a.width) * 1000) : null;
  const widthDifference = difference === null ? 'Changed' : difference === 0 ? 'Unchanged' : `${difference > 0 ? '+' : '−'}${number.format(Math.abs(difference))} mm`;
  const rows = [
    ['Entrance width', displayMM(a?.width), displayMM(b?.width), widthDifference],
    ['Door height', displayMM(a?.height), displayMM(b?.height), a?.height === b?.height ? 'Unchanged' : 'Changed'],
    ['Host wall', ah?.wall.name ?? 'Absent', bh?.wall.name ?? 'Absent', ah?.wall.id === bh?.wall.id ? 'Unchanged' : 'Changed'],
    ['Offset along host wall', displayMM(ah?.link.offset), displayMM(bh?.link.offset), ah?.link.offset === bh?.link.offset ? 'Unchanged' : 'Changed'],
    ['Host wall height', displayMM(ah?.wall.height), displayMM(bh?.wall.height), ah?.wall.height === bh?.wall.height ? 'Unchanged' : 'Changed'],
  ];
  for (const wall of selected.entities.filter((item) => item.type === 'Wall')) {
    const before = original.entities.find((item) => item.id === wall.id);
    const length = (item) => item ? Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]) : undefined;
    const position = (item) => item ? `${item.start.map(millimetres).join(', ')} → ${item.end.map(millimetres).join(', ')} mm` : 'Absent';
    rows.push([`${wall.name} length`, displayMM(length(before)), displayMM(length(wall)), length(before) === length(wall) ? 'Unchanged' : 'Changed']);
    if (position(before) !== position(wall)) rows.push([`${wall.name} endpoints`, position(before), position(wall), 'Changed']);
  }
  const propertyNames = { name: 'name', type: 'type', width: 'width', height: 'height', thickness: 'thickness', start: 'start coordinate', end: 'end coordinate', source: 'door', target: 'host wall', offset: 'offset from host start' };
  const propertyValue = (key, value) => value === undefined ? 'Absent'
    : ['width', 'height', 'thickness', 'offset'].includes(key) ? displayMM(value)
      : Array.isArray(value) ? `${value.map(millimetres).join(', ')} mm` : String(value);
  for (const [collection, noun] of [['entities', 'Object'], ['relationships', 'Placement']]) {
    const modifications = [
      ...delta[collection].added.map((after) => ({ before: null, after, action: 'Added' })),
      ...delta[collection].removed.map((before) => ({ before, after: null, action: 'Removed' })),
      ...delta[collection].modified.map((item) => ({ ...item, action: 'Changed' })),
    ];
    for (const { before, after, action } of modifications) {
      const item = after ?? before;
      const title = item.name ?? `${noun} ${item.id}`;
      for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
        if (key === 'id' || JSON.stringify(before?.[key]) === JSON.stringify(after?.[key])) continue;
        rows.push([`${title} · ${propertyNames[key] ?? key}`, propertyValue(key, before?.[key]), propertyValue(key, after?.[key]), action]);
      }
    }
  }
  ui['property-rows'].replaceChildren(...rows.map(([label, before, after, change]) => {
    const row = element('tr'); const heading = element('th', label); heading.scope = 'row';
    row.append(heading, element('td', before), element('td', after, change === 'Unchanged' ? '' : 'changed-value'), element('td', change));
    return row;
  }));
  const entityChanges = delta.entities.added.length + delta.entities.removed.length + delta.entities.modified.length;
  const linkChanges = delta.relationships.added.length + delta.relationships.removed.length + delta.relationships.modified.length;
  ui['change-count'].textContent = `${entityChanges} ${entityChanges === 1 ? 'entity' : 'entities'} · ${linkChanges} ${linkChanges === 1 ? 'relationship' : 'relationships'} changed`;
  ui['comparison-note'].textContent = `Original compared with ${dirty() ? 'the visual request sketch' : 'the selected revision'}. ${delta.entities.added.length} added, ${delta.entities.removed.length} removed, ${delta.entities.modified.length} modified entities; ${delta.relationships.added.length} added, ${delta.relationships.removed.length} removed, ${delta.relationships.modified.length} modified relationships. Only AI-submitted geometry is saved; no construction validation.`;
}

function selectRevision(branch, revisionId) {
  if (busy || gesture || !repo) return;
  if (dirty() && !window.confirm('Discard the unsaved request sketch and view this saved revision?')) return;
  selectedBranch = branch;
  selectedRevision = revisionId;
  activeReview = repo.reviews().find((review) => review.proposalRevisionId === revisionId) ?? null;
  resetEditor();
  renderComparison();
  renderReview();
  updateControls();
  // Retain focus on the clicked history button instead of replacing its DOM node.
  for (const button of ui['history-list'].querySelectorAll('button')) {
    const selected = button.dataset.revision === revisionId && button.dataset.branch === branch;
    if (button.classList.contains('history-button')) button.setAttribute('aria-pressed', String(selected));
    else button.setAttribute('aria-current', String(selected));
  }
  showPage(activeReview ? 'review' : 'request');
  status(`Viewing ${branch}${revisionId === repo.head(branch) ? '' : ' · earlier revision'}. The original remains in revision history.`);
}

function renderHistory() {
  const branches = repo.branches();
  ui['branch-count'].textContent = `${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}`;
  ui['history-list'].replaceChildren(...branches.map((branch) => {
    const wrapper = element('div', undefined, 'history-item');
    const button = element('button', undefined, 'history-button'); button.type = 'button';
    button.dataset.branch = branch.name; button.dataset.revision = branch.revisionId;
    button.setAttribute('aria-pressed', String(selectedBranch === branch.name && selectedRevision === branch.revisionId));
    const symbol = element('span', branch.name === 'main' ? '◇' : '↳', 'history-symbol'); symbol.setAttribute('aria-hidden', 'true');
    const copy = element('span');
    const room = repo.view(branch.revisionId).snapshot;
    const width = entry(room)?.width;
    const changed = repo.compare(repo.root(), branch.revisionId);
    const mainDetail = branch.revisionId === repo.root() ? 'Original model' : 'Current accepted model';
    copy.append(element('span', branch.name, 'history-name'), element('span', `${branch.name === 'main' ? mainDetail : `AI proposal · ${changed.entities.modified.length} objects and ${changed.relationships.modified.length} placements changed`} · ${width === undefined ? 'entry absent' : `${millimetres(width)} mm entrance`}`, 'history-detail'));
    button.append(symbol, copy);
    button.addEventListener('click', () => selectRevision(branch.name, branch.revisionId));
    wrapper.append(button);
    const detail = element('details', undefined, 'revision-detail');
    detail.append(element('summary', 'Revision ancestry'));
    const list = element('ol', undefined, 'revision-list');
    let revision = repo.view(branch.revisionId); let index = 0;
    while (revision) {
      const id = revision.id;
      const item = element('li');
      const control = element('button', `${index === 0 ? 'Head' : 'Ancestor'} · ${id.slice(0, 10)}${revision.parentId === null ? ' · original' : ''}`, 'revision-button');
      control.type = 'button'; control.title = id;
      control.dataset.branch = branch.name; control.dataset.revision = id;
      control.setAttribute('aria-current', String(selectedBranch === branch.name && selectedRevision === id));
      control.setAttribute('aria-label', `View ${branch.name} ${index === 0 ? 'head' : 'ancestor'} revision ${id.slice(0, 10)}`);
      control.addEventListener('click', () => selectRevision(branch.name, id));
      item.append(control); list.append(item);
      revision = revision.parentId === null ? null : repo.view(revision.parentId);
      index += 1;
    }
    detail.append(list); wrapper.append(detail);
    return wrapper;
  }));
}

function renderComparison() {
  const originalId = repo.root();
  const original = repo.view(originalId).snapshot;
  const selected = preview ?? repo.view(selectedRevision).snapshot;
  const isOriginal = selectedRevision === originalId;
  ui['original-drawing'].replaceChildren(drawPlan(original, null, 'root', 'Original room plan'));
  const next = drawPlan(selected, original, 'selected', `${selectedBranch} visual request plan`);
  const root = ui['proposal-drawing'].querySelector('svg');
  if (root) {
    // Keep the capture root stable throughout a drag; only drawing children change.
    root.replaceChildren(...next.childNodes); root.setAttribute('role', next.getAttribute('role'));
    planCameras.set(root, planCameras.get(next));
  } else ui['proposal-drawing'].replaceChildren(next);
  ui['review-drawing'].replaceChildren(drawPlan(selected, original, 'review', `${selectedBranch} proposal review plan`));
  ui['selected-title'].textContent = dirty() ? 'Your visual request' : isOriginal ? 'Original · ready for a request' : selectedBranch;
  ui['selected-badge'].textContent = dirty() ? 'Request sketch' : isOriginal ? 'Original' : selectedBranch === 'main' ? 'Accepted model' : selectedRevision === repo.head(selectedBranch) ? 'AI proposal' : 'Earlier revision';
  ui['study-caption'].textContent = 'Select a wall or door, then drag its handle or enter a dimension as visual intent. Dashed grey is the preserved original. AI prepares any saved model proposal.';
  renderProperties(original, selected, diffSnapshots(original, selected));
}

function renderConflictChoices() {
  const alternatives = repo.branches().filter((branch) => branch.name !== 'main');
  for (const [id, defaultIndex] of [['conflict-left', 0], ['conflict-right', 1]]) {
    const select = ui[id]; const previous = select.value;
    select.replaceChildren();
    if (alternatives.length < 2) {
      const option = element('option', 'Save two proposals first'); option.value = ''; select.append(option);
    } else {
      for (const branch of alternatives) {
        const width = entry(repo.view(branch.revisionId).snapshot)?.width;
        const option = element('option', `${branch.name}${width === undefined ? '' : ` · ${millimetres(width)} mm`}`);
        option.value = branch.name; select.append(option);
      }
      select.value = alternatives.some((branch) => branch.name === previous) ? previous : alternatives[defaultIndex].name;
    }
  }
  ui['conflict-result'].textContent = 'Comparison only. Nothing is merged or applied.';
}

ui['check-conflicts'].addEventListener('click', () => {
  if (!repo || busy) return;
  clearError();
  try {
    const left = ui['conflict-left'].value; const right = ui['conflict-right'].value;
    if (!left || !right || left === right) throw new Error('Choose two different proposals to compare.');
    const conflicts = repo.conflicts(repo.root(), repo.head(left), repo.head(right));
    ui['conflict-result'].replaceChildren();
    if (!conflicts.length) {
      ui['conflict-result'].textContent = 'No divergent whole-object changes found. This is a conservative demo comparison, not an approval or merge.';
    } else {
      ui['conflict-result'].append(document.createTextNode(`${conflicts.length} ${conflicts.length === 1 ? 'conflict needs' : 'conflicts need'} a human decision. `));
      for (const conflict of conflicts) {
        const describe = (value) => value === null ? 'removed' : value.type === 'Door' ? `${millimetres(value.width)} mm door` : value.name ?? value.id;
        ui['conflict-result'].append(document.createTextNode(`${conflict.id}: original ${describe(conflict.base)}; ${left}: ${describe(conflict.left)}; ${right}: ${describe(conflict.right)}. `));
      }
      ui['conflict-result'].append(document.createTextNode('Both alternatives remain separate. Nothing is merged.'));
    }
  } catch (error) { report(error); }
});

for (const id of ['conflict-left', 'conflict-right']) ui[id].addEventListener('change', () => {
  ui['conflict-result'].textContent = 'Alternatives changed. Compare again to see their conflicts. Nothing is merged.';
});

function render() {
  ui['project-title'].textContent = repo.name;
  document.title = `${repo.name} · Room studies`;
  if (!activeReview) activeReview = repo.reviews().find((review) => review.proposalRevisionId === selectedRevision) ?? null;
  renderComparison();
  renderHistory();
  renderConflictChoices();
  renderReview();
  updateControls();
}

async function initialize() {
  let needsStart = false;
  try {
    store = await RoomStore.open();
    const record = await store.load();
    generation = record.generation;
    if (record.text === null) { needsStart = true; status('Ready. Create a project or load the sample. Changes are saved only in this browser.'); return; }
    let restored;
    try { restored = await RoomRepository.restore(record.text); }
    catch (error) {
      writesBlocked = true;
      showRecovery(record.text);
      throw new Error(`The saved project could not be validated: ${error.message} It has been left intact. Download it below; local writes are blocked to protect it.`);
    }
    repo = restored;
    savedText = record.text;
    selectedBranch = 'main';
    selectedRevision = repo.head('main');
    activeReview = repo.reviews().find((review) => review.proposalRevisionId === selectedRevision) ?? null;
    resetEditor();
    ui['project-name'].value = repo.name;
    render();
    showPage(activeReview ? 'review' : 'request');
    status('Saved project restored from this browser. Original preserved on main.');
  } catch (error) {
    writesBlocked = true;
    status('Local storage is not ready. No saved data has been changed.');
    report(error);
  } finally {
    busy = false;
    updateControls();
    if (needsStart) {
      ui['start-close'].hidden = true;
      openDialog(ui['start-dialog']);
    }
  }
}

void initialize();
