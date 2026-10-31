import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { SceneSerializer } from '@babylonjs/core/Misc/sceneSerializer.js';
import { ModelScene } from './model-scene.ts';
import { SpatialTaskLayer } from './spatial-task-layer.ts';
import { spatialTokens } from './ui/design-tokens.ts';
import { spatialAcceptanceFixture } from '../tests/fixtures/spatial-workspace/fixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDemoServer } from './server.ts';
import { RoomRepository, diffSnapshots, validateSnapshot } from '../src/room-model.ts';
import { spatialFixtureWorker } from '../tests/fixtures/spatial-workspace/worker.ts';
import { spatialExpectedDoorSnapshot, spatialFixtureManifest } from '../tests/fixtures/spatial-workspace/fixture.ts';
import { parseTaskPlacement } from '../src/task-placement.ts';

test('live native agent body opens the same saved task without moving the eye; exact 1100 mm review remains explicit', { timeout: 150_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-257-'));
  const artifacts = process.env.SPATIAL_WORKSPACE_ARTIFACTS ?? 'artifacts/spatial-workspace-257'; await fs.mkdir(artifacts, { recursive: true });
  const server = await createDemoServer({ modelWorker: spatialFixtureWorker(), backlogFile: path.join(directory, 'queue.sqlite') });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { void dialog.accept(); });
  t.after(async () => { await page.screenshot({ path: path.join(artifacts, 'last.png'), fullPage: true }); t.diagnostic(JSON.stringify({ errors, status: await page.locator('#status').textContent(), error: await page.locator('#error').textContent() })); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await server.closeModelWorkers(); await fs.rm(directory, { recursive: true, force: true }); });
  const capture = () => page.evaluate(async () => { const url = '/room-app.mjs'; const api = await import(url); return api.captureWorkspaceInsidePose(); });
  await page.goto(base); await page.locator('#project-template').selectOption('house'); await page.locator('#project-name').fill('Live spatial fixture'); await page.locator('#create-project').click();
  await page.locator('#open-chat').click();
  await page.waitForFunction(() => document.getElementById('workspace-shell')?.dataset.spatialView === 'inside');
  await page.evaluate(async () => { const url = '/room-app.mjs'; const api = await import(url); const pose = api.captureWorkspaceInsidePose(); if (!pose || !api.returnWorkspaceToPose({ ...pose, eye: [2, 3.45, 1.6], forward: [1, 0, 0], up: [0, 0, 1], motion: 'fly' })) throw new Error('Explicit fixture eye could not open'); });
  await page.locator('#new-chat').click(); await page.locator('.model-object-picker').selectOption(spatialFixtureManifest.doorId);
  await page.locator('#request-text').fill('Widen this door to 1100 mm, keeping its centre.');
  const canvas = await page.locator('canvas.model-canvas').elementHandle(); assert.ok(canvas);
  const created = page.waitForResponse(response => response.url() === `${base}/api/change-requests` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click(); const acknowledgement = await created; assert.equal(acknowledgement.status(), 202, await acknowledgement.text());
  const value: unknown = await acknowledgement.json(); assert.ok(value && typeof value === 'object' && 'ticket' in value && value.ticket && typeof value.ticket === 'object' && 'id' in value.ticket && typeof value.ticket.id === 'string' && 'projectId' in value.ticket && typeof value.ticket.projectId === 'string');
  const id = value.ticket.id; const projectId = value.ticket.projectId;
  const project = async () => { const response: unknown = await (await page.request.get(`${base}/api/projects/${projectId}`)).json(); assert.ok(response && typeof response === 'object' && 'project' in response && typeof response.project === 'string'); return RoomRepository.restore(response.project); };
  const before = await project(); const baseline = before.head('main');
  const ticket = async () => { const response: unknown = await (await page.request.get(`${base}/api/change-requests/${id}`)).json(); assert.ok(response && typeof response === 'object' && 'ticket' in response && response.ticket && typeof response.ticket === 'object' && 'taskPlacement' in response.ticket); return response.ticket; };
  const placement = parseTaskPlacement((await ticket()).taskPlacement); assert.equal(placement.kind, 'placed'); if (placement.kind !== 'placed') return;
  assert.ok(placement.targets.objects.some(ref => ref.kind === 'native' && ref.entityId === spatialFixtureManifest.doorId));
  assert.notDeepEqual(placement.origin.point, spatialFixtureManifest.before.centre);
  const agent = page.locator(`.spatial-task-label[data-task-id="${id}"]`); await agent.waitFor();
  await page.locator('#workspace-context-close').click();
  const poseBeforePick = await capture();
  const box = await page.locator('canvas.model-canvas').boundingBox(); assert.ok(box);
  const point = await agent.evaluate(node => ({ x: Number(node.dataset.bodyX), y: Number(node.dataset.bodyY) }));
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.locator('#workspace-context').waitFor({ state: 'visible' });
  const pickedPose = await capture();
  assert.deepEqual({ ...pickedPose, sourcePin: '' }, { ...poseBeforePick, sourcePin: '' }, 'Opening the actual agent body never changes the eye, facing, up, project, level or motion; the actual displayed proposal may change its source pin');
  assert.equal(JSON.parse(await page.locator('.babylon-viewer').getAttribute('data-task-hit') ?? '{}').kind, 'task', 'The actual ray must hit the agent body rather than the construction behind it');
  assert.equal(await page.locator('#selected-object').inputValue(), spatialFixtureManifest.doorId);
  assert.equal(await page.locator('[data-chat-framework="assistant-ui"]').count(), 1); assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await canvas.evaluate(node => node.isConnected), true);
  await page.locator('#new-chat').click();
  await page.locator('.model-object-picker').selectOption(spatialFixtureManifest.doorId);
  await page.locator('#request-text').fill('A second independent task at this same door.');
  const secondResponse = page.waitForResponse(response => response.url() === `${base}/api/change-requests` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const secondAck = await secondResponse; assert.equal(secondAck.status(), 202, await secondAck.text());
  const second: unknown = await secondAck.json();
  assert.ok(second && typeof second === 'object' && 'ticket' in second && second.ticket && typeof second.ticket === 'object' && 'id' in second.ticket && typeof second.ticket.id === 'string' && 'taskPlacement' in second.ticket);
  assert.notEqual(second.ticket.id, id);
  const secondPlacement = parseTaskPlacement(second.ticket.taskPlacement); assert.equal(secondPlacement.kind, 'placed');
  if (secondPlacement.kind !== 'placed') return;
  assert.deepEqual(secondPlacement.origin.point, placement.origin.point, 'Independent tasks deliberately share one fixed point');
  await page.locator('#workspace-context-close').click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const beforeChooser = await capture();
  const groupLabel = page.locator('.spatial-task-label[data-candidates="2"]:visible').first(); await groupLabel.waitFor();
  const samePlace = await groupLabel.evaluate(node => ({ x: Number(node.dataset.bodyX), y: Number(node.dataset.bodyY) }));
  const chooserBox = await page.locator('canvas.model-canvas').boundingBox(); assert.ok(chooserBox);
  await page.mouse.click(chooserBox.x + samePlace.x, chooserBox.y + samePlace.y);
  await page.getByText('Choose a task at this place', { exact: true }).waitFor();
  assert.equal(await page.locator('#spatial-task-list button[data-task-id]').count(), 2);
  await page.locator(`#spatial-task-list button[data-task-id="${id}"]`).click();
  const afterChooser = await capture();
  assert.deepEqual({ ...afterChooser, sourcePin: '' }, { ...beforeChooser, sourcePin: '' }, 'Same-place choice keeps the actual eye and facing');
  const tray = page.getByRole('region', { name: 'Canvas proposal review' });
  await tray.waitFor({ timeout: 30_000 });
  const inspectedPose = await capture(); assert.deepEqual(inspectedPose?.eye, poseBeforePick.eye, 'Proposal inspection retains the actual eye');
  assert.equal((await project()).head('main'), baseline);
  await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
  await tray.getByRole('button', { name: 'Revise', exact: true }).click(); await page.locator('#request-text').fill('Keep this unsent revision independent.');
  assert.equal(await page.locator('#request-text').evaluate(node => document.activeElement === node), true);
  assert.equal((await project()).head('main'), baseline); await page.locator('#request-text').fill('');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await page.locator('#open-chat').click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const panel = await page.locator('#workspace-context').boundingBox(); assert.ok(panel && panel.width <= width - 16 && panel.height < 900 * .6);
    await page.screenshot({ path: path.join(artifacts, `narrow-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const decision = page.waitForResponse(response => response.url().endsWith('/decision') && response.request().method() === 'POST');
  await tray.getByRole('button', { name: /^Accept into/ }).click(); assert.equal((await decision).status(), 200);
  const accepted = await project(); const expected = spatialExpectedDoorSnapshot(before.view(baseline).snapshot);
  assert.deepEqual(accepted.view(accepted.head('main')).snapshot, expected);
  assert.deepEqual(diffSnapshots(before.view(baseline).snapshot, expected).entities.modified.map(item => item.id), [spatialFixtureManifest.doorId]);
  const origin = placement.origin; await page.reload(); await page.locator('#open-chat').click(); await page.locator('.spatial-task-launcher').click(); await page.locator(`#spatial-task-list button[data-task-id="${id}"]`).click();
  assert.deepEqual(parseTaskPlacement((await ticket()).taskPlacement), placement, 'Reload and acceptance preserve original placement and pinned targets');
  assert.deepEqual(parseTaskPlacement((await ticket()).taskPlacement).kind, 'placed'); assert.deepEqual(origin, placement.origin);
  assert.match(await page.locator('.spatial-placement-notice').textContent() ?? '', /historical|stale/);
  await page.locator('#spatial-return-task').click();
  await page.waitForFunction(() => document.getElementById('workspace-shell')?.dataset.spatialView === 'overview');
  assert.match(await page.locator('#status').textContent() ?? '', /saved task point/);
  const legacyResponse = await page.request.post(`${base}/api/change-requests`, { data: { project: accepted.serialize(), request: {
    requestId: crypto.randomUUID(), proposalName: 'legacy-conversation', baseRevisionId: accepted.head('main'), selectedObjectIds: [spatialFixtureManifest.doorId], instruction: 'A legacy unplaced conversation.', visualIntent: { kind: 'selection' },
  } } });
  assert.equal(legacyResponse.status(), 202, await legacyResponse.text());
  const legacy: unknown = await legacyResponse.json(); assert.ok(legacy && typeof legacy === 'object' && 'ticket' in legacy && legacy.ticket && typeof legacy.ticket === 'object' && 'id' in legacy.ticket && typeof legacy.ticket.id === 'string');
  await page.locator('.spatial-task-launcher').click();
  const legacyButton = page.locator(`#spatial-task-list button[data-task-id="${legacy.ticket.id}"]`); await legacyButton.waitFor();
  assert.match(await legacyButton.textContent() ?? '', /Unplaced/);
  assert.equal(await page.locator(`.spatial-task-label[data-task-id="${legacy.ticket.id}"]`).count(), 0);
  await legacyButton.click(); assert.equal(await page.locator('#spatial-return-task').isDisabled(), true);
  assert.deepEqual(errors, []);
});

test('the actual batched ModelScene occludes agents and excludes them from construction picks, framing and serialization', async () => {
  const fixture = await spatialAcceptanceFixture();
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 256, deterministicLockstep: true, lockstepMaxSteps: 4 });
  const model = new ModelScene(engine);
  const construction = validateSnapshot({ ...fixture.snapshot, entities: [...fixture.snapshot.entities, ...Array.from({ length: 48 }, (_, index) => ({
    id: `spatial-batch-${index}`, type: 'Equipment', name: `Read-only batch equipment ${index}`, levelId: fixture.manifest.levelId, category: 'mechanical',
    position: [6 + index % 10 * .05, 4 + Math.floor(index / 10) * .05], elevation: 0, width: .04, depth: .04, height: .1,
  }))] });
  const layer = new SpatialTaskLayer({ scene: model.scene, tokens: spatialTokens.color, isConstructionMesh: mesh => model.isConstructionMesh(mesh) });
  try {
    model.setModel(construction, null, fixture.repository.projectId); model.setLevel(fixture.manifest.levelId); model.setCutaway(false); model.setMode('basic');
    model.frame(); const framed = { radius: model.camera.radius, target: model.camera.target.asArray() };
    model.insideCamera.position.set(2, 1.6, 2); model.insideCamera.setTarget(new Vector3(4, 1.6, 2)); model.useCamera(model.insideCamera); model.scene.render();
    assert.ok(model.renderResources().batches > 0, 'This is the shipped batching path, not an isolated construction proxy');
    const picked = model.objectAt(400, 300); assert.ok(picked);
    layer.replace(fixture.repository.projectId, [
      { identity: { kind: 'task', projectId: fixture.repository.projectId, ticketId: 'visible' }, title: 'Visible task', state: 'queued', selected: true, visible: true, placement: { kind: 'placed', origin: [3.2, 2, 1.05] } },
      { identity: { kind: 'task', projectId: fixture.repository.projectId, ticketId: 'occluded' }, title: 'Behind actual inner wall', state: 'ready', selected: false, visible: true, placement: { kind: 'placed', origin: [5, 2, 1.05] } },
      { identity: { kind: 'task', projectId: fixture.repository.projectId, ticketId: 'far-away' }, title: 'Far outside model', state: 'queued', selected: false, visible: true, placement: { kind: 'placed', origin: [1000, 2000, 9] } },
    ]);
    layer.renderFrame(0); model.scene.render();
    assert.equal(layer.pick(new Ray(new Vector3(2, 1.29, 2), new Vector3(1, 0, 0), 10), 'idle').kind, 'task');
    const behind = layer.anchors(model.insideCamera, 800, 600).find(anchor => anchor.identity.kind === 'task' && anchor.identity.ticketId === 'occluded');
    assert.ok(behind?.kind === 'hidden'); assert.equal(behind.reason, 'occluded');
    assert.equal(model.objectAt(400, 300), picked, 'Generic model picking retains construction identity');
    assert.ok(model.scene.meshes.filter(mesh => layer.ownsMesh(mesh)).every(mesh => !model.isConstructionMesh(mesh)));
    model.frame(); assert.deepEqual({ radius: model.camera.radius, target: model.camera.target.asArray() }, framed);
    assert.equal(JSON.stringify(SceneSerializer.Serialize(model.scene)).includes('task-agent:'), false);
    assert.deepEqual(fixture.repository.view(fixture.baseRevisionId).snapshot, fixture.snapshot);
  } finally { layer.dispose(); model.dispose(); engine.dispose(); }
});
