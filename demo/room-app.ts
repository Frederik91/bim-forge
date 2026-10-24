import { RoomRepository, rectangleLayout, previewRectangle, diffSnapshots } from '../src/room-model.ts';
import type {
  Door, Entity, Equipment, HostingRelationship, ModelDelta, ModelSnapshot, Point, ProposalReview, RoomLayout, Wall, Window,
} from '../src/room-model.ts';
import { createHousePilotFixture } from '../src/house-pilot.ts';
import {
  DEFAULT_MODEL_VIEW_CAMERA,
  orbitModelView,
  panModelView,
  projectModelPoint,
  zoomModelView,
  type ModelViewCamera,
} from '../src/model-view.ts';
import { RoomStore, RoomStoreError, MAX_PROJECT_BYTES } from './room-store.ts';

type PageName = 'project' | 'request' | 'review' | 'history';
type RequestPane = 'canvas' | 'details';
type ModelView = 'plan' | '3d';
type ReviewState = 'pending' | 'accepted' | 'superseded' | 'declined';
type BoundSide = 'minX' | 'maxX' | 'minY' | 'maxY';
type GestureOperation = 'wall' | 'door-move' | 'door-width';

interface AuthModel { slug: string; displayName: string }
interface AuthAccount { email: string | null; name: string | null }
interface AuthSession {
  connected: boolean;
  sharing: boolean;
  account: AuthAccount | null;
  models: AuthModel[];
  selectedModel: string | null;
  revocationConfirmed: boolean | undefined;
  signInMode: 'local-browser' | 'remote-pairing';
}
interface ActiveReview {
  requestId: string;
  proposalName: string;
  baseRevisionId: string;
  proposalRevisionId: string | null;
  selectedObjectIds: readonly string[];
  instruction: string;
  summary: string;
  rationale: string;
  constraints: string;
  uncertainty: string;
  status?: 'ready' | 'declined';
  worker: { provider: string; model: string } | undefined;
  validator: string | undefined;
  decision?: { status: 'pending' | 'accepted' | 'superseded' };
}
interface PlanCamera { minX: number; maxX: number; minY: number; maxY: number; scale: number }
interface GestureState {
  id: number;
  root: SVGSVGElement;
  camera: PlanCamera;
  operation: GestureOperation;
  layout: RoomLayout;
  preview: ModelSnapshot;
  origin: Point;
  client: Point;
  moved: boolean;
  rejected: boolean;
}
interface CameraGesture {
  readonly id: number;
  readonly root: SVGSVGElement;
  readonly origin: Point;
  readonly camera: ModelViewCamera;
  readonly mode: 'orbit' | 'pan';
  readonly objectId: string | null;
  moved: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`The ChatGPT connection returned an invalid ${field}.`);
  return value;
}

function parseAuthSession(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.connected !== 'boolean' || typeof value.sharing !== 'boolean'
    || !Array.isArray(value.models) || (value.signInMode !== 'local-browser' && value.signInMode !== 'remote-pairing')) {
    throw new Error('The ChatGPT connection returned an invalid session.');
  }
  const models = value.models.map((model) => {
    if (!isRecord(model) || typeof model.slug !== 'string' || typeof model.displayName !== 'string') {
      throw new Error('The ChatGPT connection returned an invalid model list.');
    }
    return { slug: model.slug, displayName: model.displayName };
  });
  let account: AuthAccount | null = null;
  if (value.account !== null) {
    if (!isRecord(value.account)) throw new Error('The ChatGPT connection returned an invalid account.');
    account = { email: nullableText(value.account.email, 'account email'), name: nullableText(value.account.name, 'account name') };
  }
  if (value.revocationConfirmed !== undefined && typeof value.revocationConfirmed !== 'boolean') {
    throw new Error('The ChatGPT connection returned an invalid revocation status.');
  }
  return {
    connected: value.connected, sharing: value.sharing, account, models,
    selectedModel: nullableText(value.selectedModel, 'selected model'),
    revocationConfirmed: value.revocationConfirmed,
    signInMode: value.signInMode,
  };
}

interface HtmlConstructor<T extends HTMLElement> { new(): T }
function requiredElement<T extends HTMLElement>(id: string, constructor: HtmlConstructor<T>): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error(`Missing required interface element: ${id}`);
  return node;
}

const generic = (id: string): HTMLElement => requiredElement(id, HTMLElement);
const button = (id: string): HTMLButtonElement => requiredElement(id, HTMLButtonElement);
const input = (id: string): HTMLInputElement => requiredElement(id, HTMLInputElement);
const select = (id: string): HTMLSelectElement => requiredElement(id, HTMLSelectElement);
const dialog = (id: string): HTMLDialogElement => requiredElement(id, HTMLDialogElement);

const ui = {
  'project-form': requiredElement('project-form', HTMLFormElement),
  'project-name': input('project-name'),
  'create-project': button('create-project'),
  'load-sample': button('load-sample'),
  'proposal-form': requiredElement('proposal-form', HTMLFormElement),
  'door-width': input('door-width'),
  'proposal-name': input('proposal-name'),
  'request-text': requiredElement('request-text', HTMLTextAreaElement),
  'save-proposal': button('save-proposal'),
  'export-project': button('export-project'),
  'import-project': button('import-project'),
  'import-file': input('import-file'),
  status: generic('status'), error: generic('error'),
  'recover-save': button('recover-save'),
  'project-title': generic('project-title'), 'study-caption': generic('study-caption'),
  'project-overview': button('project-overview'), 'project-page': generic('project-page'), 'journey': generic('journey'),
  'open-room': button('open-room'), 'overview-revision': generic('overview-revision'),
  'overview-entity-count': generic('overview-entity-count'),
  'original-drawing': generic('original-drawing'), 'proposal-drawing': generic('proposal-drawing'),
  'selected-title': generic('selected-title'), 'selected-badge': generic('selected-badge'),
  'model-revision': generic('model-revision'), 'view-plan': button('view-plan'), 'view-3d': button('view-3d'),
  'model-3d-controls': generic('model-3d-controls'), 'reset-3d': button('reset-3d'), 'view-caption': generic('view-caption'),
  'change-count': generic('change-count'),
  'property-rows': requiredElement('property-rows', HTMLTableSectionElement),
  'comparison-note': generic('comparison-note'), 'history-list': generic('history-list'),
  'branch-count': generic('branch-count'),
  'conflict-left': select('conflict-left'), 'conflict-right': select('conflict-right'),
  'check-conflicts': button('check-conflicts'), 'conflict-result': generic('conflict-result'),
  'discard-preview': button('discard-preview'), 'editor-base': generic('editor-base'),
  'selected-object': select('selected-object'), 'door-offset': input('door-offset'),
  'wall-position': input('wall-position'), 'wall-length': input('wall-length'),
  'door-fields': generic('door-fields'), 'wall-fields': generic('wall-fields'),
  'wall-position-label': requiredElement('wall-position-label', HTMLLabelElement),
  'selection-help': generic('selection-help'), 'edit-feedback': generic('edit-feedback'),
  'review-panel': generic('review-panel'), 'review-status': generic('review-status'),
  'review-summary': generic('review-summary'), 'review-rationale': generic('review-rationale'),
  'review-uncertainty': generic('review-uncertainty'), 'review-constraints': generic('review-constraints'),
  'review-binding': generic('review-binding'), 'accept-proposal': button('accept-proposal'),
  'request-revision': button('request-revision'), 'review-drawing': generic('review-drawing'),
  'request-page': generic('request-page'), 'review-page': generic('review-page'), 'history-page': generic('history-page'),
  'nav-request': button('nav-request'), 'nav-review': button('nav-review'), 'nav-history': button('nav-history'),
  'view-original': button('view-original'), 'view-changes': button('view-changes'), 'new-project': button('new-project'),
  'start-dialog': dialog('start-dialog'), 'start-close': button('start-close'),
  'original-dialog': dialog('original-dialog'), 'changes-dialog': dialog('changes-dialog'),
  'working-dialog': dialog('working-dialog'), 'editor-panel': generic('editor-panel'),
  'request-canvas-tab': button('request-canvas-tab'), 'request-details-tab': button('request-details-tab'),
  'request-canvas-pane': generic('request-canvas-pane'), 'to-request-details': button('to-request-details'),
  'back-to-canvas': button('back-to-canvas'), 'auth-menu': button('auth-menu'),
  'proposal-auth-copy': generic('proposal-auth-copy'), 'proposal-auth-action': button('proposal-auth-action'),
  'auth-dialog': dialog('auth-dialog'), 'auth-close': button('auth-close'), 'auth-error': generic('auth-error'),
  'auth-disconnected': generic('auth-disconnected'), 'auth-connected': generic('auth-connected'),
  'auth-connect': button('auth-connect'), 'auth-account': generic('auth-account'),
  'auth-connect-heading': generic('auth-connect-heading'), 'auth-connect-copy': generic('auth-connect-copy'),
  'auth-pair-command': generic('auth-pair-command'),
  'auth-plan-status': generic('auth-plan-status'), 'auth-model': select('auth-model'),
  'auth-refresh-models': button('auth-refresh-models'), 'auth-signout': button('auth-signout'),
};

let store: RoomStore | null = null;
let repo: RoomRepository | null = null;
let generation = 0;
let savedText: string | null = null;
let recoveryText: string | null = null;
let selectedRevision = '';
let selectedBranch = 'main';
let busy = true;
let writesBlocked = false;
let layout: RoomLayout | null = null;
let preview: ModelSnapshot | null = null;
let selectedObject = 'door-entry';
let invalidInput = false;
let gesture: GestureState | null = null;
let activeReview: ActiveReview | null = null;
let currentPage: PageName = 'request';
let modelView: ModelView = 'plan';
let modelCamera: ModelViewCamera = DEFAULT_MODEL_VIEW_CAMERA;
let cameraGesture: CameraGesture | null = null;
let authBusy = false;
let authSession: AuthSession = {
  connected: false, sharing: false, account: null, models: [], selectedModel: null,
  revocationConfirmed: undefined, signInMode: 'local-browser',
};
const planCameras = new WeakMap<SVGSVGElement, PlanCamera>();
const encoder = new TextEncoder();
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const millimetres = (metres: number): string => number.format(Math.round(metres * 1000));

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(message: string): void { ui.status.textContent = message; }
function clearError() { ui.error.replaceChildren(); ui.error.hidden = true; }
function report(error: unknown, prefix = ''): void {
  ui.error.textContent = `${prefix}${error instanceof Error ? error.message : 'An unexpected error occurred.'}`;
  ui.error.hidden = false;
  if (error instanceof RoomStoreError && (error.code === 'stale' || error.code === 'corrupt')) writesBlocked = true;
  if (error instanceof RoomStoreError && typeof error.savedText === 'string') showRecovery(error.savedText);
  updateControls();
}

function showRecovery(text: string): void {
  recoveryText = text;
  ui['recover-save'].hidden = false;
}

function reviewState(review: ActiveReview | null): ReviewState | null {
  if (!review) return null;
  return review.decision?.status ?? (review.status === 'ready' ? 'pending' : review.status ?? null);
}

function showPage(name: PageName): void {
  if (name === 'review' && !activeReview) return;
  if ((name === 'project' || name === 'history') && !repo) return;
  currentPage = name;
  ui['project-page'].hidden = name !== 'project';
  ui.journey.hidden = name === 'project';
  const pages = [
    { name: 'request', page: ui['request-page'], navigation: ui['nav-request'] },
    { name: 'review', page: ui['review-page'], navigation: ui['nav-review'] },
    { name: 'history', page: ui['history-page'], navigation: ui['nav-history'] },
  ];
  for (const item of pages) {
    item.page.hidden = item.name !== name;
    item.navigation.setAttribute('aria-pressed', String(item.name === name));
  }
  requiredElement('workbench', HTMLElement).focus({ preventScroll: true });
}

function showRequestPane(name: RequestPane): void {
  const details = name === 'details';
  ui['request-page'].dataset.requestPane = details ? 'details' : 'canvas';
  ui['request-canvas-pane'].dataset.active = String(!details);
  ui['editor-panel'].dataset.active = String(details);
  ui['request-canvas-tab'].setAttribute('aria-pressed', String(!details));
  ui['request-details-tab'].setAttribute('aria-pressed', String(details));
}

function openDialog(target: HTMLDialogElement): void {
  if (!target.open) target.showModal();
}

function closeDialog(target: HTMLDialogElement): void {
  if (target.open) target.close();
}

function renderAuth() {
  const usable = authSession.connected && authSession.sharing && Boolean(authSession.selectedModel);
  const remotePairing = authSession.signInMode === 'remote-pairing';
  ui['auth-menu'].classList.toggle('connected', usable);
  const authMenuLabel = ui['auth-menu'].querySelector('span:last-child');
  if (!(authMenuLabel instanceof HTMLSpanElement)) throw new Error('Missing ChatGPT menu label.');
  authMenuLabel.textContent = usable ? 'ChatGPT connected' : authSession.connected ? 'Finish ChatGPT setup' : 'Connect ChatGPT';
  ui['proposal-auth-action'].textContent = usable ? 'Settings' : 'Connect';
  ui['proposal-auth-copy'].textContent = usable
    ? `Using ChatGPT plan · ${authSession.models.find((model) => model.slug === authSession.selectedModel)?.displayName ?? authSession.selectedModel}`
    : authSession.connected ? 'ChatGPT is connected, but plan usage needs attention' : 'Connect ChatGPT to prepare this proposal';
  const proposalConnection = ui['proposal-auth-action'].closest('.proposal-connection');
  if (!(proposalConnection instanceof HTMLElement)) throw new Error('Missing proposal connection panel.');
  proposalConnection.classList.toggle('connected', usable);
  ui['auth-disconnected'].hidden = authSession.connected;
  ui['auth-connected'].hidden = !authSession.connected;
  ui['auth-connect-heading'].textContent = remotePairing ? 'Pair this preview once' : 'Ready when you are';
  ui['auth-connect-copy'].textContent = remotePairing
    ? 'For your security, ChatGPT consent happens on a trusted computer. Run the pairing command there, then check this connection.'
    : 'BIM Forge will open ChatGPT in your browser so you can choose an account and allow plan usage.';
  ui['auth-pair-command'].hidden = !remotePairing;
  ui['auth-connect'].disabled = authBusy;
  ui['auth-connect'].textContent = authBusy ? (remotePairing ? 'Checking…' : 'Waiting for ChatGPT…')
    : remotePairing ? 'Check connection' : 'Continue with ChatGPT';
  ui['auth-refresh-models'].disabled = authBusy || !authSession.sharing;
  ui['auth-signout'].disabled = authBusy;
  ui['auth-model'].disabled = authBusy || !usable;
  if (authSession.account) {
    ui['auth-account'].textContent = authSession.account.email || authSession.account.name || 'Connected ChatGPT account';
    ui['auth-plan-status'].textContent = authSession.sharing
      ? `ChatGPT plan usage is enabled for this ${remotePairing ? 'preview server' : 'local app'}.`
      : 'This connection did not grant ChatGPT plan usage. Disconnect and reconnect to review consent.';
  }
  const selected = authSession.selectedModel;
  ui['auth-model'].replaceChildren(...authSession.models.map((model) => {
    const option = document.createElement('option'); option.value = model.slug; option.textContent = model.displayName;
    option.selected = model.slug === selected; return option;
  }));
  if (!authSession.models.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = authSession.sharing ? 'Refresh models to continue' : 'Plan usage is not enabled';
    ui['auth-model'].append(option);
  }
}

async function authRequest(target: string, options: RequestInit = {}): Promise<AuthSession> {
  const response = await fetch(target, options);
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('The ChatGPT connection service returned unreadable data.'); }
  if (!response.ok) {
    const message = isRecord(value) && typeof value.error === 'string' ? value.error : `The ChatGPT connection failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return parseAuthSession(value);
}

async function runAuth(action: () => Promise<AuthSession>, progress: string): Promise<boolean> {
  authBusy = true;
  ui['auth-error'].hidden = true;
  renderAuth(); updateControls(); status(progress);
  try {
    authSession = await action();
    renderAuth(); updateControls();
    if (authSession.connected && authSession.sharing && authSession.selectedModel) {
      status('ChatGPT plan connected. AI proposals are ready.');
    } else if (!authSession.connected) {
      status('ChatGPT disconnected from this local installation.');
      if (authSession.revocationConfirmed === false) {
        ui['auth-error'].textContent = 'Local credentials were cleared, but remote revocation could not be confirmed. Remove BIM Forge from ChatGPT Settings if it still appears there.';
        ui['auth-error'].hidden = false;
      }
    } else {
      status('ChatGPT connection needs attention before AI proposals can run.');
    }
    return true;
  } catch (error) {
    ui['auth-error'].textContent = error instanceof Error ? error.message : 'ChatGPT connection failed.';
    ui['auth-error'].hidden = false;
    return false;
  } finally { authBusy = false; renderAuth(); updateControls(); }
}

function updateControls() {
  const writable = Boolean(store) && !busy && !writesBlocked && !gesture;
  const modelReady = authSession.connected && authSession.sharing && Boolean(authSession.selectedModel);
  const projectControls: Array<HTMLInputElement | HTMLButtonElement> = [ui['project-name'], ui['create-project'], ui['load-sample'], ui['import-project']];
  for (const control of projectControls) control.disabled = !writable;
  const geometryControls = [ui['door-width'], ui['door-offset'], ui['wall-position'], ui['wall-length']];
  for (const control of geometryControls) control.disabled = !writable || !layout || Boolean(gesture);
  ui['selected-object'].disabled = busy || !preview || Boolean(gesture);
  ui['proposal-name'].disabled = !writable || !layout || Boolean(gesture);
  ui['request-text'].disabled = !writable || !layout || Boolean(gesture);
  ui['save-proposal'].disabled = !writable || !layout || invalidInput || Boolean(gesture) || !modelReady;
  ui['save-proposal'].textContent = modelReady ? 'Prepare proposal →' : 'Connect ChatGPT first';
  ui['auth-menu'].disabled = authBusy;
  ui['proposal-auth-action'].disabled = authBusy;
  ui['discard-preview'].disabled = busy || !repo || !dirty() || Boolean(gesture);
  ui['export-project'].disabled = busy || !repo || savedText === null;
  ui['new-project'].disabled = !store || busy || writesBlocked;
  ui['project-overview'].disabled = busy || !repo;
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
  const state = reviewState(activeReview);
  ui['request-revision'].disabled = !writable || !reviewMatches || (state !== 'pending' && state !== 'declined');
  ui['project-form'].setAttribute('aria-busy', String(busy));
  ui['proposal-form'].setAttribute('aria-busy', String(busy));
  for (const historyButton of ui['history-list'].querySelectorAll('button')) historyButton.disabled = busy || Boolean(gesture);
}

function dirty(): boolean {
  return invalidInput || Boolean(repo && preview && JSON.stringify(preview) !== JSON.stringify(repo.view(selectedRevision).snapshot));
}

function feedback(message: string, invalid = false): void {
  ui['edit-feedback'].textContent = message;
  ui['edit-feedback'].dataset.invalid = String(invalid);
}

function resetEditor() {
  invalidInput = false; layout = null; preview = null;
  if (!repo) return;
  preview = repo.view(selectedRevision).snapshot;
  try { layout = rectangleLayout(preview); feedback('Select an object and sketch the intent. The sketch is not authoritative model geometry.'); }
  catch (error) { feedback(`This saved layout is view-only: ${error instanceof Error ? error.message : 'unsupported geometry'}`, true); }
  const objects = preview.entities;
  ui['selected-object'].replaceChildren(...objects.map((object) => {
    const option = element('option', object.name); option.value = object.id; return option;
  }));
  if (!objects.some((object) => object.id === selectedObject)) selectedObject = objects[0]?.id ?? '';
  syncInspector();
}

function wallSide(wall: Wall, current: RoomLayout | null = layout): BoundSide {
  if (!current) throw new Error('The selected room has no editable rectangular layout.');
  const b = current.boundsMm;
  if (wall.start[0] === wall.end[0]) return Math.round(wall.start[0] * 1000) === b.minX ? 'minX' : 'maxX';
  return Math.round(wall.start[1] * 1000) === b.minY ? 'minY' : 'maxY';
}

function syncInspector() {
  ui['selected-object'].value = selectedObject;
  const dimensionInputs = [ui['door-width'], ui['door-offset'], ui['wall-position'], ui['wall-length']];
  for (const dimensionInput of dimensionInputs) dimensionInput.removeAttribute('aria-invalid');
  const object = preview?.entities.find((item) => item.id === selectedObject);
  const isDoor = object?.type === 'Door';
  const isWall = object?.type === 'Wall';
  ui['door-fields'].hidden = !isDoor;
  ui['wall-fields'].hidden = !isWall;
  ui['editor-base'].textContent = `Request bound to ${selectedBranch} · ${selectedRevision.slice(0, 10)}. The original is preserved in history. Unsaved request sketches are lost on reload.`;
  if (!layout || !preview || !object || (!isDoor && !isWall)) {
    for (const dimensionInput of dimensionInputs) dimensionInput.value = '';
    ui['selection-help'].textContent = 'This saved revision is view-only. Its geometry and changed properties remain available below.';
    return;
  }
  if (isDoor) {
    ui['door-width'].value = String(layout.door.widthMm);
    ui['door-offset'].value = String(layout.door.offsetMm);
    const host = hostFor(preview, object);
    if (!host) throw new Error('The selected door is missing its host wall.');
    ui['selection-help'].textContent = `Drag the round handle to slide along ${host.wall.name}; drag the square handle to resize. Offset is measured from the arrow at the wall start. Height and host stay unchanged.`;
  } else {
    const side = wallSide(object);
    ui['wall-position'].value = String(layout.boundsMm[side]);
    ui['wall-length'].value = String(side.endsWith('X') ? layout.boundsMm.maxY - layout.boundsMm.minY : layout.boundsMm.maxX - layout.boundsMm.minX);
    ui['wall-position-label'].textContent = `Wall ${side.endsWith('X') ? 'X' : 'Y'} position (mm)`;
    ui['selection-help'].textContent = 'Drag the round handle to move this wall. Connected corners follow. Length expands towards increasing coordinates, anchored at the minimum coordinate. Door offsets stay relative to their host start.';
  }
}

function chooseObject(id: string): void {
  if (!repo || busy || gesture) return;
  if (invalidInput && !window.confirm('Discard the incomplete or invalid input and select another object?')) return;
  invalidInput = false; clearError(); selectedObject = id; syncInspector(); renderComparison(); updateControls();
}

ui['selected-object'].addEventListener('change', () => {
  const id = ui['selected-object'].value;
  chooseObject(id); ui['selected-object'].value = selectedObject;
});

function acceptLayout(candidate: RoomLayout): void {
  if (!repo) throw new Error('Create a project before editing a request sketch.');
  const next = previewRectangle(repo.view(selectedRevision).snapshot, candidate);
  layout = rectangleLayout(next); preview = next; invalidInput = false;
  feedback(dirty() ? 'Visual request sketch updated. AI must still prepare and validate a separate proposal.' : 'The request sketch matches the selected revision. Describe any additional intent in words.');
  renderComparison(); updateControls();
}

function editFields(event: Event): void {
  if (!repo || busy || writesBlocked || !layout || !preview || gesture) return;
  const object = preview.entities.find((item) => item.id === selectedObject);
  if (!object || (object.type !== 'Door' && object.type !== 'Wall')) return;
  const fields = object.type === 'Door' ? [ui['door-width'], ui['door-offset']] : [ui['wall-position'], ui['wall-length']];
  try {
    const values = fields.map((field) => field.valueAsNumber);
    if (values.some((value) => !Number.isSafeInteger(value))) throw new Error('Enter complete, whole millimetres in both fields.');
    const next = structuredClone(layout);
    if (object.type === 'Door') [next.door.widthMm, next.door.offsetMm] = values;
    else {
      const side = wallSide(object); next.boundsMm[side] = values[0];
      if (side.endsWith('X')) next.boundsMm.maxY = next.boundsMm.minY + values[1];
      else next.boundsMm.maxX = next.boundsMm.minX + values[1];
    }
    acceptLayout(next);
    for (const field of fields) field.removeAttribute('aria-invalid');
  } catch (error) {
    invalidInput = true;
    if (event.target instanceof HTMLInputElement) event.target.setAttribute('aria-invalid', 'true');
    feedback(`${error instanceof Error ? error.message : 'The edit is invalid.'} Last valid geometry is still shown; fix the input or discard.`, true); updateControls();
  }
}
for (const field of [ui['door-width'], ui['door-offset'], ui['wall-position'], ui['wall-length']]) field.addEventListener('input', editFields);
ui['discard-preview'].addEventListener('click', () => {
  if (busy || gesture || !repo) return;
  resetEditor(); renderComparison(); updateControls(); status('Visual request sketch discarded. Saved model history is unchanged.');
});
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });

async function perform(action: () => void | Promise<void>): Promise<void> {
  if (busy || gesture) return;
  busy = true;
  clearError();
  updateControls();
  try { await action(); }
  catch (error) { status('Action did not complete. The displayed project has not been replaced.'); report(error); }
  finally { closeDialog(ui['working-dialog']); busy = false; updateControls(); }
}

function writableStore(): RoomStore {
  if (!store || writesBlocked) throw new Error('Saving is blocked. Download any recovery data or export your current project, then reload.');
  return store;
}

// This is the only publication path for a new repository. Never assign repo before saveCAS resolves.
async function persist(next: RoomRepository, branch = 'main'): Promise<void> {
  const database = writableStore();
  const text = next.serialize();
  const nextGeneration = await database.saveCAS(text, generation);
  generation = nextGeneration;
  savedText = text;
  repo = next;
  selectedBranch = branch;
  selectedRevision = repo.head(branch);
  resetEditor();
  render();
}

function confirmReplacement(): boolean {
  return !repo || window.confirm('Replace the locally saved project and discard any unsaved request sketch? Export saved work first if you want to keep it.');
}

async function createProject(name: string): Promise<void> {
  writableStore();
  if (!confirmReplacement()) { status('Project creation cancelled. Your current project is unchanged.'); return; }
  status('Creating and saving your original room…');
  const next = await RoomRepository.create(name);
  activeReview = null;
  await persist(next);
  ui['project-name'].value = next.name;
  closeDialog(ui['start-dialog']);
  showRequestPane('canvas');
  showPage('project');
  status('Original room saved locally. Select a wall or door and describe a request to begin.');
}

async function createHousePilot(): Promise<void> {
  writableStore();
  if (!confirmReplacement()) { status('House Pilot opening cancelled. Your current project is unchanged.'); return; }
  status('Opening the House Pilot project…');
  const fixture = await createHousePilotFixture();
  activeReview = null;
  await persist(fixture.repository);
  ui['project-name'].value = fixture.repository.name;
  closeDialog(ui['start-dialog']);
  showRequestPane('canvas');
  showPage('project');
  status('House Pilot opened. Choose the reference room to explore the synchronized model.');
}

ui['project-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(() => createProject(ui['project-name'].value.trim()));
});

ui['load-sample'].addEventListener('click', () => { void perform(createHousePilot); });

ui['new-project'].addEventListener('click', () => {
  ui['start-close'].hidden = !repo;
  openDialog(ui['start-dialog']);
});
ui['start-close'].addEventListener('click', () => closeDialog(ui['start-dialog']));
ui['view-original'].addEventListener('click', () => openDialog(ui['original-dialog']));
ui['view-changes'].addEventListener('click', () => openDialog(ui['changes-dialog']));
ui['project-overview'].addEventListener('click', () => showPage('project'));
ui['open-room'].addEventListener('click', () => {
  showPage('request');
  status(`Reference room opened at revision ${selectedRevision.slice(0, 10)}. Plan and 3D share the same selection.`);
});
ui['nav-request'].addEventListener('click', () => showPage('request'));
ui['nav-review'].addEventListener('click', () => showPage('review'));
ui['nav-history'].addEventListener('click', () => showPage('history'));
function switchModelView(next: ModelView): void {
  if (!repo || modelView === next) return;
  if (gesture) endGesture(true);
  cameraGesture = null;
  modelView = next;
  renderComparison();
  status(`${next === 'plan' ? 'Plan' : '3D'} view opened at revision ${selectedRevision.slice(0, 10)}. Selection remains ${selectedObject}.`);
}
ui['view-plan'].addEventListener('click', () => switchModelView('plan'));
ui['view-3d'].addEventListener('click', () => switchModelView('3d'));
ui['reset-3d'].addEventListener('click', () => {
  modelCamera = DEFAULT_MODEL_VIEW_CAMERA;
  if (repo) renderComparison();
  status('3D camera reset. Model geometry and revision are unchanged.');
});
ui['request-canvas-tab'].addEventListener('click', () => showRequestPane('canvas'));
ui['request-details-tab'].addEventListener('click', () => showRequestPane('details'));
ui['to-request-details'].addEventListener('click', () => {
  showRequestPane('details');
  ui['selected-object'].focus();
});
ui['back-to-canvas'].addEventListener('click', () => showRequestPane('canvas'));
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => {
    if (!(button instanceof HTMLElement) || !button.dataset.close) return;
    closeDialog(requiredElement(button.dataset.close, HTMLDialogElement));
  });
}
ui['start-dialog'].addEventListener('cancel', (event) => {
  if (!repo) event.preventDefault();
});

for (const authButton of [ui['auth-menu'], ui['proposal-auth-action']]) authButton.addEventListener('click', () => openDialog(ui['auth-dialog']));
ui['auth-close'].addEventListener('click', () => closeDialog(ui['auth-dialog']));
ui['auth-connect'].addEventListener('click', () => {
  if (authSession.signInMode === 'remote-pairing') {
    void runAuth(() => authRequest('/api/auth/session'), 'Checking the preview server connection…');
  } else {
    void runAuth(() => authRequest('/api/auth/start', { method: 'POST' }), 'Finish connecting ChatGPT in the browser window that just opened.');
  }
});
ui['auth-refresh-models'].addEventListener('click', () => {
  void runAuth(() => authRequest('/api/auth/models', { method: 'POST' }), 'Refreshing models available to this ChatGPT account…');
});
ui['auth-model'].addEventListener('change', () => {
  const model = ui['auth-model'].value;
  if (!model) return;
  void runAuth(() => authRequest('/api/auth/model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
  }), 'Selecting the model for future proposals…');
});
ui['auth-signout'].addEventListener('click', () => {
  void runAuth(() => authRequest('/api/auth/signout', { method: 'POST' }), 'Disconnecting ChatGPT from this local installation…');
});

interface ProposalResponse {
  status: 'ready' | 'declined';
  project: string;
  review: ActiveReview;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw new Error(`The proposal service returned an invalid ${field}.`);
  return value;
}

function parseProposalResponse(value: unknown): ProposalResponse {
  if (!isRecord(value) || (value.status !== 'ready' && value.status !== 'declined')
    || typeof value.project !== 'string' || !isRecord(value.review)) {
    throw new Error('The proposal service returned an unsupported result.');
  }
  const reviewValue = value.review;
  const proposalRevisionId = reviewValue.proposalRevisionId;
  if (proposalRevisionId !== null && typeof proposalRevisionId !== 'string') {
    throw new Error('The proposal service returned an invalid proposal revision.');
  }
  if (!Array.isArray(reviewValue.selectedObjectIds)
    || !reviewValue.selectedObjectIds.every((id) => typeof id === 'string')) {
    throw new Error('The proposal service returned invalid selected objects.');
  }
  let worker: ActiveReview['worker'];
  if (reviewValue.worker !== undefined) {
    if (!isRecord(reviewValue.worker) || typeof reviewValue.worker.provider !== 'string' || typeof reviewValue.worker.model !== 'string') {
      throw new Error('The proposal service returned invalid worker evidence.');
    }
    worker = { provider: reviewValue.worker.provider, model: reviewValue.worker.model };
  }
  return {
    status: value.status,
    project: value.project,
    review: {
      requestId: requiredText(reviewValue, 'requestId'),
      proposalName: requiredText(reviewValue, 'proposalName'),
      baseRevisionId: requiredText(reviewValue, 'baseRevisionId'),
      proposalRevisionId,
      selectedObjectIds: reviewValue.selectedObjectIds,
      instruction: requiredText(reviewValue, 'instruction'),
      summary: requiredText(reviewValue, 'summary'),
      rationale: requiredText(reviewValue, 'rationale'),
      constraints: requiredText(reviewValue, 'constraints'),
      uncertainty: requiredText(reviewValue, 'uncertainty'),
      status: value.status,
      worker,
      validator: typeof reviewValue.validator === 'string' ? reviewValue.validator : undefined,
    },
  };
}

ui['proposal-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(async () => {
    writableStore();
    if (!repo) throw new Error('Create a project first.');
    if (!authSession.connected || !authSession.sharing || !authSession.selectedModel) throw new Error('Connect a ChatGPT plan and choose a model first.');
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
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error('The proposal service returned unreadable data.'); }
    if (!response.ok) {
      const message = isRecord(value) && typeof value.error === 'string' ? value.error : `The proposal service failed with HTTP ${response.status}.`;
      throw new Error(message);
    }
    const result = parseProposalResponse(value);
    const review = result.review;
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
    if (!repo || !activeReview || activeReview.proposalRevisionId !== selectedRevision || selectedBranch === 'main') {
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
  showRequestPane('details');
  showPage('request');
  ui['proposal-name'].focus();
  status('Revision request started from the selected proposal. Choose a new proposal name; the earlier proposal remains unchanged.');
});

function download(text: string, filename: string): void {
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
    ui['project-name'].value = next.name;
    activeReview = next.reviews().find((review) => review.proposalRevisionId === selectedRevision) ?? null;
    renderReview();
    closeDialog(ui['start-dialog']);
    showPage('project');
    status('Imported project validated and saved locally. Its original room is preserved.');
  });
});

function isWall(entity: Entity): entity is Wall { return entity.type === 'Wall'; }
function isDoor(entity: Entity): entity is Door { return entity.type === 'Door'; }
function isWindow(entity: Entity): entity is Window { return entity.type === 'Window'; }
function isEquipment(entity: Entity): entity is Equipment { return entity.type === 'Equipment'; }
function entry(snapshot: ModelSnapshot): Door | undefined {
  return snapshot.entities.find((entity): entity is Door => entity.type === 'Door' && entity.id === 'door-entry');
}
function hostFor(snapshot: ModelSnapshot, opening: Door | Window | undefined): { link: HostingRelationship; wall: Wall } | null {
  if (!opening) return null;
  const link = snapshot.relationships.find((relation): relation is HostingRelationship => relation.type === 'hosted-by' && relation.source === opening.id);
  const wall = link && snapshot.entities.find((entity): entity is Wall => entity.id === link.target && entity.type === 'Wall');
  return wall ? { link, wall } : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
type SvgAttributes = Record<string, string | number>;
function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: SvgAttributes = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawPlan(snapshot: ModelSnapshot, reference: ModelSnapshot | null, identifier: string, label: string): SVGSVGElement {
  const interactive = identifier === 'selected';
  const editable = interactive && Boolean(layout);
  const svg = svgNode('svg', { viewBox: '0 0 600 400', role: interactive ? 'group' : 'img', 'aria-labelledby': `${identifier}-title ${identifier}-desc` });
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

  const walls = snapshot.entities.filter(isWall);
  const allWalls = [...walls, ...(reference ? reference.entities.filter(isWall) : [])];
  const coordinates = allWalls.flatMap((wall) => [wall.start, wall.end]);
  if (!coordinates.length) return svg;
  const camera = editable && gesture ? gesture.camera : {
    minX: Math.min(...coordinates.map(([x]) => x)), maxX: Math.max(...coordinates.map(([x]) => x)),
    minY: Math.min(...coordinates.map(([, y]) => y)), maxY: Math.max(...coordinates.map(([, y]) => y)),
  };
  const { minX, maxX, minY, maxY } = camera;
  const scale = Math.min((editable ? 350 : 430) / Math.max(maxX - minX, 1), (editable ? 190 : 245) / Math.max(maxY - minY, 1));
  planCameras.set(svg, { ...camera, scale });
  const transform = ([x, y]: Point): Point => [300 + (x - (minX + maxX) / 2) * scale, 193 - (y - (minY + maxY) / 2) * scale];
  const points = (items: Point[]): string => items.map((point) => transform(point).join(',')).join(' ');
  const line = (start: Point, end: Point, attributes: SvgAttributes = {}): SVGLineElement => {
    const [x1, y1] = transform(start); const [x2, y2] = transform(end);
    return svgNode('line', { x1, y1, x2, y2, ...attributes });
  };

  for (const wall of walls) {
    const dx = wall.end[0] - wall.start[0]; const dy = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dy);
    const px = -dy / length * wall.thickness / 2; const py = dx / length * wall.thickness / 2;
    const outline: Point[] = [[wall.start[0] + px, wall.start[1] + py], [wall.end[0] + px, wall.end[1] + py],
      [wall.end[0] - px, wall.end[1] - py], [wall.start[0] - px, wall.start[1] - py]];
    svg.append(svgNode('polygon', { points: points(outline), fill: reference ? '#e2ede8' : '#e5eae8', stroke: reference ? '#4f7e72' : '#516873', 'stroke-width': 1.2 }));
  }
  if (reference) for (const wall of reference.entities.filter(isWall)) {
    svg.append(line(wall.start, wall.end, { stroke: '#87979b', 'stroke-width': 1.3, 'stroke-dasharray': '5 4', class: 'selection-outline' }));
  }

  function drawDoors(room: ModelSnapshot, ghost = false): void {
    for (const item of room.entities.filter(isDoor)) {
      const host = hostFor(room, item);
      if (!host) continue;
      const { wall, link } = host;
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      const ux = (wall.end[0] - wall.start[0]) / length; const uy = (wall.end[1] - wall.start[1]) / length;
      const hinge: Point = [wall.start[0] + ux * link.offset, wall.start[1] + uy * link.offset];
      const jamb: Point = [hinge[0] + ux * item.width, hinge[1] + uy * item.width];
      const leaf: Point = [hinge[0] - uy * item.width, hinge[1] + ux * item.width];
      const color = ghost ? '#87979b' : reference ? '#167d78' : '#516873';
      const style = { stroke: color, 'stroke-width': ghost ? 1.3 : 1.8, ...(ghost ? { 'stroke-dasharray': '5 4' } : {}) };
      if (!ghost) {
        svg.append(line(hinge, jamb, { stroke: '#fff', 'stroke-width': wall.thickness * scale + 2 }));
        const hingeEdge: Point = [hinge[0] - uy * wall.thickness / 2, hinge[1] + ux * wall.thickness / 2];
        const jambEdge: Point = [jamb[0] - uy * wall.thickness / 2, jamb[1] + ux * wall.thickness / 2];
        svg.append(line(hinge, hingeEdge, style));
        svg.append(line(jamb, jambEdge, style));
      }
      svg.append(line(hinge, leaf, style));
      const arc: Point[] = Array.from({ length: 25 }, (_, index): Point => {
        const angle = index * Math.PI / 48;
        return [hinge[0] + item.width * (ux * Math.cos(angle) - uy * Math.sin(angle)),
          hinge[1] + item.width * (uy * Math.cos(angle) + ux * Math.sin(angle))];
      });
      svg.append(svgNode('polyline', { points: points(arc), fill: 'none', ...style }));
      if (!ghost && item.id === 'door-entry') {
        const offset = .58;
        const a: Point = [hinge[0] + uy * offset, hinge[1] - ux * offset];
        const b: Point = [jamb[0] + uy * offset, jamb[1] - ux * offset];
        svg.append(line(a, b, { stroke: color, 'stroke-width': .9 }));
        for (const point of [a, b]) {
          const tickStart: Point = [point[0] - uy * .07, point[1] + ux * .07];
          const tickEnd: Point = [point[0] + uy * .07, point[1] - ux * .07];
          svg.append(line(tickStart, tickEnd, { stroke: color, 'stroke-width': 1 }));
        }
        const [tx, ty] = transform([(a[0] + b[0]) / 2 + uy * .18, (a[1] + b[1]) / 2 - ux * .18]);
        svg.append(svgNode('text', { x: tx, y: ty, fill: color, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 11, 'font-weight': 600, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 4 }, `${millimetres(item.width)} mm`));
      }
    }
  }
  drawDoors(snapshot);
  if (reference) drawDoors(reference, true);

  for (const opening of snapshot.entities.filter(isWindow)) {
    const host = hostFor(snapshot, opening);
    if (!host) continue;
    const dx = host.wall.end[0] - host.wall.start[0]; const dy = host.wall.end[1] - host.wall.start[1];
    const length = Math.hypot(dx, dy); const ux = dx / length; const uy = dy / length;
    const start: Point = [host.wall.start[0] + ux * host.link.offset, host.wall.start[1] + uy * host.link.offset];
    const end: Point = [start[0] + ux * opening.width, start[1] + uy * opening.width];
    svg.append(line(start, end, {
      stroke: opening.id === selectedObject ? '#e1a12e' : '#318aa0', 'stroke-width': Math.max(5, host.wall.thickness * scale),
      class: interactive ? 'edit-target' : '', 'data-object': opening.id, role: interactive ? 'button' : 'img', tabindex: interactive ? 0 : -1,
      'aria-label': `Select ${opening.name}`, 'aria-pressed': String(opening.id === selectedObject),
    }));
  }
  for (const equipment of snapshot.entities.filter(isEquipment)) {
    const [x, y] = transform(equipment.position);
    const selected = equipment.id === selectedObject;
    svg.append(svgNode('rect', {
      x: x - equipment.width * scale / 2, y: y - equipment.depth * scale / 2,
      width: equipment.width * scale, height: Math.max(equipment.depth * scale, 8), rx: 3,
      fill: equipment.category === 'electrical' ? '#d6a44b' : '#69a99b', stroke: selected ? '#e1a12e' : '#365f5a',
      'stroke-width': selected ? 4 : 1.2, class: interactive ? 'edit-target' : '', 'data-object': equipment.id,
      role: interactive ? 'button' : 'img', tabindex: interactive ? 0 : -1, 'aria-label': `Select ${equipment.name}`,
      'aria-pressed': String(selected),
    }));
  }

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
  if (interactive) {
    const cssScale = 600 / Math.max(ui['proposal-drawing'].clientWidth, 200);
    const targetWidth = 44 * cssScale;
    for (const wall of walls) {
      if (wall.id === selectedObject) svg.append(line(wall.start, wall.end, { stroke: '#e1a12e', 'stroke-width': 5, class: 'selection-outline' }));
      svg.append(line(wall.start, wall.end, { stroke: 'transparent', 'stroke-width': targetWidth, class: 'edit-target',
        'data-object': wall.id, role: 'button', tabindex: 0, 'aria-label': `Select ${wall.name}`, 'aria-pressed': String(wall.id === selectedObject) }));
    }
    const doorHost = hostFor(snapshot, door);
    if (!door || !doorHost) return svg;
    const { wall, link } = doorHost;
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const unit: Point = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
    const hinge: Point = [wall.start[0] + unit[0] * link.offset, wall.start[1] + unit[1] * link.offset];
    const jamb: Point = [hinge[0] + unit[0] * door.width, hinge[1] + unit[1] * door.width];
    const centre: Point = [hinge[0] + unit[0] * door.width / 2, hinge[1] + unit[1] * door.width / 2];
    svg.append(line(hinge, jamb, { stroke: selectedObject === door.id ? '#e1a12e' : 'transparent', 'stroke-opacity': .25, 'stroke-width': targetWidth,
      class: 'edit-target', 'data-object': door.id, role: 'button', tabindex: 0, 'aria-label': 'Select Entry door', 'aria-pressed': String(selectedObject === door.id) }));
    if (!editable) return svg;
    const selected = snapshot.entities.find((item) => item.id === selectedObject);
    const handle = (location: Point, operation: GestureOperation, caption: string, square = false): void => {
      const [x, y] = transform(location);
      const group = svgNode('g', { class: 'edit-handle', 'data-handle': operation, 'data-object': selectedObject, 'aria-label': caption, role: 'button', tabindex: 0 });
      group.append(svgNode('circle', { cx: x, cy: y, r: targetWidth / 2, fill: '#167d78', 'fill-opacity': .06 }));
      group.append(square ? svgNode('rect', { x: x - 6, y: y - 6, width: 12, height: 12, rx: 2, fill: '#167d78', stroke: 'white', 'stroke-width': 2 })
        : svgNode('circle', { cx: x, cy: y, r: 7, fill: '#167d78', stroke: 'white', 'stroke-width': 2 }));
      svg.append(group);
    };
    if (!selected) return svg;
    if (selected.type === 'Wall') {
      const midpoint: Point = [(selected.start[0] + selected.end[0]) / 2, (selected.start[1] + selected.end[1]) / 2];
      handle(midpoint, 'wall', `Move ${selected.name}`);
    }
    else if (selected.type === 'Door') {
      const arrowPoint: Point = [wall.start[0] + unit[0] * .5, wall.start[1] + unit[1] * .5];
      const origin = transform(wall.start); const arrow = transform(arrowPoint);
      svg.append(svgNode('line', { x1: origin[0], y1: origin[1], x2: arrow[0], y2: arrow[1], stroke: '#c27d1a', 'stroke-width': 3 }));
      const tangent: Point = [unit[0], -unit[1]];
      const head: Point[] = [[arrow[0], arrow[1]], [arrow[0] - tangent[0] * 8 - tangent[1] * 4, arrow[1] - tangent[1] * 8 + tangent[0] * 4],
        [arrow[0] - tangent[0] * 8 + tangent[1] * 4, arrow[1] - tangent[1] * 8 - tangent[0] * 4]];
      svg.append(svgNode('polygon', { points: head.map((p) => p.join(',')).join(' '), fill: '#c27d1a' }));
      svg.append(svgNode('text', { x: origin[0], y: origin[1] + 25, fill: '#986312', 'font-size': 10 }, 'HOST START'));
      // Separate move and resize targets from the opening so small doors remain usable on phones.
      const normal: Point = [-unit[1], unit[0]];
      const moveHandle: Point = [centre[0] + normal[0] * 36 * cssScale / scale, centre[1] + normal[1] * 36 * cssScale / scale];
      const widthHandle: Point = [jamb[0] - normal[0] * 36 * cssScale / scale, jamb[1] - normal[1] * 36 * cssScale / scale];
      handle(moveHandle, 'door-move', 'Move Entry door');
      handle(widthHandle, 'door-width', 'Resize Entry door', true);
    }
  }
  return svg;
}

type ModelPoint = readonly [number, number, number];
interface ModelFace {
  readonly points: readonly ModelPoint[];
  readonly fill: string;
  readonly stroke: string;
  readonly object: Entity | undefined;
}

function boxFaces(equipment: Equipment): ModelFace[] {
  const halfWidth = equipment.width / 2; const halfDepth = equipment.depth / 2;
  const x0 = equipment.position[0] - halfWidth; const x1 = equipment.position[0] + halfWidth;
  const y0 = equipment.position[1] - halfDepth; const y1 = equipment.position[1] + halfDepth;
  const z0 = equipment.elevation; const z1 = equipment.elevation + equipment.height;
  const fill = equipment.category === 'electrical' ? '#c99438' : '#4f9789';
  return [
    { points: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], fill, stroke: '#274f4c', object: equipment },
    { points: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], fill, stroke: '#274f4c', object: equipment },
    { points: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], fill, stroke: '#274f4c', object: equipment },
  ];
}

function openingFace(snapshot: ModelSnapshot, opening: Door | Window): ModelFace | null {
  const host = hostFor(snapshot, opening);
  if (!host) return null;
  const dx = host.wall.end[0] - host.wall.start[0]; const dy = host.wall.end[1] - host.wall.start[1];
  const length = Math.hypot(dx, dy); const ux = dx / length; const uy = dy / length;
  const normal: Point = [-uy * 0.006, ux * 0.006];
  const start: Point = [host.wall.start[0] + ux * host.link.offset + normal[0], host.wall.start[1] + uy * host.link.offset + normal[1]];
  const end: Point = [start[0] + ux * opening.width, start[1] + uy * opening.width];
  const sill = opening.type === 'Window' ? opening.sillHeight : 0;
  return {
    points: [[start[0], start[1], sill], [end[0], end[1], sill], [end[0], end[1], sill + opening.height], [start[0], start[1], sill + opening.height]],
    fill: opening.type === 'Window' ? '#9bcbd6dd' : '#d9c7a9', stroke: opening.type === 'Window' ? '#246b7c' : '#6f5b42', object: opening,
  };
}

function drawModel3d(snapshot: ModelSnapshot, label: string): SVGSVGElement {
  const svg = svgNode('svg', { viewBox: '0 0 800 500', role: 'group', 'aria-labelledby': 'model-3d-title model-3d-desc' });
  svg.append(svgNode('title', { id: 'model-3d-title' }, label));
  svg.append(svgNode('desc', { id: 'model-3d-desc' }, 'Navigable three-dimensional room model. Drag to orbit, Shift-drag to pan, scroll to zoom, and select any visible model object.'));
  const centre: Point = [400, 290];
  const walls = snapshot.entities.filter(isWall);
  const coordinates = walls.flatMap((wall) => [wall.start, wall.end]);
  if (!coordinates.length) return svg;
  const minX = Math.min(...coordinates.map(([x]) => x)); const maxX = Math.max(...coordinates.map(([x]) => x));
  const minY = Math.min(...coordinates.map(([, y]) => y)); const maxY = Math.max(...coordinates.map(([, y]) => y));
  const faces: ModelFace[] = [{
    points: [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0]],
    fill: '#e9efeb', stroke: '#91a69f', object: undefined,
  }];
  for (const wall of walls) faces.push({
    points: [[wall.start[0], wall.start[1], 0], [wall.end[0], wall.end[1], 0],
      [wall.end[0], wall.end[1], wall.height], [wall.start[0], wall.start[1], wall.height]],
    fill: '#cedbd6e8', stroke: '#4b6868', object: wall,
  });
  for (const opening of snapshot.entities.filter((entity): entity is Door | Window => entity.type === 'Door' || entity.type === 'Window')) {
    const face = openingFace(snapshot, opening); if (face) faces.push(face);
  }
  for (const equipment of snapshot.entities.filter(isEquipment)) faces.push(...boxFaces(equipment));

  const projected = faces.map((face) => ({
    face,
    points: face.points.map((point) => projectModelPoint(point, modelCamera, centre)),
  })).sort((left, right) => {
    const average = (values: readonly { depth: number }[]): number => values.reduce((sum, point) => sum + point.depth, 0) / values.length;
    return average(left.points) - average(right.points);
  });
  for (const item of projected) {
    const object = item.face.object; const selected = object?.id === selectedObject;
    svg.append(svgNode('polygon', {
      points: item.points.map((point) => `${point.x},${point.y}`).join(' '), fill: item.face.fill, stroke: item.face.stroke,
      'stroke-width': selected ? 4 : 1.4, class: object ? 'model-object' : '', 'data-selected': String(Boolean(selected)),
      ...(object ? { 'data-object': object.id, role: 'button', tabindex: 0, 'aria-label': `Select ${object.name}`, 'aria-pressed': String(selected) } : {}),
    }));
  }
  const selected = snapshot.entities.find((entity) => entity.id === selectedObject);
  svg.append(svgNode('text', { x: 24, y: 34, fill: '#234d4b', 'font-size': 12, 'font-weight': 700 }, selected ? selected.name : 'No object selected'));
  svg.append(svgNode('text', { x: 24, y: 53, fill: '#5f7772', 'font-size': 9 }, `Stable ID · ${selected?.id ?? '—'}`));
  return svg;
}

function pointerPlan(event: PointerEvent, root: SVGSVGElement, camera: PlanCamera): Point {
  const matrix = root.getScreenCTM();
  if (!matrix) throw new Error('The room plan is not currently visible.');
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return [(point.x - 300) / camera.scale + (camera.minX + camera.maxX) / 2,
    (193 - point.y) / camera.scale + (camera.minY + camera.maxY) / 2];
}

ui['proposal-drawing'].addEventListener('pointerdown', (event) => {
  if (modelView === '3d') {
    if (!repo || busy || cameraGesture || event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
    const target = event.target.closest<SVGElement>('[data-object]');
    const objectId = target?.dataset.object ?? null;
    const root = ui['proposal-drawing'].querySelector<SVGSVGElement>('svg');
    if (!root) return;
    event.preventDefault();
    cameraGesture = {
      id: event.pointerId, root, origin: [event.clientX, event.clientY], camera: modelCamera,
      mode: event.shiftKey ? 'pan' : 'orbit', objectId, moved: false,
    };
    root.setPointerCapture(event.pointerId);
    return;
  }
  if (!repo || busy || gesture || event.button !== 0 || !event.isPrimary) return;
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<SVGElement>('[data-object]'); if (!target) return;
  const operation = target.dataset.handle;
  if (!operation) {
    const objectId = target.dataset.object;
    if (objectId) chooseObject(objectId);
    return;
  }
  if (writesBlocked || !layout || !preview) return;
  if (operation !== 'wall' && operation !== 'door-move' && operation !== 'door-width') return;
  if (invalidInput) { feedback('Fix or discard the invalid input before dragging.', true); return; }
  event.preventDefault();
  const root = ui['proposal-drawing'].querySelector<SVGSVGElement>('svg');
  if (!root) throw new Error('The editable room plan is unavailable.');
  const camera = planCameras.get(root);
  if (!camera) throw new Error('The editable room camera is unavailable.');
  gesture = { id: event.pointerId, root, camera, operation, layout, preview, origin: pointerPlan(event, root, camera),
    client: [event.clientX, event.clientY], moved: false, rejected: false };
  root.setPointerCapture(event.pointerId); updateControls();
});
ui['proposal-drawing'].addEventListener('pointermove', (event) => {
  if (cameraGesture?.id === event.pointerId) {
    const active = cameraGesture;
    const delta: Point = [event.clientX - active.origin[0], event.clientY - active.origin[1]];
    if (!active.moved && Math.hypot(...delta) < 4) return;
    active.moved = true;
    event.preventDefault();
    modelCamera = active.mode === 'pan' ? panModelView(active.camera, delta) : orbitModelView(active.camera, delta);
    renderComparison();
    return;
  }
  if (!gesture || gesture.id !== event.pointerId) return;
  const activeGesture = gesture;
  if (!activeGesture.moved && Math.hypot(event.clientX - activeGesture.client[0], event.clientY - activeGesture.client[1]) < 6) return;
  activeGesture.moved = true; event.preventDefault();
  const current = pointerPlan(event, activeGesture.root, activeGesture.camera);
  const delta: Point = [current[0] - activeGesture.origin[0], current[1] - activeGesture.origin[1]];
  const candidate = structuredClone(activeGesture.layout);
  if (activeGesture.operation === 'wall') {
    const wall = activeGesture.preview.entities.find((item): item is Wall => item.type === 'Wall' && item.id === selectedObject);
    if (!wall) return;
    const side = wallSide(wall, activeGesture.layout);
    candidate.boundsMm[side] += Math.round(delta[side.endsWith('X') ? 0 : 1] * 1000);
  } else {
    const host = hostFor(activeGesture.preview, entry(activeGesture.preview));
    if (!host) return;
    const dx = host.wall.end[0] - host.wall.start[0]; const dy = host.wall.end[1] - host.wall.start[1];
    const along = Math.round((delta[0] * dx + delta[1] * dy) / Math.hypot(dx, dy) * 1000);
    candidate.door[activeGesture.operation === 'door-move' ? 'offsetMm' : 'widthMm'] += along;
  }
  try { acceptLayout(candidate); activeGesture.rejected = false; }
  catch (error) { activeGesture.rejected = true; feedback(`${error instanceof Error ? error.message : 'The drag is invalid.'} Last valid request sketch retained.`, true); }
});
function endGesture(cancel = false): void {
  if (!gesture) return;
  const previous = gesture; gesture = null;
  if (cancel) { layout = previous.layout; preview = previous.preview; feedback('Drag cancelled. Pre-drag request sketch restored.'); }
  else if (previous.rejected) feedback('Move stopped at the last valid request sketch. Review it before submitting.');
  if (previous.root.hasPointerCapture(previous.id)) previous.root.releasePointerCapture(previous.id);
  syncInspector(); renderComparison(); updateControls();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) ui['proposal-drawing'].addEventListener(type, (event) => {
  if (event instanceof PointerEvent && cameraGesture?.id === event.pointerId) {
    const active = cameraGesture;
    cameraGesture = null;
    if (active.root.hasPointerCapture(active.id)) active.root.releasePointerCapture(active.id);
    if (!active.moved && active.objectId) chooseObject(active.objectId);
    renderComparison();
    return;
  }
  if (event instanceof PointerEvent && gesture?.id === event.pointerId) endGesture(type !== 'pointerup');
});
ui['proposal-drawing'].addEventListener('wheel', (event) => {
  if (modelView !== '3d' || !repo) return;
  event.preventDefault();
  modelCamera = zoomModelView(modelCamera, event.deltaY);
  renderComparison();
}, { passive: false });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && gesture) { event.preventDefault(); endGesture(true); } });
ui['proposal-drawing'].addEventListener('keydown', (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<SVGElement>('[data-object]');
  if (target && ['Enter', ' '].includes(event.key)) {
    const objectId = target.dataset.object;
    if (!objectId) return;
    event.preventDefault(); chooseObject(objectId);
    const selected = preview?.entities.find((entity) => entity.id === selectedObject);
    const control = selected?.type === 'Door' ? ui['door-width'] : selected?.type === 'Wall' ? ui['wall-position'] : null;
    if (control && !control.disabled) control.focus();
  }
});

type ModelItem = Entity | HostingRelationship;
type PropertyRow = [string, string, string, string];

function modelProperties(item: ModelItem): Record<string, unknown> {
  if (item.type === 'Wall') {
    return { id: item.id, type: item.type, name: item.name, start: item.start, end: item.end, height: item.height, thickness: item.thickness };
  }
  if (item.type === 'Door') {
    return { id: item.id, type: item.type, name: item.name, width: item.width, height: item.height };
  }
  if (item.type === 'Window') {
    return { id: item.id, type: item.type, name: item.name, width: item.width, height: item.height, sillHeight: item.sillHeight };
  }
  if (item.type === 'Equipment') {
    return { id: item.id, type: item.type, name: item.name, category: item.category, position: item.position,
      elevation: item.elevation, width: item.width, depth: item.depth, height: item.height };
  }
  return { id: item.id, type: item.type, source: item.source, target: item.target, offset: item.offset };
}

function renderProperties(original: ModelSnapshot, selected: ModelSnapshot, delta: ModelDelta): void {
  const a = entry(original); const b = entry(selected);
  const ah = hostFor(original, a); const bh = hostFor(selected, b);
  const displayMM = (value: number | undefined): string => value === undefined ? 'Absent' : `${millimetres(value)} mm`;
  const difference = a && b ? Math.round((b.width - a.width) * 1000) : null;
  const widthDifference = difference === null ? 'Changed' : difference === 0 ? 'Unchanged' : `${difference > 0 ? '+' : '−'}${number.format(Math.abs(difference))} mm`;
  const rows: PropertyRow[] = [
    ['Entrance width', displayMM(a?.width), displayMM(b?.width), widthDifference],
    ['Door height', displayMM(a?.height), displayMM(b?.height), a?.height === b?.height ? 'Unchanged' : 'Changed'],
    ['Host wall', ah?.wall.name ?? 'Absent', bh?.wall.name ?? 'Absent', ah?.wall.id === bh?.wall.id ? 'Unchanged' : 'Changed'],
    ['Offset along host wall', displayMM(ah?.link.offset), displayMM(bh?.link.offset), ah?.link.offset === bh?.link.offset ? 'Unchanged' : 'Changed'],
    ['Host wall height', displayMM(ah?.wall.height), displayMM(bh?.wall.height), ah?.wall.height === bh?.wall.height ? 'Unchanged' : 'Changed'],
  ];
  for (const wall of selected.entities.filter(isWall)) {
    const before = original.entities.find((item): item is Wall => item.id === wall.id && item.type === 'Wall');
    const length = (item: Wall | undefined): number | undefined => item ? Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]) : undefined;
    const position = (item: Wall | undefined): string => item ? `${item.start.map(millimetres).join(', ')} → ${item.end.map(millimetres).join(', ')} mm` : 'Absent';
    rows.push([`${wall.name} length`, displayMM(length(before)), displayMM(length(wall)), length(before) === length(wall) ? 'Unchanged' : 'Changed']);
    if (position(before) !== position(wall)) rows.push([`${wall.name} endpoints`, position(before), position(wall), 'Changed']);
  }
  const propertyNames: Record<string, string> = { name: 'name', type: 'type', width: 'width', height: 'height', thickness: 'thickness', start: 'start coordinate', end: 'end coordinate', source: 'door', target: 'host wall', offset: 'offset from host start' };
  const propertyValue = (key: string, value: unknown): string => {
    if (value === undefined) return 'Absent';
    if (['width', 'height', 'thickness', 'offset'].includes(key) && typeof value === 'number') return displayMM(value);
    if (Array.isArray(value) && value.every((coordinate) => typeof coordinate === 'number')) {
      return `${value.map((coordinate) => millimetres(coordinate)).join(', ')} mm`;
    }
    return String(value);
  };
  const entityModifications: Array<{ before: ModelItem | null; after: ModelItem | null; action: string }> = [
    ...delta.entities.added.map((after) => ({ before: null, after, action: 'Added' })),
    ...delta.entities.removed.map((before) => ({ before, after: null, action: 'Removed' })),
    ...delta.entities.modified.map((item) => ({ ...item, action: 'Changed' })),
  ];
  const relationshipModifications: Array<{ before: ModelItem | null; after: ModelItem | null; action: string }> = [
    ...delta.relationships.added.map((after) => ({ before: null, after, action: 'Added' })),
    ...delta.relationships.removed.map((before) => ({ before, after: null, action: 'Removed' })),
    ...delta.relationships.modified.map((item) => ({ ...item, action: 'Changed' })),
  ];
  const modificationGroups: Array<[Array<{ before: ModelItem | null; after: ModelItem | null; action: string }>, string]> = [
    [entityModifications, 'Object'], [relationshipModifications, 'Placement'],
  ];
  for (const [modifications, noun] of modificationGroups) {
    for (const { before, after, action } of modifications) {
      const item = after ?? before;
      if (!item) continue;
      const title = 'name' in item ? item.name : `${noun} ${item.id}`;
      const beforeProperties = before ? modelProperties(before) : {};
      const afterProperties = after ? modelProperties(after) : {};
      for (const key of new Set([...Object.keys(beforeProperties), ...Object.keys(afterProperties)])) {
        if (key === 'id' || JSON.stringify(beforeProperties[key]) === JSON.stringify(afterProperties[key])) continue;
        rows.push([`${title} · ${propertyNames[key] ?? key}`, propertyValue(key, beforeProperties[key]), propertyValue(key, afterProperties[key]), action]);
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

function selectRevision(branch: string, revisionId: string): void {
  if (busy || gesture || !repo) return;
  const project = repo;
  if (dirty() && !window.confirm('Discard the unsaved request sketch and view this saved revision?')) return;
  selectedBranch = branch;
  selectedRevision = revisionId;
  activeReview = project.reviews().find((review) => review.proposalRevisionId === revisionId) ?? null;
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
  status(`Viewing ${branch}${revisionId === project.head(branch) ? '' : ' · earlier revision'}. The original remains in revision history.`);
}

function requireRepository(): RoomRepository {
  if (!repo) throw new Error('Create or open a project first.');
  return repo;
}

function renderHistory(): void {
  const project = requireRepository();
  const branches = project.branches();
  ui['branch-count'].textContent = `${branches.length} ${branches.length === 1 ? 'branch' : 'branches'}`;
  ui['history-list'].replaceChildren(...branches.map((branch) => {
    const wrapper = element('div', undefined, 'history-item');
    const button = element('button', undefined, 'history-button'); button.type = 'button';
    button.dataset.branch = branch.name; button.dataset.revision = branch.revisionId;
    button.setAttribute('aria-pressed', String(selectedBranch === branch.name && selectedRevision === branch.revisionId));
    const symbol = element('span', branch.name === 'main' ? '◇' : '↳', 'history-symbol'); symbol.setAttribute('aria-hidden', 'true');
    const copy = element('span');
    const room = project.view(branch.revisionId).snapshot;
    const width = entry(room)?.width;
    const changed = project.compare(project.root(), branch.revisionId);
    const mainDetail = branch.revisionId === project.root() ? 'Original model' : 'Current accepted model';
    copy.append(element('span', branch.name, 'history-name'), element('span', `${branch.name === 'main' ? mainDetail : `AI proposal · ${changed.entities.modified.length} objects and ${changed.relationships.modified.length} placements changed`} · ${width === undefined ? 'entry absent' : `${millimetres(width)} mm entrance`}`, 'history-detail'));
    button.append(symbol, copy);
    button.addEventListener('click', () => selectRevision(branch.name, branch.revisionId));
    wrapper.append(button);
    const detail = element('details', undefined, 'revision-detail');
    detail.append(element('summary', 'Revision ancestry'));
    const list = element('ol', undefined, 'revision-list');
    let revisionId: string | null = branch.revisionId; let index = 0;
    while (revisionId !== null) {
      const revision = project.view(revisionId);
      const id = revision.id;
      const item = element('li');
      const control = element('button', `${index === 0 ? 'Head' : 'Ancestor'} · ${id.slice(0, 10)}${revision.parentId === null ? ' · original' : ''}`, 'revision-button');
      control.type = 'button'; control.title = id;
      control.dataset.branch = branch.name; control.dataset.revision = id;
      control.setAttribute('aria-current', String(selectedBranch === branch.name && selectedRevision === id));
      control.setAttribute('aria-label', `View ${branch.name} ${index === 0 ? 'head' : 'ancestor'} revision ${id.slice(0, 10)}`);
      control.addEventListener('click', () => selectRevision(branch.name, id));
      item.append(control); list.append(item);
      revisionId = revision.parentId;
      index += 1;
    }
    detail.append(list); wrapper.append(detail);
    return wrapper;
  }));
}

function renderComparison(): void {
  const project = requireRepository();
  const originalId = project.root();
  const original = project.view(originalId).snapshot;
  const selected = preview ?? project.view(selectedRevision).snapshot;
  const isOriginal = selectedRevision === originalId;
  ui['original-drawing'].replaceChildren(drawPlan(original, null, 'root', 'Original room plan'));
  if (modelView === 'plan') {
    const next = drawPlan(selected, original, 'selected', `${selectedBranch} visual request plan`);
    const root = ui['proposal-drawing'].querySelector<SVGSVGElement>('svg');
    if (root && gesture) {
      // Keep the capture root stable throughout a geometry-request drag.
      root.replaceChildren(...next.childNodes);
      const role = next.getAttribute('role');
      if (role) root.setAttribute('role', role); else root.removeAttribute('role');
      const camera = planCameras.get(next);
      if (!camera) throw new Error('The room plan camera was not created.');
      planCameras.set(root, camera);
    } else ui['proposal-drawing'].replaceChildren(next);
  } else {
    const next = drawModel3d(selected, `${selectedBranch} room model`);
    const root = ui['proposal-drawing'].querySelector<SVGSVGElement>('svg');
    if (root && cameraGesture) root.replaceChildren(...next.childNodes);
    else ui['proposal-drawing'].replaceChildren(next);
  }
  ui['proposal-drawing'].dataset.modelView = modelView;
  ui['view-plan'].setAttribute('aria-pressed', String(modelView === 'plan'));
  ui['view-3d'].setAttribute('aria-pressed', String(modelView === '3d'));
  ui['model-3d-controls'].hidden = modelView !== '3d';
  ui['view-caption'].textContent = modelView === 'plan' ? 'PLAN · METRES' : '3D · CAMERA ONLY';
  ui['model-revision'].textContent = `Revision ${selectedRevision.slice(0, 10)} · ${selected.entities.length} objects`;
  ui['review-drawing'].replaceChildren(drawPlan(selected, original, 'review', `${selectedBranch} proposal review plan`));
  ui['selected-title'].textContent = dirty() ? 'Your visual request' : isOriginal ? 'Original · ready for a request' : selectedBranch;
  ui['selected-badge'].textContent = dirty() ? 'Request sketch' : isOriginal ? 'Original' : selectedBranch === 'main' ? 'Accepted model' : selectedRevision === project.head(selectedBranch) ? 'AI proposal' : 'Earlier revision';
  ui['study-caption'].textContent = 'Inspect the same revision in Plan or 3D. Select any object in either view; walls and the entry door can also carry visual change requests.';
  renderProperties(original, selected, diffSnapshots(original, selected));
}

function renderProjectOverview(): void {
  const project = requireRepository();
  const revision = project.view(project.head('main'));
  ui['overview-revision'].textContent = revision.id.slice(0, 10);
  ui['overview-entity-count'].textContent = `${revision.snapshot.entities.length} model objects`;
}

function renderConflictChoices(): void {
  const project = requireRepository();
  const alternatives = project.branches().filter((branch) => branch.name !== 'main');
  const choices: Array<[HTMLSelectElement, number]> = [[ui['conflict-left'], 0], [ui['conflict-right'], 1]];
  for (const [choice, defaultIndex] of choices) {
    const previous = choice.value;
    choice.replaceChildren();
    if (alternatives.length < 2) {
      const option = element('option', 'Save two proposals first'); option.value = ''; choice.append(option);
    } else {
      for (const branch of alternatives) {
        const width = entry(project.view(branch.revisionId).snapshot)?.width;
        const option = element('option', `${branch.name}${width === undefined ? '' : ` · ${millimetres(width)} mm`}`);
        option.value = branch.name; choice.append(option);
      }
      const fallback = alternatives[defaultIndex] ?? alternatives[0];
      if (!fallback) throw new Error('Two proposal alternatives were expected.');
      choice.value = alternatives.some((branch) => branch.name === previous) ? previous : fallback.name;
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
        const describe = (value: ModelItem | null): string => {
          if (value === null) return 'removed';
          if (value.type === 'Door') return `${millimetres(value.width)} mm door`;
          if (value.type === 'Wall') return value.name;
          if (value.type === 'Window') return `${millimetres(value.width)} mm window`;
          if (value.type === 'Equipment') return value.name;
          return `placement on ${value.target}`;
        };
        ui['conflict-result'].append(document.createTextNode(`${conflict.id}: original ${describe(conflict.base)}; ${left}: ${describe(conflict.left)}; ${right}: ${describe(conflict.right)}. `));
      }
      ui['conflict-result'].append(document.createTextNode('Both alternatives remain separate. Nothing is merged.'));
    }
  } catch (error) { report(error); }
});

for (const conflictChoice of [ui['conflict-left'], ui['conflict-right']]) conflictChoice.addEventListener('change', () => {
  ui['conflict-result'].textContent = 'Alternatives changed. Compare again to see their conflicts. Nothing is merged.';
});

function render(): void {
  const project = requireRepository();
  ui['project-title'].textContent = project.name;
  document.title = `${project.name} · Room studies`;
  if (!activeReview) activeReview = project.reviews().find((review) => review.proposalRevisionId === selectedRevision) ?? null;
  renderComparison();
  renderProjectOverview();
  renderHistory();
  renderConflictChoices();
  renderReview();
  updateControls();
}

async function initialize() {
  let needsStart = false;
  renderAuth();
  try {
    authSession = await authRequest('/api/auth/session');
    renderAuth();
  } catch (error) {
    ui['auth-error'].textContent = error instanceof Error ? error.message : 'ChatGPT connection status is unavailable.';
    ui['auth-error'].hidden = false;
  }
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
      const message = error instanceof Error ? error.message : 'The saved data is invalid.';
      throw new Error(`The saved project could not be validated: ${message} It has been left intact. Download it below; local writes are blocked to protect it.`);
    }
    repo = restored;
    savedText = record.text;
    selectedBranch = 'main';
    selectedRevision = repo.head('main');
    activeReview = repo.reviews().find((review) => review.proposalRevisionId === selectedRevision) ?? null;
    resetEditor();
    ui['project-name'].value = repo.name;
    render();
    showPage('project');
    status('Saved project restored. Open the reference room to continue from its current revision.');
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
