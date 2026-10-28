import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { admission, assertNativeManifest, parseFragmentsInput, parseModel } from './contract.ts';
import { smokeModel } from './fixtures.ts';
import { runCandidateProcess } from './runner-limits.ts';
import type { Candidate } from './metrics.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const known = new Set(['--candidate', '--dataset', '--output', '--channel', '--cycles', '--timeout-ms', '--elements', '--headed', '--serve', '--fragments', '--no-trace', '--profile']);
for (const argument of args.filter(item => item.startsWith('--'))) if (!known.has(argument)) throw new Error('Unknown option: ' + argument);
function option(name: string, fallback: string): string {
  const index = args.indexOf(name); if (index === -1) return fallback;
  const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + name);
  return value;
}
function integer(name: string, fallback: number, maximum: number): number {
  const result = Number(option(name, String(fallback)));
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new Error('Invalid ' + name);
  return result;
}
const candidate = option('--candidate', 'both');
if (candidate !== 'both' && candidate !== 'babylon' && candidate !== 'babylon-batched' && candidate !== 'fragments') throw new Error('Candidate must be babylon, babylon-batched, fragments, or both');
const candidates: Candidate[] = candidate === 'both' ? ['babylon', 'fragments'] : [candidate];
const cycles = integer('--cycles', 3, 100);
const timeout = integer('--timeout-ms', 120000, 600000);
const count = integer('--elements', 24, 10000);
const dataset = option('--dataset', '');
const model = parseModel(dataset ? JSON.parse(await fs.readFile(path.resolve(dataset), 'utf8')) : smokeModel(count), 'transfer');
const channel = option('--channel', '');
const output = path.resolve(option('--output', path.join(root, 'artifacts/private/viewer-benchmark', new Date().toISOString().replaceAll(':', '-'))));
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output, { recursive: false });
const assets = path.join(output, 'assets'); await fs.mkdir(assets);
const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const modelText = JSON.stringify(model);
const nativePath = option('--fragments', '');
const nativeBytes = nativePath ? await fs.readFile(path.resolve(nativePath)) : null;
const fragmentsInput = parseFragmentsInput(nativePath ? { kind: 'native', manifest: JSON.parse(await fs.readFile(path.resolve(nativePath) + '.json', 'utf8')) } : { kind: 'raw-edit' });
if (fragmentsInput.kind === 'native') {
  assertNativeManifest(fragmentsInput.manifest, model, hash(modelText));
  if (!nativeBytes || nativeBytes.length !== fragmentsInput.manifest.bytes || hash(nativeBytes) !== fragmentsInput.manifest.sha256) throw new Error('Native Fragments binary integrity mismatch');
}
const purpose = model.provenance.kind === 'synthetic' ? 'setup-smoke' : 'initial-local';
const profile: unknown = JSON.parse(await fs.readFile(path.join(root, 'benchmarks/viewer/profile.json'), 'utf8'));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'benchmarks/viewer', 'package.json', 'package-lock.json', 'tsconfig.json', 'scripts/validate-typescript.ts'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const sourceFiles = await Promise.all(files.map(async name => ({ path: name, sha256: hash(await fs.readFile(path.join(root, name))) })));
await fs.writeFile(path.join(output, 'run.json'), JSON.stringify({ version: 1, issue: 192, purpose, qualified: false,
  source, dirty: dirty.length > 0, sourceFiles, dataset: { id: model.id, sha256: hash(modelText), elements: model.elements.length,
    triangles: model.geometries.reduce((sum, geometry) => sum + geometry.indices.length / 3, 0), admission: admission(model),
    grossFloorAreaM2: model.grossFloorAreaM2, provenance: model.provenance,
    disciplines: Object.fromEntries([...new Set(model.elements.map(item => item.discipline))].map(discipline =>
      [discipline, model.elements.filter(item => item.discipline === discipline).length])) },
  profile, candidates, cycles, timeout, tracing: !args.includes('--no-trace'), cpuProfile: args.includes('--profile'), fragmentsInput, fragmentsLodMode: 'ALL_GEOMETRY', node: process.version, os: { platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unavailable', totalMemoryBytes: os.totalmem() },
  network: 'loopback, unshaped', memory: 'not-measured', status: 'started',
}, null, 2) + '\n');
await build({ entryPoints: [path.join(root, 'benchmarks/viewer/browser.ts')], outdir: assets, entryNames: 'browser', chunkNames: '[name]-[hash]',
  outExtension: { '.js': '.mjs' }, bundle: true, splitting: true, platform: 'browser', format: 'esm', target: 'es2023', sourcemap: true, logLevel: 'warning' });
await fs.copyFile(path.join(root, 'node_modules/@thatopen/fragments/dist/Worker/worker.mjs'), path.join(assets, 'fragments-worker.mjs'));
const pageHtml = `<!doctype html><html lang="en"><meta charset="utf-8"><title>BIM Forge viewer benchmark</title>
<style>body{font:16px system-ui;margin:16px;background:#f0f2f5}canvas{display:block;width:1280px;height:800px}button{padding:10px;margin:8px}pre{white-space:pre-wrap}</style>
<h1>Viewer benchmark setup</h1><p>Synthetic smoke replay or an explicitly supplied dataset. No large-project qualification.</p>
<button data-candidate="babylon">Run Babylon</button><button data-candidate="babylon-batched">Run batched Babylon</button><button data-candidate="fragments">Run Fragments</button>
<canvas width="1280" height="800" aria-label="Benchmark model"></canvas><pre>Ready. Select a candidate.</pre>
<script type="module" src="/browser.mjs"></script></html>`;
const assetNames = new Set(await fs.readdir(assets));
const server = createServer(async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: blob:");
    const name = request.url?.split('?')[0]?.slice(1) ?? '';
    if (name === '' || name === 'index.html') { response.setHeader('Content-Type', 'text/html'); response.end(pageHtml); }
    else if (name === 'dataset.json') { response.setHeader('Content-Type', 'application/json'); response.end(modelText); }
    else if (name === 'fragments-input.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(fragmentsInput)); }
    else if (name === 'native.frag' && nativeBytes) { response.setHeader('Content-Type', 'application/octet-stream'); response.end(nativeBytes); }
    else if (name === 'favicon.ico') { response.writeHead(204); response.end(); }
    else if (assetNames.has(name)) { response.setHeader('Content-Type', name.endsWith('.mjs') ? 'text/javascript' : 'application/json'); response.end(await fs.readFile(path.join(assets, name))); }
    else { response.writeHead(404); response.end(); }
  } catch (error) { response.writeHead(500); response.end('Benchmark asset failed'); process.stderr.write(String(error) + '\n'); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('No benchmark address');
const url = 'http://127.0.0.1:' + address.port;
process.stdout.write('Benchmark assets: ' + url + '\nEvidence: ' + output + '\n');
if (args.includes('--serve')) {
  process.stdout.write('Manual mode. Open the URL and select a candidate. Stop with Ctrl+C.\n');
} else {
  let failed = false;
  try {
    for (const engine of candidates) {
      const passed = await runCandidateProcess({ candidate: engine, output, timeoutMs: timeout, executable: process.execPath,
        args: [fileURLToPath(new URL('./runner-candidate.ts', import.meta.url)), JSON.stringify({
          candidate: engine, url, output, channel, headed: args.includes('--headed'), cycles, timeout, tracing: !args.includes('--no-trace'), cpuProfile: args.includes('--profile'),
        })],
      });
      if (!passed) failed = true;
      process.stdout.write(engine + ': ' + (passed ? 'completed' : 'failed') + '\n');
    }
    await fs.writeFile(path.join(output, 'completion.json'), JSON.stringify({ status: failed ? 'failed' : 'completed', qualified: false,
      purpose, realisticDataset: 'not-qualified', finishedAt: new Date().toISOString() }, null, 2) + '\n');
    if (failed) process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
