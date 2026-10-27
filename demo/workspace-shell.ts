export type WorkspaceContext = 'project' | 'request' | 'backlog' | 'activity' | 'review' | 'history';

const contextLabels: Record<WorkspaceContext, string> = {
  project: 'Project overview', request: 'Change request', backlog: 'Change requests',
  activity: 'Agent activity', review: 'Proposal review', history: 'Model history',
};

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
    const fileMenu = document.querySelector('.workspace-file-menu');
    if (fileMenu instanceof HTMLDetailsElement) {
      fileMenu.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('button')) fileMenu.open = false;
      });
      fileMenu.addEventListener('keydown', event => {
        if (event.key === 'Escape') fileMenu.open = false;
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
    });
    this.setPanel('navigation', !this.phone.matches);
    this.setPanel('context', !this.phone.matches);
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

  private close(panel: 'navigation' | 'context'): void {
    this.setPanel(panel, false);
    (panel === 'navigation' ? this.navigationToggle : this.contextToggle).focus({ preventScroll: true });
  }

  private setPanel(panel: 'navigation' | 'context', open: boolean): void {
    if (open && this.phone.matches) this.setPanel(panel === 'navigation' ? 'context' : 'navigation', false);
    const node = panel === 'navigation' ? this.navigation : this.context;
    const toggle = panel === 'navigation' ? this.navigationToggle : this.contextToggle;
    node.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (panel === 'navigation') this.shell.dataset.navigationOpen = String(open);
    else this.shell.dataset.contextOpen = String(open);
  }
}
