import type { Adapter, Element, Model, Proposal } from './contract.ts';
import { admission, applyProposal, assertReadback, changesBetween, comparisonElements, parseModel } from './contract.ts';
import { smokeProposal } from './fixtures.ts';
import type { Candidate, Result, Sample } from './metrics.ts';

declare global {
  interface Window {
    viewerBenchmark: {
      run(candidate: Candidate, cycles: number): Promise<Result>;
      preview(): Promise<void>; compare(): Promise<void>; discard(): Promise<void>;
      dispose(): Promise<void>; inspect(): Promise<unknown>;
    };
  }
}

function requireCanvas(): HTMLCanvasElement {
  const element = document.querySelector('canvas');
  if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing benchmark canvas');
  return element;
}
function requireOutput(): HTMLPreElement {
  const element = document.querySelector('pre');
  if (!(element instanceof HTMLPreElement)) throw new Error('Missing benchmark output');
  return element;
}
const canvas = requireCanvas(); const output = requireOutput();
let adapter: Adapter | null = null;
let accepted: Model | null = null;
let proposed: Model | null = null;
let displayed: Element[] = [];
let comparison = false;
let active = false;

function loaded(): { adapter: Adapter; accepted: Model } {
  if (!adapter || !accepted) throw new Error('Run a candidate first');
  return { adapter, accepted };
}
async function show(elements: Element[]): Promise<void> {
  const { adapter: renderer, accepted: base } = loaded();
  await renderer.apply(changesBetween(displayed, elements));
  assertReadback(base, elements, await renderer.readback());
  displayed = elements;
}
async function preview(proposal?: Proposal): Promise<void> {
  const { accepted: base } = loaded();
  const next = applyProposal(base, proposal ?? smokeProposal(base));
  await show(next.elements); proposed = next; comparison = false;
}
async function compare(): Promise<void> {
  const { accepted: base } = loaded(); if (!proposed) throw new Error('Preview a proposal first');
  const next = !comparison;
  await show(next ? comparisonElements(base, proposed) : proposed.elements); comparison = next;
}
async function discard(): Promise<void> {
  await show(loaded().accepted.elements); proposed = null; comparison = false;
}
async function dispose(): Promise<void> {
  if (adapter) await adapter.dispose(); adapter = null; accepted = null; proposed = null; displayed = []; comparison = false;
}

async function replay(candidate: Candidate, cycles: number): Promise<Result> {
  if (active) throw new Error('Benchmark already running');
  active = true;
  const samples: Sample[] = []; const checks: string[] = []; const frameIntervalsMs: number[] = [];
  const result: Result = { version: 1, candidate, profile: 'viewer-192-v1', purpose: 'setup-smoke', status: 'failed', qualified: false,
    samples, checks, frameIntervalsMs, error: null,
    limitations: ['Setup replay, not a scored engine comparison. No full-project or hardware qualification.',
      'No current production Babylon baseline, native IFC conversion, streaming, instancing tuning, or automated memory qualification yet.',
      'Renderer completion is followed by requestAnimationFrame; GPU presentation timing requires external tracing.',
      'CPU, process/GPU memory, transfer shaping, long tasks, conversion equivalence, and shader fidelity need scored-run instrumentation.',
      'Neutral diff/readback scans the input. Timings include those checks and must not be called isolated renderer performance.'],
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      renderer: 'unavailable', viewport: [canvas.width, canvas.height], devicePixelRatio: devicePixelRatio },
  };
  async function measure(operation: string, work: () => Promise<void>): Promise<void> {
    const start = performance.now(); await work();
    if (!adapter) throw new Error('Missing active adapter');
    samples.push({ operation, durationMs: performance.now() - start, ...adapter.stats() });
  }
  try {
    await dispose();
    const response = await fetch('/dataset.json'); if (!response.ok) throw new Error('Dataset fetch failed');
    const input: unknown = await response.json(); const model = parseModel(input);
    const firstCamera = model.cameraPath[0];
    accepted = model; result.limitations.push(...admission(model).reasons);
    const baseline = JSON.stringify(model);
    if (candidate === 'babylon') {
      const { BabylonAdapter } = await import('./adapters/babylon.ts'); adapter = new BabylonAdapter(canvas);
    } else {
      const { FragmentsAdapter } = await import('./adapters/fragments.ts'); adapter = new FragmentsAdapter(canvas);
    }
    const renderer = adapter;
    const gl = canvas.getContext('webgl2');
    if (gl) {
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const name: unknown = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (typeof name === 'string') result.environment.renderer = name;
    }
    await measure('load', async () => { await renderer.load(model); await renderer.camera(firstCamera); });
    displayed = model.elements;
    assertReadback(model, model.elements, await renderer.readback()); checks.push('load', 'renderer-readback');
    const stable = model.elements[2]; if (!stable) throw new Error('Replay needs three elements');
    await measure('select', () => renderer.select(stable.id));
    await measure('properties', async () => {
      const actual = await renderer.properties(stable.id);
      if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(stable.properties).sort())) throw new Error('Property readback mismatch');
    });
    let picked: string | null = null;
    let pickX = canvas.width / 2; let pickY = canvas.height / 2;
    await measure('pick', async () => {
      for (const x of [canvas.width / 2, canvas.width * .4, canvas.width * .6]) {
        for (const y of [canvas.height / 2, canvas.height * .4, canvas.height * .6]) {
          picked = await renderer.pick(x, y); if (picked) { pickX = x; pickY = y; return; }
        }
      }
      throw new Error('No geometry could be ray-picked');
    }); checks.push('pick');
    await measure('filter', async () => {
      await renderer.visible([]);
      if (await renderer.pick(pickX, pickY)) throw new Error('Hidden geometry intercepted a pick');
      await renderer.visible(null);
    }); checks.push('filter');
    await measure('section', async () => {
      await renderer.section(-1000);
      if (await renderer.pick(pickX, pickY)) throw new Error('Clipped geometry intercepted a pick');
      await renderer.section(null);
    }); checks.push('section');
    for (let i = 0; i < cycles; i++) {
      await measure('proposal', () => preview());
      await measure('comparison', compare);
      await measure('comparison-exit', compare);
      await measure('discard', discard);
      if (JSON.stringify(accepted) !== baseline) throw new Error('Accepted model mutated during review');
    }
    checks.push('proposal', 'comparison', 'discard', 'accepted-immutable');
    const beforeStale = JSON.stringify(displayed);
    try { await preview({ ...smokeProposal(model), baseRevision: 'stale-revision' }); throw new Error('Stale proposal was accepted'); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'Stale or invalid proposal revision') throw error; }
    if (JSON.stringify(displayed) !== beforeStale) throw new Error('Stale proposal changed rendered state');
    checks.push('stale-rejected');
    for (const size of [1, 10, 100, 1000]) {
      if (size > model.elements.length) { result.limitations.push('Proposal size ' + size + ' not run: insufficient fixture elements'); continue; }
      const proposal: Proposal = { id: 'bounded-' + size, baseRevision: model.revision, nextRevision: 'bounded-' + size,
        remove: [], upsert: model.elements.slice(0, size).map(item => ({ ...item, position: [item.position[0], item.position[1] + .25, item.position[2]] })) };
      await measure('proposal-' + size, () => preview(proposal)); await discard();
    }
    let previous = performance.now();
    for (let frame = 0; frame < 30; frame++) {
      await renderer.camera(model.cameraPath[frame % model.cameraPath.length]);
      const now = performance.now(); frameIntervalsMs.push(now - previous); previous = now;
    }
    await renderer.camera(firstCamera);
    result.status = 'completed';
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  finally { active = false; }
  output.textContent = JSON.stringify(result, null, 2); return result;
}

window.viewerBenchmark = { run: replay, preview: () => preview(), compare, discard, dispose,
  inspect: async () => ({ accepted, proposed, comparison, readback: await loaded().adapter.readback() }) };
for (const button of document.querySelectorAll('button[data-candidate]')) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener('click', async () => {
    const value = button.dataset.candidate; if (value !== 'babylon' && value !== 'fragments') return;
    await replay(value, 3);
  });
}
