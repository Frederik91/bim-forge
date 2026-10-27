import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { ProjectEvidencePanel } from './project-evidence-ui.ts';
import type { ProjectEvidenceContext } from './project-evidence-ui.ts';
import { ProjectEvidenceClient } from './project-evidence-client.ts';
import type { EvidenceEntry, EvidencePin } from '../src/model-evidence.ts';
import type { RequestSource } from '../src/request-sources.ts';
import type { ModelParameterValue } from '../src/model-scope-contract.ts';

// Deliberately limited DOM boundary. Browser layout/keyboard integration belongs
// to the parent; these tests run real panel handlers and real transport codecs.
class TestElement {
  readonly tagName: string;
  readonly dataset: Record<string, string | undefined> = {};
  readonly attributes = new Map<string, string>();
  readonly children: TestElement[] = [];
  readonly listeners = new Map<string, (() => void)[]>();
  className = ''; type = ''; href = ''; download = ''; accept = ''; value = '';
  checked = false; disabled = false; tabIndex = 0; files: File[] = [];
  #text = '';
  constructor(tagName: string) { this.tagName = tagName.toUpperCase(); }
  get textContent(): string { return this.#text + this.children.map(child => child.textContent).join(' '); }
  set textContent(value: string) { this.#text = value; this.children.length = 0; }
  set innerHTML(_value: string) { throw new Error('Untrusted content must use textContent.'); }
  append(...children: TestElement[]): void { this.children.push(...children); }
  replaceChildren(...children: TestElement[]): void { this.children.length = 0; this.#text = ''; this.append(...children); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  contains(element: TestElement): boolean { return this === element || this.children.some(child => child.contains(element)); }
  all(): TestElement[] { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector: string): TestElement[] {
    if (selector === '[data-entry-id]') return this.all().filter(element => element.dataset.entryId !== undefined);
    if (selector === '[data-evidence-key]') return this.all().filter(element => element.dataset.evidenceKey !== undefined);
    throw new Error(`Unsupported test selector ${selector}`);
  }
  addEventListener(event: string, listener: () => void): void { this.listeners.set(event, [...this.listeners.get(event) ?? [], listener]); }
  trigger(event: string): void { if (!this.disabled) for (const listener of this.listeners.get(event) ?? []) listener(); }
  focus(): void { dom.activeElement = this; }
  scrollIntoView(): void { /* Layout is qualified by parent browser checks. */ }
}
const dom: { activeElement: TestElement | null; createElement: (tag: string) => TestElement } = {
  activeElement: null, createElement: tag => new TestElement(tag),
};
const source: RequestSource = { id: '00000000-0000-0000-0000-000000000001', name: '<img onerror=alert(1)>.txt', mediaType: 'text/plain', byteLength: 4, sha256: 'a'.repeat(64) };
const context: ProjectEvidenceContext = { projectId: 'project-211', target: { kind: 'main' }, revisionId: 'e'.repeat(64),
  selectedObject: { id: 'wall-north', name: '<script>Current wall</script>' }, entityName: () => 'Displayed wall' };
const entry: EvidenceEntry = { id: 'record-1', anchor: { projectId: context.projectId, entityId: 'wall-north', revisionId: 'b'.repeat(64), bodyHash: 'c'.repeat(64), target: { kind: 'main' } },
  property: { definitionId: 'geometry-thickness', valueKind: 'length' }, predecessor: null,
  assertion: { kind: 'documented', value: { kind: 'length', value: 150, unit: 'mm' }, citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'https://outside.invalid/<script>attack</script>' }] } };
const pin = { entryId: entry.id, hash: 'd'.repeat(64) };
function reply(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status }); }
function button(mount: TestElement, label: string): TestElement {
  const result = mount.all().find(element => element.tagName === 'BUTTON' && element.textContent === label);
  assert.ok(result, `Missing button: ${label}`); return result;
}
function choose(mount: TestElement, label: string, checked = true): void {
  const wrapper = mount.all().find(element => element.tagName === 'LABEL' && (element.textContent.trim() === label
    || element.children.some(child => child.getAttribute('aria-label') === label)));
  const input = wrapper?.children.find(element => element.tagName === 'INPUT'); assert.ok(input, `Missing checkbox: ${label}`);
  input.checked = checked; input.focus(); input.trigger('change');
}
function primaryText(element: TestElement): string {
  return element.tagName === 'DETAILS' ? '' : element.children.length ? element.children.map(primaryText).join(' ') : element.textContent;
}
async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 200; index++) { if (predicate()) return; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
  assert.ok(predicate(), 'Panel did not settle.');
}

test('panel behavior at the DOM boundary; no browser layout or touch qualification claimed', async t => {
  const originals = ['document', 'HTMLElement'].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
  Object.defineProperty(globalThis, 'document', { value: dom, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: TestElement, configurable: true });
  t.after(() => { for (const original of originals) {
    if (original.descriptor) Object.defineProperty(globalThis, original.key, original.descriptor);
    else Reflect.deleteProperty(globalThis, original.key);
  } });
  function mount(): HTMLElement {
    // The public DOM boundary is installed above, with no production type casts.
    return document.createElement('div');
  }
  function tree(host: HTMLElement): TestElement {
    assert.ok(host instanceof TestElement); return host;
  }

  await t.test('history is project-wide, text stays text, correction references and exact chosen pins reach callbacks', async () => {
    const host = mount(); const root = tree(host); const requests: string[] = [];
    const chosenSources: RequestSource[][] = []; const chosenPins: EvidencePin[][] = [];
    const anchors: EvidenceEntry['anchor'][] = [];
    const correction: EvidenceEntry = { ...entry, id: 'record-2', predecessor: pin,
      anchor: { ...entry.anchor, entityId: 'other-wall', target: { kind: 'alternative', id: 'option-b' } }, assertion: { kind: 'unknown', reason: 'Survey missing.' } };
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(async input => {
      const url = String(input); requests.push(url);
      return url.endsWith('project-sources') ? reply({ sources: [source], next: null })
        : reply(url.includes('?') ? { entries: [{ entry: correction, pin: { entryId: correction.id, hash: 'f'.repeat(64) } }], next: null } : { entries: [{ entry, pin }], next: 1 });
    }), useSources: values => { chosenSources.push(structuredClone([...values])); },
      useEvidence: values => { chosenPins.push(structuredClone([...values])); }, selectEntity: anchor => { anchors.push(anchor); } });
    await panel.show(context);
    const card = root.all().find(element => element.dataset.entryId === entry.id); assert.ok(card);
    const provenance = card.all().find(element => element.tagName === 'DETAILS'); assert.ok(provenance);
    assert.equal(provenance.children[0]?.tagName, 'SUMMARY'); assert.equal(provenance.children[0]?.textContent, 'Provenance and history');
    assert.equal(provenance.getAttribute('open'), null, 'Native details starts collapsed.');
    assert.match(primaryText(card), /Displayed wall · Geometry thickness.*150 mm · documented/);
    for (const identity of [entry.id, entry.anchor.projectId, entry.anchor.revisionId, entry.anchor.bodyHash, pin.hash, source.id, source.sha256]) {
      assert.ok(provenance.textContent.includes(identity)); assert.ok(!primaryText(card).includes(identity));
    }
    assert.ok(provenance.textContent.includes(JSON.stringify(entry.assertion.kind === 'documented' ? entry.assertion.value : null)));
    const sourceCard = root.all().find(element => element.tagName === 'LI' && !element.dataset.entryId); assert.ok(sourceCard);
    const sourceDetails = sourceCard.all().find(element => element.tagName === 'DETAILS'); assert.ok(sourceDetails);
    assert.equal(sourceDetails.children[0]?.tagName, 'SUMMARY'); assert.equal(sourceDetails.children[0]?.textContent, 'Details');
    assert.equal(sourceDetails.getAttribute('open'), null); assert.match(primaryText(sourceCard), /text\/plain · 4 bytes/);
    assert.ok(!primaryText(sourceCard).includes(source.id)); assert.ok(!primaryText(sourceCard).includes(source.sha256));
    assert.ok(sourceDetails.textContent.includes(source.id)); assert.ok(sourceDetails.textContent.includes(source.sha256));
    assert.match(root.textContent, /Current selection: <script>Current wall<\/script>/);
    assert.match(root.textContent, /Historical record; current applicability and acceptance are not established/);
    assert.ok(root.all().filter(element => element.tagName === 'A').every(link => link.href === `/api/projects/${context.projectId}/sources/${source.id}`));
    assert.equal(root.all().filter(element => ['SCRIPT', 'IMG'].includes(element.tagName)).length, 0);
    button(root, 'Load more records').trigger('click'); await until(() => root.all().filter(element => element.dataset.entryId).length === 2);
    assert.match(root.textContent, /other-wall.*Current display name: Displayed wall/);
    assert.match(root.textContent, /alternative option-b/);
    button(root, 'Inspect record record-1').trigger('click'); assert.equal(dom.activeElement?.dataset.entryId, 'record-1');
    choose(root, 'Choose record record-1 for chat'); button(root, 'Use chosen records in chat (1)').trigger('click');
    await until(() => chosenPins.some(values => values.length === 1)); assert.deepEqual(panel.selectedEvidencePins, [pin]);
    choose(root, `Choose ${source.name} for chat`); button(root, 'Use chosen files in chat (1)').trigger('click');
    await until(() => chosenSources.some(values => values.length === 1)); assert.deepEqual(panel.selectedSourceDescriptors, [source]);
    button(root, 'Inspect anchor object').trigger('click'); assert.deepEqual(anchors, [entry.anchor]);
    assert.ok(requests.includes('/api/projects/project-211/evidence?after=1'));
    assert.ok(requests.every(url => !url.includes('/sources/')), 'listing never fetches blobs or previews'); panel.dispose();
  });

  await t.test('typed claim summaries are readable and raw values stay under native provenance details', async () => {
    const host = mount(); const root = tree(host);
    const values: { value: ModelParameterValue; label: string }[] = [
      { value: { kind: 'length', value: 5, unit: 'm' }, label: '5 m' },
      { value: { kind: 'angle', value: 45, unit: 'deg' }, label: '45°' },
      { value: { kind: 'duration', value: 2, unit: 'h' }, label: '2 h' },
      { value: { kind: 'number', value: 0 }, label: '0' },
      { value: { kind: 'boolean', value: false }, label: 'No' },
      { value: { kind: 'text', value: '<script>survey note</script>' }, label: '<script>survey note</script>' },
    ];
    const entries = values.map(({ value }, index) => ({ entry: { ...entry, id: `value-${index}`,
      property: { definitionId: 'fixture-value', valueKind: value.kind },
      assertion: { kind: 'assumed', value, rationale: 'Display fixture only.', basis: [] } } satisfies EvidenceEntry,
    pin: { ...pin, entryId: `value-${index}` } }));
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(async input => reply(String(input).endsWith('/project-sources')
      ? { sources: [], next: null } : { entries, next: null })), useSources: () => {}, useEvidence: () => {} });
    await panel.show({ ...context, entityName: () => undefined });
    for (const [index, fixture] of values.entries()) {
      const card = root.all().find(element => element.dataset.entryId === `value-${index}`); assert.ok(card);
      assert.ok(primaryText(card).includes(`wall-north · Fixture value`)); assert.ok(primaryText(card).includes(`${fixture.label} · assumed`));
      assert.ok(!primaryText(card).includes('"kind"'));
      const details = card.all().find(element => element.tagName === 'DETAILS'); assert.ok(details);
      assert.ok(details.textContent.includes(JSON.stringify(fixture.value))); assert.equal(details.getAttribute('open'), null);
    }
    assert.equal(root.all().filter(element => element.tagName === 'SCRIPT').length, 0); panel.dispose();
  });

  await t.test('missing and busy errors retry independently; binding aborts stale work and clears panel choices', async () => {
    const host = mount(); const root = tree(host); let attempts = 0; let finishOld: ((value: Response) => void) | undefined;
    const old = new Promise<Response>(resolve => { finishOld = resolve; });
    let rejectContext = false; const contexts: (string | null)[] = [];
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(async input => {
      const url = String(input); if (url.includes('old-project')) return old;
      if (url.endsWith('/project-sources')) { attempts++; return attempts === 1 ? reply({}, 503) : reply({ sources: [source], next: null }); }
      return reply({}, 404);
    }), useSources: (_values, binding) => { if (rejectContext) throw new Error('Composer busy; retry context.'); contexts.push(binding?.projectId ?? null); }, useEvidence: () => {} });
    await panel.bind(context); assert.match(root.textContent, /busy.*unavailable/);
    button(root, 'Retry sources').trigger('click'); await until(() => root.textContent.includes(source.name));
    rejectContext = true; choose(root, `Choose ${source.name} for chat`); button(root, 'Use chosen files in chat (1)').trigger('click');
    await until(() => root.textContent.includes('Composer busy; retry context.')); rejectContext = false;
    const before = attempts; await panel.update({ ...context, selectedObject: null }); assert.equal(attempts, before);
    assert.match(root.textContent, /Current selection: none/);
    const stale = panel.show({ ...context, projectId: 'old-project' }); assert.ok(root.all().some(element => element.getAttribute('aria-busy') === 'true'));
    await panel.show({ ...context, projectId: 'new-project' }); finishOld?.(reply({ entries: [], next: null })); await stale;
    assert.match(root.textContent, /Displaying new-project/); assert.deepEqual(panel.selectedSourceDescriptors, []);
    assert.deepEqual(contexts, [], 'Navigation must not call the parent composer.');
    await panel.bind(null); assert.match(root.textContent, /Choose a project/); panel.dispose(); assert.equal(root.textContent, '');
  });

  await t.test('20-source paging is explicit; native labeled choices enforce chat request bounds and callback backpressure', async () => {
    const host = mount(); const root = tree(host); let calls = 0; let finish: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const sources = Array.from({ length: 20 }, (_, index) => ({ ...source, name: `plan-${index}.txt`, id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}` }));
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(async input => {
      const url = String(input); if (url.includes('/project-sources')) { calls++; return reply(url.includes('?') ? { sources: [], next: null } : { sources, next: sources.at(-1)?.id }); }
      return reply({ entries: [], next: null });
    }), useSources: async values => { if (values.length) await gate; }, useEvidence: () => {} });
    await panel.bind(context); assert.match(root.textContent, /20 sources loaded. More project history is available/);
    for (let index = 0; index < 5; index++) choose(root, `Choose plan-${index}.txt for chat`);
    await until(() => root.textContent.includes('four source files')); assert.equal(panel.selectedSourceDescriptors.length, 4);
    button(root, 'Use chosen files in chat (4)').trigger('click'); assert.equal(button(root, 'Use chosen files in chat (4)').disabled, true);
    finish?.(); await until(() => !button(root, 'Use chosen files in chat (4)').disabled);
    button(root, 'Load more sources').trigger('click'); await until(() => calls === 2 && root.textContent.includes('End of available history'));
    assert.equal(root.all().filter(element => element.tagName === 'INPUT' && element.type === 'checkbox').length, 20);
    await panel.refresh(); assert.equal(panel.selectedSourceDescriptors.length, 0); panel.dispose();
  });

  await t.test('navigation and refresh preserve parent chat drafts; only explicit empty Use actions clear composer context', async () => {
    const host = mount(); const root = tree(host); let calls = 0;
    let parentSources = [source]; let parentPins = [pin];
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(async input => reply(String(input).endsWith('/project-sources')
      ? { sources: [source], next: null } : { entries: [{ entry, pin }], next: null })),
      useSources: values => { calls++; parentSources = structuredClone([...values]); },
      useEvidence: values => { calls++; parentPins = structuredClone([...values]); } });
    await panel.show({ ...context, bindingId: 'chat-a' });
    choose(root, `Choose ${source.name} for chat`); choose(root, 'Choose record record-1 for chat');
    await panel.update({ ...context, bindingId: 'chat-b' });
    assert.deepEqual(panel.selectedSourceDescriptors, []); assert.deepEqual(panel.selectedEvidencePins, []);
    await panel.refresh(); await panel.bind(null); await panel.show(context);
    assert.equal(calls, 0); assert.deepEqual(parentSources, [source]); assert.deepEqual(parentPins, [pin]);
    button(root, 'Use chosen files in chat (0)').trigger('click'); await until(() => parentSources.length === 0);
    assert.deepEqual(parentPins, [pin]);
    button(root, 'Use chosen records in chat (0)').trigger('click'); await until(() => parentPins.length === 0);
    assert.equal(calls, 2); await panel.bind(null); panel.dispose(); assert.equal(calls, 2);
  });

  const kinds: ('sources' | 'evidence')[] = ['sources', 'evidence'];
  for (const kind of kinds) await t.test(`same-project chat switch aborts pending ${kind} callbacks and cannot overwrite new-chat status`, async () => {
    const host = mount(); const root = tree(host); let fetches = 0;
    let finishA: (() => void) | undefined; let finishB: (() => void) | undefined;
    const gateA = new Promise<void>(resolve => { finishA = resolve; });
    const gateB = new Promise<void>(resolve => { finishB = resolve; });
    const callbacks: { bindingId: string | undefined; signal: AbortSignal }[] = []; const settled: string[] = []; const applied: string[] = [];
    async function apply(binding: ProjectEvidenceContext | null, signal: AbortSignal): Promise<void> {
      const bindingId = binding?.bindingId; callbacks.push({ bindingId, signal });
      if (bindingId === 'chat-a') await gateA;
      else if (bindingId === 'chat-b') await gateB;
      else throw new Error('Unexpected implicit composer callback.');
      if (!signal.aborted) applied.push(bindingId);
      settled.push(bindingId);
    }
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(async input => {
      fetches++; return reply(String(input).endsWith('/project-sources') ? { sources: [source], next: null } : { entries: [{ entry, pin }], next: null });
    }), useSources: (_values, binding, signal) => apply(binding, signal), useEvidence: (_values, binding, signal) => apply(binding, signal) });
    const label = kind === 'sources' ? `Choose ${source.name} for chat` : 'Choose record record-1 for chat';
    const action = kind === 'sources' ? 'Use chosen files in chat (1)' : 'Use chosen records in chat (1)';
    await panel.show({ ...context, bindingId: 'chat-a' }); assert.equal(callbacks.length, 0);
    choose(root, label); button(root, action).trigger('click'); assert.equal(callbacks.length, 1);
    const old = callbacks[0]; assert.ok(old); assert.equal(old.signal.aborted, false);
    const before = fetches; await panel.update({ ...context, bindingId: 'chat-a', selectedObject: null });
    assert.equal(fetches, before); assert.equal(old.signal.aborted, false);
    await panel.update({ ...context, bindingId: 'chat-b' });
    assert.equal(old.signal.aborted, true); assert.equal(fetches, before + 2); assert.equal(callbacks.length, 1);
    choose(root, label); button(root, action).trigger('click'); assert.equal(callbacks.length, 2);
    finishA?.(); await until(() => settled.includes('chat-a'));
    assert.equal(button(root, action).disabled, true); assert.deepEqual(applied, []);
    assert.equal(root.textContent.includes('Chosen context sent to chat.'), false);
    finishB?.(); await until(() => !button(root, action).disabled && applied.length === 1);
    assert.deepEqual(applied, ['chat-b']); assert.match(root.textContent, /Chosen context sent to chat/); panel.dispose();
  });

  await t.test('file uploads use the shared private protocol, retain explicitly and retry retention without re-uploading', async () => {
    const host = mount(); const root = tree(host); let uploads = 0; let retains = 0; let retained: RequestSource | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/sources/')) {
        uploads++; assert.equal(init?.method, 'POST'); assert.deepEqual(init?.headers, { 'Content-Type': 'text/plain', 'X-Source-Name': 'plan.txt' });
        retained = { ...source, id: url.split('/').at(-1) ?? '', name: 'plan.txt' }; return reply({ source: retained });
      }
      if (init?.method === 'POST') { retains++; assert.deepEqual(JSON.parse(String(init.body)), { source: retained }); return retains === 1 ? reply({}, 429) : reply({ source: retained }); }
      return reply(url.endsWith('/project-sources') ? { sources: retains > 1 && retained ? [retained] : [], next: null } : { entries: [], next: null });
    };
    const mock = t.mock.method(globalThis, 'fetch', fetcher);
    const panel = new ProjectEvidencePanel(host, { client: new ProjectEvidenceClient(fetcher), useSources: () => {}, useEvidence: () => {} });
    try {
      await panel.bind(context); const input = root.all().find(element => element.type === 'file'); assert.ok(input);
      input.files = [new File(['plan'], 'plan.txt')]; input.trigger('change');
      await until(() => root.textContent.includes('Retain in project')); assert.equal(uploads, 1); assert.equal(retains, 0);
      button(root, 'Retain in project').trigger('click'); await until(() => root.textContent.includes('HTTP 429'));
      button(root, 'Retain in project').trigger('click'); await until(() => root.textContent.includes('Source retained in project.'));
      assert.equal(uploads, 1); assert.equal(retains, 2); assert.deepEqual(panel.selectedSourceDescriptors, []);
    } finally { panel.dispose(); mock.mock.restore(); }
  });
});

test('panel bundles for the browser without server, repository or blob-store dependencies', async () => {
  const result = await build({ entryPoints: ['demo/project-evidence-ui.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  assert.ok(result.outputFiles[0]?.contents.length);
  assert.ok(Object.keys(result.metafile.inputs).every(filename => !/project-evidence-store|room-model\.ts|request-source-store|node:/.test(filename)));
});
