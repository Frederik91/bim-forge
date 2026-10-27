import type { DesignTarget, DesignTargetView } from '../src/design-targets.ts';

interface DesignActions {
  select(target: DesignTarget): Promise<void>;
  capture(input: { name: string; commandId: string }): Promise<void>;
  fork(input: { baselineId: string; name: string; commandId: string }): Promise<void>;
}
function key(target: DesignTarget): string {
  return target.kind === 'main' ? 'main' : `${target.kind}:${target.id}`;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const result = document.createElement('button');
  result.type = 'button'; result.className = 'button quiet'; result.textContent = label;
  result.addEventListener('click', action); return result;
}
function nameInput(label: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const root = document.createElement('label'); root.textContent = label;
  const input = document.createElement('input'); input.type = 'text'; input.maxLength = 80;
  root.append(input); return { label: root, input };
}

/** Design navigation and naming only; model authority stays with the host actions. */
export class DesignWorkspace {
  readonly #actions: DesignActions;
  readonly #trigger: HTMLButtonElement;
  readonly #dialog = document.createElement('dialog');
  readonly #list = document.createElement('div');
  readonly #status = document.createElement('p');
  readonly #capture = nameInput('Baseline name');
  readonly #alternative = nameInput('Alternative name');
  readonly #baselines = document.createElement('select');
  readonly #saveBaseline: HTMLButtonElement;
  readonly #createAlternative: HTMLButtonElement;
  #views: readonly DesignTargetView[] = [];
  #selected: DesignTarget = { kind: 'main' };
  #busy = false;
  #captureCommand = crypto.randomUUID();
  #forkCommand = crypto.randomUUID();

  constructor(mount: HTMLElement, actions: DesignActions) {
    this.#actions = actions;
    this.#trigger = button('Design views', () => this.#open());
    this.#trigger.setAttribute('aria-haspopup', 'dialog');
    this.#dialog.className = 'design-workspace-dialog';
    this.#dialog.setAttribute('aria-label', 'Design views and alternatives');
    const heading = document.createElement('h2'); heading.textContent = 'Design views';
    const introduction = document.createElement('p');
    introduction.textContent = 'Keep a fixed baseline, then explore alternatives. Each chat stays bound to the design where it started.';
    this.#list.className = 'design-workspace-list';
    this.#status.setAttribute('role', 'status'); this.#status.setAttribute('aria-live', 'polite');
    this.#saveBaseline = button('Capture baseline', () => {
      void this.#run('Capturing baseline…', async () => {
        await actions.capture({ name: this.#capture.input.value.trim() || 'As-is', commandId: this.#captureCommand });
        this.#captureCommand = crypto.randomUUID();
      });
    });
    this.#baselines.setAttribute('aria-label', 'Baseline for the new alternative');
    this.#createAlternative = button('Create alternative', () => {
      void this.#run('Creating alternative…', async () => {
        await actions.fork({ baselineId: this.#baselines.value,
          name: this.#alternative.input.value.trim() || 'Alternative', commandId: this.#forkCommand });
        this.#forkCommand = crypto.randomUUID();
      });
    });
    const capture = document.createElement('section'); capture.className = 'design-workspace-create';
    capture.append(this.#capture.label, this.#saveBaseline);
    const fork = document.createElement('section'); fork.className = 'design-workspace-create';
    fork.append(this.#baselines, this.#alternative.label, this.#createAlternative);
    const close = button('Close', () => this.#dialog.close());
    this.#dialog.append(heading, introduction, this.#list, capture, fork, this.#status, close);
    this.#capture.input.addEventListener('input', () => { this.#captureCommand = crypto.randomUUID(); });
    this.#alternative.input.addEventListener('input', () => { this.#forkCommand = crypto.randomUUID(); });
    this.#baselines.addEventListener('change', () => { this.#forkCommand = crypto.randomUUID(); });
    mount.replaceChildren(this.#trigger, this.#dialog);
  }

  update(views: readonly DesignTargetView[], selected: DesignTarget): void {
    this.#views = views; this.#selected = selected;
    const current = views.find(view => key(view.target) === key(selected));
    this.#trigger.textContent = `${current?.name ?? 'Design views'} ▾`;
    this.#trigger.setAttribute('aria-label', `Design views. Current: ${current?.name ?? 'unavailable'}`);
    this.#trigger.disabled = this.#busy || views.length === 0;
    this.#render();
  }

  #open(): void {
    this.#capture.input.value = 'As-is';
    this.#alternative.input.value = `Alternative ${this.#views.filter(view => view.target.kind === 'alternative').length + 1}`;
    this.#captureCommand = crypto.randomUUID(); this.#forkCommand = crypto.randomUUID();
    this.#status.textContent = ''; this.#render(); this.#dialog.showModal();
  }

  #render(): void {
    this.#trigger.disabled = this.#busy || this.#views.length === 0;
    this.#list.replaceChildren();
    for (const view of this.#views) {
      const row = button('', () => { void this.#run('Opening design…', () => this.#actions.select(view.target)); });
      row.className = 'design-workspace-choice'; row.disabled = this.#busy;
      row.setAttribute('aria-pressed', String(key(view.target) === key(this.#selected)));
      const title = document.createElement('strong'); title.textContent = view.name;
      const detail = document.createElement('small');
      detail.textContent = `${view.target.kind === 'baseline' ? 'Fixed baseline · read only' : view.target.kind === 'main' ? 'Main design' : 'Design alternative'} · ${view.revisionId.slice(0, 10)}`;
      row.append(title, detail); this.#list.append(row);
    }
    const previous = this.#baselines.value;
    this.#baselines.replaceChildren();
    for (const view of this.#views) {
      if (view.target.kind !== 'baseline') continue;
      const option = document.createElement('option'); option.value = view.target.id; option.textContent = view.name;
      this.#baselines.append(option);
    }
    if ([...this.#baselines.options].some(option => option.value === previous)) this.#baselines.value = previous;
    this.#saveBaseline.disabled = this.#busy || this.#selected.kind === 'baseline';
    this.#createAlternative.disabled = this.#busy || this.#baselines.options.length === 0;
    this.#capture.input.disabled = this.#busy;
    this.#alternative.input.disabled = this.#busy;
    this.#baselines.disabled = this.#busy || this.#baselines.options.length === 0;
    if (!this.#busy && this.#baselines.options.length === 0 && !this.#status.textContent) {
      this.#status.textContent = 'Capture a baseline to start an alternative.';
    }
  }

  async #run(message: string, action: () => Promise<void>): Promise<void> {
    if (this.#busy) return;
    this.#busy = true; this.#status.textContent = message; this.#render();
    try {
      await action(); this.#dialog.close();
    } catch (error) {
      this.#status.textContent = error instanceof Error ? error.message : 'The design action could not finish. Try again.';
    } finally {
      this.#busy = false; this.update(this.#views, this.#selected);
    }
  }

  dispose(): void { this.#dialog.remove(); this.#trigger.remove(); }
}
