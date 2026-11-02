import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright';

test('opening a spatial conversation never reserves a hidden navigation gutter or resizes the model', async () => {
  const styles = await Promise.all(['room.css', 'canvas-studio.css'].map(name => fs.readFile(new URL(name, import.meta.url), 'utf8')));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 800, 390]) for (const reducedMotion of ['reduce', 'no-preference'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
      await page.setContent(`<body class="canvas-studio"><main class="workbench" style="width:100%;height:800px"><div class="workspace-toolbar"></div>
        <div id="workspace-shell" class="workspace-shell" data-navigation-open="false" data-context-open="false" data-context="request" data-chat-model="accepted">
          <aside class="workspace-navigation" hidden><h2>Model explorer</h2><p>Building navigation</p></aside>
          <div id="stage" class="workspace-stage spatial-workspace-stage"><canvas aria-label="Model"></canvas><aside class="spatial-conversation" hidden>Saved conversation</aside></div>
        </div></main></body>`);
      for (const content of styles) await page.addStyleTag({ content });
      for (const navigationOpen of [false, true]) {
        await page.evaluate(open => {
          const shell = document.getElementById('workspace-shell'); const navigation = document.querySelector('.workspace-navigation');
          const conversation = document.querySelector('.spatial-conversation');
          if (!shell || !(navigation instanceof HTMLElement) || !(conversation instanceof HTMLElement)) throw new Error('Missing shell fixture');
          shell.dataset.navigationOpen = String(open); shell.dataset.contextOpen = 'false'; navigation.hidden = !open;
          conversation.hidden = true;
        }, navigationOpen);
        await page.waitForTimeout(220);
        const before = await page.locator('#stage').boundingBox(); const shell = await page.locator('#workspace-shell').boundingBox();
        assert.ok(before && shell);
        if (!navigationOpen || width <= 900) {
          assert.ok(Math.abs(before.x - shell.x) < .5, `No empty gutter at ${width}px with navigation ${navigationOpen}`);
          assert.ok(Math.abs(before.width - shell.width) < .5, `The model fills its shell at ${width}px`);
        }
        await page.evaluate(() => {
          const shell = document.getElementById('workspace-shell'); const conversation = document.querySelector('.spatial-conversation');
          if (!shell || !(conversation instanceof HTMLElement)) throw new Error('Missing conversation fixture');
          shell.dataset.contextOpen = 'true'; conversation.hidden = false;
        });
        const frames = await page.evaluate(() => new Promise<{ x: number; width: number }[]>(resolve => {
          const samples: { x: number; width: number }[] = []; const start = performance.now();
          const sample = () => {
            const box = document.getElementById('stage')?.getBoundingClientRect();
            if (!box) throw new Error('Model stage disappeared');
            samples.push({ x: box.x, width: box.width });
            if (performance.now() - start >= 220) resolve(samples); else requestAnimationFrame(sample);
          }; sample();
        }));
        assert.ok(frames.every(frame => Math.abs(frame.x - before.x) < .5 && Math.abs(frame.width - before.width) < .5),
          `Conversation opening preserves every model frame at ${width}px (${reducedMotion}, navigation ${navigationOpen})`);
        if (navigationOpen) assert.ok(await page.locator('.workspace-navigation').isVisible(), 'Useful navigation remains available');
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
