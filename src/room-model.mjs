const MAX_BYTES = 256 * 1024;
const token = Symbol('validated room repository');
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const fail = (message) => { throw new Error(message); };
const size = (text) => new TextEncoder().encode(text).length;

function copy(value, depth = 0, seen = new Set()) {
  if (depth > 16) fail('Model data is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('Model data must be finite JSON values.');
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Model data must be plain objects.');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256 || keys.some((key) => typeof key !== 'string')) fail('Model collection is too large or has unknown fields.');
  if (array && (value.length > 100 || keys.length !== value.length + 1)) fail('Model arrays must be dense and bounded.');
  seen.add(value);
  const output = array ? [] : {};
  for (const key of keys.filter((key) => !array || key !== 'length').sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('Unsupported model field.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('Model accessors are not supported.');
    if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail('Invalid array field.');
    output[key] = copy(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fields(value, expected) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).sort().join(',') !== expected.slice().sort().join(',')) fail('Unexpected model fields.');
}

function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f]/.test(value)) fail('Names must contain 1 to 80 readable characters.');
  return value;
}

function identifier(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) fail('Invalid stable identifier.');
}

function branchName(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z]+(?:-[a-z]+)*$/.test(value)) fail('Proposal names require lowercase words separated by hyphens.');
}

function metres(value, min = 0.001, max = 100) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
      || Math.abs(Math.round(value * 1000) - value * 1000) > 0.000001) fail('Dimensions must be bounded metres on a 1 mm grid.');
}

function point(value) {
  if (!Array.isArray(value) || value.length !== 2) fail('Wall coordinates require two dimensions.');
  value.forEach((item) => metres(item, -1000, 1000));
}

function graph(input) {
  const snapshot = copy(input);
  fields(snapshot, ['units', 'entities', 'relationships']);
  if (snapshot.units !== 'm' || !Array.isArray(snapshot.entities) || !Array.isArray(snapshot.relationships)
      || snapshot.entities.length > 100 || snapshot.relationships.length > 100) fail('Unsupported model snapshot.');
  const entities = new Map();
  for (const entity of snapshot.entities) {
    identifier(entity?.id); label(entity.name);
    if (entities.has(entity.id)) fail('Duplicate entity identifier.');
    if (entity.type === 'Wall') {
      fields(entity, ['id', 'type', 'name', 'start', 'end', 'thickness', 'height']);
      point(entity.start); point(entity.end); metres(entity.thickness); metres(entity.height);
      const length = Math.hypot(entity.end[0] - entity.start[0], entity.end[1] - entity.start[1]);
      if (length < 0.001 || length > 1000) fail('Wall length is outside the demo bounds.');
    } else if (entity.type === 'Door') {
      fields(entity, ['id', 'type', 'name', 'width', 'height']);
      metres(entity.width); metres(entity.height);
    } else fail('Only demo walls and doors are supported.');
    entities.set(entity.id, entity);
  }
  const relations = new Set();
  const hosted = new Set();
  for (const relation of snapshot.relationships) {
    fields(relation, ['id', 'type', 'source', 'target', 'offset']); identifier(relation.id);
    identifier(relation.source); identifier(relation.target); metres(relation.offset, 0, 1000);
    if (relation.type !== 'hosted-by' || relations.has(relation.id) || hosted.has(relation.source)) fail('Invalid or duplicate hosting relationship.');
    const door = entities.get(relation.source); const wall = entities.get(relation.target);
    if (door?.type !== 'Door' || wall?.type !== 'Wall') fail('Hosting references must identify a door and wall.');
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    if (relation.offset + door.width > length + 1e-9 || door.height > wall.height) fail('Door opening must fit inside its host wall.');
    relations.add(relation.id); hosted.add(relation.source);
  }
  if (snapshot.entities.some((entity) => entity.type === 'Door' && !hosted.has(entity.id))) fail('Every door must have exactly one host.');
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  snapshot.entities.sort(byId); snapshot.relationships.sort(byId);
  return freeze(snapshot);
}

function fixture() {
  return graph({ units: 'm', entities: [
    ...[
      ['south', [0, 0], [6, 0]], ['east', [6, 0], [6, 4]],
      ['north', [6, 4], [0, 4]], ['west', [0, 4], [0, 0]],
    ].map(([side, start, end]) => ({ id: `wall-${side}`, type: 'Wall', name: `${side[0].toUpperCase()}${side.slice(1)} wall`, start, end, thickness: 0.2, height: 3 })),
    { id: 'door-entry', type: 'Door', name: 'Entry door', width: 0.9, height: 2.1 },
  ], relationships: [{ id: 'host-entry', type: 'hosted-by', source: 'door-entry', target: 'wall-south', offset: 2.4 }] });
}

async function revision(parentId, snapshot) {
  const bytes = new TextEncoder().encode(canonical({ version: 1, parentId, snapshot }));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return freeze({ id, parentId, snapshot });
}

function changes(before, after) {
  const left = new Map(before.map((item) => [item.id, item]));
  const right = new Map(after.map((item) => [item.id, item]));
  return {
    added: after.filter((item) => !left.has(item.id)),
    removed: before.filter((item) => !right.has(item.id)),
    modified: after.filter((item) => left.has(item.id) && canonical(item) !== canonical(left.get(item.id)))
      .map((item) => ({ id: item.id, before: left.get(item.id), after: item })),
  };
}

export function diffSnapshots(before, after) {
  const left = graph(before); const right = graph(after);
  return freeze({ entities: changes(left.entities, right.entities), relationships: changes(left.relationships, right.relationships) });
}

export class RoomRepository {
  #state;
  #revisions;

  constructor(key, state) {
    if (key !== token) fail('Use RoomRepository.create or restore.');
    this.#state = freeze({ ...state, branches: [...state.branches].sort((a, b) =>
      a.name === b.name ? 0 : a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name < b.name ? -1 : 1) });
    this.#revisions = new Map(state.revisions.map((item) => [item.id, item]));
    Object.freeze(this);
  }

  static async create(name = 'Courtyard study') {
    label(name);
    const initial = await revision(null, fixture());
    return new RoomRepository(token, { version: 1, projectId: globalThis.crypto.randomUUID(), name,
      revisions: [initial], branches: [{ name: 'main', revisionId: initial.id }] });
  }

  static async restore(text) {
    if (typeof text !== 'string' || size(text) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    let state;
    try { state = copy(JSON.parse(text)); } catch { fail('Saved project is not valid bounded JSON.'); }
    fields(state, ['version', 'projectId', 'name', 'revisions', 'branches']); label(state.name);
    if (state.version !== 1 || typeof state.projectId !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.projectId)
        || !Array.isArray(state.revisions) || !state.revisions.length || state.revisions.length > 32
        || !Array.isArray(state.branches) || !state.branches.length || state.branches.length > 32) fail('Unsupported saved project.');
    const revisions = new Map();
    for (const item of state.revisions) {
      fields(item, ['id', 'parentId', 'snapshot']);
      if (!revisionPattern.test(item.id) || (item.parentId !== null && !revisionPattern.test(item.parentId))
          || revisions.has(item.id)) fail('Invalid revision identity.');
      const validated = await revision(item.parentId, graph(item.snapshot));
      if (validated.id !== item.id) fail('Saved revision content does not match its hash.');
      revisions.set(item.id, validated);
    }
    const roots = [...revisions.values()].filter((item) => item.parentId === null);
    if (roots.length !== 1 || roots[0].id !== (await revision(null, fixture())).id) fail('The original room revision must be preserved.');
    for (const item of revisions.values()) {
      const seen = new Set(); let current = item;
      while (current.parentId !== null) {
        if (seen.has(current.id)) fail('Revision ancestry contains a cycle.');
        seen.add(current.id); current = revisions.get(current.parentId);
        if (!current) fail('Revision ancestry is incomplete.');
      }
    }
    const branches = new Set(); const reachable = new Set();
    for (const branch of state.branches) {
      fields(branch, ['name', 'revisionId']); branchName(branch.name);
      if (branches.has(branch.name) || !revisions.has(branch.revisionId)) fail('Invalid branch target or duplicate branch.');
      branches.add(branch.name);
      if (branch.name === 'main' && branch.revisionId !== roots[0].id) fail('The original branch cannot advance in this demo.');
      let current = revisions.get(branch.revisionId);
      while (current) { reachable.add(current.id); current = revisions.get(current.parentId); }
    }
    if (!branches.has('main') || reachable.size !== revisions.size) fail('Saved project has missing or unreachable history.');
    return new RoomRepository(token, { ...state, revisions: [...revisions.values()] });
  }

  get name() { return this.#state.name; }

  head(name) {
    const branch = this.#state.branches.find((item) => item.name === name);
    if (!branch) fail('Unknown branch.');
    return branch.revisionId;
  }

  view(id) {
    const value = this.#revisions.get(id);
    if (!value) fail('Unknown revision.');
    return value;
  }

  branches() { return this.#state.branches; }

  async propose(input) {
    const { name, from, doorWidthM } = copy(input);
    fields(input, ['name', 'from', 'doorWidthM']); branchName(name);
    if (name === 'main') fail('Choose a proposal name other than main.');
    metres(doorWidthM);
    const base = this.view(from);
    const snapshot = copy(base.snapshot);
    const door = snapshot.entities.find((item) => item.id === 'door-entry' && item.type === 'Door');
    if (!door) fail('This revision has no entry door.');
    door.width = doorWidthM;
    const updated = graph(snapshot);
    const next = canonical(updated) === canonical(base.snapshot) ? base : await revision(from, updated);
    const existing = this.#state.branches.find((item) => item.name === name);
    if (existing) {
      if (existing.revisionId === next.id) return this;
      fail('A different proposal already uses that name.');
    }
    if (next === base) return this;
    const revisions = this.#revisions.has(next.id) ? this.#state.revisions : [...this.#state.revisions, next];
    if (revisions.length > 32 || this.#state.branches.length >= 32) fail('Demo history is full. Export it before starting another project.');
    const state = { ...this.#state, revisions, branches: [...this.#state.branches, { name, revisionId: next.id }] };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    return new RoomRepository(token, state);
  }

  compare(before, after) { return diffSnapshots(this.view(before).snapshot, this.view(after).snapshot); }

  conflicts(baseId, leftId, rightId) {
    const ancestor = (id) => {
      let current = this.view(id);
      while (current.id !== baseId && current.parentId !== null) current = this.view(current.parentId);
      if (current.id !== baseId) fail('Comparison requires a shared ancestor.');
    };
    ancestor(leftId); ancestor(rightId);
    const base = this.view(baseId).snapshot;
    const left = this.view(leftId).snapshot; const right = this.view(rightId).snapshot;
    const conflicts = [];
    for (const [collection, kind] of [['entities', 'entity'], ['relationships', 'relationship']]) {
      const maps = [base, left, right].map((snapshot) => new Map(snapshot[collection].map((item) => [item.id, item])));
      const ids = [...new Set(maps.flatMap((map) => [...map.keys()]))].sort();
      for (const id of ids) {
        const [original, a, b] = maps.map((map) => map.get(id) ?? null);
        if (canonical(a) !== canonical(original) && canonical(b) !== canonical(original) && canonical(a) !== canonical(b)) {
          conflicts.push({ kind, id, base: original, left: a, right: b });
        }
      }
    }
    return freeze(conflicts);
  }

  serialize() { return canonical(this.#state); }
}
