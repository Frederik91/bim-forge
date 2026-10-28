import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { parseResult, summarize } from './metrics.ts';

const schema = Type.Object({
  candidate: Type.Union([Type.Literal('babylon'), Type.Literal('babylon-batched'), Type.Literal('fragments')]),
  url: Type.String(), output: Type.String(), channel: Type.String(), headed: Type.Boolean(),
  cycles: Type.Integer({ minimum: 1, maximum: 100 }), timeout: Type.Integer({ minimum: 1, maximum: 600000 }),
  tracing: Type.Optional(Type.Boolean()), cpuProfile: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const input: unknown = JSON.parse(process.argv[2] ?? 'null');
if (!Check(schema, input)) throw new Error('Invalid candidate configuration');
const { candidate, url, output, channel, headed, cycles, timeout } = input;
function phase(name: string): void { process.send?.({ phase: name }); }
const errors: string[] = [];
phase('launch');
const server = await chromium.launchServer({ headless: !headed, ...(channel ? { channel } : {}), timeout });
process.send?.({ browserPid: server.process().pid });
try {
  phase('setup');
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({ viewport: { width: 1320, height: 1080 }, deviceScaleFactor: 1 });
  if (input.tracing !== false) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage(); page.setDefaultTimeout(timeout);
  page.on('pageerror', error => { errors.push(error.message); process.stderr.write('[viewer-benchmark] pageerror ' + error.message + '\n'); });
  page.on('crash', () => process.stderr.write('[viewer-benchmark] page-crashed\n'));
  page.on('console', message => {
    if (message.type() === 'info' && message.text().startsWith('[viewer-benchmark]')) process.stdout.write(message.text() + '\n');
    if (message.type() === 'error' || (message.type() === 'warning' && message.text().includes('WebGL: INVALID_'))) errors.push(message.text());
    if (message.type() === 'error' || message.type() === 'warning') process.stderr.write('[viewer-benchmark] console ' + message.type() + ' ' + message.text() + '\n');
  });
  await page.goto(url); await page.waitForFunction(() => !!window.viewerBenchmark);
  phase('replay');
  const profiler = input.cpuProfile ? await context.newCDPSession(page) : null;
  if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start'); }
  const raw: unknown = await page.evaluate(({ candidate, cycles }) => window.viewerBenchmark.run(candidate, cycles), { candidate, cycles });
  if (profiler) { const profile = await profiler.send('Profiler.stop'); await fs.writeFile(path.join(output, candidate + '-cpu.json'), JSON.stringify(profile)); await profiler.detach(); }
  const result = parseResult(raw, { candidate, reviewCycles: cycles });
  await fs.writeFile(path.join(output, candidate + '.json'), JSON.stringify({ result, errors, browserVersion: browser.version(),
    summaries: Object.fromEntries([...new Set(result.samples.map(sample => sample.operation))].map(operation => [operation, summarize(result.samples.filter(sample => sample.operation === operation).map(sample => sample.durationMs))])),
    frameSummary: summarize(result.frameIntervalsMs),
  }, null, 2) + '\n');
  phase('baseline-screenshot');
  await page.locator('canvas').screenshot({ path: path.join(output, candidate + '-baseline.png') });
  if (result.status === 'completed') {
    phase('preview'); await page.evaluate(() => window.viewerBenchmark.preview());
    phase('comparison'); await page.evaluate(() => window.viewerBenchmark.compare());
    phase('comparison-screenshot'); await page.locator('canvas').screenshot({ path: path.join(output, candidate + '-comparison.png') });
    phase('inspect'); const delta: unknown = await page.evaluate(() => window.viewerBenchmark.inspect());
    await fs.writeFile(path.join(output, candidate + '-review.json'), JSON.stringify(delta, null, 2) + '\n');
    phase('discard'); await page.evaluate(() => window.viewerBenchmark.discard());
    const visualEvidence = [];
    for (const scenario of ['move', 'add', 'remove'] satisfies ('move' | 'add' | 'remove')[]) {
      const images = new Map<string, Buffer>(); const stages = [];
      for (const stage of ['baseline', 'preview', 'comparison', 'discard'] satisfies ('baseline' | 'preview' | 'comparison' | 'discard')[]) {
        phase('focused-' + scenario + '-' + stage);
        const state: unknown = await page.evaluate(({ stage, scenario }) => window.viewerBenchmark.focusReview(stage, scenario), { stage, scenario });
        const png = await page.locator('canvas').screenshot({ path: path.join(output, candidate + '-' + scenario + '-' + stage + '.png') });
        const pixels = await sharp(png).ensureAlpha().raw().toBuffer(); images.set(stage, pixels);
        stages.push({ stage, pixelSha256: createHash('sha256').update(pixels).digest('hex'), state });
      }
      const baseline = images.get('baseline'); const preview = images.get('preview'); const comparison = images.get('comparison'); const discard = images.get('discard');
      if (!baseline || !preview || !comparison || !discard) throw new Error('Missing focused images');
      const differingPixels = (other: Buffer): number => {
        if (other.length !== baseline.length) throw new Error('Mismatched screenshot size');
        let count = 0;
        for (let i = 0; i < baseline.length; i += 4) if (baseline[i] !== other[i] || baseline[i + 1] !== other[i + 1] || baseline[i + 2] !== other[i + 2]) count++;
        return count;
      };
      const previewPixels = differingPixels(preview); const comparisonPixels = differingPixels(comparison); const discardPixels = differingPixels(discard);
      visualEvidence.push({ scenario, previewPixels, comparisonPixels, discardPixels, stages });
      await fs.writeFile(path.join(output, candidate + '-focused.json'), JSON.stringify(visualEvidence, null, 2) + '\n');
      if (previewPixels < 100 || comparisonPixels < 100 || discardPixels !== 0) throw new Error('Focused visual review failed: ' + scenario + ' ' + JSON.stringify({ previewPixels, comparisonPixels, discardPixels }));
    }
  }
  phase('dispose'); await page.evaluate(() => window.viewerBenchmark.dispose());
  if (input.tracing !== false) { phase('trace'); await context.tracing.stop({ path: path.join(output, candidate + '-trace.zip') }); }
  phase('close'); await browser.close();
  if (result.status !== 'completed' || errors.length) throw new Error(result.error ?? errors.join('\n'));
} finally { phase('close'); await server.close(); }
phase('completed');
process.disconnect?.();
