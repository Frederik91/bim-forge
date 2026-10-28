import type { DesignTarget, DesignTargetView } from '../src/design-targets.ts';
import { DesignCommands } from './design-command.ts';

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
  readonly #select = document.createElement('select');
  readonly #quickAlternative: HTMLButtonElement;
  readonly #switcher = document.createElement('div');
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
  readonly #commands = new DesignCommands();
  #projectId = '';

  constructor(mount: HTMLElement, actions: DesignActions) {
    this.#actions = actions;
    this.#trigger = button('Manage', () => this.#open());
    this.#trigger.setAttribute('aria-label', 'Manage design versions');
    this.#select.className = 'design-workspace-select';
    this.#select.setAttribute('aria-label', 'Active design');
    this.#select.addEventListener('change', () => {
      const view = this.#views.find(item => key(item.target) === this.#select.value);
      if (view) void this.#run('Opening design…', () => actions.select(view.target));
    });
    this.#quickAlternative = button('+ Alternative', () => this.createAlternative());
    this.#quickAlternative.title = 'Explore a separate design; the starting version stays unchanged';
    this.#switcher.className = 'design-workspace-switcher';
    this.#switcher.append(this.#select, this.#quickAlternative, this.#trigger);
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
        const name = this.#capture.input.value.trim() || 'As-is';
        await actions.capture({ name, commandId: this.#captureId(name) });
        this.#commands.complete('capture');
      });
    });
    this.#baselines.setAttribute('aria-label', 'Baseline for the new alternative');
    this.#createAlternative = button('Create alternative', () => {
      void this.#run('Creating alternative…', async () => {
        const baselineId = this.#baselines.value; const name = this.#alternative.input.value.trim() || 'Alternative';
        await actions.fork({ baselineId, name, commandId: this.#commands.id({ kind: 'fork', projectId: this.#projectId, baselineId, name }) });
        this.#commands.complete('fork');
      });
    });
    const capture = document.createElement('section'); capture.className = 'design-workspace-create';
    capture.append(this.#capture.label, this.#saveBaseline);
    const fork = document.createElement('section'); fork.className = 'design-workspace-create';
    fork.append(this.#baselines, this.#alternative.label, this.#createAlternative);
    const close = button('Close', () => this.#dialog.close());
    this.#dialog.append(heading, introduction, this.#list, capture, fork, this.#status, close);
    mount.replaceChildren(this.#switcher);
    document.body.append(this.#dialog);
  }

  update(views: readonly DesignTargetView[], selected: DesignTarget, projectId: string): void {
    this.#projectId = projectId;
    this.#views = views; this.#selected = selected;
    const current = views.find(view => key(view.target) === key(selected));
    this.#select.title = current ? `${current.name} · ${current.target.kind === 'baseline' ? 'fixed baseline' : 'editable design'}` : 'Open a project';
    this.#trigger.disabled = this.#busy || views.length === 0;
    this.#render();
  }

  createAlternative(): void {
    void this.#run('Creating alternative…', async () => {
      if (this.#selected.kind !== 'baseline') {
        const current = this.#views.find(view => key(view.target) === key(this.#selected));
        const name = (current?.target.kind === 'main' ? 'As-is' : `${current?.name ?? 'Design'} baseline`).slice(0, 80);
        await this.#actions.capture({ name, commandId: this.#captureId(name) });
        this.#commands.complete('capture');
      }
      const selected = this.#selected;
      if (selected.kind !== 'baseline') throw new Error('The starting baseline could not be confirmed. Reopen the project.');
      const name = `Alternative ${this.#views.filter(view => view.target.kind === 'alternative').length + 1}`;
      await this.#actions.fork({ baselineId: selected.id, name,
        commandId: this.#commands.id({ kind: 'fork', projectId: this.#projectId, baselineId: selected.id, name }) });
      this.#commands.complete('fork');
    });
  }

  #open(): void {
    this.#capture.input.value = 'As-is';
    this.#alternative.input.value = `Alternative ${this.#views.filter(view => view.target.kind === 'alternative').length + 1}`;
    this.#status.textContent = ''; this.#render(); this.#dialog.showModal();
  }

  #captureId(name: string): string {
    const current = this.#views.find(view => key(view.target) === key(this.#selected));
    if (!current || this.#selected.kind === 'baseline' || !this.#projectId) throw new Error('Open an editable design first.');
    return this.#commands.id({ kind: 'capture', projectId: this.#projectId, target: this.#selected, revisionId: current.revisionId, name });
  }

  #render(): void {
    this.#trigger.disabled = this.#busy || this.#views.length === 0;
    this.#select.disabled = this.#trigger.disabled;
    this.#quickAlternative.disabled = this.#trigger.disabled;
    this.#quickAlternative.textContent = this.#busy ? 'Working…' : '+ Alternative';
    this.#select.replaceChildren();
    for (const view of this.#views) {
      const option = document.createElement('option'); option.value = key(view.target);
      option.textContent = `${view.name}${view.target.kind === 'baseline' ? ' · locked' : ''}`;
      option.selected = key(view.target) === key(this.#selected); this.#select.append(option);
    }
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
      await action(); if (this.#dialog.open) this.#dialog.close();
    } catch (error) {
      this.#status.textContent = error instanceof Error ? error.message : 'The design action could not finish. Try again.';
      if (!this.#dialog.open) this.#dialog.showModal();
    } finally {
      this.#busy = false; this.update(this.#views, this.#selected, this.#projectId);
    }
  }

  dispose(): void { this.#dialog.remove(); this.#switcher.remove(); }
}
