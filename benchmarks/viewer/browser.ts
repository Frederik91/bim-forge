import type { Adapter, Camera, Element, Model, Proposal, Vec3 } from './contract.ts';
import { admission, applyProposal, assertReadback, changesBetween, comparisonElements, parseModel, unchangedModel } from './contract.ts';
import { smokeProposal } from './fixtures.ts';
import type { Candidate, Result, Sample } from './metrics.ts';

declare global {
  interface Window {
    viewerBenchmark: {
      run(candidate: Candidate, cycles: number): Promise<Result>;
      preview(): Promise<void>; compare(): Promise<void>; discard(): Promise<void>;
      dispose(): Promise<void>; inspect(): Promise<unknown>;
      focusReview(stage: 'baseline' | 'preview' | 'comparison' | 'discard', scenario: 'move' | 'add' | 'remove'): Promise<unknown>;
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
let phases = { validationMs: 0, diffMs: 0, applyMs: 0, readbackMs: 0 };

function loaded(): { adapter: Adapter; accepted: Model } {
  if (!adapter || !accepted) throw new Error('Run a candidate first');
  return { adapter, accepted };
}
async function show(elements: Element[]): Promise<void> {
  const { adapter: renderer, accepted: base } = loaded();
  let start = performance.now(); const changes = changesBetween(displayed, elements); phases.diffMs += performance.now() - start;
  start = performance.now(); await renderer.apply(changes); phases.applyMs += performance.now() - start;
  start = performance.now();
  assertReadback(base, elements, await renderer.readback());
  phases.readbackMs += performance.now() - start;
  displayed = elements;
}
async function preview(proposal?: Proposal): Promise<void> {
  const { accepted: base } = loaded();
  const start = performance.now(); const next = applyProposal(base, proposal ?? smokeProposal(base)); phases.validationMs += performance.now() - start;
  await show(next.elements); proposed = next; comparison = false;
}
async function compare(): Promise<void> {
  const { accepted: base } = loaded(); if (!proposed) throw new Error('Preview a proposal first');
  const next = !comparison;
  const start = performance.now(); const elements = next ? comparisonElements(base, proposed) : proposed.elements;
  phases.diffMs += performance.now() - start;
  await show(elements); comparison = next;
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
    reviewCycles: cycles, samples, checks, frameIntervalsMs, error: null,
    limitations: ['Setup replay, not a scored engine comparison. No full-project or hardware qualification.',
      'The current adapter baseline is not the production viewer. No progressive streaming or automated memory qualification yet.',
      'Renderer completion is followed by requestAnimationFrame; GPU presentation timing requires external tracing.',
      'CPU, process/GPU memory, transfer shaping, long tasks, conversion equivalence, and shader fidelity need scored-run instrumentation.',
      'Neutral diff/readback scans the input. Timings include those checks and must not be called isolated renderer performance.'],
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      renderer: 'unavailable', viewport: [canvas.width, canvas.height], devicePixelRatio: devicePixelRatio },
  };
  async function measure(operation: string, work: () => Promise<void>): Promise<void> {
    output.textContent = 'Running ' + candidate + ': ' + operation;
    console.info('[viewer-benchmark] start ' + operation);
    phases = { validationMs: 0, diffMs: 0, applyMs: 0, readbackMs: 0 };
    const start = performance.now(); await work();
    if (!adapter) throw new Error('Missing active adapter');
    const durationMs = performance.now() - start;
    const resources = adapter.resources?.();
    samples.push({ operation, durationMs, ...adapter.stats(), phases: { ...phases }, ...(resources ? { resources } : {}) });
    checks.push(operation);
    console.info('[viewer-benchmark] end ' + operation + ' ' + samples.at(-1)?.durationMs.toFixed(1) + ' ms');
  }
  try {
    await dispose();
    const response = await fetch('/dataset.json'); if (!response.ok) throw new Error('Dataset fetch failed');
    const input: unknown = await response.json(); const model = parseModel(input, 'transfer');
    result.purpose = model.provenance.kind === 'synthetic' ? 'setup-smoke' : 'initial-local';
    if (model.provenance.kind !== 'synthetic') result.limitations.push(...model.provenance.limitations);
    const firstCamera = model.cameraPath[0];
    accepted = model; result.limitations.push(...admission(model).reasons);
    const unchanged = unchangedModel(model);
    if (candidate === 'babylon') {
      const { BabylonAdapter } = await import('./adapters/babylon.ts'); adapter = new BabylonAdapter(canvas);
    } else if (candidate === 'babylon-batched') {
      const { BatchedBabylonAdapter } = await import('./adapters/babylon-batched.ts'); adapter = new BatchedBabylonAdapter(canvas);
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
    await measure('validation-readback', async () => { assertReadback(model, model.elements, await renderer.readback()); });
    checks.push('renderer-readback');
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
    });
    await measure('filter', async () => {
      await renderer.visible([]);
      if (await renderer.pick(pickX, pickY)) throw new Error('Hidden geometry intercepted a pick');
      await renderer.visible(null);
    });
    await measure('section', async () => {
      await renderer.section(-1000);
      if (await renderer.pick(pickX, pickY)) throw new Error('Clipped geometry intercepted a pick');
      await renderer.section(null);
    });
    async function review(operation: string, work: () => Promise<void>): Promise<void> {
      await measure(operation, work);
      if (accepted !== model || !unchanged()) throw new Error('Accepted model mutated during review');
      checks.push('accepted-immutable');
    }
    for (let i = 0; i < cycles; i++) {
      await review('proposal', () => preview());
      await review('comparison', compare);
      await review('comparison-exit', compare);
      await review('discard', discard);
    }
    const beforeStale = JSON.stringify(displayed);
    try { await preview({ ...smokeProposal(model), baseRevision: 'stale-revision' }); throw new Error('Stale proposal was accepted'); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'Stale or invalid proposal revision') throw error; }
    if (JSON.stringify(displayed) !== beforeStale) throw new Error('Stale proposal changed rendered state');
    if (accepted !== model || !unchanged()) throw new Error('Stale proposal changed accepted state');
    assertReadback(model, model.elements, await renderer.readback());
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
      samples.push({ operation: 'camera-frame', durationMs: frameIntervalsMs.at(-1) ?? 0, ...renderer.stats() });
    }
    await renderer.camera(firstCamera);
    result.status = 'completed';
  } catch (error) { result.error = error instanceof Error ? error.message : String(error); }
  finally { active = false; }
  output.textContent = JSON.stringify(result, null, 2); return result;
}

async function focusReview(stage: 'baseline' | 'preview' | 'comparison' | 'discard', scenario: 'move' | 'add' | 'remove'): Promise<unknown> {
  const { adapter: renderer, accepted: base } = loaded();
  const geometries = new Map(base.geometries.map(item => [item.id, item]));
  let subject: { element: Element; min: Vec3; max: Vec3 } | null = null;
  for (const element of base.elements) {
    const geometry = geometries.get(element.geometryId); if (!geometry) continue;
    const min: Vec3 = [Infinity, Infinity, Infinity]; const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geometry.positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
      const value = geometry.positions[i + axis] * element.scale[axis] + element.position[axis];
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
    const extents = max.map((value, axis) => value - min[axis]);
    if (Math.max(...extents) <= 8 && extents.filter(value => value >= .1).length >= 2) { subject = { element, min, max }; break; }
  }
  if (!subject) throw new Error('No suitable focused engineering-review subject');
  const { element, min, max } = subject;
  const span = Math.max(...max.map((value, axis) => value - min[axis]), .5);
  const modified: Element = { ...element, id: scenario === 'add' ? 'focused-added' : element.id,
    position: [element.position[0] + span * 1.5, element.position[1], element.position[2]] };
  const proposal: Proposal = { id: 'focused-' + scenario, baseRevision: base.revision, nextRevision: base.revision + '-focused',
    upsert: scenario === 'remove' ? [] : [modified], remove: scenario === 'remove' ? [element.id] : [] };
  const center: Vec3 = [(min[0] + max[0]) / 2 + span * .75, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const camera: Camera = { eye: [center[0] + span * .3, center[1] + span, center[2] + span * 4.5], target: center };
  await renderer.select(null); await renderer.section(null);
  await renderer.visible([element.id, modified.id, 'before:' + element.id]);
  if (stage === 'baseline' || stage === 'discard') await discard();
  else if (stage === 'preview') await preview(proposal);
  else if (!comparison) await compare();
  await renderer.camera(camera);
  return { scenario, stage, subject: element.id, camera, sourceGeometry: element.geometryId,
    acceptedRevision: base.revision, delta: changesBetween(base.elements, proposed?.elements ?? base.elements) };
}

window.viewerBenchmark = { run: replay, preview: () => preview(), compare, discard, dispose,
  focusReview,
  inspect: async () => ({ modelId: accepted?.id, acceptedRevision: accepted?.revision, proposedRevision: proposed?.revision,
    comparison, delta: changesBetween(accepted?.elements ?? [], proposed?.elements ?? accepted?.elements ?? []),
    readback: await loaded().adapter.readback() }) };
for (const button of document.querySelectorAll('button[data-candidate]')) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener('click', async () => {
    const value = button.dataset.candidate; if (value !== 'babylon' && value !== 'babylon-batched' && value !== 'fragments') return;
    await replay(value, 3);
  });
}
