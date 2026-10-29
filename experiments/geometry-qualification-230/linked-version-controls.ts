import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Page, Route } from 'playwright';
import { parseLinkedCatalog, parseLinkedPrepared, parseLinkedReview } from '../../src/linked-model.ts';

/** Actual disposable-project UI actions and public read routes. No provider or scene hooks. */
export async function qualifyLinkedVersions(input: {
  page: Page; base: string; projectId: string; originalHref: string; artifacts: string; fixtures: string;
  historicalPinHref: string; historicalPinText: string;
}) {
  const { page, base } = input;
  const parsed = /^\/api\/projects\/([a-f0-9-]{36})\/ifc-links\/([a-f0-9-]{36})\/original$/.exec(input.originalHref);
  assert.ok(parsed && parsed[1] === input.projectId && parsed[2]);
  const linkId = parsed[2];
  const prefix = `${base}/api/projects/${input.projectId}/ifc-links`;
  if (await page.locator('#workspace-navigation').isHidden()) await page.locator('#workspace-navigation-toggle').click();
  if (await page.locator('#linked-model-references').getAttribute('open') === null) await page.locator('#linked-model-references > summary').click();
  const section = page.locator(`#linked-model-mount a[href="${input.originalHref}"]`).locator('..');
  const observations: unknown[] = [];
  async function record(event: unknown) {
    observations.push(event);
    await fs.writeFile(path.join(input.artifacts, 'linked-version-ui-events.json'), JSON.stringify(observations, null, 2) + '\n');
  }
  async function catalog() {
    const response = await page.request.get(prefix + '/catalog'); assert.equal(response.status(), 200);
    const value: unknown = await response.json();
    const current = parseLinkedCatalog(value).find(item => item.state.id === linkId); assert.ok(current);
    return current;
  }
  async function currentPrepared() {
    const response = await page.request.get(`${prefix}/${linkId}/prepared`); assert.equal(response.status(), 200);
    const value: unknown = await response.json(); return parseLinkedPrepared(value);
  }
  async function showHistory() {
    const summary = section.locator('summary').filter({ hasText: /^Source versions and candidate changes$/ });
    if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  }
  function candidateRow(name: string, state = 'ready') {
    return section.getByRole('heading', { name: `${name} · Candidate · ${state}`, exact: true, includeHidden: true }).locator('..');
  }
  async function stage(filename: string, fixtureName: string, terminal: 'ready' | 'failed' = 'ready') {
    const before = await catalog();
    await section.getByText(new RegExp(`retained source versions · generation ${before.state.generation}\\.`)).waitFor();
    const response = page.waitForResponse(item => item.url() === `${prefix}/${linkId}/candidate` && item.request().method() === 'POST');
    await section.getByLabel(/^Prepare replacement for /).setInputFiles({ name: filename, mimeType: 'application/x-step',
      buffer: await fs.readFile(path.join(input.fixtures, fixtureName)) });
    assert.equal((await response).status(), 202);
    await candidateRow(filename, terminal).getByRole('heading', { includeHidden: true }).waitFor({ state: 'attached', timeout: 60_000 });
    await showHistory();
    await candidateRow(filename, terminal).getByRole('heading').waitFor();
    const after = await catalog();
    const version = after.versions.find(item => item.job.name === filename); assert.ok(version);
    assert.equal(after.state.generation, before.state.generation, 'Preparing or failing a staged candidate cannot advance current generation.');
    assert.equal(after.state.currentVersionId, before.state.currentVersionId);
    await record({ event: 'candidate-terminal', filename, terminal, generation: after.state.generation, versionId: version.job.id });
    return version;
  }
  async function review(filename: string, versionId: string) {
    const response = page.waitForResponse(item => item.url() === `${prefix}/${linkId}/versions/${versionId}/review` && item.request().method() === 'GET');
    await candidateRow(filename).getByRole('button', { name: 'Review candidate changes', exact: true }).click();
    const read = await response; assert.equal(read.status(), 200);
    const value: unknown = await read.json(); const result = parseLinkedReview(value);
    await candidateRow(filename).getByRole('button', { name: 'Adopt reviewed IFC version', exact: true, includeHidden: true }).waitFor({ state: 'attached' });
    await showHistory();
    await candidateRow(filename).getByRole('button', { name: 'Adopt reviewed IFC version', exact: true }).waitFor();
    await record({ event: 'review', filename, result }); return result;
  }
  async function adopt(filename: string, versionId: string) {
    const before = await catalog();
    const response = page.waitForResponse(item => item.url() === `${prefix}/${linkId}/versions/${versionId}/adopt` && item.request().method() === 'POST');
    await candidateRow(filename).getByRole('button', { name: 'Adopt reviewed IFC version', exact: true }).click();
    const reply = await response; assert.equal(reply.status(), 200);
    const after = await catalog();
    assert.equal(after.state.currentVersionId, versionId);
    assert.equal(after.state.generation, before.state.generation + 1);
    await section.getByRole('heading', { name: `${filename} · Current · ready`, exact: true, includeHidden: true }).waitFor({ state: 'attached' });
    await record({ event: 'adopt', filename, state: after.state }); return after;
  }
  const initialCatalog = await catalog(); const initial = await currentPrepared();
  const wall = initial.index.objects.find(object => object.name === 'Invented wall'); assert.ok(wall);
  await stage('Malformed candidate 234.ifc', 'malformed.ifc', 'failed');
  assert.equal((await currentPrepared()).manifest.source.originalSha256, initial.manifest.source.originalSha256);
  await section.getByRole('list', { name: /spatial hierarchy$/ }).getByRole('button', { name: 'Invented wall · IfcWall', exact: true }).click();
  assert.match(await section.locator('[aria-label="Original IFC properties and conversion losses"]').innerText(), /EI60/);
  const propertyVersion = await stage('Property candidate 234.ifc', 'mm-property.ifc');
  assert.equal((await currentPrepared()).manifest.source.originalSha256, initial.manifest.source.originalSha256);
  const propertyReview = await review('Property candidate 234.ifc', propertyVersion.job.id);
  assert.ok(propertyReview.delta.properties.includes(wall.ref.globalId));
  assert.equal(propertyReview.delta.geometry.length, 0);
  assert.equal(propertyReview.delta.moved.length, 0);
  await adopt('Property candidate 234.ifc', propertyVersion.job.id);
  const propertyCurrent = await currentPrepared();
  assert.equal(propertyCurrent.manifest.source.namespace, initial.manifest.source.namespace);
  assert.equal(propertyCurrent.manifest.occurrence.id, initial.manifest.occurrence.id);
  assert.equal(propertyCurrent.manifest.source.originalSha256, propertyVersion.job.source.originalSha256);
  assert.equal(await (await page.request.get(base + input.historicalPinHref)).text(), input.historicalPinText);

  const motionVersion = await stage('Raced motion 234.ifc', 'mm-wall-motion.ifc');
  await review('Raced motion 234.ifc', motionVersion.job.id);
  const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  const adoptUrl = `${prefix}/${linkId}/versions/${motionVersion.job.id}/adopt`;
  // Delay ONLY the actual UI-generated adoption request. Do not alter URL, body,
  // headers, auth or response. A second real UI commits placement before forwarding.
  const intercept = async (route: Route) => {
    entered.resolve(); await release.promise; await route.continue();
  };
  await page.route(adoptUrl, intercept, { times: 1 });
  const browser = page.context().browser(); assert.ok(browser);
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const other = await otherContext.newPage();
    await other.goto(base);
    const projectPicker = other.locator('#start-dialog');
    if (!await projectPicker.isVisible()) {
      await other.locator('.workspace-file-menu > summary').click();
      await other.getByRole('button', { name: 'Projects', exact: true }).click();
    }
    await projectPicker.waitFor({ state: 'visible' });
    await projectPicker.locator('#saved-projects').selectOption(input.projectId);
    await projectPicker.getByRole('button', { name: 'Open latest accepted model', exact: true }).click();
    await projectPicker.waitFor({ state: 'hidden' });
    if (await other.locator('#workspace-navigation').isHidden()) await other.locator('#workspace-navigation-toggle').click();
    if (await other.locator('#linked-model-references').getAttribute('open') === null) await other.locator('#linked-model-references > summary').click();
    const otherSection = other.locator(`#linked-model-mount a[href="${input.originalHref}"]`).locator('..');
    const placementSummary = otherSection.locator('summary').filter({ hasText: /^Occurrence placement in project$/ });
    await placementSummary.click();
    await otherSection.getByLabel(/ X metres$/).fill('4');
    await otherSection.getByLabel(/ Y metres$/).fill('-2');
    await otherSection.getByLabel(/ Z metres$/).fill('.5');
    await otherSection.getByLabel(/ Rotation degrees$/).fill('30');
    const racedResponse = page.waitForResponse(item => item.url() === adoptUrl && item.request().method() === 'POST');
    const click = candidateRow('Raced motion 234.ifc').getByRole('button', { name: 'Adopt reviewed IFC version', exact: true }).click();
    await Promise.race([entered.promise, click.then(() => entered.promise)]);
    const placementResponse = other.waitForResponse(item => item.url() === `${prefix}/${linkId}/placement` && item.request().method() === 'POST');
    await otherSection.getByRole('button', { name: 'Apply occurrence placement', exact: true }).click();
    assert.equal((await placementResponse).status(), 200);
    const placed = await catalog();
    assert.equal(placed.state.currentVersionId, propertyVersion.job.id);
    release.resolve(); await click;
    const rejected = await racedResponse;
    const rejectedBody: unknown = await rejected.json();
    await record({ event: 'adopt-placement-race', status: rejected.status(), rejection: rejectedBody, state: placed.state });
    assert.ok(rejected.status() === 400 || rejected.status() === 409, 'Stale UI adoption must lose to a committed concurrent placement.');
    assert.equal((await catalog()).state.currentVersionId, propertyVersion.job.id);
  } finally {
    release.resolve(); await page.unroute(adoptUrl, intercept); await otherContext.close();
  }
  const freshMotion = await stage('Fresh motion 234.ifc', 'mm-wall-motion.ifc');
  const freshReview = await review('Fresh motion 234.ifc', freshMotion.job.id);
  assert.ok(freshReview.delta.moved.includes(wall.ref.globalId));
  const finalCatalog = await adopt('Fresh motion 234.ifc', freshMotion.job.id);
  const final = await currentPrepared();
  assert.equal(final.manifest.source.namespace, initial.manifest.source.namespace);
  assert.equal(final.manifest.occurrence.id, initial.manifest.occurrence.id);
  assert.equal(final.manifest.source.originalSha256, freshMotion.job.source.originalSha256);
  assert.equal(final.manifest.occurrence.sourceToProjectMetres[0]?.[3], 4);
  assert.equal(final.manifest.occurrence.sourceToProjectMetres[1]?.[3], -2);
  assert.equal(final.manifest.occurrence.sourceToProjectMetres[2]?.[3], .5);
  assert.ok(Math.abs((final.manifest.occurrence.sourceToProjectMetres[1]?.[0] ?? Infinity) - .5) < 1e-12);
  const initialVersion = initialCatalog.versions.find(version => version.current); assert.ok(initialVersion);
  for (const version of [initialVersion, propertyVersion, freshMotion]) {
    await showHistory();
    const href = `${prefix}/${linkId}/versions/${version.job.id}/original`;
    // Use the actual rendered historical download anchor, including its association.
    assert.equal(await section.locator(`a[href="${new URL(href).pathname}"]`).count(), 1);
    const response = await page.request.get(href); assert.equal(response.status(), 200);
    assert.equal(createHash('sha256').update(await response.body()).digest('hex'), version.job.source.originalSha256);
  }
  assert.equal(await (await page.request.get(base + input.historicalPinHref)).text(), input.historicalPinText);
  await section.getByRole('list', { name: /spatial hierarchy$/ }).getByRole('button', { name: 'Invented wall · IfcWall', exact: true }).click();
  assert.match(await section.locator('[aria-label="Original IFC properties and conversion losses"]').innerText(), /EI60/);
  await page.locator('#selection-ask').click();
  await page.getByText('3 of 4 files ready', { exact: true }).waitFor();
  const links = await page.locator('#request-source-list a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  let currentPin: string | null = null;
  for (const href of links) {
    assert.ok(href); const text = await (await page.request.get(base + href)).text();
    if (text.includes(final.manifest.source.originalSha256)) currentPin = text;
  }
  assert.ok(currentPin);
  await page.screenshot({ path: path.join(input.artifacts, 'same-link-history-placement-desktop.png'), fullPage: true });
  await record({ event: 'final-current', catalog: finalCatalog, source: final.manifest.source, occurrence: final.manifest.occurrence });
  return { prepared: final, currentPin, linkId, finalGeneration: finalCatalog.state.generation };
}
