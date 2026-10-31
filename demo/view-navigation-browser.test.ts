import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { InsidePose, ViewSession, NavigationResult, InsideMotion } from './view-navigation.ts';
interface BrowserNavigationHarness {
  pose(): InsidePose;
  inside(motion?: InsideMotion): NavigationResult;
  returnTo(pose: InsidePose): NavigationResult;
  resume(): NavigationResult;
  view(kind: 'plan' | 'overview' | 'section'): NavigationResult;
  state(): ViewSession;
}
declare global { interface Window { navHarness: BrowserNavigationHarness } }

const source = `
import { ModelViewer } from './demo/model-viewer.ts';
import { multiStoreySnapshot } from './src/multi-storey-house.ts';
const snapshot = multiStoreySnapshot();
let annotations = [];
const viewer = new ModelViewer({ select() {}, inspect() {}, reference() {}, keyboardReference() {},
  markup(values) { annotations = values; show(); return true; } });
const host = document.querySelector('#host');
const base = { snapshot, navigationPin: 'native-r1', comparison: null, selectedId: 'level-ground-wall-north',
  focusId: null, mode: 'basic', cutaway: true, interactive: true, reference: null, levelId: 'level-ground',
  markup: { binding: 'r1', editable: true, annotations, references: [] } };
function show() { viewer.show(host, { ...base, markup: { ...base.markup, annotations } }); }
show();
Object.assign(window, { navHarness: {
  pose: () => viewer.captureInsidePose(), state: () => viewer.navigationState,
  inside: (motion = 'fly', entry = [2,3,1.6]) => viewer.changeView({ kind: 'inside', motion, entry }),
  resume: () => viewer.changeView({kind: 'inside', motion: 'fly'}),
  view: kind => viewer.changeView({ kind }), returnTo: pose => viewer.returnToPose(pose),
  stop: () => viewer.stopNavigation(), look: () => viewer.activateMouseLook(),
  markup: (tool = 'rectangle') => viewer.startMarkup(tool), hide: () => viewer.hide(), show,
  context: pin => { base.navigationPin = pin; show(); },
  dispose: () => viewer.dispose(), annotationCount: () => annotations.length,
} });
document.querySelector('#look').onclick = () => void viewer.activateMouseLook();
`;

test('browser WASD gaze, Fly vertical keys, mouse-look, Escape, input isolation and session transitions use the real viewer', { timeout: 120_000 }, async t => {
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', write: false });
  const server = http.createServer((req, res) => {
    if (req.url === '/harness.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><button id="look">Mouse look</button><input id="composer"><div id="host" style="width:800px;height:600px"></div><style>.babylon-viewer{width:100%;height:100%;position:relative}canvas{width:100%;height:100%}.model-markup-controls{position:absolute;top:0;right:0}</style><script type="module" src="/harness.mjs"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => 'navHarness' in window);
  await page.waitForFunction(() => document.querySelector('.babylon-viewer')?.getAttribute('data-scene-ready') === 'true');
  const pose = () => page.evaluate<InsidePose>('window.navHarness.pose()');
  const enter = async () => { assert.equal((await page.evaluate<{kind: string}>('window.navHarness.inside()')).kind, 'changed'); await page.locator('canvas').focus(); };
  const hold = async (key: string, duration = 160) => {
    await page.keyboard.down(key); await page.waitForTimeout(duration);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.keyboard.up(key);
  };
  await enter();
  const start = await pose();
  await hold('w'); const north = await pose();
  assert.ok(north.eye[1] > start.eye[1] + .1); assert.ok(Math.abs(north.eye[0] - start.eye[0]) < .01);
  await hold('d'); assert.ok((await pose()).eye[0] > north.eye[0] + .1);
  const height = (await pose()).eye[2];
  await hold('Space'); assert.ok(Math.abs((await pose()).eye[2] - height) < .001);
  await hold('Shift'); const above = (await pose()).eye[2]; assert.ok(above > height + .1);
  await hold('Control'); assert.ok((await pose()).eye[2] < above - .1);
  const facing: InsidePose = { ...start, forward: [Math.SQRT1_2, 0, Math.SQRT1_2], up: [-Math.SQRT1_2, 0, Math.SQRT1_2] };
  assert.equal((await page.evaluate(p => window.navHarness.returnTo(p), facing)).kind, 'changed');
  await page.locator('canvas').focus(); await hold('w'); const gaze = await pose();
  assert.ok(gaze.eye[0] > facing.eye[0] + .1 && gaze.eye[2] > facing.eye[2] + .1, 'Fly follows pitched gaze');
  await page.keyboard.down('w'); await page.keyboard.press('Escape');
  await page.locator('canvas').dispatchEvent('keydown', { key: 'w', repeat: true }); const escaped = await pose();
  await page.waitForTimeout(140); assert.deepEqual((await pose()).eye, escaped.eye); await page.keyboard.up('w');
  assert.equal(await page.evaluate(() => document.pointerLockElement === null), true);
  await page.locator('#composer').focus(); const typing = await pose(); await page.keyboard.type('wasd WASD '); assert.deepEqual((await pose()).eye, typing.eye);
  assert.equal(await page.locator('#composer').inputValue(), 'wasd WASD ');
  await page.locator('canvas').focus();
  await page.keyboard.down('w'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); const blurred = await pose();
  await page.waitForTimeout(140); assert.deepEqual((await pose()).eye, blurred.eye); await page.keyboard.up('w');
  await page.keyboard.down('w'); await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1 }); const cancelled = await pose();
  await page.waitForTimeout(140); assert.deepEqual((await pose()).eye, cancelled.eye); await page.keyboard.up('w');
  await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'modal'; document.body.append(dialog); dialog.showModal(); });
  const modal = await pose(); await hold('w'); assert.deepEqual((await pose()).eye, modal.eye);
  await page.evaluate(() => document.querySelector('dialog')?.remove()); await page.locator('canvas').focus();
  await page.keyboard.down('w');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await pose(); await page.waitForTimeout(100); assert.deepEqual((await pose()).eye, hidden.eye);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.keyboard.up('w');
  assert.equal((await page.evaluate<NavigationResult>('window.navHarness.inside("walk")')).kind, 'changed');
  await page.locator('canvas').focus(); await hold('w', 700); const walking = await pose();
  assert.ok(walking.eye[1] > 3.5); assert.equal(walking.eye[2], 1.6);
  // Solid walls conservatively block Walk, including door crossings in this first scope.
  let blocked: InsidePose | null = null;
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.navHarness.pose().eye[1] > 5.5, undefined, { timeout: 10_000, polling: 'raf' });
    for (let frame = 0; frame < 20; frame++) {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      blocked = await pose();
      assert.ok(blocked.eye[1] < 5.75 && blocked.eye[1] > 5.5, 'Held Walk stays in the wall band through rendered frames.');
    }
  } finally { await page.keyboard.up('w'); }
  assert.ok(blocked); assert.ok(blocked.eye[1] < 5.75 && blocked.eye[1] > 5.5);
  await hold('Shift'); assert.equal((await pose()).eye[2], 1.6);
  await enter();
  const saved = await pose();
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.navHarness.view("plan")'); await page.evaluate('window.navHarness.hide()'); await page.evaluate('window.navHarness.show()');
    await page.evaluate('window.navHarness.view("overview")');
    assert.equal((await page.evaluate<{kind: string}>('window.navHarness.resume()')).kind, 'changed');
    assert.deepEqual((await pose()).eye, saved.eye, 'Plan/Overview returns to saved eye without a framing reset');
    // Explicit return is distinct from opening/selection.
    await page.evaluate(p => window.navHarness.returnTo(p), saved);
    assert.deepEqual((await pose()).eye, saved.eye);
    assert.equal(await page.locator('canvas').count(), 1);
  }
  await page.locator('#look').click(); await page.waitForTimeout(100);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  if (locked) {
    const before = await pose(); await page.mouse.move(500, 300); await page.mouse.move(570, 340, { steps: 5 });
    assert.notDeepEqual((await pose()).forward, before.forward);
  }
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.pointerLockElement === null), true);
  await page.evaluate('document.querySelector("canvas").requestPointerLock = () => Promise.reject(new Error("denied"))');
  assert.equal(await page.evaluate<string>('window.navHarness.look()'), 'drag');
  const rect = await page.locator('canvas').boundingBox(); assert.ok(rect);
  const beforeDrag = await pose(); await page.mouse.move(rect.x + 300, rect.y + 250); await page.mouse.down();
  await page.mouse.move(rect.x + 380, rect.y + 280, { steps: 8 }); await page.mouse.up();
  assert.notDeepEqual((await pose()).forward, beforeDrag.forward);
  await page.keyboard.press('Escape');
  await enter();
  await page.evaluate('window.navHarness.markup("polyline")');
  await page.mouse.click(rect.x + rect.width * .42, rect.y + rect.height * .75);
  await page.mouse.click(rect.x + rect.width * .48, rect.y + rect.height * .72);
  await page.mouse.click(rect.x + rect.width * .55, rect.y + rect.height * .75);
  const finish = page.getByRole('button', { name: 'Finish polyline', exact: true });
  assert.equal(await finish.isEnabled(), true);
  await finish.focus();
  assert.equal(await page.locator('.model-markup-controls').getAttribute('data-tool'), 'polyline', 'toolbar focus is not window blur');
  await finish.click();
  assert.equal(await page.evaluate<number>('window.navHarness.annotationCount()'), 1, 'toolbar commits the collected polyline');
  await page.evaluate('window.navHarness.markup("polyline")');
  await page.mouse.click(rect.x + rect.width * .42, rect.y + rect.height * .75);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await page.locator('.model-markup-controls').getAttribute('data-tool'), 'select', 'true window blur still cancels markup');
  await page.evaluate('window.navHarness.markup()');
  assert.equal(await page.locator('.model-markup-controls').getAttribute('data-tool'), 'rectangle');
  const beforeMarkup = await pose(); await hold('w'); assert.deepEqual((await pose()).eye, beforeMarkup.eye);
  await page.evaluate('window.navHarness.stop()');
  await page.evaluate('window.navHarness.context("r2")');
  assert.equal((await page.evaluate<{kind: string}>('window.navHarness.state()')).kind, 'overview');
  assert.equal((await page.evaluate(p => window.navHarness.returnTo(p), saved)).kind, 'unsupported');
  assert.deepEqual(errors, []);
  await page.evaluate('window.navHarness.dispose()'); assert.equal(await page.locator('canvas').count(), 0);
});
