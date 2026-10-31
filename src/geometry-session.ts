import { Worker } from 'node:worker_threads';
import { Check } from 'typebox/value';
import { GeometryDescriptionResultSchema, GeometryMeasureResultSchema, GeometryQueryResultSchema, GeometryRelationsResultSchema,
  geometryPlainData } from './geometry-contract.ts';
import type { GeometryDescriptionResult, GeometryMeasureResult, GeometryQueryResult, GeometryReceipt, GeometryRef, GeometryRelationsResult } from './geometry-contract.ts';
import { geometryDigest, geometryPublicResultDigest } from './geometry-query.ts';
import type { GeometryContextInput, GeometryFreshness } from './geometry-query.ts';

export type GeometrySessionInput = Omit<GeometryContextInput, 'now'>;
export type GeometrySessionOptions = { signal?: AbortSignal; constructionTimeoutMs?: number; operationTimeoutMs?: number; lifetimeMs?: number };
export class GeometrySessionError extends Error {
  readonly reason: 'aborted' | 'deadline' | 'worker-failed' | 'invalid-reply' | 'closed';
  constructor(reason: GeometrySessionError['reason'], message: string) { super(message); this.reason = reason; }
}
type Reply = GeometryDescriptionResult | GeometryQueryResult | GeometryRelationsResult | GeometryMeasureResult;
/** Applied only after method-specific schema validation. A mismatched payload cannot publish its receipt. */
export function geometryReplyMatchesReceipt(reply: Reply, expected: { projectId: string; operationDigest: string }): boolean {
  try {
    return reply.receipt.projectId === expected.projectId && reply.receipt.operationDigest === expected.operationDigest
      && reply.receipt.status === reply.kind && reply.receipt.resultDigest === geometryPublicResultDigest(reply);
  } catch { return false; }
}
type Pending = { id: number; method: string; digest: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const boundedTime = (value: number | undefined, fallback: number, maximum: number): number => {
  const time = value ?? fallback;
  if (!Number.isInteger(time) || time < 1 || time > maximum) throw new Error('Invalid bounded geometry worker timeout.');
  return time;
};
function inputEnvelope(value: unknown): void {
  // Structured-clone admission is bounded before posting. Heavy geometry validation/computation happens in the worker.
  let nodes = 0; let bytes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 600000 || depth > 24 || bytes > 16 * 1024 * 1024) throw new Error('Geometry worker input exceeds the admission envelope.');
    if (item === null || typeof item === 'boolean') { bytes += 4; return; }
    if (typeof item === 'number' && Number.isFinite(item)) { bytes += 8; return; }
    if (typeof item === 'string') { bytes += item.length * 2; return; }
    if (typeof item !== 'object' || item === null || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(item))) throw new Error('Geometry worker input must be finite plain data.');
    const keys = Reflect.ownKeys(item);
    if (keys.length > 300001) throw new Error('Geometry worker input collection exceeds the admission envelope.');
    for (const key of keys) {
      if (key === 'length' && Array.isArray(item)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Geometry worker input accessors are forbidden.');
      bytes += key.length * 2; visit(descriptor.value, depth + 1);
    }
  }
  visit(value, 0);
  if (bytes > 16 * 1024 * 1024) throw new Error('Geometry worker input exceeds the byte envelope.');
}
type Admission = { signal?: AbortSignal; deadline: number; aborted: GeometrySessionError; expired: GeometrySessionError };
type Waiter = { admit: () => void };
type ManagedWorker = { instance: Worker; stop: () => Promise<void> };
let activeWorkers = 0;
// Two persistent proposal sessions normally leave two slots for validation. Direct callers
// must still close their sessions: queued admissions never borrow a live worker's slot.
const maxWaitingWorkers = 16;
const waitingWorkers: Waiter[] = [];
function admissionFailure(admission: Admission): GeometrySessionError | null {
  if (admission.signal?.aborted) return admission.aborted;
  return performance.now() >= admission.deadline ? admission.expired : null;
}
function reserveWorker(admission: Admission): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const failure = admissionFailure(admission);
    if (failure) { reject(failure); return; }
    if (activeWorkers >= 4 && waitingWorkers.length >= maxWaitingWorkers) {
      reject(new GeometrySessionError('worker-failed', 'Geometry worker admission queue is full.')); return;
    }
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer); admission.signal?.removeEventListener('abort', abort);
      const index = waitingWorkers.indexOf(waiter);
      if (index !== -1) waitingWorkers.splice(index, 1);
    };
    const fail = (error: GeometrySessionError): void => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const abort = (): void => fail(admission.aborted);
    const waiter: Waiter = { admit: () => {
      if (settled) return;
      const error = admissionFailure(admission);
      if (error) { fail(error); return; }
      settled = true; cleanup(); activeWorkers++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true; activeWorkers--;
        while (activeWorkers < 4 && waitingWorkers.length) waitingWorkers[0]?.admit();
      });
    } };
    const timer = setTimeout(() => fail(admission.expired), Math.max(0, admission.deadline - performance.now()));
    admission.signal?.addEventListener('abort', abort, { once: true });
    if (admission.signal?.aborted) { abort(); return; }
    if (activeWorkers < 4 && waitingWorkers.length === 0) waiter.admit();
    else waitingWorkers.push(waiter);
  });
}
async function worker(data: unknown, admission: Admission): Promise<ManagedWorker> {
  const initialFailure = admissionFailure(admission);
  if (initialFailure) throw initialFailure;
  inputEnvelope(data);
  const release = await reserveWorker(admission);
  try {
    const failure = admissionFailure(admission);
    if (failure) throw failure;
    // A caller may have changed the plain input while waiting for capacity.
    inputEnvelope(data);
    const afterEnvelope = admissionFailure(admission);
    if (afterEnvelope) throw afterEnvelope;
    const instance = new Worker(new URL('./geometry-worker.ts', import.meta.url), { workerData: data,
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    const exited = new Promise<void>(resolve => instance.once('exit', () => { release(); resolve(); }));
    let stopping: Promise<void> | null = null;
    return { instance, stop: () => {
      stopping ??= (async () => {
        // Keep the reservation until exit, including when terminate rejects.
        try { await instance.terminate(); } finally { await exited; }
      })();
      return stopping;
    } };
  } catch (error) { release(); throw error; }
}

/** Product host boundary: one immutable context stays in a private, resource-bounded worker for one request. */
export class GeometrySession {
  #worker: ManagedWorker | null = null;
  readonly #startup: Promise<void>;
  readonly #admission = new AbortController();
  readonly #projectId: string;
  readonly #constructionDeadline: number;
  readonly #operationTimeout: number;
  readonly #receipts: GeometryReceipt[] = [];
  readonly #lifetime: ReturnType<typeof setTimeout>;
  readonly #signal: AbortSignal | undefined;
  readonly #abort: () => void;
  #pending: Pending | null = null;
  #next = 0;
  #calls = 0;
  #chain: Promise<void> = Promise.resolve();
  #failure: GeometrySessionError | null = null;
  readonly ready: Promise<void>;
  constructor(input: GeometrySessionInput, options: GeometrySessionOptions = {}) {
    const started = performance.now();
    const construction = boundedTime(options.constructionTimeoutMs, 3000, 5000);
    this.#constructionDeadline = started + construction;
    this.#operationTimeout = boundedTime(options.operationTimeoutMs, 1500, 5000);
    const lifetime = boundedTime(options.lifetimeMs, 180000, 900000);
    this.#projectId = input.projectId; this.#signal = options.signal;
    this.#abort = () => this.#fail(new GeometrySessionError('aborted', 'Geometry request was aborted.'));
    this.#lifetime = setTimeout(() => this.#fail(new GeometrySessionError('deadline', 'Geometry session lifetime expired.')), lifetime);
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(new GeometrySessionError('deadline', 'Geometry worker construction exceeded its hard deadline.')), construction);
      this.#pending = { id: 0, method: 'ready', digest: '', resolve: () => resolve(), reject, timer };
    });
    this.#signal?.addEventListener('abort', this.#abort, { once: true });
    if (this.#signal?.aborted) this.#abort();
    this.#startup = this.#start(input, this.#constructionDeadline);
  }
  async #start(input: GeometrySessionInput, deadline: number): Promise<void> {
    try {
      const managed = await worker({ kind: 'session', input }, { signal: this.#admission.signal, deadline,
        aborted: new GeometrySessionError('aborted', 'Geometry request was aborted.'),
        expired: new GeometrySessionError('deadline', 'Geometry worker construction exceeded its hard deadline.') });
      this.#worker = managed;
      managed.instance.on('message', (message: unknown) => this.#message(message));
      managed.instance.on('error', () => this.#fail(new GeometrySessionError('worker-failed', 'Geometry worker failed.')));
      managed.instance.on('exit', () => { if (!this.#failure) this.#fail(new GeometrySessionError('worker-failed', 'Geometry worker exited unexpectedly.')); });
      if (this.#failure) await managed.stop();
      else if (performance.now() >= deadline) this.#fail(new GeometrySessionError('deadline', 'Geometry worker construction exceeded its hard deadline.'));
    } catch (error) {
      this.#fail(error instanceof GeometrySessionError ? error : new GeometrySessionError('worker-failed', 'Geometry worker startup failed.'));
    }
  }
  #fail(error: GeometrySessionError): void {
    if (this.#failure) return;
    this.#failure = error; clearTimeout(this.#lifetime); this.#signal?.removeEventListener('abort', this.#abort);
    this.#admission.abort();
    if (this.#pending) { clearTimeout(this.#pending.timer); this.#pending.reject(error); this.#pending = null; }
    // A Worker has a separate JS event loop; this terminates even a synchronous mesh/BVH/parse loop.
    void this.#worker?.stop().catch(() => {});
  }
  #message(message: unknown): void {
    const pending = this.#pending;
    if (!pending || this.#failure) return;
    if (pending.id === 0 && performance.now() >= this.#constructionDeadline) {
      this.#fail(new GeometrySessionError('deadline', 'Geometry worker construction exceeded its hard deadline.')); return;
    }
    if (typeof message !== 'object' || message === null || !('id' in message) || message.id !== pending.id || !('kind' in message)) {
      this.#fail(new GeometrySessionError('invalid-reply', 'Geometry worker reply is not bound to the pending operation.')); return;
    }
    if (message.kind === 'error') { this.#fail(new GeometrySessionError('worker-failed', 'Geometry worker rejected its input or operation.')); return; }
    if (message.kind === 'ready' && pending.id === 0) { clearTimeout(pending.timer); this.#pending = null; pending.resolve(null); return; }
    if (message.kind !== 'result' || !('value' in message) || Buffer.byteLength(JSON.stringify(message.value)) > 512 * 1024) {
      this.#fail(new GeometrySessionError('invalid-reply', 'Geometry worker reply exceeds the result envelope.')); return;
    }
    clearTimeout(pending.timer); this.#pending = null; pending.resolve(message.value);
  }
  #call<T extends Reply>(method: string, input: unknown, isResult: (value: unknown) => value is T): Promise<T> {
    if (++this.#calls > 127) { this.#fail(new GeometrySessionError('closed', 'Geometry session call budget exhausted.')); return Promise.reject(this.#failure); }
    const result = this.#chain.then(async () => {
      await this.ready;
      if (this.#failure) throw this.#failure;
      const managed = this.#worker;
      if (!managed) throw new GeometrySessionError('worker-failed', 'Geometry worker is unavailable.');
      const value = geometryPlainData(input); const digest = geometryDigest({ method, input: value }); const id = ++this.#next;
      const reply = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => this.#fail(new GeometrySessionError('deadline', 'Geometry operation exceeded its hard worker deadline.')), this.#operationTimeout);
        this.#pending = { id, method, digest, resolve, reject, timer };
        managed.instance.postMessage({ id, method, input: value });
      });
      if (!isResult(reply) || !geometryReplyMatchesReceipt(reply, { projectId: this.#projectId, operationDigest: digest })) {
        this.#fail(new GeometrySessionError('invalid-reply', 'Geometry result/receipt does not match the dispatched operation.')); throw this.#failure;
      }
      this.#receipts.push(structuredClone(reply.receipt)); return reply;
    });
    this.#chain = result.then(() => {}, () => {});
    return result;
  }
  describe(input: unknown): Promise<GeometryDescriptionResult> { return this.#call('describe', input, value => Check(GeometryDescriptionResultSchema, value)); }
  query(input: unknown): Promise<GeometryQueryResult> { return this.#call('query', input, value => Check(GeometryQueryResultSchema, value)); }
  relations(input: unknown): Promise<GeometryRelationsResult> { return this.#call('relations', input, value => Check(GeometryRelationsResultSchema, value)); }
  measure(input: unknown): Promise<GeometryMeasureResult> { return this.#call('measure', input, value => Check(GeometryMeasureResultSchema, value)); }
  receipts(): GeometryReceipt[] {
    if (this.#failure) throw this.#failure;
    if (this.#pending || this.#calls !== this.#receipts.length) throw new GeometrySessionError('closed', 'Geometry results are still pending or a call failed; evidence cannot be published.');
    return structuredClone(this.#receipts);
  }
  async close(): Promise<void> {
    this.#fail(new GeometrySessionError('closed', 'Geometry session is closed.'));
    await this.#startup; await this.#worker?.stop();
  }
}
export async function createGeometrySession(input: GeometrySessionInput, options: GeometrySessionOptions = {}): Promise<GeometrySession> {
  const session = new GeometrySession(input, options);
  try { await session.ready; return session; }
  catch (error) {
    // close still waits for actual exit if terminate rejects; preserve the startup cause.
    try { await session.close(); } catch {}
    throw error;
  }
}

export type GeometryCorrespondence = { historical: Extract<GeometryRef, { kind: 'ifc' }>; current: Extract<GeometryRef, { kind: 'ifc' }> };
export type GeometryRevalidationInput = { current: GeometrySessionInput; candidate?: GeometrySessionInput; receipts: GeometryReceipt[];
  correspondences?: GeometryCorrespondence[] };
export async function validateGeometryReceiptsInWorker(input: GeometryRevalidationInput, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GeometryFreshness> {
  const started = performance.now();
  const timeout = boundedTime(options.timeoutMs, 4000, 10000);
  const deadline = started + timeout;
  const aborted = new GeometrySessionError('aborted', 'Geometry revalidation was aborted.');
  const expired = new GeometrySessionError('deadline', 'Geometry revalidation exceeded its hard worker deadline.');
  const managed = await worker({ kind: 'revalidate', input }, { ...(options.signal ? { signal: options.signal } : {}), deadline, aborted, expired });
  const instance = managed.instance;
  let failed = false;
  try { return await new Promise<GeometryFreshness>((resolve, reject) => {
    let finished = false;
    const finish = (value: GeometryFreshness | Error): void => {
      if (finished) return; finished = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      if (value instanceof Error) reject(value); else resolve(value);
    };
    const abort = (): void => finish(aborted);
    const timer = setTimeout(() => finish(expired), Math.max(0, deadline - performance.now()));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    else if (performance.now() >= deadline) finish(expired);
    instance.on('error', () => finish(new GeometrySessionError('worker-failed', 'Geometry revalidation worker failed.')));
    instance.on('exit', () => { if (!finished) finish(new GeometrySessionError('worker-failed', 'Geometry revalidation worker exited.')); });
    instance.on('message', (message: unknown) => {
      if (finished) return;
      if (options.signal?.aborted) { abort(); return; }
      if (performance.now() >= deadline) { finish(expired); return; }
      if (typeof message !== 'object' || message === null || !('kind' in message)) { finish(new GeometrySessionError('invalid-reply', 'Invalid geometry freshness reply.')); return; }
      if (message.kind === 'fresh') { finish({ kind: 'fresh' }); return; }
      if ((message.kind === 'stale' || message.kind === 'unavailable') && 'reason' in message && typeof message.reason === 'string' && message.reason.length <= 4096) {
        finish({ kind: message.kind, reason: message.reason }); return;
      }
      finish(new GeometrySessionError('invalid-reply', 'Invalid geometry freshness reply.'));
    });
  }); } catch (error) { failed = true; throw error; }
  finally {
    try { await managed.stop(); }
    catch { if (!failed) throw new GeometrySessionError('worker-failed', 'Geometry revalidation worker termination failed.'); }
  }
}
