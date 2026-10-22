const MAX_BYTES = 256 * 1024;
const token = Symbol('validated room repository');
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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
      || Object.keys(value).length !== expected.length
      || !expected.every((key) => Object.hasOwn(value, key))) fail('Unexpected model fields.');
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

function readable(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail(`${name} must contain readable text no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function boundedInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) fail(`Invalid ${name}.`);
}

function reviewRecord(input, revisions, branches) {
  const review = copy(input);
  fields(review, ['requestId', 'proposalName', 'baseRevisionId', 'proposalRevisionId', 'selectedObjectIds', 'instruction',
    'summary', 'rationale', 'constraints', 'uncertainty', 'worker', 'toolCalls', 'validator', 'decision']);
  if (typeof review.requestId !== 'string' || !requestPattern.test(review.requestId)) fail('Invalid review request identity.');
  branchName(review.proposalName);
  if (!revisionPattern.test(review.baseRevisionId) || !revisionPattern.test(review.proposalRevisionId)) fail('Invalid reviewed revision identity.');
  const base = revisions.get(review.baseRevisionId); const proposal = revisions.get(review.proposalRevisionId);
  const branch = branches.get(review.proposalName);
  if (!base || !proposal || proposal.parentId !== base.id || branch?.revisionId !== proposal.id) fail('Review is not bound to its proposal history.');
  if (!Array.isArray(review.selectedObjectIds) || review.selectedObjectIds.length < 1 || review.selectedObjectIds.length > 16
      || new Set(review.selectedObjectIds).size !== review.selectedObjectIds.length) fail('Invalid reviewed object identities.');
  const baseObjects = new Set(base.snapshot.entities.map((entity) => entity.id));
  for (const id of review.selectedObjectIds) if (typeof id !== 'string' || !idPattern.test(id) || !baseObjects.has(id)) fail('Invalid reviewed object identity.');
  review.instruction = readable(review.instruction, 'Reviewed instruction', 1000);
  review.summary = readable(review.summary, 'Review summary', 240);
  review.rationale = readable(review.rationale, 'Review rationale', 800);
  review.constraints = readable(review.constraints, 'Review constraints', 600);
  review.uncertainty = readable(review.uncertainty, 'Review uncertainty', 400);
  fields(review.worker, ['provider', 'model', 'responseIds', 'usage']);
  review.worker.provider = readable(review.worker.provider, 'Worker provider', 80);
  review.worker.model = readable(review.worker.model, 'Worker model', 100);
  if (!Array.isArray(review.worker.responseIds) || review.worker.responseIds.length > 12
      || review.worker.responseIds.some((id) => typeof id !== 'string' || !requestPattern.test(id))) fail('Invalid model response identities.');
  fields(review.worker.usage, ['inputTokens', 'outputTokens', 'totalTokens']);
  boundedInteger(review.worker.usage.inputTokens, 'input token count');
  boundedInteger(review.worker.usage.outputTokens, 'output token count');
  boundedInteger(review.worker.usage.totalTokens, 'total token count');
  if (review.worker.usage.totalTokens < review.worker.usage.inputTokens + review.worker.usage.outputTokens) fail('Invalid total token count.');
  if (!Array.isArray(review.toolCalls) || review.toolCalls.length < 1 || review.toolCalls.length > 12) fail('Invalid model tool evidence.');
  for (const call of review.toolCalls) {
    fields(call, ['name', 'status', 'error']);
    if (!['inspect_model', 'preview_rectangle', 'submit_proposal', 'decline_request', 'unsupported_tool'].includes(call.name)
        || !['accepted', 'rejected'].includes(call.status)
        || (call.error !== null && (typeof call.error !== 'string' || !call.error || call.error.length > 240))) fail('Invalid model tool evidence.');
  }
  if (review.validator !== 'room-graph-v1') fail('Unknown proposal validator.');
  fields(review.decision, ['status', 'decisionId', 'actor']);
  if (!['pending', 'accepted', 'superseded'].includes(review.decision.status)) fail('Invalid proposal decision.');
  if (review.decision.status === 'pending') {
    if (review.decision.decisionId !== null || review.decision.actor !== null) fail('Pending proposals cannot contain a decision identity.');
  } else {
    if (typeof review.decision.decisionId !== 'string' || !requestPattern.test(review.decision.decisionId)) fail('Invalid decision identity.');
    review.decision.actor = readable(review.decision.actor, 'Decision actor', 80);
  }
  return freeze(review);
}

function metres(value, min = 0.001, max = 100) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
      || Math.abs(Math.round(value * 1000) - value * 1000) > 0.000001) fail('Dimensions must be bounded metres on a 1 mm grid.');
}

function point(value) {
  if (!Array.isArray(value) || value.length !== 2) fail('Wall coordinates require two dimensions.');
  value.forEach((item) => metres(item, -1000, 1000));
}

function wallLength(wall) {
  return Math.hypot(
    Math.round(wall.end[0] * 1000) - Math.round(wall.start[0] * 1000),
    Math.round(wall.end[1] * 1000) - Math.round(wall.start[1] * 1000),
  ) / 1000;
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
      // Measure the minimum on the validated grid: a 1 mm edge near 1000 m can subtract to slightly less.
      if (wallLength(entity) < 0.001 || length > 1000) fail('Wall length is outside the demo bounds.');
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

function rectangle(input) {
  const snapshot = graph(input);
  const walls = snapshot.entities.filter((entity) => entity.type === 'Wall');
  const door = snapshot.entities.find((entity) => entity.type === 'Door' && entity.id === 'door-entry');
  if (walls.length !== 4 || snapshot.entities.length !== 5 || !door || snapshot.relationships.length !== 1) {
    fail('Interactive editing requires four rectangular walls and one hosted entry door.');
  }
  const edges = walls.map((wall) => [wall.start, wall.end].map((point) => point.map((value) => Math.round(value * 1000))));
  const corners = edges.flat();
  const minX = Math.min(...corners.map(([x]) => x));
  const maxX = Math.max(...corners.map(([x]) => x));
  const minY = Math.min(...corners.map(([, y]) => y));
  const maxY = Math.max(...corners.map(([, y]) => y));
  const sides = new Set();
  for (const [[sx, sy], [ex, ey]] of edges) {
    let side;
    if (sy === ey && Math.min(sx, ex) === minX && Math.max(sx, ex) === maxX) {
      if (sy === minY) side = 'south';
      else if (sy === maxY) side = 'north';
    } else if (sx === ex && Math.min(sy, ey) === minY && Math.max(sy, ey) === maxY) {
      if (sx === minX) side = 'west';
      else if (sx === maxX) side = 'east';
    }
    if (!side || sides.has(side)) fail('Interactive editing requires a connected axis-aligned rectangle.');
    sides.add(side);
  }
  if (minX >= maxX || minY >= maxY) fail('Interactive editing requires a positive rectangular area.');
  return { snapshot, boundsMm: { minX, minY, maxX, maxY }, door };
}

export function rectangleLayout(snapshot) {
  const room = rectangle(snapshot);
  return freeze({ boundsMm: room.boundsMm, door: {
    widthMm: Math.round(room.door.width * 1000),
    offsetMm: Math.round(room.snapshot.relationships[0].offset * 1000),
  } });
}

function integerMm(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Layout dimensions must be bounded whole millimetres.');
}

export function previewRectangle(baseSnapshot, input) {
  const layout = copy(input);
  fields(layout, ['boundsMm', 'door']);
  fields(layout.boundsMm, ['minX', 'minY', 'maxX', 'maxY']);
  fields(layout.door, ['widthMm', 'offsetMm']);
  const { minX, minY, maxX, maxY } = layout.boundsMm;
  for (const coordinate of [minX, minY, maxX, maxY]) integerMm(coordinate, -1000000, 1000000);
  const width = maxX - minX; const depth = maxY - minY;
  if (width <= 0 || depth <= 0 || width > 1000000 || depth > 1000000) fail('Room spans must be between 1 and 1000000 millimetres.');
  integerMm(layout.door.widthMm, 1, 100000);
  integerMm(layout.door.offsetMm, 0, 1000000);
  const base = rectangle(baseSnapshot);
  const snapshot = copy(base.snapshot);
  const host = snapshot.relationships[0];
  const hostWall = snapshot.entities.find((entity) => entity.id === host.target);
  const hostLength = Math.round(hostWall.start[1] * 1000) === Math.round(hostWall.end[1] * 1000) ? width : depth;
  if (layout.door.offsetMm + layout.door.widthMm > hostLength) fail('Door opening must fit inside its host wall.');
  for (const entity of snapshot.entities) {
    if (entity.type === 'Wall') {
      const move = ([x, y]) => [
        (Math.round(x * 1000) === base.boundsMm.minX ? minX : maxX) / 1000,
        (Math.round(y * 1000) === base.boundsMm.minY ? minY : maxY) / 1000,
      ];
      entity.start = move(entity.start);
      entity.end = move(entity.end);
    } else entity.width = layout.door.widthMm / 1000;
  }
  host.offset = layout.door.offsetMm / 1000;
  return graph(snapshot);
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
    return new RoomRepository(token, { version: 2, projectId: globalThis.crypto.randomUUID(), name,
      revisions: [initial], branches: [{ name: 'main', revisionId: initial.id }], reviews: [] });
  }

  static async restore(text) {
    if (typeof text !== 'string' || size(text) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    let state;
    try { state = copy(JSON.parse(text)); } catch { fail('Saved project is not valid bounded JSON.'); }
    if (state?.version === 1) fields(state, ['version', 'projectId', 'name', 'revisions', 'branches']);
    else if (state?.version === 2) fields(state, ['version', 'projectId', 'name', 'revisions', 'branches', 'reviews']);
    else fail('Unsupported saved project.');
    label(state.name);
    if (typeof state.projectId !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.projectId)
        || !Array.isArray(state.revisions) || !state.revisions.length || state.revisions.length > 32
        || !Array.isArray(state.branches) || !state.branches.length || state.branches.length > 32
        || (state.version === 2 && (!Array.isArray(state.reviews) || state.reviews.length > 31))) fail('Unsupported saved project.');
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
    const branches = new Map(); const reachable = new Set();
    for (const branch of state.branches) {
      fields(branch, ['name', 'revisionId']); branchName(branch.name);
      if (branches.has(branch.name) || !revisions.has(branch.revisionId)) fail('Invalid branch target or duplicate branch.');
      branches.set(branch.name, branch);
      if (state.version === 1 && branch.name === 'main' && branch.revisionId !== roots[0].id) fail('Version one main must preserve the original revision.');
      let current = revisions.get(branch.revisionId);
      while (current) { reachable.add(current.id); current = revisions.get(current.parentId); }
    }
    if (!branches.has('main') || reachable.size !== revisions.size) fail('Saved project has missing or unreachable history.');
    let reviews = [];
    if (state.version === 2) {
      const requests = new Set(); const proposals = new Set();
      reviews = state.reviews.map((item) => {
        const review = reviewRecord(item, revisions, branches);
        if (requests.has(review.requestId) || proposals.has(review.proposalName)) fail('Duplicate proposal review identity.');
        requests.add(review.requestId); proposals.add(review.proposalName); return review;
      });
      const main = branches.get('main').revisionId;
      if (main !== roots[0].id && !reviews.some((review) => review.proposalRevisionId === main && review.decision.status === 'accepted')) {
        fail('The current model must reference an accepted reviewed proposal.');
      }
    }
    return new RoomRepository(token, { ...state, revisions: [...revisions.values()], ...(state.version === 2 ? { reviews } : {}) });
  }

  get name() { return this.#state.name; }

  root() { return this.#state.revisions.find((item) => item.parentId === null).id; }

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

  reviews() { return this.#state.version === 2 ? this.#state.reviews : []; }

  review(name) {
    branchName(name);
    const value = this.reviews().find((item) => item.proposalName === name);
    if (!value) fail('Unknown reviewed proposal.');
    return value;
  }

  accept(name, input) {
    branchName(name);
    if (name === 'main') fail('Choose a proposal to accept.');
    const proposal = this.#state.branches.find((item) => item.name === name);
    if (!proposal) fail('Unknown proposal.');
    const review = this.review(name);
    const decision = copy(input);
    fields(decision, ['decisionId', 'actor']);
    if (typeof decision.decisionId !== 'string' || !requestPattern.test(decision.decisionId)) fail('Invalid decision identity.');
    decision.actor = readable(decision.actor, 'Decision actor', 80);
    if (this.head('main') === proposal.revisionId && review.decision.status === 'accepted') return this;
    const branches = this.#state.branches.map((item) => item.name === 'main'
      ? { name: 'main', revisionId: proposal.revisionId } : item);
    const reviews = this.reviews().map((item) => item.proposalName === name
      ? { ...item, decision: { status: 'accepted', decisionId: decision.decisionId, actor: decision.actor } }
      : item.decision.status === 'accepted' ? { ...item, decision: { ...item.decision, status: 'superseded' } } : item);
    const state = { ...this.#state, version: 2, branches, reviews };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    return new RoomRepository(token, state);
  }

  async propose(input) {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'doorWidthM']);
    const { name, from, doorWidthM } = proposal;
    metres(doorWidthM);
    const base = this.view(from);
    const snapshot = copy(base.snapshot);
    const door = snapshot.entities.find((item) => item.id === 'door-entry' && item.type === 'Door');
    if (!door) fail('This revision has no entry door.');
    door.width = doorWidthM;
    return this.#commit(name, base, snapshot);
  }

  async proposeLayout(input) {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'layout']);
    const { name, from, layout } = proposal;
    const base = this.view(from);
    return this.#commit(name, base, previewRectangle(base.snapshot, layout));
  }

  async proposeReviewedLayout(input) {
    const proposal = copy(input);
    fields(proposal, ['name', 'from', 'layout', 'review']);
    const details = proposal.review;
    fields(details, ['requestId', 'selectedObjectIds', 'instruction', 'summary', 'rationale', 'constraints',
      'uncertainty', 'worker', 'toolCalls', 'validator']);
    const next = await this.#commit(proposal.name, this.view(proposal.from), previewRectangle(this.view(proposal.from).snapshot, proposal.layout));
    if (next === this) fail('The reviewed proposal must change the bound revision.');
    const record = reviewRecord({
      requestId: details.requestId, proposalName: proposal.name, baseRevisionId: proposal.from,
      proposalRevisionId: next.head(proposal.name), selectedObjectIds: details.selectedObjectIds,
      instruction: details.instruction, summary: details.summary, rationale: details.rationale,
      constraints: details.constraints, uncertainty: details.uncertainty, worker: details.worker,
      toolCalls: details.toolCalls, validator: details.validator,
      decision: { status: 'pending', decisionId: null, actor: null },
    }, next.#revisions, new Map(next.#state.branches.map((branch) => [branch.name, branch])));
    const reviews = [...next.reviews(), record];
    if (reviews.some((item, index) => reviews.findIndex((other) => other.requestId === item.requestId || other.proposalName === item.proposalName) !== index)) {
      fail('Duplicate proposal review identity.');
    }
    const state = { ...next.#state, version: 2, reviews };
    if (size(canonical(state)) > MAX_BYTES) fail('Saved project exceeds the 256 KiB demo limit.');
    return new RoomRepository(token, state);
  }

  async #commit(name, base, snapshot) {
    branchName(name);
    if (name === 'main') fail('Choose a proposal name other than main.');
    const updated = graph(snapshot);
    const next = canonical(updated) === canonical(base.snapshot) ? base : await revision(base.id, updated);
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
