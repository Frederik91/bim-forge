import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelWorker, ModelWorkerSession } from './model-proposal.ts';

const MAX_RPC_LINE_BYTES = 1024 * 1024;
const DEFAULT_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TURN_TIMEOUT_MS = 2 * 60 * 1000;
const DEVICE_URL = 'https://auth.openai.com/codex/device';

type JsonRpcId = number | string;
type JsonRecord = Record<string, unknown>;
type NotificationListener = (method: string, params: unknown) => void;
type RequestListener = (method: string, params: unknown) => Promise<unknown>;

export interface CodexRpcClient {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): void;
  onNotification(listener: NotificationListener): void;
  onRequest(listener: RequestListener): void;
  close(): void;
}

export interface CodexModel { slug: string; displayName: string }
export interface CodexAccount { email: string | null; planType: string }
export interface DeviceAuthorization { verificationUrl: typeof DEVICE_URL; userCode: string; expiresAt: number }

interface SessionBase {
  models: readonly Readonly<CodexModel>[];
  selectedModel: string | null;
}

export type PublicCodexSession = Readonly<
  | (SessionBase & { status: 'disconnected'; connected: false; account: null })
  | (SessionBase & { status: 'pending'; connected: false; account: null; device: Readonly<DeviceAuthorization> })
  | (SessionBase & { status: 'failed'; connected: false; account: null; error: string })
  | (SessionBase & { status: 'connected'; connected: true; account: Readonly<CodexAccount> })
>;

export class CodexAppServerError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'CodexAppServerError'; }
}

function fail(message: string): never { throw new CodexAppServerError(message); }
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) {
    fail(`Codex app-server returned an invalid ${label}.`);
  }
  return value.trim();
}
function safeError(value: unknown): string {
  if (typeof value !== 'string') return 'ChatGPT authorization could not be completed.';
  const cleaned = value.replace(/[\u0000-\u001f]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 300) : 'ChatGPT authorization could not be completed.';
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonLineCodexRpc implements CodexRpcClient {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  #notificationListener: NotificationListener = () => {};
  #requestListener: RequestListener = async () => fail('Codex app-server requested an unsupported operation.');
  #nextId = 1;
  #buffer = Buffer.alloc(0);
  #closed = false;

  static async launch(options: { codexHome: string; workingDirectory: string }): Promise<JsonLineCodexRpc> {
    if (!path.isAbsolute(options.codexHome) || !path.isAbsolute(options.workingDirectory)) {
      fail('Codex runtime paths must be absolute.');
    }
    await fs.mkdir(options.codexHome, { recursive: true, mode: 0o700 });
    await fs.mkdir(options.workingDirectory, { recursive: true, mode: 0o700 });
    const cli = fileURLToPath(new URL('../node_modules/@openai/codex/bin/codex.js', import.meta.url));
    const child = spawn(process.execPath, [cli, 'app-server', '--stdio', '--strict-config'], {
      cwd: options.workingDirectory,
      env: { ...process.env, CODEX_HOME: options.codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rpc = new JsonLineCodexRpc(child);
    await rpc.request('initialize', {
      clientInfo: { name: 'bim_forge', title: 'BIM Forge', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    rpc.notify('initialized', {});
    return rpc;
  }

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#process = child;
    child.stdout.on('data', (chunk: Buffer) => this.#accept(chunk));
    child.stderr.resume();
    child.on('error', () => this.#terminate('Codex app-server could not start.'));
    child.on('exit', () => this.#terminate('Codex app-server stopped unexpectedly.'));
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.#closed) return Promise.reject(new CodexAppServerError('Codex app-server is unavailable.'));
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CodexAppServerError(`Codex app-server did not answer ${method}.`));
      }, 30_000);
      timer.unref();
      this.#pending.set(id, { resolve, reject, timer });
      this.#write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void { this.#write({ method, params }); }
  onNotification(listener: NotificationListener): void { this.#notificationListener = listener; }
  onRequest(listener: RequestListener): void { this.#requestListener = listener; }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#process.kill();
    this.#rejectPending('Codex app-server connection closed.');
  }

  async closeAndWait(): Promise<void> {
    if (this.#process.exitCode !== null || this.#process.signalCode !== null) return;
    const exited = once(this.#process, 'exit');
    this.close();
    await exited;
  }

  #write(message: unknown): void {
    if (this.#closed || !this.#process.stdin.writable) fail('Codex app-server is unavailable.');
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #accept(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    let newline = this.#buffer.indexOf(0x0a);
    while (newline >= 0) {
      const lineBytes = this.#buffer.subarray(0, newline);
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (lineBytes.length > MAX_RPC_LINE_BYTES) {
        this.#terminate('Codex app-server exceeded the protocol message limit.');
        return;
      }
      const line = lineBytes.toString('utf8').trim();
      if (line) this.#dispatch(line);
      newline = this.#buffer.indexOf(0x0a);
    }
    if (this.#buffer.length > MAX_RPC_LINE_BYTES) {
      this.#terminate('Codex app-server exceeded the protocol message limit.');
    }
  }

  #dispatch(line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.#terminate('Codex app-server returned malformed JSON.'); return; }
    if (!isRecord(message)) { this.#terminate('Codex app-server returned an invalid protocol message.'); return; }
    const id = message.id;
    if ((typeof id === 'number' || typeof id === 'string') && typeof message.method === 'string') {
      void this.#answer(id, message.method, message.params);
      return;
    }
    if (typeof id === 'number' || typeof id === 'string') {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id); clearTimeout(pending.timer);
      if (isRecord(message.error)) pending.reject(new CodexAppServerError(safeError(message.error.message)));
      else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
      else pending.reject(new CodexAppServerError('Codex app-server returned an invalid response.'));
      return;
    }
    if (typeof message.method === 'string') this.#notificationListener(message.method, message.params);
  }

  async #answer(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    try { this.#write({ id, result: await this.#requestListener(method, params) }); }
    catch (error) { this.#write({ id, error: { code: -32603, message: error instanceof Error ? error.message : 'Request failed.' } }); }
  }

  #terminate(message: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#process.kill();
    this.#rejectPending(message);
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer); pending.reject(new CodexAppServerError(message));
    }
    this.#pending.clear();
  }
}

interface ActiveRun {
  session: ModelWorkerSession;
  signal: AbortSignal;
  cancel: () => void;
  done: boolean;
  turnId: string | null;
  usage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }> | null;
  resolve: (status: 'completed' | 'failed' | 'interrupted', error: string | null) => void;
}

export class CodexAccountConnection {
  readonly #rpc: CodexRpcClient;
  readonly #now: () => number;
  readonly #loginTimeoutMs: number;
  readonly #turnTimeoutMs: number;
  readonly #workingDirectory: string;
  readonly #runs = new Map<string, ActiveRun>();
  #session: PublicCodexSession = Object.freeze({ status: 'disconnected', connected: false, account: null, models: Object.freeze([]), selectedModel: null });
  #loginId: string | null = null;
  #loginTimer: NodeJS.Timeout | null = null;
  #startingLogin: Promise<PublicCodexSession> | null = null;
  #authEpoch = 0;

  static async open(options: {
    rpc?: CodexRpcClient;
    codexHome?: string;
    workingDirectory?: string;
    now?: () => number;
    loginTimeoutMs?: number;
    turnTimeoutMs?: number;
  } = {}): Promise<CodexAccountConnection> {
    const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const workingDirectory = options.workingDirectory ?? path.join(os.tmpdir(), 'bim-forge-agent');
    const rpc = options.rpc ?? await JsonLineCodexRpc.launch({ codexHome, workingDirectory });
    const connection = new CodexAccountConnection(rpc, {
      now: options.now ?? (() => Date.now()),
      loginTimeoutMs: options.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS,
      turnTimeoutMs: options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
      workingDirectory,
    });
    await connection.refreshAccount().catch(() => connection.#setFailure('The saved ChatGPT session could not be restored. Connect again.'));
    return connection;
  }

  constructor(rpc: CodexRpcClient, options: { now: () => number; loginTimeoutMs: number; turnTimeoutMs: number; workingDirectory: string }) {
    this.#rpc = rpc;
    this.#now = options.now;
    this.#loginTimeoutMs = options.loginTimeoutMs;
    this.#turnTimeoutMs = options.turnTimeoutMs;
    this.#workingDirectory = options.workingDirectory;
    rpc.onNotification((method, params) => this.#notification(method, params));
    rpc.onRequest((method, params) => this.#serverRequest(method, params));
  }

  publicSession(): PublicCodexSession { return this.#session; }

  startDeviceLogin(): Promise<PublicCodexSession> {
    if (!this.#startingLogin) {
      this.#startingLogin = this.#startDeviceLogin().finally(() => { this.#startingLogin = null; });
    }
    return this.#startingLogin;
  }

  async #startDeviceLogin(): Promise<PublicCodexSession> {
    if (this.#session.status === 'connected') return this.#session;
    if (this.#session.status === 'pending' && this.#session.device.expiresAt > this.#now()) return this.#session;
    const epoch = ++this.#authEpoch;
    const response = await this.#rpc.request('account/login/start', { type: 'chatgptDeviceCode' });
    if (!isRecord(response) || response.type !== 'chatgptDeviceCode') fail('Codex app-server did not start device authorization.');
    const loginId = text(response.loginId, 'login identifier', 128);
    if (epoch !== this.#authEpoch) {
      await this.#rpc.request('account/login/cancel', { loginId });
      return this.#session;
    }
    const verificationUrl = text(response.verificationUrl, 'verification URL', 300);
    const parsedUrl = new URL(verificationUrl);
    if (parsedUrl.href !== DEVICE_URL || parsedUrl.username || parsedUrl.password) {
      await this.#rpc.request('account/login/cancel', { loginId }).catch(() => {});
      fail('Codex app-server returned an unsupported verification URL.');
    }
    const device = Object.freeze({
      verificationUrl: DEVICE_URL,
      userCode: text(response.userCode, 'device code', 32),
      expiresAt: this.#now() + this.#loginTimeoutMs,
    });
    this.#loginId = loginId;
    this.#session = Object.freeze({ status: 'pending', connected: false, account: null, device, models: Object.freeze([]), selectedModel: null });
    this.#scheduleExpiry(loginId);
    return this.#session;
  }

  async cancelDeviceLogin(): Promise<PublicCodexSession> {
    const loginId = this.#loginId;
    if (!loginId && !this.#startingLogin) return this.#session;
    this.#authEpoch += 1;
    this.#clearLogin();
    this.#session = Object.freeze({ status: 'disconnected', connected: false, account: null, models: Object.freeze([]), selectedModel: null });
    if (loginId) await this.#rpc.request('account/login/cancel', { loginId });
    if (this.#startingLogin) await this.#startingLogin;
    return this.#session;
  }

  async refreshAccount(): Promise<PublicCodexSession> {
    const epoch = this.#authEpoch;
    const response = await this.#rpc.request('account/read', { refreshToken: false });
    if (epoch !== this.#authEpoch) return this.#session;
    if (!isRecord(response) || !Object.hasOwn(response, 'account')) fail('Codex app-server returned an invalid account state.');
    if (response.account === null) {
      if (this.#session.status !== 'pending') {
        this.#session = Object.freeze({ status: 'disconnected', connected: false, account: null, models: Object.freeze([]), selectedModel: null });
      }
      return this.#session;
    }
    if (!isRecord(response.account) || response.account.type !== 'chatgpt') fail('Only ChatGPT plan accounts are supported.');
    const account = Object.freeze({
      email: response.account.email === null ? null : text(response.account.email, 'account email', 320),
      planType: text(response.account.planType, 'plan type', 80),
    });
    const models = await this.#models();
    if (epoch !== this.#authEpoch) return this.#session;
    this.#clearLogin();
    const previous = this.#session.selectedModel;
    const selectedModel = models.some((model) => model.slug === previous) ? previous : models[0]?.slug ?? null;
    this.#session = Object.freeze({ status: 'connected', connected: true, account, models, selectedModel });
    return this.#session;
  }

  async refreshModels(): Promise<PublicCodexSession> {
    if (this.#session.status !== 'connected') fail('Connect a ChatGPT plan before refreshing models.');
    return this.refreshAccount();
  }

  async selectModel(value: unknown): Promise<PublicCodexSession> {
    if (this.#session.status !== 'connected' || typeof value !== 'string' || !this.#session.models.some((model) => model.slug === value)) {
      fail('Choose a model available to the connected ChatGPT account.');
    }
    this.#session = Object.freeze({ ...this.#session, selectedModel: value });
    return this.#session;
  }

  async signOut(): Promise<PublicCodexSession> {
    if (this.#loginId || this.#startingLogin) await this.cancelDeviceLogin();
    this.#authEpoch += 1;
    await this.#rpc.request('account/logout', {});
    this.#clearLogin();
    this.#session = Object.freeze({ status: 'disconnected', connected: false, account: null, models: Object.freeze([]), selectedModel: null });
    return this.#session;
  }

  modelWorker(): Readonly<ModelWorker> {
    if (this.#session.status !== 'connected' || !this.#session.selectedModel) fail('Connect a ChatGPT plan and choose a model before preparing a proposal.');
    const model = this.#session.selectedModel;
    return Object.freeze({
      identity: Object.freeze({ provider: 'openai-codex-app-server', model }),
      run: (session: ModelWorkerSession) => this.#runModel(session, model),
    });
  }

  close(): void {
    this.#authEpoch += 1; this.#clearLogin();
    for (const run of this.#runs.values()) run.cancel();
    this.#rpc.close();
  }

  async #models(): Promise<readonly Readonly<CodexModel>[]> {
    const response = await this.#rpc.request('model/list', { includeHidden: false, limit: 100 });
    if (!isRecord(response) || !Array.isArray(response.data)) fail('Codex app-server returned an invalid model catalog.');
    const models: CodexModel[] = [];
    const seen = new Set<string>();
    for (const item of response.data) {
      if (!isRecord(item) || item.hidden === true) continue;
      const slug = text(item.model, 'model identifier', 100);
      const displayName = text(item.displayName, 'model name', 120);
      if (!seen.has(slug)) { seen.add(slug); models.push(Object.freeze({ slug, displayName })); }
    }
    if (!models.length) fail('No ChatGPT models are available for this account.');
    return Object.freeze(models);
  }

  #notification(method: string, params: unknown): void {
    if (method === 'account/login/completed') {
      if (!isRecord(params) || (params.loginId !== null && typeof params.loginId !== 'string') || typeof params.success !== 'boolean') return;
      if (this.#loginId === null || params.loginId !== this.#loginId || this.#session.status !== 'pending') return;
      if (this.#session.device.expiresAt <= this.#now()) { this.#setFailure('This device code expired. Start again for a new code.'); return; }
      if (params.success) void this.refreshAccount().catch((error: unknown) => this.#setFailure(error));
      else this.#setFailure(params.error);
      return;
    }
    if (method === 'account/updated') {
      if (isRecord(params) && params.authMode === 'chatgpt' && this.#session.status === 'connected') {
        void this.refreshAccount().catch((error: unknown) => this.#setFailure(error));
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') { this.#updateUsage(params); return; }
    if (method === 'turn/completed') this.#completeTurn(params);
  }

  async #serverRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== 'item/tool/call' || !isRecord(params)) fail('Codex requested an unsupported operation.');
    const threadId = text(params.threadId, 'tool thread identifier', 128);
    const run = this.#runs.get(threadId);
    if (!run || run.signal.aborted || params.namespace !== 'bim_model') fail('Codex requested a tool outside the active BIM proposal.');
    if (run.turnId !== null && params.turnId !== undefined && params.turnId !== run.turnId) fail('Codex requested a tool outside the active BIM proposal turn.');
    const tool = text(params.tool, 'tool name', 80);
    if (tool !== 'run_model_script') fail('Codex requested an unsupported model tool.');
    if (run.done) fail('This proposal session has already finished.');
    const output = await run.session.executeTool(tool, params.arguments);
    if (run.signal.aborted || this.#runs.get(threadId) !== run) fail('The BIM proposal was cancelled.');
    if (output.done === true) run.done = true;
    return { contentItems: [{ type: 'inputText', text: JSON.stringify(output) }], success: true };
  }

  async #runModel(session: ModelWorkerSession, model: string): Promise<void> {
    if (session.signal.aborted) fail('The BIM proposal was cancelled.');
    const controller = new AbortController();
    const signal = AbortSignal.any([session.signal, controller.signal]);
    let threadId: string | null = null;
    let turnId: string | null = null;
    let stoppedError: CodexAppServerError | null = null;
    let interrupted = false;
    let rejectStopped: (error: CodexAppServerError) => void = () => {};
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    // Startup RPCs may settle after cancellation; their observers still revoke the late turn.
    const interrupt = (): void => {
      if (!threadId || !turnId || interrupted) return;
      interrupted = true;
      void this.#rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    };
    const stop = (message: string): void => {
      if (stoppedError) return;
      stoppedError = new CodexAppServerError(message);
      controller.abort();
      if (threadId) this.#runs.delete(threadId);
      interrupt();
      rejectStopped(stoppedError);
    };
    const onAbort = (): void => stop('The BIM proposal was cancelled.');
    session.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop('Codex exceeded the proposal turn timeout.'), this.#turnTimeoutMs);
    timer.unref();
    void stopped.catch(() => {});
    try {
      const tools = session.tools.map((tool) => ({
        type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters,
      }));
      const threadResponse = await Promise.race([this.#rpc.request('thread/start', {
        model,
        cwd: this.#workingDirectory,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config: {
          'features.shell_tool': false,
          'features.unified_exec': false,
          'features.code_mode': false,
          'features.code_mode_host': false,
          'features.multi_agent': false,
          'features.apps': false,
          web_search: 'disabled',
          mcp_servers: {},
        },
        ephemeral: true,
        historyMode: 'legacy',
        baseInstructions: session.instructions,
        developerInstructions: 'Use only bim_model.run_model_script. Call exactly one script at a time. Scripts return an observe, propose, or decline decision. Finish only after run_model_script returns done true. Do not use shell, files, web, apps, or other tools.',
        dynamicTools: [{
          type: 'namespace', name: 'bim_model',
          description: 'Atomic model scripts with bounded inspection, validated previews, and human-review proposals.',
          tools,
        }],
      }), stopped]);
      if (!isRecord(threadResponse) || !isRecord(threadResponse.thread)) fail('Codex app-server did not start a proposal thread.');
      threadId = text(threadResponse.thread.id, 'thread identifier', 128);
      if (signal.aborted) throw stoppedError ?? new CodexAppServerError('The BIM proposal was cancelled.');
      let resolveCompletion: ActiveRun['resolve'] = () => {};
      const completion = new Promise<readonly ['completed' | 'failed' | 'interrupted', string | null]>((resolve) => {
        resolveCompletion = (status, error) => resolve([status, error]);
      });
      const run: ActiveRun = {
        session, signal, cancel: onAbort, done: false, turnId: null, usage: null,
        resolve: resolveCompletion,
      };
      this.#runs.set(threadId, run);
      const starting = this.#rpc.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: JSON.stringify(session.input), text_elements: [] }],
      }).then((turnResponse) => {
        if (!isRecord(turnResponse) || !isRecord(turnResponse.turn)) fail('Codex app-server did not start a proposal turn.');
        turnId = text(turnResponse.turn.id, 'turn identifier', 128);
        run.turnId = turnId;
        if (signal.aborted) interrupt();
        return turnId;
      });
      const responseId = await Promise.race([starting, stopped]);
      const [status, error] = await Promise.race([completion, stopped]);
      if (signal.aborted) throw stoppedError ?? new CodexAppServerError('The BIM proposal was cancelled.');
      session.recordProviderEvent({ responseId, ...(run.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) });
      if (status !== 'completed') fail(error ?? `Codex proposal turn ${status}.`);
      if (!run.done) fail('Codex ended without a completed model script proposal or decline.');
    } finally {
      clearTimeout(timer);
      session.signal.removeEventListener('abort', onAbort);
      controller.abort();
      if (threadId) this.#runs.delete(threadId);
    }
  }

  #completeTurn(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.turn)) return;
    const threadId = typeof params.threadId === 'string' ? params.threadId : null;
    const run = threadId ? this.#runs.get(threadId) : null;
    if (!run) return;
    if (run.turnId !== null && params.turn.id !== run.turnId) return;
    const status = params.turn.status;
    if (status !== 'completed' && status !== 'failed' && status !== 'interrupted') return;
    const error = isRecord(params.turn.error) ? safeError(params.turn.error.message) : null;
    run.resolve(status, error);
  }

  #updateUsage(params: unknown): void {
    if (!isRecord(params) || typeof params.threadId !== 'string' || typeof params.turnId !== 'string'
        || !isRecord(params.tokenUsage) || !isRecord(params.tokenUsage.last)) return;
    const run = this.#runs.get(params.threadId);
    if (!run || (run.turnId !== null && run.turnId !== params.turnId)) return;
    const { inputTokens, outputTokens, totalTokens } = params.tokenUsage.last;
    if (![inputTokens, outputTokens, totalTokens].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)) return;
    run.usage = Object.freeze({
      inputTokens: Number(inputTokens), outputTokens: Number(outputTokens), totalTokens: Number(totalTokens),
    });
  }

  #scheduleExpiry(loginId: string): void {
    if (this.#loginTimer) clearTimeout(this.#loginTimer);
    this.#loginTimer = setTimeout(() => {
      if (this.#loginId !== loginId) return;
      void this.#rpc.request('account/login/cancel', { loginId }).catch(() => {});
      this.#setFailure('This device code expired. Start again for a new code.');
    }, this.#loginTimeoutMs);
    this.#loginTimer.unref();
  }

  #setFailure(error: unknown): void {
    this.#authEpoch += 1;
    this.#clearLogin();
    const message = error instanceof Error ? error.message : safeError(error);
    this.#session = Object.freeze({ status: 'failed', connected: false, account: null, error: safeError(message), models: Object.freeze([]), selectedModel: null });
  }

  #clearLogin(): void {
    this.#loginId = null;
    if (this.#loginTimer) clearTimeout(this.#loginTimer);
    this.#loginTimer = null;
  }
}
