import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { ModelParameterValueSchema, SavedModelScopeSchema, plainScopeData, parseFrozenModelScope, parseModelScopeQuery, parseScopedRequest } from '../src/model-scope-contract.ts';
import type { FrozenModelScope, ModelParameterValue, ModelScopePredicate, ModelScopeQuery, SavedModelScope, ScopedRequest } from '../src/model-scope-contract.ts';
import { FURNITURE_KINDS } from '../src/room-model.ts';
import type { Entity } from '../src/room-model.ts';

const identifier = Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' });
// A scope projection is a partial graph. Only display identities are read here, never restored as a project.
const PreviewSchema = Type.Object({ scope: Type.Unknown(), graph: Type.Object({ units: Type.Literal('m'),
  version: Type.Optional(Type.Literal(2)),
  entities: Type.Array(Type.Object({ id: identifier, name: Type.String(), type: Type.String() }), { maxItems: 100 }),
  relationships: Type.Array(Type.Object({ id: identifier, source: identifier, target: identifier, type: Type.String() }), { maxItems: 100 }),
}) });
const ListSchema = Type.Object({ scopes: Type.Array(SavedModelScopeSchema, { maxItems: 100 }) });
const SavedSchema = Type.Object({ scope: SavedModelScopeSchema });
const SaveSchema = Type.Object({ id: identifier, name: Type.String({ minLength: 1, maxLength: 80 }),
  expectedVersion: Type.Union([Type.String({ pattern: '^[a-f0-9]{64}$' }), Type.Null()]) });
const revision = Type.String({ pattern: '^[a-f0-9]{64}$' });
const entityTypes = ['Wall', 'Door', 'Window', 'Equipment', 'Furniture', 'Level', 'Space', 'Slab', 'Stair', 'Roof', 'AssetFamily', 'AssetInstance'] satisfies Entity['type'][];

export function parseScopeQuery(value: unknown): ModelScopeQuery {
  const query = parseModelScopeQuery(value);
  for (const predicate of [...query.allOf, ...query.anyOf]) {
    if (predicate.kind === 'entity-type' && !entityTypes.some(type => type === predicate.entityType)) throw new Error('Unknown entity type. Choose an exact model entity type, such as Furniture or Door.');
    if (predicate.kind === 'furniture-kind' && !FURNITURE_KINDS.some(kind => kind === predicate.furnitureKind)) throw new Error('Unknown furniture kind. Use a supported kind, such as desk or chair.');
  }
  return query;
}

export class ModelScopeClient {
  readonly #fetch: typeof fetch;
  constructor(request: typeof fetch = (input, options) => globalThis.fetch(input, options)) { this.#fetch = request; }

  async #json(projectId: string, route: string, body?: unknown): Promise<unknown> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(projectId)) throw new Error('Invalid scope project identity.');
    const response = await this.#fetch(`/api/projects/${encodeURIComponent(projectId)}/${route}`, {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 512 * 1024) throw new Error('Scope response exceeds the bounded demo limit.');
    const value: unknown = JSON.parse(text);
    if (!response.ok) {
      if (response.status === 409) throw new Error('The saved scope changed on the server. Your filters are retained. Refresh and reopen the saved scope to review its current query before replacing it.');
      throw new Error(`Scope server refused this action (HTTP ${response.status}). Your selection and filters are retained.`);
    }
    return value;
  }

  async preview(input: { projectId: string; baseRevisionId: string; query: ModelScopeQuery }) {
    if (!Check(revision, input.baseRevisionId)) throw new Error('Invalid scope base revision.');
    const query = parseScopeQuery(input.query);
    const value = await this.#json(input.projectId, 'scope-preview', { baseRevisionId: input.baseRevisionId, query });
    if (!Check(PreviewSchema, value)) throw new Error('Invalid scope preview graph.');
    const scope = parseFrozenModelScope(value.scope);
    if (scope.baseRevisionId !== input.baseRevisionId || JSON.stringify(scope.query) !== JSON.stringify(query)) throw new Error('Scope preview belongs to another revision or query.');
    const ids = new Set(value.graph.entities.map(item => item.id));
    const relationIds = new Set(value.graph.relationships.map(item => item.id));
    if (ids.size !== value.graph.entities.length || relationIds.size !== value.graph.relationships.length
      || [...scope.targetIds, ...scope.contextIds, ...scope.dependentIds, ...scope.writableIds].some(id => !ids.has(id))
      || scope.relationshipIds.some(id => !relationIds.has(id))
      || scope.writableIds.some(id => !scope.targetIds.includes(id) && !scope.dependentIds.includes(id))
      || scope.contextIds.some(id => scope.writableIds.includes(id))) throw new Error('Scope preview membership is inconsistent.');
    return { scope, identities: value.graph.entities.map(({ id, type, name }) => ({ id, type, name })) };
  }

  async list(projectId: string): Promise<SavedModelScope[]> {
    const value = await this.#json(projectId, 'scopes');
    if (!Check(ListSchema, value) || new Set(value.scopes.map(scope => scope.id)).size !== value.scopes.length) throw new Error('Invalid saved scope list.');
    return value.scopes.map(scope => ({ ...scope, query: parseScopeQuery(scope.query) }));
  }

  async save(input: { projectId: string; id: string; name: string; query: ModelScopeQuery; expectedVersion: string | null }): Promise<SavedModelScope> {
    const { projectId, query: rawQuery, ...fields } = input;
    if (!Check(SaveSchema, fields)) throw new Error('Use a scope ID of lowercase words separated by hyphens and a name of 1 to 80 characters.');
    const query = parseScopeQuery(rawQuery);
    const value = await this.#json(projectId, 'scopes', { ...fields, query });
    if (!Check(SavedSchema, value) || value.scope.id !== fields.id || value.scope.name !== fields.name
      || JSON.stringify(value.scope.query) !== JSON.stringify(query)) throw new Error('Saved scope response does not match this query.');
    return { ...value.scope, query: parseScopeQuery(value.scope.query) };
  }
}

function ownScope(value: object): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'scope');
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Scope context must be plain JSON data.');
  return plainScopeData(descriptor.value);
}
export function requestScopeContext(value: object): { scope?: ScopedRequest } {
  return Object.hasOwn(value, 'scope') ? { scope: parseScopedRequest(ownScope(value)) } : {};
}
export function reviewScopeContext(value: object): { scope?: FrozenModelScope } {
  return Object.hasOwn(value, 'scope') ? { scope: parseFrozenModelScope(ownScope(value)) } : {};
}

export function scopeEvidenceText(scope: FrozenModelScope): string {
  return [`Frozen scope · base ${scope.baseRevisionId}`,
    `Targets (${scope.targetIds.length}): ${scope.targetIds.join(', ') || 'none'} — requested matches.`,
    `Read-only context (${scope.contextIds.length}): ${scope.contextIds.join(', ') || 'none'} — information only; no write approval.`,
    `Dependents (${scope.dependentIds.length}): ${scope.dependentIds.join(', ') || 'none'} — affected support, host or family dependencies.`,
    `Writable (${scope.writableIds.length}): ${scope.writableIds.join(', ') || 'none'} — bounded proposal authority, still requires review.`,
    `Relationships (${scope.relationshipIds.length}): ${scope.relationshipIds.join(', ') || 'none'}`,
    `Frozen query: ${JSON.stringify(scope.query)}`,
    'New matches never join this reviewed proposal automatically. Acceptance checks freshness and the validated delta.'].join('\n');
}
export function renderScopeEvidence(host: Pick<HTMLElement, 'textContent' | 'hidden'>, scope?: FrozenModelScope): void {
  host.hidden = scope === undefined;
  host.textContent = scope ? scopeEvidenceText(scope) : '';
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}
function choice(values: readonly string[]): HTMLSelectElement {
  const result = node('select');
  for (const value of values) { const option = node('option', value); option.value = value; result.append(option); }
  return result;
}
function field(host: HTMLElement, label: string, control: HTMLElement): void {
  const wrapper = node('label', label); wrapper.append(control); host.append(wrapper);
}
function action(host: HTMLElement, label: string, run: () => void): HTMLButtonElement {
  const result = node('button', label); result.type = 'button'; result.className = 'button outline';
  result.addEventListener('click', run); host.append(result); return result;
}
function textInput(placeholder = ''): HTMLInputElement {
  const result = node('input'); result.placeholder = placeholder; return result;
}
function splitIds(value: string): string[] { return [...new Set(value.split(/[\s,]+/).filter(Boolean))]; }

export function parameterKinds(): ModelParameterValue['kind'][] {
  return ModelParameterValueSchema.anyOf.map(schema => schema.properties.kind.const);
}
export function parameterUnits(kind: string): string[] {
  const schema = ModelParameterValueSchema.anyOf.find(item => item.properties.kind.const === kind);
  if (!schema || !('unit' in schema.properties)) return [];
  const unit = schema.properties.unit;
  return 'anyOf' in unit ? unit.anyOf.map(item => item.const) : [unit.const];
}
export function parseParameterValue(rawInput: unknown): ModelParameterValue {
  const input = plainScopeData(rawInput);
  if (!Check(Type.Object({ kind: Type.String(), value: Type.String(), unit: Type.String() }, { additionalProperties: false }), input)) throw new Error('Invalid parameter input.');
  const value = input.kind === 'boolean' ? input.value === 'true' ? true : input.value === 'false' ? false : undefined
    : input.kind === 'text' ? input.value : input.value.trim() ? Number(input.value) : undefined;
  const candidate = { kind: input.kind, value, ...(parameterUnits(input.kind).length ? { unit: input.unit } : {}) };
  if (!Check(ModelParameterValueSchema, candidate)) throw new Error('Enter a valid typed parameter value and unit.');
  return candidate;
}

type ScopeContext = { projectId: string; baseRevisionId: string; selectedIds: string[]; roomId: string | null; levelId: string | null };
type Preview = Awaited<ReturnType<ModelScopeClient['preview']>>;

export class ModelScopeBuilder {
  readonly #host: HTMLElement;
  readonly #client: ModelScopeClient;
  readonly #changed: () => void;
  readonly #context: () => ScopeContext | null;
  readonly #enabled = node('input');
  readonly #controls = node('fieldset');
  readonly #status = node('p', 'No scope enabled. The reference selection remains the request context.');
  readonly #evidence = node('pre');
  readonly #clauses = node('div');
  readonly #exclude = textInput('door-entry, wall-north');
  readonly #saved = choice([]);
  readonly #id = textInput('office-desks');
  readonly #name = textInput('Office desks');
  #query: ModelScopeQuery = { version: 1, allOf: [], anyOf: [], excludeIds: [] };
  #preview: Preview | null = null;
  #definitions: SavedModelScope[] = [];
  #savedScope: SavedModelScope | null = null;
  #savedScopeId: string | null = null;
  #projectId: string | null = null;
  #generation = 0;
  #loading = false;

  constructor(input: { host: HTMLElement; context: () => ScopeContext | null; changed: () => void; client?: ModelScopeClient }) {
    this.#host = input.host; this.#context = input.context; this.#changed = input.changed; this.#client = input.client ?? new ModelScopeClient();
    this.#enabled.type = 'checkbox'; field(this.#host, 'Use a model scope (optional)', this.#enabled);
    this.#enabled.addEventListener('change', () => { this.#invalidate(); this.#controls.hidden = !this.#enabled.checked; });
    this.#controls.hidden = true;
    this.#controls.append(node('legend', 'Compose target filters'), node('p', 'Filters identify requested targets. Context is read-only. Dependency writes remain bounded and need human review.'));
    const group = choice(['allOf', 'anyOf']); field(this.#controls, 'Add filters to: allOf = every filter; anyOf = at least one', group);
    const add = (predicate: ModelScopePredicate) => {
      this.#query = parseScopeQuery({ ...this.#query, [group.value]: [...(group.value === 'allOf' ? this.#query.allOf : this.#query.anyOf), predicate] });
      this.#invalidate(); this.#renderClauses();
    };
    const tryAdd = (create: (context: ScopeContext) => ModelScopePredicate) => this.#try(() => {
      const context = this.#context(); if (!context) throw new Error('Open a server project first.'); add(create(context));
    });
    const starts = node('div'); starts.className = 'scope-actions';
    action(starts, 'Add current selection', () => tryAdd(context => ({ kind: 'ids', ids: context.selectedIds })));
    action(starts, 'Add current room', () => tryAdd(context => { if (!context.roomId) throw new Error('Choose a room first.'); return { kind: 'in-spaces', spaceIds: [context.roomId] }; }));
    action(starts, 'Add current level', () => tryAdd(context => { if (!context.levelId) throw new Error('Choose a level first.'); return { kind: 'on-levels', levelIds: [context.levelId] }; }));
    action(starts, 'Add whole model', () => tryAdd(() => ({ kind: 'all' })));
    this.#controls.append(starts);
    const type = choice(['entity-type', 'furniture-kind', 'asset-family']);
    const typeValue = textInput('Furniture / desk / family ID');
    field(this.#controls, 'Type domain (entity type, furniture kind or shared asset family)', type); field(this.#controls, 'Exact type or family ID', typeValue);
    this.#controls.append(node('small', `Entity types: ${entityTypes.join(', ')}. Furniture kinds: ${FURNITURE_KINDS.join(', ')}. Asset family requires a stable family ID.`));
    action(this.#controls, 'Add type / family filter', () => tryAdd(() => type.value === 'entity-type' ? { kind: 'entity-type', entityType: typeValue.value.trim() }
      : type.value === 'furniture-kind' ? { kind: 'furniture-kind', furnitureKind: typeValue.value.trim() } : { kind: 'asset-family', familyId: typeValue.value.trim() }));
    const parameter = textInput('geometry-width or fire-rating'); const mode = choice(['parameter-exists', 'parameter-kind', 'parameter-compare']);
    const kind = choice(parameterKinds()); const operator = choice(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
    const value = textInput('Typed value (boolean: true or false)'); const unit = choice(parameterUnits(kind.value));
    kind.addEventListener('change', () => { unit.replaceChildren(...parameterUnits(kind.value).map(value => { const option = node('option', value); option.value = value; return option; })); unit.disabled = !parameterUnits(kind.value).length; });
    field(this.#controls, 'Parameter filter', mode); field(this.#controls, 'Parameter definition ID', parameter);
    this.#controls.append(node('small', 'Built-ins: geometry-width, geometry-depth, geometry-height, geometry-thickness, geometry-elevation, geometry-rotation, geometry-sill-height. Availability depends on the entity. Custom definitions use their stable IDs.'));
    field(this.#controls, 'Value kind', kind); field(this.#controls, 'Comparison', operator); field(this.#controls, 'Value', value); field(this.#controls, 'Unit', unit);
    action(this.#controls, 'Add parameter filter', () => tryAdd(() => {
      const definitionId = parameter.value.trim();
      if (mode.value === 'parameter-exists') return { kind: 'parameter-exists', definitionId };
      if (mode.value === 'parameter-kind') {
        const valueKind = parameterKinds().find(item => item === kind.value);
        if (!valueKind) throw new Error('Choose a supported parameter kind.');
        return { kind: 'parameter-kind', valueKind };
      }
      const candidate: unknown = { kind: 'parameter-compare', definitionId, operator: operator.value,
        value: parseParameterValue({ kind: kind.value, value: value.value, unit: unit.value }) };
      const parsed = parseModelScopeQuery({ version: 1, allOf: [candidate], anyOf: [], excludeIds: [] });
      const predicate = parsed.allOf[0]; if (!predicate) throw new Error('Invalid comparison.'); return predicate;
    }));
    const geometry = node('details'); geometry.append(node('summary', 'Bounds and relationship filters'));
    const coordinates = [textInput('min X'), textInput('min Y'), textInput('max X'), textInput('max Y')];
    for (const [index, label] of ['Minimum X · m', 'Minimum Y · m', 'Maximum X · m', 'Maximum Y · m'].entries()) {
      const control = coordinates[index]; if (control) { control.type = 'number'; control.step = 'any'; field(geometry, label, control); }
    }
    const boundsMode = choice(['intersects', 'contained']); const boundLevels = textInput('Optional level IDs, comma separated');
    field(geometry, 'Bounds observation (not exact solid intersection)', boundsMode); field(geometry, 'Bounds level IDs (empty = all levels)', boundLevels);
    action(geometry, 'Add bounds filter', () => tryAdd(() => {
      const values = coordinates.map(control => { if (!control.value.trim()) throw new Error('Enter all four bounds in metres.'); return Number(control.value); });
      return { kind: 'bounds', bounds: { minX: values[0] ?? NaN, minY: values[1] ?? NaN, maxX: values[2] ?? NaN, maxY: values[3] ?? NaN },
        levelIds: splitIds(boundLevels.value), mode: boundsMode.value === 'contained' ? 'contained' : 'intersects' };
    }));
    const from = textInput('Seed entity IDs, comma separated'); const relation = choice(['hosted-by', 'supported-by', 'instance-of', 'contained-in']);
    const direction = choice(['outgoing', 'incoming', 'either']); const depth = textInput('1'); depth.type = 'number'; depth.min = '1'; depth.max = '8'; depth.value = '1';
    field(geometry, 'Relationship seed IDs', from); field(geometry, 'Relationship', relation); field(geometry, 'Direction', direction); field(geometry, 'Maximum traversal depth', depth);
    action(geometry, 'Add relationship filter', () => tryAdd(() => {
      const parsed = parseModelScopeQuery({ version: 1, allOf: [{ kind: 'related', fromIds: splitIds(from.value), relation: relation.value, direction: direction.value, depth: Number(depth.value) }], anyOf: [], excludeIds: [] });
      const predicate = parsed.allOf[0]; if (!predicate) throw new Error('Invalid relationship.'); return predicate;
    }));
    this.#controls.append(geometry, this.#clauses);
    field(this.#controls, 'Exclude entity IDs (comma separated)', this.#exclude);
    this.#exclude.addEventListener('input', () => { this.#invalidate(); });
    const previewActions = node('div'); previewActions.className = 'scope-actions';
    action(previewActions, 'Preview scope', () => { void this.#run(async () => {
      const context = this.#context(); if (!context) throw new Error('Open a server project first.');
      const query = this.#currentQuery(); const generation = this.#generation;
      const result = await this.#client.preview({ ...context, query });
      if (!this.#matches(context, generation)) return;
      this.#preview = result; renderScopeEvidence(this.#evidence, result.scope);
      this.#evidence.textContent += '\nObject identities:\n' + result.identities.map(item => `${item.id} · ${item.type} · ${item.name}`).join('\n');
      this.#status.textContent = result.scope.targetIds.length ? 'Preview ready for this revision and query. No geometry changed.' : 'No targets match. Adjust the filters before submitting.';
    }); });
    action(previewActions, 'Clear filters', () => { this.reset(); });
    this.#controls.append(previewActions, this.#evidence);
    const named = node('details'); named.append(node('summary', 'Save or reopen a named scope'));
    field(named, 'Saved scopes in this project', this.#saved);
    action(named, 'Refresh named scopes', () => { void this.#run(() => this.#refresh()); });
    action(named, 'Reopen selected scope', () => this.#try(() => {
      const saved = this.#definitions.find(item => item.id === this.#saved.value);
      if (!saved) throw new Error('Refresh and choose a saved scope first.');
      this.restore({ query: saved.query, savedScopeId: saved.id }); this.#savedScope = saved;
      this.#id.value = saved.id; this.#name.value = saved.name;
      this.#status.textContent = `Reopened version ${saved.version}. Preview against the current revision before submitting.`;
    }));
    field(named, 'Stable scope ID', this.#id); field(named, 'Scope name', this.#name);
    action(named, 'Save named query', () => { void this.#run(async () => {
      const context = this.#context(); if (!context) throw new Error('Open a server project first.');
      const generation = this.#generation; const id = this.#id.value.trim();
      if (this.#savedScope && id !== this.#savedScope.id) throw new Error('Clear filters to create a new named scope, or retain the reopened scope ID.');
      const saved = await this.#client.save({ projectId: context.projectId, id, name: this.#name.value.trim(), query: this.#currentQuery(), expectedVersion: this.#savedScope?.version ?? null });
      if (!this.#matches(context, generation)) return;
      this.#savedScope = saved; this.#savedScopeId = saved.id; this.#status.textContent = `Named query saved · version ${saved.version}. Request copies retain their own frozen query.`;
      await this.#refresh();
    }); });
    this.#controls.append(named); this.#host.append(this.#controls, this.#status);
    this.#status.setAttribute('role', 'status'); this.#status.setAttribute('aria-live', 'polite');
    this.#evidence.className = 'scope-evidence'; this.#evidence.hidden = true;
  }

  get dirty(): boolean { return this.#enabled.checked; }
  get ready(): boolean { return !this.#loading && (!this.#enabled.checked || Boolean(this.#preview?.scope.targetIds.length && this.#matchesPreview())); }
  request(): ScopedRequest | undefined {
    if (!this.#enabled.checked) return undefined;
    if (!this.ready || !this.#preview) throw new Error('Preview this scope and confirm nonempty targets at the current revision before submitting.');
    return parseScopedRequest({ query: this.#preview.scope.query, ...(this.#savedScopeId ? { savedScopeId: this.#savedScopeId } : {}) });
  }
  setDisabled(disabled: boolean): void {
    this.#enabled.disabled = disabled || this.#loading; this.#controls.disabled = disabled || this.#loading;
    if (this.#preview && !this.#matchesPreview()) {
      this.#preview = null; this.#evidence.hidden = true;
      this.#status.textContent = 'The base revision changed. Preview this scope again before submitting.';
    }
  }
  setProject(projectId: string): void {
    if (this.#projectId === projectId) return;
    this.#projectId = projectId; this.#definitions = []; this.#saved.replaceChildren(); this.reset();
  }
  restore(scope: ScopedRequest): void {
    this.#enabled.checked = true; this.#controls.hidden = false; this.#query = parseScopeQuery(scope.query); this.#savedScopeId = scope.savedScopeId ?? null;
    this.#exclude.value = scope.query.excludeIds.join(', '); this.#savedScope = this.#definitions.find(item => item.id === scope.savedScopeId) ?? null;
    this.#invalidate(); this.#renderClauses();
  }
  reset(): void {
    this.#enabled.checked = false; this.#controls.hidden = true; this.#query = { version: 1, allOf: [], anyOf: [], excludeIds: [] };
    this.#exclude.value = ''; this.#savedScope = null; this.#savedScopeId = null; this.#id.value = ''; this.#name.value = ''; this.#invalidate(); this.#renderClauses();
  }
  #currentQuery(): ModelScopeQuery { return parseScopeQuery({ ...this.#query, excludeIds: splitIds(this.#exclude.value) }); }
  #matchesPreview(): boolean { return this.#context()?.baseRevisionId === this.#preview?.scope.baseRevisionId; }
  #matches(context: ScopeContext, generation: number): boolean {
    const current = this.#context(); return generation === this.#generation && current?.projectId === context.projectId && current.baseRevisionId === context.baseRevisionId;
  }
  #invalidate(): void {
    this.#generation++; this.#preview = null; this.#evidence.hidden = true; this.#evidence.textContent = '';
    this.#status.textContent = this.#enabled.checked ? 'Filters changed. Preview the scope before submitting.' : 'No scope enabled. The reference selection remains the request context.';
    this.#changed();
  }
  #renderClauses(): void {
    this.#clauses.replaceChildren();
    for (const group of ['allOf', 'anyOf'] satisfies Array<'allOf' | 'anyOf'>) for (const [index, predicate] of this.#query[group].entries()) {
      const row = node('div'); row.append(node('code', `${group}: ${JSON.stringify(predicate)}`));
      action(row, 'Remove filter', () => { this.#query = { ...this.#query, [group]: this.#query[group].filter((_, at) => at !== index) }; this.#invalidate(); this.#renderClauses(); });
      this.#clauses.append(row);
    }
  }
  async #refresh(): Promise<void> {
    const context = this.#context(); if (!context) throw new Error('Open a server project first.');
    const generation = this.#generation; const definitions = await this.#client.list(context.projectId);
    if (!this.#matches(context, generation)) return;
    this.#definitions = definitions;
    this.#saved.replaceChildren(...definitions.map(saved => { const option = node('option', `${saved.name} · ${saved.version.slice(0, 10)}`); option.value = saved.id; return option; }));
  }
  #try(action: () => void): void { try { action(); } catch (error) { this.#status.textContent = error instanceof Error ? error.message : 'Invalid scope input.'; } }
  async #run(action: () => Promise<void>): Promise<void> {
    if (this.#loading) return;
    const generation = this.#generation; const projectId = this.#context()?.projectId;
    this.#loading = true; this.#changed();
    try { await action(); }
    catch (error) { if (generation === this.#generation && projectId === this.#context()?.projectId) this.#status.textContent = error instanceof Error ? error.message : 'Scope action failed. Selection and filters are retained.'; }
    finally { this.#loading = false; this.#changed(); }
  }
}
