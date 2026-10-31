import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import workerThreads from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import { createGeometrySession, GeometrySession, GeometrySessionError, validateGeometryReceiptsInWorker } from './geometry-session.ts';
import type { GeometrySessionInput } from './geometry-session.ts';

const flush = (): Promise<void> => setImmediate();
function input(projectId = 'project'): GeometrySessionInput {
  return { projectId, native: { snapshot: { units: 'm', entities: [], relationships: [] }, revisionId: 'a'.repeat(64), target: { kind: 'main' } }, linked: [] };
}
function watch<T>(promise: Promise<T>) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  return { promise, get settled() { return settled; } };
}
const reason = (expected: GeometrySessionError['reason']) => (error: unknown): boolean => error instanceof GeometrySessionError && error.reason === expected;

// Replace only the builtin constructor, synchronizing its named ESM binding. Production
// admission, timers, message validation and cleanup all run unchanged. Exit and terminate
// completion are separate explicit gates; no OS scheduling or sleeps decide assertions.
function controlledWorkers(t: TestContext) {
  const original = workerThreads.Worker;
  let now = 0;
  const state = { failConstruction: false, highWater: 0, live: 0 };
  const workers: ControlledWorker[] = [];
  class ControlledWorker extends EventEmitter {
    readonly data: unknown;
    readonly options: WorkerOptions;
    terminateCalls = 0;
    exited = false;
    readonly #termination = Promise.withResolvers<number>();
    constructor(_filename: string | URL, options: WorkerOptions) {
      super();
      if (state.failConstruction) { state.failConstruction = false; throw new Error('controlled constructor failure'); }
      this.data = options.workerData; this.options = options;
      workers.push(this); state.live++; state.highWater = Math.max(state.highWater, state.live);
    }
    terminate(): Promise<number> { this.terminateCalls++; return this.#termination.promise; }
    postMessage(_message: unknown): void {}
    message(value: unknown): void { this.emit('message', value); }
    releaseExit(): void { if (!this.exited) { this.exited = true; state.live--; this.emit('exit', 0); } }
    completeTermination(): void { this.#termination.resolve(0); }
    rejectTermination(): void { this.#termination.reject(new Error('controlled termination failure')); }
    exit(): void { this.releaseExit(); this.completeTermination(); }
  }
  Object.defineProperty(workerThreads, 'Worker', { value: ControlledWorker, configurable: true, writable: true });
  syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => now);
  t.after(async () => {
    // Also drain workers admitted by an exit during cleanup if an assertion failed.
    try {
      for (let pass = 0; pass < 20; pass++) {
        for (const instance of workers) instance.exit();
        await flush();
        if (workers.every(instance => instance.exited)) break;
      }
    } finally {
      Object.defineProperty(workerThreads, 'Worker', { value: original, configurable: true, writable: true });
      syncBuiltinESMExports();
    }
  });
  return { workers, state, advance(ms: number) { now += ms; }, tick(ms: number) { now += ms; t.mock.timers.tick(ms); },
    check(id: string, options: Parameters<typeof validateGeometryReceiptsInWorker>[1] = {}) {
      return watch(validateGeometryReceiptsInWorker({ current: input(id), receipts: [] }, options));
    } };
}

test('four held workers admit five waiters in FIFO order only after actual exit', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`));
  await flush(); assert.equal(h.workers.length, 4);
  const queued = Array.from({ length: 5 }, (_, index) => h.check(`queued-${index}`));
  await flush(); assert.equal(h.workers.length, 4);
  for (let index = 0; index < 5; index++) {
    const retiring = h.workers[index]; assert.ok(retiring);
    retiring.message({ kind: 'fresh' }); await flush();
    assert.equal(retiring.terminateCalls, 1);
    assert.equal(h.workers.length, index + 4, 'requesting termination must not release admission');
    retiring.completeTermination(); await flush();
    assert.equal(h.workers.length, index + 4, 'terminate completion alone must not release admission');
    retiring.releaseExit(); await flush();
    assert.equal(h.workers.length, index + 5);
    assert.deepEqual(h.workers[index + 4]?.data, { kind: 'revalidate', input: { current: input(`queued-${index}`), receipts: [] } });
  }
  for (const instance of h.workers.slice(5)) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all([...held, ...queued].map(result => result.promise));
  assert.equal(h.state.highWater, 4); assert.equal(h.state.live, 0);
  assert.deepEqual(h.workers[0]?.options.resourceLimits, { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 });
});

test('queued abort and deadline remove waiters without changing survivor FIFO or spawning late workers', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const controller = new AbortController();
  const aborted = h.check('aborted', { signal: controller.signal });
  const first = h.check('first');
  const expired = h.check('expired', { timeoutMs: 10 });
  const last = h.check('last');
  controller.abort(); await assert.rejects(aborted.promise, reason('aborted'));
  h.tick(10); await assert.rejects(expired.promise, reason('deadline'));
  assert.equal(h.workers.length, 4);
  h.workers[0]?.message({ kind: 'fresh' }); h.workers[0]?.exit(); await flush();
  assert.deepEqual(h.workers[4]?.data, { kind: 'revalidate', input: { current: input('first'), receipts: [] } });
  h.workers[1]?.message({ kind: 'fresh' }); h.workers[1]?.exit(); await flush();
  assert.deepEqual(h.workers[5]?.data, { kind: 'revalidate', input: { current: input('last'), receipts: [] } });
  for (const instance of h.workers.slice(2)) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all([...held, first, last].map(result => result.promise));
  assert.equal(h.workers.length, 6); assert.equal(h.state.highWater, 4);
});

test('admission has a finite sixteen-waiter cap and cancellation frees a queue position', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const controllers = Array.from({ length: 16 }, () => new AbortController());
  const queued = controllers.map((controller, index) => h.check(`queued-${index}`, { signal: controller.signal }));
  await assert.rejects(h.check('overflow').promise, /admission queue is full/);
  controllers[0]?.abort(); await assert.rejects(queued[0].promise, reason('aborted'));
  const replacementController = new AbortController();
  const replacement = h.check('replacement', { signal: replacementController.signal });
  await flush(); assert.equal(replacement.settled, false); assert.equal(h.workers.length, 4);
  for (const controller of controllers.slice(1)) controller.abort();
  replacementController.abort();
  await Promise.all([...queued.slice(1), replacement].map(result => assert.rejects(result.promise, reason('aborted'))));
  for (const instance of h.workers) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all(held.map(result => result.promise));
});

test('fresh, stale, unavailable and invalid/error outcomes all wait for both termination and exit', async t => {
  const h = controlledWorkers(t);
  const cases = [
    { reply: { kind: 'fresh' }, outcome: { kind: 'fresh' } },
    { reply: { kind: 'stale', reason: 'changed' }, outcome: { kind: 'stale', reason: 'changed' } },
    { reply: { kind: 'unavailable', reason: 'missing' }, outcome: { kind: 'unavailable', reason: 'missing' } },
    { reply: { kind: 'stale', reason: 'x'.repeat(4097) }, outcome: null },
    { reply: { kind: 'error', id: 0 }, outcome: null },
  ];
  for (const [index, entry] of cases.entries()) {
    const result = h.check(`outcome-${index}`); await flush();
    const instance = h.workers[index]; assert.ok(instance);
    instance.message(entry.reply); await flush(); assert.equal(result.settled, false);
    assert.equal(instance.terminateCalls, 1);
    if (index % 2 === 0) instance.releaseExit(); else instance.completeTermination();
    await flush(); assert.equal(result.settled, false);
    instance.message({ kind: 'fresh' }); // Late competing replies must not replace the first outcome.
    instance.exit();
    if (entry.outcome) assert.deepEqual(await result.promise, entry.outcome);
    else await assert.rejects(result.promise, reason('invalid-reply'));
    assert.equal(instance.terminateCalls, 1);
  }
  for (const event of ['error', 'exit']) {
    const result = h.check(event); await flush(); const instance = h.workers.at(-1); assert.ok(instance);
    if (event === 'error') instance.emit('error', new Error('private worker error')); else instance.releaseExit();
    await flush(); assert.equal(result.settled, false);
    instance.exit(); await assert.rejects(result.promise, reason('worker-failed'));
  }
});

test('one-shot abort and hard deadline await cleanup and admission wait consumes the same deadline', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const pending = h.check('remaining-budget', { timeoutMs: 100 });
  h.tick(90);
  h.workers[0]?.message({ kind: 'fresh' }); h.workers[0]?.exit(); await flush();
  const admitted = h.workers[4]; assert.ok(admitted);
  h.tick(10); await flush(); assert.equal(admitted.terminateCalls, 1); assert.equal(pending.settled, false);
  admitted.message({ kind: 'fresh' }); admitted.exit(); await assert.rejects(pending.promise, reason('deadline'));
  const controller = new AbortController();
  const aborted = h.check('active-abort', { signal: controller.signal }); await flush();
  const active = h.workers[5]; assert.ok(active); controller.abort(); await flush();
  assert.equal(active.terminateCalls, 1); assert.equal(aborted.settled, false);
  active.exit(); await assert.rejects(aborted.promise, reason('aborted'));
  for (const instance of h.workers.slice(1, 4)) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all(held.map(result => result.promise));
});

test('factory startup failures and cancellation settle only after worker cleanup; constructor failure returns its reservation', async t => {
  const h = controlledWorkers(t);
  h.state.failConstruction = true;
  await assert.rejects(createGeometrySession(input()), reason('worker-failed'));
  h.state.failConstruction = true;
  await assert.rejects(h.check('one-shot-constructor-failure').promise, /controlled constructor failure/);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  assert.equal(h.workers.length, 4, 'throwing constructor must not retain a reservation');
  for (const instance of h.workers) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all(held.map(result => result.promise));
  for (const mode of ['error', 'cancel', 'deadline']) {
    const controller = new AbortController();
    const result = watch(createGeometrySession(input(), { signal: controller.signal, constructionTimeoutMs: 50 }));
    await flush(); const instance = h.workers.at(-1); assert.ok(instance);
    if (mode === 'error') instance.message({ kind: 'error', id: 0 });
    else if (mode === 'cancel') controller.abort();
    else h.tick(50);
    await flush(); assert.equal(result.settled, false); assert.equal(instance.terminateCalls, 1);
    instance.message({ kind: 'ready', id: 0 }); instance.exit();
    await assert.rejects(result.promise, reason(mode === 'error' ? 'worker-failed' : mode === 'cancel' ? 'aborted' : 'deadline'));
  }
  const cancelled = new AbortController(); cancelled.abort();
  const count = h.workers.length;
  await assert.rejects(createGeometrySession(input(), { signal: cancelled.signal }), reason('aborted'));
  await assert.rejects(h.check('pre-aborted', { signal: cancelled.signal }).promise, reason('aborted'));
  assert.equal(h.workers.length, count);
});

test('queued session construction retains its hard deadline and close cancels admission', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const controller = new AbortController();
  const cancelled = watch(createGeometrySession(input(), { signal: controller.signal }));
  controller.abort(); await assert.rejects(cancelled.promise, reason('aborted'));
  const closed = new GeometrySession(input()); const closedReady = watch(closed.ready);
  await closed.close(); await assert.rejects(closedReady.promise, reason('closed'));
  const result = watch(createGeometrySession(input(), { constructionTimeoutMs: 100 }));
  h.tick(90); h.workers[0]?.message({ kind: 'fresh' }); h.workers[0]?.exit(); await flush();
  const instance = h.workers[4]; assert.ok(instance);
  h.tick(10); await flush(); assert.equal(result.settled, false); assert.equal(instance.terminateCalls, 1);
  instance.exit(); await assert.rejects(result.promise, reason('deadline'));
  assert.equal(h.workers.length, 5, 'closed/cancelled queue entries must never construct a worker');
  for (const remaining of h.workers.slice(1, 4)) { remaining.message({ kind: 'fresh' }); remaining.exit(); }
  await Promise.all(held.map(item => item.promise));
});

test('two persistent sessions and overlapping freshness/replay calls keep the four-worker cap', async t => {
  const h = controlledWorkers(t);
  const opening = [createGeometrySession(input('author-a')), createGeometrySession(input('author-b'))];
  await flush(); for (const instance of h.workers) instance.message({ kind: 'ready', id: 0 });
  const sessions = await Promise.all(opening);
  const first = h.check('fresh-a'); const second = h.check('fresh-b');
  const refresh = h.check('ready-refresh'); await flush(); assert.equal(h.workers.length, 4);
  h.workers[2]?.message({ kind: 'fresh' }); await flush(); assert.equal(first.settled, false);
  h.workers[2]?.exit(); await first.promise;
  const replay = h.check('replay-a'); await flush(); assert.equal(h.workers.length, 5);
  assert.deepEqual(h.workers[4]?.data, { kind: 'revalidate', input: { current: input('ready-refresh'), receipts: [] } });
  h.workers[3]?.message({ kind: 'stale', reason: 'changed' }); h.workers[3]?.exit(); await second.promise;
  await flush(); assert.equal(h.workers.length, 6);
  for (const instance of h.workers.slice(4)) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all([refresh.promise, replay.promise]);
  const closing = sessions.map(session => session.close());
  for (const instance of h.workers.slice(0, 2)) instance.exit();
  await Promise.all(closing); assert.equal(h.state.highWater, 4); assert.equal(h.state.live, 0);
});

test('abort after reservation and expiry before timer delivery cannot construct a late worker', async t => {
  const h = controlledWorkers(t);
  const controller = new AbortController();
  const cancelled = h.check('reserved-cancel', { signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled.promise, reason('aborted'));
  assert.equal(h.workers.length, 0);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const expired = h.check('expired-before-timer', { timeoutMs: 10 });
  const survivor = h.check('survivor');
  h.advance(10); // Dequeue must check elapsed time even before Node delivers the deadline timer.
  h.workers[0]?.message({ kind: 'fresh' }); h.workers[0]?.exit();
  await assert.rejects(expired.promise, reason('deadline')); await flush();
  assert.equal(h.workers.length, 5);
  assert.deepEqual(h.workers[4]?.data, { kind: 'revalidate', input: { current: input('survivor'), receipts: [] } });
  for (const instance of h.workers.slice(1)) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all([...held, survivor].map(result => result.promise));
});

test('a queued input still passes the original admission envelope when capacity becomes available', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const queuedInput = input('mutated');
  const queued = watch(validateGeometryReceiptsInWorker({ current: queuedInput, receipts: [] }));
  Object.defineProperty(queuedInput, 'unsafe', { enumerable: true, get() { throw new Error('accessor must not run'); } });
  const survivor = h.check('survivor');
  h.workers[0]?.message({ kind: 'fresh' }); h.workers[0]?.exit();
  await assert.rejects(queued.promise, /accessors are forbidden/); await flush();
  assert.equal(h.workers.length, 5);
  assert.deepEqual(h.workers[4]?.data, { kind: 'revalidate', input: { current: input('survivor'), receipts: [] } });
  for (const instance of h.workers.slice(1)) { instance.message({ kind: 'fresh' }); instance.exit(); }
  await Promise.all([...held, survivor].map(result => result.promise));
});

test('session lifetime includes queue wait and is not restarted by ready', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const expiresInQueue = watch(createGeometrySession(input(), { lifetimeMs: 10 }));
  h.tick(10); await assert.rejects(expiresInQueue.promise, /session lifetime expired/);
  assert.equal(h.workers.length, 4);
  const opening = watch(createGeometrySession(input(), { lifetimeMs: 100 }));
  h.tick(90); h.workers[0]?.message({ kind: 'fresh' }); h.workers[0]?.exit(); await flush();
  const instance = h.workers[4]; assert.ok(instance); instance.message({ kind: 'ready', id: 0 });
  const session = await opening.promise;
  h.tick(10); assert.throws(() => session.receipts(), /session lifetime expired/);
  const closing = watch(session.close()); await flush(); assert.equal(closing.settled, false);
  instance.exit(); await closing.promise;
  for (const remaining of h.workers.slice(1, 4)) { remaining.message({ kind: 'fresh' }); remaining.exit(); }
  await Promise.all(held.map(result => result.promise));
});

test('termination rejection retains admission until exit and preserves earlier worker/startup errors', async t => {
  const h = controlledWorkers(t);
  const held = Array.from({ length: 4 }, (_, index) => h.check(`held-${index}`)); await flush();
  const queued = h.check('queued');
  const instance = h.workers[0]; assert.ok(instance);
  instance.emit('error', new Error('private worker error')); await flush();
  instance.rejectTermination(); await flush();
  assert.equal(held[0].settled, false); assert.equal(h.workers.length, 4);
  instance.releaseExit(); await assert.rejects(held[0].promise, /revalidation worker failed/); await flush();
  assert.equal(h.workers.length, 5);
  for (const remaining of h.workers.slice(1)) { remaining.message({ kind: 'fresh' }); remaining.exit(); }
  await Promise.all([...held.slice(1), queued].map(result => result.promise));
  const startup = watch(createGeometrySession(input())); await flush();
  const starting = h.workers.at(-1); assert.ok(starting);
  starting.message({ kind: 'error', id: 0 }); await flush(); starting.rejectTermination(); await flush();
  assert.equal(startup.settled, false);
  starting.releaseExit(); await assert.rejects(startup.promise, /rejected its input or operation/);
  const fresh = h.check('cleanup-failure'); await flush(); const last = h.workers.at(-1); assert.ok(last);
  last.message({ kind: 'fresh' }); await flush(); last.rejectTermination(); await flush();
  assert.equal(fresh.settled, false); last.releaseExit();
  await assert.rejects(fresh.promise, /termination failed/);
});

test('late ready and freshness messages cannot beat an expired hard deadline before its timer runs', async t => {
  const h = controlledWorkers(t);
  const opening = watch(createGeometrySession(input(), { constructionTimeoutMs: 10 })); await flush();
  const instance = h.workers[0]; assert.ok(instance);
  h.advance(10); instance.message({ kind: 'ready', id: 0 }); await flush();
  assert.equal(opening.settled, false); instance.exit(); await assert.rejects(opening.promise, reason('deadline'));
  const fresh = h.check('late-fresh', { timeoutMs: 10 }); await flush(); const last = h.workers[1]; assert.ok(last);
  h.advance(10); last.message({ kind: 'fresh' }); await flush();
  assert.equal(fresh.settled, false); last.exit(); await assert.rejects(fresh.promise, reason('deadline'));
});
