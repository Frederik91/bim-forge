import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { parseResult, summarize } from './metrics.ts';

const schema = Type.Object({
  candidate: Type.Union([Type.Literal('babylon'), Type.Literal('fragments')]),
  url: Type.String(), output: Type.String(), channel: Type.String(), headed: Type.Boolean(),
  cycles: Type.Integer({ minimum: 1, maximum: 100 }), timeout: Type.Integer({ minimum: 1, maximum: 600000 }),
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
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
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
  const raw: unknown = await page.evaluate(({ candidate, cycles }) => window.viewerBenchmark.run(candidate, cycles), { candidate, cycles });
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
  }
  phase('dispose'); await page.evaluate(() => window.viewerBenchmark.dispose());
  phase('trace'); await context.tracing.stop({ path: path.join(output, candidate + '-trace.zip') });
  phase('close'); await browser.close();
  if (result.status !== 'completed' || errors.length) throw new Error(result.error ?? errors.join('\n'));
} finally { phase('close'); await server.close(); }
phase('completed');
process.disconnect?.();
