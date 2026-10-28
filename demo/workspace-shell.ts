export type WorkspaceContext = 'project' | 'request' | 'backlog' | 'activity' | 'review' | 'history' | 'evidence';

const contextLabels: Record<WorkspaceContext, string> = {
  project: 'Project overview', request: 'Change request', backlog: 'Change requests',
  activity: 'Agent activity', review: 'Proposal review', history: 'Model history',
  evidence: 'Project evidence',
};

type Panel = 'navigation' | 'context';
const panelBounds = {
  navigation: { min: 180, max: 320 },
  context: { min: 280, max: 520 },
};
const minimumStageWidth = 320;

export class WorkspaceShell {
  private readonly shell: HTMLElement;
  private readonly navigation: HTMLElement;
  private readonly context: HTMLElement;
  private readonly navigationToggle: HTMLButtonElement;
  private readonly contextToggle: HTMLButtonElement;
  private readonly heading: HTMLElement;
  private readonly toggleLabel: HTMLElement;
  private readonly content: HTMLElement;
  private readonly phone = window.matchMedia('(max-width: 900px)');
  private readonly widths: Record<Panel, number> = { navigation: 208, context: 344 };
  private readonly resizers: Record<Panel, HTMLElement>;

  constructor() {
    const required = (id: string): HTMLElement => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing workspace mount: ${id}`);
      return element;
    };
    const button = (id: string): HTMLButtonElement => {
      const element = required(id);
      if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing workspace button: ${id}`);
      return element;
    };
    this.shell = required('workspace-shell');
    this.navigation = required('workspace-navigation');
    this.context = required('workspace-context');
    this.navigationToggle = button('workspace-navigation-toggle');
    this.contextToggle = button('workspace-context-toggle');
    this.heading = required('workspace-context-heading');
    this.toggleLabel = required('workspace-context-toggle-label');
    this.content = required('workspace-context-content');
    if (this.shell.clientWidth <= 1200) {
      this.widths.navigation = 184;
      this.widths.context = 320;
    }
    this.resizers = { navigation: this.createResizer('navigation'), context: this.createResizer('context') };
    for (const fileMenu of document.querySelectorAll('.workspace-file-menu, .workspace-toolbar > details')) {
      if (!(fileMenu instanceof HTMLDetailsElement)) continue;
      fileMenu.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('button') && !event.target.closest('#design-views-mount')) fileMenu.open = false;
      });
      fileMenu.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        fileMenu.open = false;
        fileMenu.querySelector('summary')?.focus({ preventScroll: true });
        event.preventDefault();
      });
    }
    this.navigationToggle.addEventListener('click', () => this.setPanel('navigation', this.navigation.hidden === true));
    this.contextToggle.addEventListener('click', () => this.setPanel('context', this.context.hidden === true));
    button('workspace-navigation-close').addEventListener('click', () => this.close('navigation'));
    button('workspace-context-close').addEventListener('click', () => this.close('context'));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (this.navigation.contains(target)) this.close('navigation');
      else if (this.context.contains(target)) this.close('context');
    });
    this.phone.addEventListener('change', () => {
      if (this.phone.matches) this.setPanel('navigation', false);
      this.fitPanels();
    });
    this.setPanel('navigation', !this.phone.matches);
    this.setPanel('context', !this.phone.matches);
    new ResizeObserver(() => this.fitPanels()).observe(this.shell);
  }

  showContext(page: WorkspaceContext): void {
    if (this.shell.dataset.context !== page) this.content.scrollTop = 0;
    this.heading.textContent = contextLabels[page];
    this.toggleLabel.textContent = page === 'request' ? 'Request' : contextLabels[page];
    this.shell.dataset.context = page;
    this.setPanel('context', true);
  }

  showRequestDetails(show: boolean): void {
    if (show) this.showContext('request');
    else if (this.phone.matches) this.setPanel('context', false);
  }

  showInspector(): void {
    this.setPanel('navigation', true);
    const inspector = document.getElementById('element-inspector');
    if (inspector instanceof HTMLDetailsElement) inspector.open = true;
  }

  private createResizer(panel: Panel): HTMLElement {
    const node = panel === 'navigation' ? this.navigation : this.context;
    const resizer = document.createElement('div');
    resizer.className = 'workspace-panel-resizer';
    resizer.dataset.panel = panel;
    resizer.tabIndex = 0;
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-controls', node.id);
    resizer.setAttribute('aria-label', panel === 'navigation' ? 'Resize model navigation' : 'Resize context panel');
    resizer.title = 'Drag to resize. Arrow keys: 8px; Shift + Arrow: 32px; Home / End: minimum / maximum.';
    const direction = panel === 'navigation' ? 1 : -1;
    resizer.addEventListener('keydown', event => {
      if (this.phone.matches) return;
      const step = event.shiftKey ? 32 : 8;
      let width: number;
      if (event.key === 'Home') width = panelBounds[panel].min;
      else if (event.key === 'End') width = this.maximumWidth(panel);
      else if (event.key === 'ArrowLeft') width = this.widths[panel] - step * direction;
      else if (event.key === 'ArrowRight') width = this.widths[panel] + step * direction;
      else return;
      event.preventDefault();
      this.resizePanel(panel, width);
    });
    let drag: { pointerId: number; startX: number; startWidth: number } | null = null;
    resizer.addEventListener('pointerdown', event => {
      if (this.phone.matches || event.button !== 0) return;
      event.preventDefault();
      resizer.focus({ preventScroll: true });
      resizer.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: this.widths[panel] };
      resizer.dataset.dragging = 'true';
    });
    resizer.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId || this.phone.matches) return;
      this.resizePanel(panel, drag.startWidth + (event.clientX - drag.startX) * direction);
    });
    const endDrag = () => {
      const pointerId = drag?.pointerId;
      drag = null;
      delete resizer.dataset.dragging;
      if (pointerId !== undefined && resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
    };
    resizer.addEventListener('pointerup', endDrag);
    resizer.addEventListener('pointercancel', endDrag);
    resizer.addEventListener('lostpointercapture', endDrag);
    resizer.addEventListener('blur', endDrag);
    // A breakpoint change or panel dismissal must not leave pointer capture active.
    resizer.addEventListener('keydown', event => { if (event.key === 'Escape') endDrag(); });
    this.phone.addEventListener('change', endDrag);
    node.append(resizer);
    return resizer;
  }

  private maximumWidth(panel: Panel): number {
    const other: Panel = panel === 'navigation' ? 'context' : 'navigation';
    const otherNode = other === 'navigation' ? this.navigation : this.context;
    const available = this.shell.clientWidth - minimumStageWidth - (otherNode.hidden ? 0 : this.widths[other]);
    return Math.max(panelBounds[panel].min, Math.min(panelBounds[panel].max, available));
  }

  private resizePanel(panel: Panel, width: number): void {
    this.widths[panel] = Math.max(panelBounds[panel].min, Math.min(this.maximumWidth(panel), Math.round(width)));
    this.fitPanels();
  }

  private fitPanels(): void {
    for (const panel of ['navigation', 'context'] satisfies Panel[]) {
      const resizer = this.resizers[panel];
      resizer.hidden = this.phone.matches;
      if (this.phone.matches) continue;
      this.widths[panel] = Math.min(this.widths[panel], this.maximumWidth(panel));
      this.shell.style.setProperty(`--workspace-${panel}-width`, `${this.widths[panel]}px`);
    }
    // Recompute both ranges after fitting so assistive technology sees the same bounds as dragging.
    for (const panel of ['navigation', 'context'] satisfies Panel[]) {
      const resizer = this.resizers[panel];
      resizer.setAttribute('aria-valuemin', String(panelBounds[panel].min));
      resizer.setAttribute('aria-valuemax', String(this.maximumWidth(panel)));
      resizer.setAttribute('aria-valuenow', String(this.widths[panel]));
      resizer.setAttribute('aria-valuetext', `${this.widths[panel]} pixels`);
    }
  }

  private close(panel: Panel): void {
    this.setPanel(panel, false);
    (panel === 'navigation' ? this.navigationToggle : this.contextToggle).focus({ preventScroll: true });
  }

  private setPanel(panel: Panel, open: boolean): void {
    if (open && this.phone.matches) this.setPanel(panel === 'navigation' ? 'context' : 'navigation', false);
    const node = panel === 'navigation' ? this.navigation : this.context;
    const toggle = panel === 'navigation' ? this.navigationToggle : this.contextToggle;
    node.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (panel === 'navigation') this.shell.dataset.navigationOpen = String(open);
    else this.shell.dataset.contextOpen = String(open);
    this.fitPanels();
  }
}
