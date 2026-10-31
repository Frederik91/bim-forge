import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

// Run in the parent's server browser environment. This fixture uses the shipped
// markup/styles and real DOM events; the shell needs no model server or renderer.
async function workspace(browser: Browser, viewport = { width: 1440, height: 900 }, hasTouch = false, openExplorer = true): Promise<Page> {
  const context = await browser.newContext({ viewport, hasTouch, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const [html, css, chatCss, studioCss] = await Promise.all([
    readFile(new URL('./index.html', import.meta.url), 'utf8'),
    readFile(new URL('./room.css', import.meta.url), 'utf8'),
    readFile(new URL('./request-chat.css', import.meta.url), 'utf8'),
    readFile(new URL('../dist/demo/canvas-studio.css', import.meta.url), 'utf8'),
  ]);
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: chatCss });
  await page.addStyleTag({ content: studioCss });
  const script = await build({
    stdin: { contents: `
    import { WorkspaceShell } from './workspace-shell.ts';
    import { mountCanvasStudioChrome } from './workspace-react.tsx';
    const chrome = document.getElementById('workspace-chrome-mount');
    if (!chrome) throw new Error('Missing Canvas Studio chrome mount');
    mountCanvasStudioChrome(chrome);
    const shell = new WorkspaceShell();
    document.addEventListener('test-request', () => shell.showContext('request'));
    document.addEventListener('test-inspector', () => shell.showInspector());
    document.addEventListener('test-canvas', () => shell.showRequestDetails(false));
    document.getElementById('nav-history').disabled = false;
    document.getElementById('nav-history').addEventListener('click', () => {
      document.getElementById('history-page').hidden = false;
      shell.showContext('history');
    });
    document.getElementById('open-project-evidence').disabled = false;
    document.getElementById('open-project-evidence').addEventListener('click', () => {
      document.getElementById('history-page').hidden = true;
      document.getElementById('evidence-page').hidden = false;
      shell.showContext('evidence');
    });
    document.documentElement.dataset.shellReady = 'true';
    `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
    bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic',
  });
  const scriptOutput = script.outputFiles[0];
  if (!scriptOutput) throw new Error('Workspace fixture did not compile');
  await page.addScriptTag({ content: scriptOutput.text });
  await page.waitForFunction(() => document.documentElement.dataset.shellReady === 'true');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.id = 'workspace-test-canvas'; canvas.className = 'model-canvas';
    document.getElementById('proposal-drawing')?.replaceChildren(canvas);
    document.dispatchEvent(new Event('test-request'));
  });
  if (openExplorer && viewport.width > 900) await page.locator('#workspace-navigation-toggle').click();
  return page;
}

async function box(page: Page, selector: string) {
  const result = await page.locator(selector).boundingBox();
  assert.ok(result, `${selector} must be visible`);
  return result;
}

async function frame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function modelRemainsVisible(page: Page, minimumWidth = 320): Promise<void> {
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.locator('#proposal-drawing > #workspace-test-canvas').count(), 1);
  const stage = await box(page, '.workspace-stage');
  assert.ok(stage.width >= minimumWidth - 1, `Model stage was ${stage.width}px wide`);
  assert.ok(stage.height > 100, `Model stage was ${stage.height}px tall`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page-level horizontal overflow');
}

test('workspace panels preserve the model through desktop resizing, collapse and phone sheets', { timeout: 90_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  await t.test('rail tools open persistent docked side panels and preserve a long model tree', async () => {
    const page = await workspace(browser, { width: 1440, height: 900 }, false, false);
    try {
      assert.equal(await page.locator('#workspace-navigation').isHidden(), true, 'The model starts with the full canvas');
      const fullCanvas = await box(page, '.workspace-stage');
      await page.locator('#workspace-navigation-toggle').click();
      const modelPanel = await box(page, '#workspace-navigation');
      const modelStage = await box(page, '.workspace-stage');
      const shell = await box(page, '#workspace-shell');
      assert.ok(Math.abs(modelPanel.y - shell.y) <= 1 && Math.abs(modelPanel.height - shell.height) <= 1, 'Explorer is a full-height dock');
      assert.ok(modelStage.x >= modelPanel.x + modelPanel.width - 1, 'Explorer reserves canvas space');
      assert.ok(modelStage.width < fullCanvas.width, 'Collapsing and opening reallocates the canvas');
      await page.evaluate(() => {
        const tree = document.getElementById('model-explorer');
        if (!tree) throw new Error('Missing model tree');
        for (let index = 0; index < 150; index++) {
          const row = document.createElement('button'); row.className = 'model-tree-row'; row.textContent = `Building object ${index}`; tree.append(row);
        }
        tree.scrollTop = 480;
      });
      const scrollTop = await page.locator('#model-explorer').evaluate(element => element.scrollTop);
      assert.ok(scrollTop > 0, 'Long tree scrolls independently');
      await page.locator('#workspace-navigation-close').click();
      await page.locator('#workspace-navigation-toggle').click();
      assert.equal(await page.locator('#model-explorer').evaluate(element => element.scrollTop), scrollTop, 'Reopening preserves tree position');
      await page.locator('#nav-history').click();
      assert.equal(await page.locator('#workspace-navigation-heading').textContent(), 'Model history');
      assert.equal(await page.locator('#workspace-tools-content #history-page').isVisible(), true);
      assert.equal(await page.locator('#workspace-explorer-content').isHidden(), true);
      assert.equal(await page.locator('#workspace-context').isVisible(), true, 'Assistant remains available beside tools');
      assert.equal(await page.locator('dialog[open], .canvas-proposal-tray[role="dialog"]').count(), 0, 'Rail tools do not open popups');
      await page.locator('#open-project-evidence').click();
      assert.equal(await page.locator('#workspace-tools-content #evidence-page').isVisible(), true);
      await page.locator('#workspace-navigation-close').click();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-project-evidence', 'Closing restores the initiating rail command');
      await page.locator('#workspace-navigation-toggle').click();
      assert.equal(await page.locator('#workspace-navigation-heading').textContent(), 'Model explorer');
      assert.equal(await page.locator('#model-explorer').evaluate(element => element.scrollTop), scrollTop, 'Tool routing retains the same tree');
      assert.equal(await page.locator('#workspace-navigation').evaluate(element => getComputedStyle(element).transitionDuration), '0s', 'Reduced motion skips panel transitions');
      await modelRemainsVisible(page);
    } finally { await page.context().close(); }
  });

  await t.test('keyboard separators announce bounds, follow their physical edge and preserve model width on viewport changes', async () => {
    const page = await workspace(browser);
    try {
      const navigation = page.getByRole('separator', { name: 'Resize model navigation' });
      const context = page.getByRole('separator', { name: 'Resize context panel' });
      assert.equal(await navigation.getAttribute('aria-controls'), 'workspace-navigation');
      assert.equal(await context.getAttribute('aria-orientation'), 'vertical');
      const start = Number(await navigation.getAttribute('aria-valuenow'));
      await navigation.focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(Number(await navigation.getAttribute('aria-valuenow')), start + 8);
      await page.keyboard.press('Shift+ArrowLeft');
      assert.equal(Number(await navigation.getAttribute('aria-valuenow')), start - 24);
      await page.keyboard.press('Home');
      assert.equal(await navigation.getAttribute('aria-valuenow'), await navigation.getAttribute('aria-valuemin'));
      await page.keyboard.press('End');
      assert.equal(await navigation.getAttribute('aria-valuenow'), await navigation.getAttribute('aria-valuemax'));

      await context.focus();
      const before = Number(await context.getAttribute('aria-valuenow'));
      await page.keyboard.press('ArrowLeft');
      assert.equal(Number(await context.getAttribute('aria-valuenow')), before + 8);
      await page.keyboard.press('End');
      await page.setViewportSize({ width: 901, height: 800 });
      await frame(page);
      await modelRemainsVisible(page);
      assert.ok(Number(await context.getAttribute('aria-valuenow')) <= Number(await context.getAttribute('aria-valuemax')));
      assert.ok(Math.abs((await box(page, '#workspace-context')).width - Number(await context.getAttribute('aria-valuenow'))) <= 1);

      await page.locator('#workspace-context-toggle').click();
      assert.equal(await page.locator('#workspace-context').isHidden(), true);
      await navigation.focus(); await page.keyboard.press('End');
      await page.locator('#workspace-context-toggle').click();
      await frame(page); await modelRemainsVisible(page);
      await navigation.focus(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#workspace-navigation').isHidden(), true);
      assert.equal(await page.locator('#workspace-navigation-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'workspace-navigation-toggle');
    } finally { await page.context().close(); }
  });

  await t.test('pointer capture resizes both edges, clamps widths and remembers a collapsed panel', async () => {
    const page = await workspace(browser);
    try {
      const navigation = page.getByRole('separator', { name: 'Resize model navigation' });
      const navBox = await box(page, '.workspace-panel-resizer[data-panel="navigation"]');
      await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + 80);
      await page.mouse.down(); await page.mouse.move(700, navBox.y + 80); await page.mouse.up();
      assert.equal(await navigation.getAttribute('aria-valuenow'), await navigation.getAttribute('aria-valuemax'));
      const width = (await box(page, '#workspace-navigation')).width;
      await page.locator('#workspace-navigation-close').click();
      await page.locator('#workspace-navigation-toggle').click();
      assert.equal((await box(page, '#workspace-navigation')).width, width);
      const context = page.getByRole('separator', { name: 'Resize context panel' });
      const contextBox = await box(page, '.workspace-panel-resizer[data-panel="context"]');
      await page.mouse.move(contextBox.x + contextBox.width / 2, contextBox.y + 80);
      await page.mouse.down(); await page.mouse.move(100, contextBox.y + 80); await page.mouse.up();
      assert.equal(await context.getAttribute('aria-valuenow'), await context.getAttribute('aria-valuemax'));
      assert.equal(await page.locator('[data-dragging]').count(), 0);
      await modelRemainsVisible(page);
    } finally { await page.context().close(); }
  });

  await t.test('long conversations scroll above a composer contained in the full-height panel', async () => {
    const page = await workspace(browser);
    try {
      await page.evaluate(() => {
        const transcript = document.createElement('section'); transcript.className = 'request-chat';
        for (let index = 0; index < 80; index++) {
          const message = document.createElement('p'); message.textContent = `Message ${index}: keep this conversation available while inspecting the model.`;
          transcript.append(message);
        }
        document.getElementById('request-chat-mount')?.append(transcript);
      });
      await frame(page);
      const composer = await box(page, '#proposal-form');
      const panel = await box(page, '#workspace-context');
      assert.ok(composer.y >= panel.y && composer.y + composer.height <= panel.y + panel.height + 1, 'Composer fits inside context panel');
      const scrolls = await page.locator('#request-chat-mount').evaluate(element => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop > 0;
      });
      assert.equal(scrolls, true, 'Long transcript has its own scroll area');
      assert.deepEqual(await box(page, '#proposal-form'), composer, 'Transcript scrolling leaves composer pinned');
      await modelRemainsVisible(page);
    } finally { await page.context().close(); }
  });

  await t.test('header design controls and selection actions fit desktop and narrow touch layouts', async () => {
    for (const width of [1440, 390, 320]) {
      const page = await workspace(browser, { width, height: 900 }, width < 901);
      try {
        // Fill the parent-owned controller's layout seam without running model actions.
        await page.evaluate(() => {
          const mount = document.getElementById('design-views-mount');
          if (!mount) throw new Error('Missing design mount');
          document.querySelector('.header-actions')?.prepend(mount);
          const switcher = document.createElement('div'); switcher.className = 'design-workspace-switcher';
          const select = document.createElement('select'); select.className = 'design-workspace-select';
          select.setAttribute('aria-label', 'Design');
          const option = document.createElement('option'); option.textContent = 'Alternative with a deliberately long engineering study name';
          select.append(option); switcher.append(select);
          for (const label of ['+ Alternative', 'Manage']) {
            const button = document.createElement('button'); button.className = 'button quiet'; button.textContent = label; switcher.append(button);
          }
          mount.replaceChildren(switcher);
          const bar = document.getElementById('selection-context') ?? document.createElement('div');
          bar.id = 'selection-context'; bar.className = 'selection-context'; bar.hidden = false;
          const label = document.createElement('strong'); label.textContent = 'Shared wall between the kitchen and living room';
          bar.replaceChildren(label);
          for (const text of ['Ask about this', 'Suggest a move', 'Properties']) {
            const button = document.createElement('button'); button.className = 'button quiet'; button.textContent = text; bar.append(button);
          }
          const drawing = document.getElementById('proposal-drawing'); drawing?.before(bar);
        });
        await frame(page);
        if (width <= 900) await page.locator('#workspace-context-close').click();
        for (const selector of ['.design-workspace-select', '.design-workspace-switcher > button', '.selection-context button']) {
          for (const control of await page.locator(selector).all()) {
            const bounds = await control.boundingBox(); assert.ok(bounds);
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${selector} fits ${width}px`);
            if (width > 900) assert.ok(bounds.height >= 30 && bounds.height <= 34, `${selector} is compact on desktop`);
            else assert.ok(bounds.height >= 44, `${selector} retains a touch target`);
          }
        }
        await modelRemainsVisible(page, width > 900 ? 320 : width);
      } finally { await page.context().close(); }
    }
  });

  await t.test('a phone proposal leaves readable chat history and visible model geometry', async () => {
    const page = await workspace(browser, { width: 390, height: 844 }, true);
    try {
      await page.evaluate(() => {
        const shell = document.getElementById('workspace-shell'); if (shell) shell.dataset.chatModel = 'proposal';
        const tools = document.getElementById('chat-proposal-tools'); if (tools) tools.hidden = false;
        const controls = document.getElementById('model-3d-controls'); if (controls) controls.hidden = false;
        const selection = document.getElementById('selection-context'); if (selection) selection.hidden = false;
        const transcript = document.createElement('section'); transcript.className = 'request-chat';
        for (let index = 0; index < 30; index++) {
          const message = document.createElement('p'); message.textContent = `Message ${index}: inspect this proposed model change.`; transcript.append(message);
        }
        document.getElementById('request-chat-mount')?.append(transcript);
      });
      await frame(page);
      const history = await box(page, '#request-chat-mount');
      const model = await box(page, '#workspace-test-canvas'); const panel = await box(page, '#workspace-context');
      assert.ok(history.height >= 120, `Readable history was only ${history.height}px`);
      assert.ok(Math.min(model.y + model.height, panel.y) - model.y >= 200, 'The model preview stays useful while reading chat');
      assert.equal(await page.locator('#model-3d-controls').isVisible(), false, 'Closing chat restores the full model toolbars');
      assert.equal(await page.locator('#request-options').isVisible(), false, 'Advanced options start under the + menu');
      assert.ok((await box(page, '#composer-add')).height >= 44);
      await modelRemainsVisible(page, 390);
    } finally { await page.context().close(); }
  });

  await t.test('phone sheets exclude one another, keep touch targets and retain external inspector behavior', async () => {
    for (const width of [390, 320]) {
      const page = await workspace(browser, { width, height: 844 }, true);
      try {
        assert.equal(await page.getByRole('separator').count(), 0, 'Desktop resize handles leave the phone accessibility tree');
        assert.equal(await page.locator('#workspace-navigation').isHidden(), true);
        await page.locator('#workspace-navigation-toggle').click();
        assert.equal(await page.locator('#workspace-context').isHidden(), true);
        await page.locator('#workspace-context-toggle').click();
        assert.equal(await page.locator('#workspace-navigation').isHidden(), true);
        await page.evaluate(() => {
          const inspector = document.getElementById('element-inspector');
          if (inspector instanceof HTMLDetailsElement) inspector.open = false;
          document.dispatchEvent(new Event('test-inspector'));
        });
        assert.equal(await page.locator('#element-inspector').getAttribute('open'), '');
        assert.equal(await page.locator('#workspace-context').isHidden(), true);
        for (const selector of ['#workspace-navigation-toggle', '#workspace-context-toggle', '#workspace-navigation-close', '#view-plan', '#view-3d']) {
          assert.ok((await box(page, selector)).height >= 44, `${selector} needs a phone touch target`);
        }
        await modelRemainsVisible(page, width);
        await page.locator('#workspace-navigation-close').click();
        await page.evaluate(() => document.dispatchEvent(new Event('test-request')));
        await page.evaluate(() => document.dispatchEvent(new Event('test-canvas')));
        assert.equal(await page.locator('#workspace-context').isHidden(), true);
      } finally { await page.context().close(); }
    }
  });
});
