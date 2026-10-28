import { drawingSources, floorMeasurementText, guidedFloorRequest, measurementMatches, parseFloorMeasurement } from './floor-plan-guide.ts';
import type { FloorMeasurement } from './floor-plan-guide.ts';
import type { RequestSource } from '../src/request-sources.ts';
import { parseRequestSources } from '../src/request-sources.ts';
import { uploadSourceFile } from './request-source-ui.ts';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); if (text) result.textContent = text; return result;
}
function select(label: string, options: readonly (readonly [string, string])[]) {
  const root = node('label', label); const input = node('select'); input.setAttribute('aria-label', label);
  for (const [value, text] of options) { const option = node('option', text); option.value = value; input.append(option); }
  root.append(input); return { root, input };
}
function field(label: string, type: 'text' | 'number') {
  const root = node('label', label); const input = node('input'); input.type = type; input.setAttribute('aria-label', label);
  root.append(input); return { root, input };
}
type Confirmation = { measurement: FloorMeasurement; note: RequestSource };
export interface FloorGuideDraft {
  enabled: boolean; sourceId: string; page: string; feature: string; length: string; provenance: string; basis: string;
  confirmation: Confirmation | null;
}
interface Context { binding: string; projectId: string; sources: readonly RequestSource[]; disabled: boolean }

/** UI state only. Sources, proposals and acceptance retain their existing owners. */
export class FloorPlanGuide {
  readonly #host: HTMLElement;
  readonly #actions: { changed(): void; enable(): void; cancel(): void; attach(): void };
  readonly #start = node('button', 'Reconstruct a floor plan');
  readonly #details = node('details');
  readonly #summary = node('summary', 'Floor plan · confirm a known dimension');
  readonly #source = select('Plan image or PDF', []);
  readonly #page = field('Page', 'number');
  readonly #feature = field('Known feature', 'text');
  readonly #length = field('Length · mm', 'number');
  readonly #provenance = select('Dimension comes from', [['', 'Choose…'], ['measured', 'Site measurement'], ['documented', 'Dimension on the drawing']]);
  readonly #basis = select('Dimension measures', [['', 'Choose…'], ['wall-centrelines', 'Between wall centrelines'], ['clear-span', 'Clear span between faces']]);
  readonly #confirm = node('button', 'Confirm known dimension');
  readonly #status = node('p');
  readonly #error = node('p');
  readonly #attach = node('button', 'Attach plan image or PDF');
  readonly #cancel = node('button', 'Cancel reconstruction');
  #enabled = false;
  #context: Context | null = null;
  #confirmation: Confirmation | null = null;
  #upload: AbortController | null = null;
  #sourceSignature = '';

  constructor(host: HTMLElement, actions: { changed(): void; enable(): void; cancel(): void; attach(): void }) {
    this.#host = host; this.#actions = actions;
    host.className = 'floor-plan-guide';
    for (const button of [this.#start, this.#confirm, this.#cancel, this.#attach]) { button.type = 'button'; button.className = 'button quiet'; }
    this.#start.addEventListener('click', () => this.start());
    this.#attach.addEventListener('click', () => actions.attach());
    this.#cancel.addEventListener('click', () => { this.clear(); actions.cancel(); actions.changed(); });
    this.#confirm.addEventListener('click', () => { void this.#confirmMeasurement(); });
    this.#feature.input.maxLength = 100; this.#feature.input.placeholder = 'e.g. Overall north wall width';
    this.#length.input.min = '1'; this.#length.input.max = '1000000'; this.#length.input.step = '1';
    this.#page.input.min = '1'; this.#page.input.max = '4'; this.#page.input.step = '1'; this.#page.input.value = '1';
    for (const control of this.#controls()) control.addEventListener('input', () => {
      this.#invalidate(); this.#error.textContent = ''; this.#render(); actions.changed();
    });
    const grid = node('div'); grid.className = 'floor-plan-measurement';
    grid.append(this.#source.root, this.#page.root, this.#feature.root, this.#length.root, this.#provenance.root, this.#basis.root);
    const help = node('p', 'Confirm one known dimension. All other lengths remain inferred until reviewed. Conflicting source values stay unresolved.');
    const limits = node('p', 'Supported: one rectangular storey, 2–12 rectangular rooms. Angled or curved walls and disconnected wings need another representation. The agent must disclose omissions. Native limits: 100 items, 32 revisions, 256 KiB.');
    limits.className = 'floor-plan-limits';
    const next = node('p', 'Send to get an AI proposal. Inspect measured values, inferred assumptions and changes before accepting. Then use + Alternative to keep an As-is baseline and edit separately.');
    this.#status.setAttribute('role', 'status'); this.#error.setAttribute('role', 'alert');
    this.#details.append(this.#summary, help, this.#attach, grid, this.#confirm, this.#status, this.#error, limits, next, this.#cancel);
    host.append(this.#start, this.#details); this.#render();
  }

  get enabled(): boolean { return this.#enabled; }
  get ready(): boolean { return !this.#enabled || Boolean(this.#confirmation && !this.#upload); }
  start(): void {
    if (this.#context?.disabled) return;
    this.#enabled = true; this.#details.open = true; this.#actions.enable(); this.#render(); this.#actions.changed();
    this.#details.scrollIntoView({ block: 'nearest' });
  }
  clear(): void {
    this.#enabled = false; this.#invalidate(); this.#error.textContent = ''; this.#render();
  }
  #invalidate(): void { this.#upload?.abort(); this.#upload = null; this.#confirmation = null; }
  #controls(): (HTMLInputElement | HTMLSelectElement)[] {
    return [this.#source.input, this.#page.input, this.#feature.input, this.#length.input, this.#provenance.input, this.#basis.input];
  }
  update(context: Context): void {
    if (this.#context?.binding !== context.binding) { this.#upload?.abort(); this.#upload = null; }
    this.#context = context;
    const sources = drawingSources(context.sources); const signature = JSON.stringify(sources);
    if (signature !== this.#sourceSignature) {
      const previous = this.#source.input.value;
      this.#source.input.replaceChildren(...sources.map(source => { const option = node('option', source.name); option.value = source.id; return option; }));
      if (sources.some(source => source.id === previous)) this.#source.input.value = previous;
      this.#sourceSignature = signature;
    }
    if (this.#confirmation && !measurementMatches(this.#confirmation.measurement, context.sources)) this.#invalidate();
    this.#render();
  }
  capture(): FloorGuideDraft {
    return { enabled: this.#enabled, sourceId: this.#source.input.value, page: this.#page.input.value,
      feature: this.#feature.input.value, length: this.#length.input.value, provenance: this.#provenance.input.value,
      basis: this.#basis.input.value, confirmation: this.#confirmation };
  }
  restore(value: FloorGuideDraft): void {
    this.#invalidate(); this.#enabled = value.enabled;
    this.#source.input.value = value.sourceId; this.#page.input.value = value.page; this.#feature.input.value = value.feature;
    this.#length.input.value = value.length; this.#provenance.input.value = value.provenance; this.#basis.input.value = value.basis;
    this.#confirmation = value.confirmation; this.#details.open = value.enabled; this.#render();
  }
  request(instruction: string, sources: readonly RequestSource[]) {
    if (!this.#enabled) return null;
    if (!this.#confirmation || this.#upload) throw new Error('Confirm a known drawing dimension before sending.');
    return guidedFloorRequest({ instruction, sources, ...this.#confirmation });
  }
  async #confirmMeasurement(): Promise<void> {
    const context = this.#context;
    if (!context || context.disabled || this.#upload || !this.#enabled) return;
    const controller = new AbortController();
    try {
      if (context.sources.length > 3) throw new Error('Keep at most three files to leave room for the confirmed measurement.');
      const measurement = parseFloorMeasurement({ source: context.sources.find(source => source.id === this.#source.input.value),
        page: Number(this.#page.input.value), feature: this.#feature.input.value, lengthMm: Number(this.#length.input.value),
        provenance: this.#provenance.input.value, basis: this.#basis.input.value });
      this.#upload = controller; this.#render(); this.#actions.changed();
      const note = await uploadSourceFile({ projectId: context.projectId, id: crypto.randomUUID(), signal: controller.signal,
        file: new File([floorMeasurementText(measurement)], 'floor-plan-measurement.txt', { type: 'text/plain' }) });
      if (controller.signal.aborted || this.#context?.binding !== context.binding || !measurementMatches(measurement, this.#context.sources)) return;
      this.#confirmation = { measurement, note }; this.#details.open = false; this.#error.textContent = '';
    } catch (error) {
      if (!controller.signal.aborted && this.#context?.binding === context.binding)
        this.#error.textContent = error instanceof Error ? error.message : 'Measurement confirmation failed. Retry.';
    } finally { if (this.#upload === controller) this.#upload = null; this.#render(); this.#actions.changed(); }
  }
  #render(): void {
    const disabled = !this.#context || this.#context.disabled;
    this.#host.hidden = disabled && !this.#enabled;
    this.#start.hidden = this.#enabled; this.#start.disabled = disabled;
    this.#details.hidden = !this.#enabled;
    for (const control of [...this.#controls(), this.#confirm, this.#attach, this.#cancel]) control.disabled = disabled || Boolean(this.#upload);
    this.#confirm.disabled ||= !this.#source.input.value;
    this.#attach.hidden = Boolean(this.#source.input.value);
    const m = this.#confirmation?.measurement;
    this.#summary.textContent = m ? `Confirmed ${m.provenance}: ${m.feature} · ${m.lengthMm} mm · ${m.basis}` : 'Floor plan · confirm a known dimension';
    this.#status.textContent = this.#upload ? 'Saving source-bound measurement…' : m
      ? `${m.source.name} · page ${m.page}. User confirmed; remaining dimensions are inferred. Send for a proposal, then review before acceptance.`
      : 'Scale not confirmed. Choose the source and a known feature length.';
    this.#error.hidden = !this.#error.textContent;
  }
}

/** Recovery data is untrusted and contains references, never source bytes or authority. */
export function parseFloorGuideDraft(value: unknown): FloorGuideDraft {
  if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean') throw new Error('Invalid floor-plan draft.');
  const text = (key: string): string => {
    if (!(key in value)) throw new Error('Incomplete floor-plan draft.');
    const item = Reflect.get(value, key);
    if (typeof item !== 'string' || item.length > 160) throw new Error('Invalid floor-plan draft field.');
    return item;
  };
  let confirmation: Confirmation | null = null;
  if ('confirmation' in value && value.confirmation !== null) {
    const item = value.confirmation;
    if (!item || typeof item !== 'object' || !('measurement' in item) || !('note' in item)) throw new Error('Invalid confirmed dimension.');
    const note = parseRequestSources([item.note])[0]; if (!note) throw new Error('Missing measurement source.');
    confirmation = { measurement: parseFloorMeasurement(item.measurement), note };
  }
  return { enabled: value.enabled, sourceId: text('sourceId'), page: text('page'), feature: text('feature'), length: text('length'),
    provenance: text('provenance'), basis: text('basis'), confirmation };
}
