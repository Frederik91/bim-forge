import { levels, entityLevel } from '../src/building-levels.ts';
import { entitySpace } from '../src/floor-plan.ts';
import type { ModelGraph } from '../src/room-model.ts';

export type ModelNode = { kind: 'project' | 'level' | 'room' | 'element' | 'group'; id: string; name: string; detail: string; children: ModelNode[] };
export function modelHierarchy(graph: ModelGraph, name: string): ModelNode {
  const root: ModelNode = { kind: 'project', id: '$project', name, detail: 'Whole model', children: [] };
  const storeys = levels(graph);
  const byId = new Map<string, ModelNode>();
  for (const level of storeys) {
    const node: ModelNode = { kind: 'level', id: level.id, name: level.name, detail: `${level.elevation} m`, children: [] };
    root.children.push(node); byId.set(level.id, node);
  }
  for (const room of graph.entities.filter(item => item.type === 'Space')) {
    const node: ModelNode = { kind: 'room', id: room.id, name: room.name, detail: 'Room', children: [] };
    (byId.get(room.levelId) ?? root).children.push(node); byId.set(room.id, node);
  }
  const groups = new Map<string, ModelNode>();
  for (const entity of graph.entities) {
    if (entity.type === 'Level' || entity.type === 'Space') continue;
    const room = entitySpace(graph, entity); const level = entityLevel(graph, entity);
    let parent = room ? byId.get(room.id) : undefined;
    if (!parent) {
      const owner = level ? byId.get(level.id) ?? root : root;
      const key = `${owner.id}:${entity.type === 'AssetFamily' ? 'families' : 'elements'}`;
      parent = groups.get(key);
      if (!parent) {
        parent = { kind: 'group', id: key, name: entity.type === 'AssetFamily' ? 'Asset families' : level ? 'Shared / level elements' : 'Model elements', detail: '', children: [] };
        owner.children.push(parent); groups.set(key, parent);
      }
    }
    parent.children.push({ kind: 'element', id: entity.id, name: entity.name, detail: entity.type, children: [] });
  }
  const sort = (node: ModelNode) => {
    if (node.kind !== 'project') node.children.sort((a, b) => Number(a.kind === 'group') - Number(b.kind === 'group') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    node.children.forEach(sort);
  }; sort(root); return root;
}

export function elementProperties(graph: ModelGraph, id: string): { name: string; rows: [string, string][] } | null {
  const entity = graph.entities.find(item => item.id === id); if (!entity) return null;
  const rows: [string, string][] = [['Identity', entity.id], ['Type', entity.type], ['Units', graph.units]];
  const level = entityLevel(graph, entity); const room = entitySpace(graph, entity);
  if (level && entity.type !== 'Level') rows.push(['Level', level.name]);
  if (room && entity.type !== 'Space') rows.push(['Room', room.name]);
  const labels: Record<string, string> = { rotationDeg: 'Rotation', supportId: 'Supported by', familyId: 'Asset family', sillHeight: 'Sill height' };
  for (const [key, value] of Object.entries(entity)) {
    if (['id', 'type', 'name', 'levelId', 'roomId'].includes(key)) continue;
    const label = labels[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, first => first.toUpperCase());
    const identity = typeof value === 'string' ? graph.entities.find(item => item.id === value) : null;
    const text = identity ? identity.name : value === null ? 'None' : typeof value === 'number'
      ? `${value}${['width', 'depth', 'height', 'thickness', 'elevation', 'sillHeight'].includes(key) ? ' m' : key === 'rotationDeg' ? '°' : ''}`
      : typeof value === 'string' ? value : JSON.stringify(value) ?? 'Not set';
    rows.push([label, text]);
  }
  for (const link of graph.relationships.filter(link => link.source === id || link.target === id)) {
    const other = graph.entities.find(item => item.id === (link.source === id ? link.target : link.source));
    rows.push([link.type, `${other?.name ?? (link.source === id ? link.target : link.source)} · ${link.id}`]);
  }
  return { name: entity.name, rows };
}

export class ModelExplorer {
  readonly #host: HTMLElement;
  readonly #navigate: (node: ModelNode) => void;
  readonly #expanded = new Set<string>();
  #root: ModelNode | null = null;
  #projectId = '';
  #selected = '';
  #signature = '';
  #disabled = false;
  constructor(host: HTMLElement, navigate: (node: ModelNode) => void) { this.#host = host; this.#navigate = navigate; }
  show(input: { graph: ModelGraph; projectId: string; name: string; selectedId: string }): void {
    const signature = JSON.stringify(input); if (signature === this.#signature) return; this.#signature = signature;
    this.#root = modelHierarchy(input.graph, input.name);
    if (this.#projectId !== input.projectId) { this.#expanded.clear(); this.#expanded.add(this.#root.id); for (const node of this.#root.children) if (node.kind === 'level') this.#expanded.add(node.id); }
    this.#projectId = input.projectId;
    if (this.#selected !== input.selectedId) {
      const expand = (node: ModelNode): boolean => { const contains = node.id === input.selectedId || node.children.map(expand).some(Boolean); if (contains && node.children.length) this.#expanded.add(node.id); return contains; }; expand(this.#root);
    }
    this.#selected = input.selectedId; this.#render();
  }
  setDisabled(disabled: boolean): void { this.#disabled = disabled; this.#host.setAttribute('aria-disabled', String(disabled)); }
  #render(): void {
    if (!this.#root) return;
    const active = document.activeElement; const focused = active instanceof HTMLElement && this.#host.contains(active) ? active.closest<HTMLElement>('[role="treeitem"]')?.dataset.nodeId : null;
    const tree = document.createElement('ul'); tree.className = 'model-tree'; tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Model hierarchy');
    const rows = new Map<string, HTMLLIElement>();
    const create = (node: ModelNode, depth: number): HTMLLIElement => {
      const item = document.createElement('li'); item.setAttribute('role', 'treeitem'); item.dataset.nodeId = node.id; item.dataset.kind = node.kind;
      item.setAttribute('aria-label', `${node.name} · ${node.detail || node.children.length + ' items'}`); item.setAttribute('aria-level', String(depth));
      item.setAttribute('aria-selected', String(node.id === this.#selected)); item.tabIndex = -1; rows.set(node.id, item);
      const row = document.createElement('div'); row.className = 'model-tree-row';
      if (node.children.length) {
        item.setAttribute('aria-expanded', String(this.#expanded.has(node.id)));
        const toggle = document.createElement('button'); toggle.type = 'button'; toggle.tabIndex = -1; toggle.textContent = this.#expanded.has(node.id) ? '⌄' : '›'; toggle.dataset.expand = 'true'; toggle.setAttribute('aria-label', `${this.#expanded.has(node.id) ? 'Collapse' : 'Expand'} ${node.name}`); row.append(toggle);
      } else { const spacer = document.createElement('span'); spacer.className = 'tree-leaf'; spacer.textContent = '·'; row.append(spacer); }
      const label = document.createElement('span'); label.textContent = node.name; label.className = 'model-tree-name'; row.append(label);
      const detail = document.createElement('small'); detail.textContent = node.kind === 'element' ? node.detail : String(node.children.length); row.append(detail); item.append(row);
      if (node.children.length) { const group = document.createElement('ul'); group.setAttribute('role', 'group'); group.hidden = !this.#expanded.has(node.id); node.children.forEach(child => group.append(create(child, depth + 1))); item.append(group); }
      const toggle = () => { if (this.#expanded.has(node.id)) this.#expanded.delete(node.id); else this.#expanded.add(node.id); item.focus(); this.#render(); };
      item.addEventListener('click', event => {
        if (!(event.target instanceof Element) || event.target.closest('[role="treeitem"]') !== item) return;
        event.stopPropagation(); if (this.#disabled) return;
        if (event.target.closest('[data-expand]') || node.kind === 'group') toggle(); else { item.focus(); this.#navigate(node); }
      });
      item.addEventListener('keydown', event => {
        if (event.target !== item || this.#disabled) return;
        const visible = [...rows.values()].filter(row => !row.closest('[hidden]'));
        const index = visible.indexOf(item); let target: HTMLElement | undefined;
        if (event.key === 'ArrowDown') target = visible[index + 1];
        else if (event.key === 'ArrowUp') target = visible[index - 1];
        else if (event.key === 'Home') target = visible[0];
        else if (event.key === 'End') target = visible.at(-1);
        else if (event.key === 'ArrowRight') { if (node.children.length && !this.#expanded.has(node.id)) toggle(); else target = node.children[0] ? rows.get(node.children[0].id) : undefined; }
        else if (event.key === 'ArrowLeft') { if (node.children.length && this.#expanded.has(node.id)) toggle(); else target = item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined; }
        else if (event.key === 'Enter' || event.key === ' ') { if (node.kind === 'group') toggle(); else this.#navigate(node); }
        else return;
        event.preventDefault(); event.stopPropagation(); if (target) { for (const row of rows.values()) row.tabIndex = -1; target.tabIndex = 0; target.focus(); }
      }); return item;
    };
    tree.append(create(this.#root, 1)); this.#host.replaceChildren(tree);
    const target = (focused ? rows.get(focused) : null) ?? rows.get(this.#selected) ?? rows.get(this.#root.id);
    if (target) { target.tabIndex = 0; if (focused) target.focus({ preventScroll: true }); }
  }
}

export function renderElementProperties(host: HTMLElement, graph: ModelGraph, id: string, context: string): void {
  const properties = elementProperties(graph, id); host.replaceChildren();
  const title = document.createElement('h3'); title.textContent = properties?.name ?? 'Select a model item'; host.append(title);
  const note = document.createElement('p'); note.className = 'inspector-note'; note.textContent = `${context} · Read-only properties`; host.append(note);
  if (!properties) return;
  host.dataset.selectedId = id; const list = document.createElement('dl');
  for (const [label, value] of properties.rows) { const row = document.createElement('div'); const term = document.createElement('dt'); term.textContent = label; const description = document.createElement('dd'); description.textContent = value; row.append(term, description); list.append(row); }
  host.append(list);
}
