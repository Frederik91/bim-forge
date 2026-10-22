import { RoomRepository } from '../src/room-model.mjs';
import { RoomStore, MAX_PROJECT_BYTES } from './room-store.mjs';

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'project-form', 'project-name', 'create-project', 'load-sample', 'proposal-form',
  'door-width', 'proposal-name', 'save-proposal', 'export-project', 'import-project',
  'import-file', 'status', 'error', 'recover-save', 'project-title', 'study-caption',
  'original-drawing', 'proposal-drawing', 'selected-title', 'selected-badge', 'change-count',
  'property-rows', 'comparison-note', 'history-list', 'branch-count', 'conflict-left',
  'conflict-right', 'check-conflicts', 'conflict-result',
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

function updateControls() {
  const writable = Boolean(store) && !busy && !writesBlocked;
  for (const id of ['project-name', 'create-project', 'load-sample', 'import-project']) ui[id].disabled = !writable;
  for (const id of ['door-width', 'proposal-name', 'save-proposal']) ui[id].disabled = !writable || !repo;
  ui['export-project'].disabled = busy || !repo || savedText === null;
  const alternatives = repo ? repo.branches().filter((branch) => branch.name !== 'main') : [];
  const canCompare = !busy && alternatives.length >= 2;
  ui['conflict-left'].disabled = !canCompare;
  ui['conflict-right'].disabled = !canCompare;
  ui['check-conflicts'].disabled = !canCompare;
  ui['recover-save'].disabled = busy;
  ui['project-form'].setAttribute('aria-busy', String(busy));
  ui['proposal-form'].setAttribute('aria-busy', String(busy));
  for (const button of ui['history-list'].querySelectorAll('button')) button.disabled = busy;
}

async function perform(action) {
  if (busy) return;
  busy = true;
  clearError();
  updateControls();
  try { await action(); }
  catch (error) { status('Action did not complete. The displayed project has not been replaced.'); report(error); }
  finally { busy = false; updateControls(); }
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
  render();
}

function confirmReplacement() {
  return !repo || window.confirm('Replace the locally saved project? Export your current project first if you want to keep it.');
}

async function createProject(name) {
  writableStore();
  if (!confirmReplacement()) { status('Project creation cancelled. Your current project is unchanged.'); return; }
  status('Creating and saving your original room…');
  const next = await RoomRepository.create(name);
  await persist(next);
  ui['project-name'].value = repo.name;
  status('Original room saved locally. Create a proposal to explore a different entrance width.');
}

ui['project-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(() => createProject(ui['project-name'].value.trim()));
});

ui['load-sample'].addEventListener('click', () => { void perform(() => createProject('Courtyard room study')); });

ui['proposal-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(async () => {
    writableStore();
    if (!repo) throw new Error('Create a project first.');
    const width = ui['door-width'].valueAsNumber;
    if (!Number.isSafeInteger(width) || width <= 0) throw new Error('Enter a positive whole number of millimetres.');
    const name = ui['proposal-name'].value.trim();
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(name) || name === 'main') throw new Error('Use lowercase words separated by hyphens, and choose a name other than main.');
    status('Checking your proposal and saving locally…');
    const next = await repo.propose({ name, from: repo.head('main'), doorWidthM: width / 1000 });
    if (next === repo) { status('No change to save'); return; }
    await persist(next, name);
    status(`Proposal “${name}” saved locally. The original room is preserved on main.`);
  });
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
    status('Project JSON prepared for download. This export is demo data, not IFC.');
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
    await persist(next);
    ui['project-name'].value = repo.name;
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
  const svg = svgNode('svg', { viewBox: '0 0 600 400', role: 'img', 'aria-labelledby': `${identifier}-title ${identifier}-desc` });
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
  const minX = Math.min(...coordinates.map(([x]) => x));
  const maxX = Math.max(...coordinates.map(([x]) => x));
  const minY = Math.min(...coordinates.map(([, y]) => y));
  const maxY = Math.max(...coordinates.map(([, y]) => y));
  const scale = Math.min(430 / Math.max(maxX - minX, 1), 245 / Math.max(maxY - minY, 1));
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

  const [left, top] = transform([minX, maxY]);
  const [right, bottom] = transform([maxX, minY]);
  svg.append(svgNode('line', { x1: left, y1: top - 30, x2: right, y2: top - 30, stroke: '#a6b8af', 'stroke-width': .8 }));
  for (const x of [left, right]) svg.append(svgNode('line', { x1: x, y1: top - 35, x2: x, y2: top - 25, stroke: '#a6b8af', 'stroke-width': .8 }));
  svg.append(svgNode('text', { x: 300, y: top - 38, 'text-anchor': 'middle', fill: '#6b8075', 'font-size': 10 }, `${number.format(maxX - minX)} m`));
  svg.append(svgNode('text', { x: left - 30, y: (top + bottom) / 2, 'text-anchor': 'middle', fill: '#6b8075', 'font-size': 10, transform: `rotate(-90 ${left - 30} ${(top + bottom) / 2})` }, `${number.format(maxY - minY)} m`));
  svg.append(svgNode('text', { x: 300, y: 185, 'text-anchor': 'middle', fill: '#779086', 'font-size': 11, 'letter-spacing': 2 }, 'ROOM STUDY'));
  svg.append(svgNode('text', { x: 300, y: 204, 'text-anchor': 'middle', fill: '#8b9d94', 'font-size': 9 }, 'Concept plan · dimensions in metres'));
  svg.append(svgNode('path', { d: 'M552 350 V325 M548 333 L552 325 L556 333', stroke: '#8ba096', 'stroke-width': 1, fill: 'none' }));
  svg.append(svgNode('text', { x: 552, y: 365, 'text-anchor': 'middle', fill: '#83968c', 'font-size': 8 }, 'Y'));
  return svg;
}

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
  ui['property-rows'].replaceChildren(...rows.map(([label, before, after, change]) => {
    const row = element('tr'); const heading = element('th', label); heading.scope = 'row';
    row.append(heading, element('td', before), element('td', after, change === 'Unchanged' ? '' : 'changed-value'), element('td', change));
    return row;
  }));
  const entityChanges = delta.entities.added.length + delta.entities.removed.length + delta.entities.modified.length;
  const linkChanges = delta.relationships.added.length + delta.relationships.removed.length + delta.relationships.modified.length;
  ui['change-count'].textContent = `${entityChanges} ${entityChanges === 1 ? 'entity' : 'entities'} · ${linkChanges} ${linkChanges === 1 ? 'relationship' : 'relationships'} changed`;
  ui['comparison-note'].textContent = `Original compared with the selected revision. ${delta.entities.added.length} added, ${delta.entities.removed.length} removed, ${delta.entities.modified.length} modified entities; ${delta.relationships.added.length} added, ${delta.relationships.removed.length} removed, ${delta.relationships.modified.length} modified relationships. No construction validation.`;
}

function selectRevision(branch, revisionId) {
  if (busy || !repo) return;
  selectedBranch = branch;
  selectedRevision = revisionId;
  renderComparison();
  // Retain focus on the clicked history button instead of replacing its DOM node.
  for (const button of ui['history-list'].querySelectorAll('button')) {
    const selected = button.dataset.revision === revisionId && button.dataset.branch === branch;
    if (button.classList.contains('history-button')) button.setAttribute('aria-pressed', String(selected));
    else button.setAttribute('aria-current', String(selected));
  }
  status(`Viewing ${branch}${revisionId === repo.head(branch) ? '' : ' · earlier revision'}. Original preserved on main.`);
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
    const width = entry(repo.view(branch.revisionId).snapshot)?.width;
    copy.append(element('span', branch.name, 'history-name'), element('span', `${branch.name === 'main' ? 'Preserved original' : 'Saved proposal'} · ${width === undefined ? 'entry absent' : `${millimetres(width)} mm entrance`}`, 'history-detail'));
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
  const main = repo.head('main');
  const original = repo.view(main).snapshot;
  const selected = repo.view(selectedRevision).snapshot;
  const isOriginal = selectedRevision === main;
  ui['original-drawing'].replaceChildren(drawPlan(original, null, 'original', 'Original room plan'));
  ui['proposal-drawing'].replaceChildren(drawPlan(selected, isOriginal ? null : original, 'selected', `${selectedBranch} room plan`));
  ui['selected-title'].textContent = isOriginal ? 'Original room' : selectedBranch;
  ui['selected-badge'].textContent = isOriginal ? 'Original' : selectedRevision === repo.head(selectedBranch) ? 'Saved proposal' : 'Earlier revision';
  ui['study-caption'].textContent = isOriginal ? 'The original room is saved. Propose a new entrance width to compare the possibilities.' : 'Dashed grey shows the original entrance; teal shows the selected proposal. No merge is applied.';
  renderProperties(original, selected, repo.compare(main, selectedRevision));
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
    const conflicts = repo.conflicts(repo.head('main'), repo.head(left), repo.head(right));
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
  renderComparison();
  renderHistory();
  renderConflictChoices();
  updateControls();
}

async function initialize() {
  try {
    store = await RoomStore.open();
    const record = await store.load();
    generation = record.generation;
    if (record.text === null) { status('Ready. Create a project or load the sample. Changes are saved only in this browser.'); return; }
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
    ui['project-name'].value = repo.name;
    render();
    status('Saved project restored from this browser. Original preserved on main.');
  } catch (error) {
    writesBlocked = true;
    status('Local storage is not ready. No saved data has been changed.');
    report(error);
  } finally { busy = false; updateControls(); }
}

void initialize();
