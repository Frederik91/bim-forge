import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodexAccountConnection, JsonLineCodexRpc } from './codex-app-server.ts';
import type { CodexRpcClient } from './codex-app-server.ts';
import { MODEL_PROPOSAL_TOOLS } from './model-proposal.ts';
import type { ModelWorkerSession } from './model-proposal.ts';

interface CapturedRequest { method: string; params: unknown }

class FakeRpc implements CodexRpcClient {
  readonly requests: CapturedRequest[] = [];
  readonly notifications: CapturedRequest[] = [];
  readonly handlers = new Map<string, (params: unknown) => unknown | Promise<unknown>>();
  #notificationListener: (method: string, params: unknown) => void = () => {};
  #requestListener: (method: string, params: unknown) => Promise<unknown> = async () => { throw new Error('Missing request listener.'); };

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`Unexpected RPC request: ${method}`);
    return handler(params);
  }
  notify(method: string, params: unknown): void { this.notifications.push({ method, params }); }
  onNotification(listener: (method: string, params: unknown) => void): void { this.#notificationListener = listener; }
  onRequest(listener: (method: string, params: unknown) => Promise<unknown>): void { this.#requestListener = listener; }
  close(): void {}
  emit(method: string, params: unknown): void { this.#notificationListener(method, params); }
  serverRequest(method: string, params: unknown): Promise<unknown> { return this.#requestListener(method, params); }
}

function disconnected(rpc: FakeRpc): void {
  rpc.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true, workspaceRouting: null }));
}

async function tick(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

test('pinned Codex app-server starts with an isolated auth home', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'bim-forge-codex-test-'));
  const codexHome = path.join(root, 'codex');
  const workingDirectory = path.join(root, 'workspace');
  await mkdir(workingDirectory);
  const rpc = await JsonLineCodexRpc.launch({ codexHome, workingDirectory });
  t.after(async () => {
    await rpc.closeAndWait();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const response = await rpc.request('account/read', { refreshToken: false });
  assert.equal(typeof response, 'object');
  assert.notEqual(response, null);
});

test('device authorization exposes only the documented URL and transitions to a ChatGPT account', async (t) => {
  const rpc = new FakeRpc();
  let connected = false;
  rpc.handlers.set('account/read', () => connected
    ? { account: { type: 'chatgpt', email: 'designer@example.com', planType: 'plus' }, requiresOpenaiAuth: true, workspaceRouting: null }
    : { account: null, requiresOpenaiAuth: true, workspaceRouting: null });
  rpc.handlers.set('account/login/start', () => ({
    type: 'chatgptDeviceCode', loginId: 'login-1',
    verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234',
  }));
  rpc.handlers.set('model/list', () => ({
    data: [{ model: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', hidden: false }], nextCursor: null,
  }));
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd(), loginTimeoutMs: 1000 });
  t.after(() => connection.close());
  const pending = await connection.startDeviceLogin();
  assert.equal(pending.status, 'pending');
  if (pending.status !== 'pending') throw new Error('Expected pending authorization.');
  assert.equal(pending.device.userCode, 'ABCD-1234');
  assert.equal(JSON.stringify(pending).includes('token'), false);
  connected = true;
  rpc.emit('account/login/completed', { loginId: 'login-1', success: true, error: null });
  await tick();
  const session = connection.publicSession();
  assert.equal(session.status, 'connected');
  if (session.status !== 'connected') throw new Error('Expected connected account.');
  assert.deepEqual(session.account, { email: 'designer@example.com', planType: 'plus' });
  assert.equal(session.selectedModel, 'gpt-6.1-sol');
});

test('device authorization cancels and fails closed on unsupported protocol data', async (t) => {
  const rpc = new FakeRpc(); disconnected(rpc);
  rpc.handlers.set('account/login/start', () => ({
    type: 'chatgptDeviceCode', loginId: 'login-2',
    verificationUrl: 'https://attacker.example/device', userCode: 'ABCD-1234',
  }));
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd() });
  t.after(() => connection.close());
  await assert.rejects(connection.startDeviceLogin(), /unsupported verification URL/);

  rpc.handlers.set('account/login/start', () => ({
    type: 'chatgptDeviceCode', loginId: 'login-3',
    verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'WXYZ-9876',
  }));
  rpc.handlers.set('account/login/cancel', () => ({ status: 'cancelled' }));
  assert.equal((await connection.startDeviceLogin()).status, 'pending');
  assert.equal((await connection.cancelDeviceLogin()).status, 'disconnected');
  assert.deepEqual(rpc.requests.at(-1), { method: 'account/login/cancel', params: { loginId: 'login-3' } });
});

test('concurrent starts share one code and cancellation ignores stale completion', async (t) => {
  const rpc = new FakeRpc(); disconnected(rpc);
  rpc.handlers.set('account/login/start', async () => {
    await tick();
    return { type: 'chatgptDeviceCode', loginId: 'shared-login',
      verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'SHARED-1234' };
  });
  rpc.handlers.set('account/login/cancel', () => ({ status: 'cancelled' }));
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd() });
  t.after(() => connection.close());
  const [first, second] = await Promise.all([connection.startDeviceLogin(), connection.startDeviceLogin()]);
  assert.deepEqual(first, second);
  assert.equal(rpc.requests.filter((request) => request.method === 'account/login/start').length, 1);
  await connection.cancelDeviceLogin();
  rpc.emit('account/login/completed', { loginId: 'shared-login', success: true, error: null });
  rpc.emit('account/updated', { authMode: 'chatgpt' });
  await tick();
  assert.equal(connection.publicSession().status, 'disconnected');
});

test('cancelling while a code is being issued cancels the upstream attempt', async (t) => {
  const rpc = new FakeRpc(); disconnected(rpc);
  rpc.handlers.set('account/login/start', async () => {
    await tick();
    return { type: 'chatgptDeviceCode', loginId: 'delayed-login',
      verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'DELAY-1234' };
  });
  rpc.handlers.set('account/login/cancel', () => ({ status: 'cancelled' }));
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd() });
  t.after(() => connection.close());
  const starting = connection.startDeviceLogin();
  const cancelling = connection.cancelDeviceLogin();
  await Promise.all([starting, cancelling]);
  assert.equal(connection.publicSession().status, 'disconnected');
  assert.equal(rpc.requests.some((request) => request.method === 'account/login/cancel'
    && JSON.stringify(request.params) === JSON.stringify({ loginId: 'delayed-login' })), true);
});

test('a foreign installation login and expired completion cannot connect the account', async (t) => {
  const rpc = new FakeRpc(); disconnected(rpc);
  let now = 0;
  rpc.handlers.set('account/login/start', () => ({
    type: 'chatgptDeviceCode', loginId: 'this-installation',
    verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'LOCAL-1234',
  }));
  const connection = await CodexAccountConnection.open({ rpc, now: () => now, workingDirectory: process.cwd(), loginTimeoutMs: 1000 });
  t.after(() => connection.close());
  await connection.startDeviceLogin();
  rpc.emit('account/login/completed', { loginId: 'another-installation', success: true, error: null });
  await tick();
  assert.equal(connection.publicSession().status, 'pending');
  now = 1001;
  rpc.emit('account/login/completed', { loginId: 'this-installation', success: true, error: null });
  await tick();
  assert.equal(connection.publicSession().status, 'failed');
});

test('expired device authorization is cancelled and becomes retryable', async (t) => {
  const rpc = new FakeRpc(); disconnected(rpc);
  rpc.handlers.set('account/login/start', () => ({
    type: 'chatgptDeviceCode', loginId: 'login-expiring',
    verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TIME-0001',
  }));
  rpc.handlers.set('account/login/cancel', () => ({ status: 'cancelled' }));
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd(), loginTimeoutMs: 15 });
  t.after(() => connection.close());
  await connection.startDeviceLogin();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const session = connection.publicSession();
  assert.equal(session.status, 'failed');
  if (session.status !== 'failed') throw new Error('Expected expired authorization failure.');
  assert.match(session.error, /expired/);
  assert.equal(rpc.requests.some((request) => request.method === 'account/login/cancel'), true);
});

test('proposal worker uses one ephemeral read-only thread and only the BIM tool namespace', async (t) => {
  const rpc = new FakeRpc();
  rpc.handlers.set('account/read', () => ({
    account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true, workspaceRouting: null,
  }));
  rpc.handlers.set('model/list', () => ({ data: [{ model: 'gpt-test', displayName: 'GPT Test', hidden: false }], nextCursor: null }));
  rpc.handlers.set('thread/start', () => ({ thread: { id: 'thread-1' }, model: 'gpt-test' }));
  rpc.handlers.set('turn/start', () => {
    queueMicrotask(() => {
      void rpc.serverRequest('item/tool/call', {
        threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', namespace: 'bim_model',
        tool: 'run_model_script', arguments: { language: 'javascript', source: "return { kind: 'decline', reason: 'Clarify the destination.', uncertainty: 'No destination specified.' };" },
      }).then(() => {
        rpc.emit('thread/tokenUsage/updated', {
          threadId: 'thread-1', turnId: 'turn-1',
          tokenUsage: { last: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } },
        });
        rpc.emit('turn/completed', {
          threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null },
        });
      });
    });
    return { turn: { id: 'turn-1', status: 'inProgress' } };
  });
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd(), turnTimeoutMs: 1000 });
  t.after(() => connection.close());
  const calls: Array<[string, unknown]> = [];
  const events: unknown[] = [];
  const session: ModelWorkerSession = {
    instructions: 'Use bounded tools.', input: { request: 'test' }, tools: MODEL_PROPOSAL_TOOLS,
    signal: new AbortController().signal,
    executeTool: async (name, argumentsValue) => {
      calls.push([name, argumentsValue]); return { ok: true, done: true };
    },
    recordProviderEvent: (event) => { events.push(event); },
  };
  const worker = connection.modelWorker();
  await worker.run(session);
  assert.deepEqual(worker.identity, { provider: 'openai-codex-app-server', model: 'gpt-test' });
  assert.deepEqual(calls, [['run_model_script', { language: 'javascript', source: "return { kind: 'decline', reason: 'Clarify the destination.', uncertainty: 'No destination specified.' };" }]]);
  assert.deepEqual(MODEL_PROPOSAL_TOOLS.map((tool) => tool.name), ['run_model_script']);
  assert.deepEqual(events, [{ responseId: 'turn-1', inputTokens: 120, outputTokens: 30, totalTokens: 150 }]);
  const start = rpc.requests.find((request) => request.method === 'thread/start');
  assert.ok(start);
  assert.deepEqual(start.params, {
    model: 'gpt-test',
    cwd: process.cwd(),
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
    baseInstructions: 'Use bounded tools.',
    developerInstructions: 'Use only bim_model.run_model_script. Call exactly one script at a time. Scripts return an observe, propose, or decline decision. Finish only after run_model_script returns done true. Do not use shell, files, web, apps, or other tools.',
    dynamicTools: [{
      type: 'namespace', name: 'bim_model',
      description: 'Atomic model scripts with bounded inspection, validated previews, and human-review proposals.',
      tools: MODEL_PROPOSAL_TOOLS.map((tool) => ({
        type: 'function', name: tool.name, description: tool.description, inputSchema: tool.parameters,
      })),
    }],
  });
  assert.equal(JSON.stringify(rpc.requests).includes('accessToken'), false);
});

test('proposal timeout interrupts the active Codex turn', async (t) => {
  const rpc = new FakeRpc();
  rpc.handlers.set('account/read', () => ({
    account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true, workspaceRouting: null,
  }));
  rpc.handlers.set('model/list', () => ({ data: [{ model: 'gpt-test', displayName: 'GPT Test', hidden: false }], nextCursor: null }));
  rpc.handlers.set('thread/start', () => ({ thread: { id: 'thread-timeout' } }));
  rpc.handlers.set('turn/start', () => ({ turn: { id: 'turn-timeout', status: 'inProgress' } }));
  rpc.handlers.set('turn/interrupt', () => ({}));
  const connection = await CodexAccountConnection.open({ rpc, workingDirectory: process.cwd(), turnTimeoutMs: 10 });
  t.after(() => connection.close());
  const worker = connection.modelWorker();
  await assert.rejects(worker.run({
    instructions: 'Use bounded tools.', input: { request: 'test' }, tools: MODEL_PROPOSAL_TOOLS,
    signal: new AbortController().signal,
    executeTool: async () => ({ ok: true, done: false }), recordProviderEvent: () => {},
  }), /turn timeout/);
  await tick();
  assert.equal(rpc.requests.some((request) => request.method === 'turn/interrupt'
    && JSON.stringify(request.params) === JSON.stringify({ threadId: 'thread-timeout', turnId: 'turn-timeout' })), true);
});

function proposalRpc(): FakeRpc {
  const rpc = new FakeRpc();
  rpc.handlers.set('account/read', () => ({ account: { type: 'chatgpt', email: null, planType: 'plus' } }));
  rpc.handlers.set('model/list', () => ({ data: [{ model: 'gpt-test', displayName: 'GPT Test', hidden: false }] }));
  rpc.handlers.set('thread/start', () => ({ thread: { id: 'cancel-thread' } }));
  rpc.handlers.set('turn/start', () => ({ turn: { id: 'cancel-turn', status: 'inProgress' } }));
  rpc.handlers.set('turn/interrupt', () => ({}));
  return rpc;
}

function proposalSession(signal: AbortSignal, executeTool: ModelWorkerSession['executeTool'] = async () => ({ ok: true, done: false })): ModelWorkerSession {
  return { signal, instructions: 'Use bounded scripts.', input: {}, tools: MODEL_PROPOSAL_TOOLS,
    executeTool, recordProviderEvent: () => {} };
}

test('already cancelled proposals do not create a Codex thread', async (t) => {
  const rpc = proposalRpc();
  const connection = await CodexAccountConnection.open({ rpc }); t.after(() => connection.close());
  const controller = new AbortController(); controller.abort();
  await assert.rejects(connection.modelWorker().run(proposalSession(controller.signal)), /cancelled/);
  assert.equal(rpc.requests.some((request) => request.method === 'thread/start'), false);
});

test('cancellation during thread creation settles immediately and never starts a turn', async (t) => {
  const rpc = proposalRpc(); const starting = Promise.withResolvers<unknown>();
  rpc.handlers.set('thread/start', () => starting.promise);
  const connection = await CodexAccountConnection.open({ rpc }); t.after(() => connection.close());
  const controller = new AbortController();
  const cancelled = assert.rejects(connection.modelWorker().run(proposalSession(controller.signal)), /cancelled/);
  controller.abort(); await cancelled;
  starting.resolve({ thread: { id: 'late-thread' } }); await tick();
  assert.equal(rpc.requests.some((request) => request.method === 'turn/start'), false);
  await assert.rejects(rpc.serverRequest('item/tool/call', { threadId: 'late-thread', namespace: 'bim_model', tool: 'run_model_script', arguments: {} }), /outside/);
});

test('cancellation during turn startup interrupts its late identity and revokes tool dispatch', async (t) => {
  const rpc = proposalRpc(); const starting = Promise.withResolvers<unknown>();
  const turnRequested = Promise.withResolvers<void>();
  rpc.handlers.set('turn/start', () => { turnRequested.resolve(); return starting.promise; });
  const connection = await CodexAccountConnection.open({ rpc }); t.after(() => connection.close());
  const controller = new AbortController(); let calls = 0;
  const cancelled = assert.rejects(connection.modelWorker().run(proposalSession(controller.signal, async () => {
    calls += 1; return { ok: true, done: true };
  })), /cancelled/);
  await turnRequested.promise; controller.abort(); await cancelled;
  await assert.rejects(rpc.serverRequest('item/tool/call', {
    threadId: 'cancel-thread', namespace: 'bim_model', tool: 'run_model_script', arguments: {},
  }), /outside/);
  starting.resolve({ turn: { id: 'late-turn', status: 'inProgress' } }); await tick();
  assert.deepEqual(rpc.requests.filter((request) => request.method === 'turn/interrupt'), [
    { method: 'turn/interrupt', params: { threadId: 'cancel-thread', turnId: 'late-turn' } },
  ]);
  assert.equal(calls, 0);
});

test('cancellation discards an in-flight script reply and ignores late completion', async (t) => {
  const rpc = proposalRpc(); const script = Promise.withResolvers<Record<string, unknown>>();
  const entered = Promise.withResolvers<void>();
  const connection = await CodexAccountConnection.open({ rpc }); t.after(() => connection.close());
  const controller = new AbortController();
  const cancelled = assert.rejects(connection.modelWorker().run(proposalSession(controller.signal, async () => {
    entered.resolve(); return script.promise;
  })), /cancelled/);
  await tick();
  const reply = assert.rejects(rpc.serverRequest('item/tool/call', {
    threadId: 'cancel-thread', turnId: 'cancel-turn', namespace: 'bim_model', tool: 'run_model_script', arguments: {},
  }), /cancelled/);
  await entered.promise; controller.abort(); await cancelled;
  script.resolve({ ok: true, done: true }); await reply;
  rpc.emit('turn/completed', { threadId: 'cancel-thread', turn: { id: 'cancel-turn', status: 'completed' } });
  assert.equal(rpc.requests.filter((request) => request.method === 'turn/interrupt').length, 1);
});

test('timeout during turn startup settles before the RPC and interrupts a late turn', async (t) => {
  const rpc = proposalRpc(); const starting = Promise.withResolvers<unknown>();
  rpc.handlers.set('turn/start', () => starting.promise);
  const connection = await CodexAccountConnection.open({ rpc, turnTimeoutMs: 10 }); t.after(() => connection.close());
  await assert.rejects(connection.modelWorker().run(proposalSession(new AbortController().signal)), /turn timeout/);
  starting.resolve({ turn: { id: 'late-timeout', status: 'inProgress' } }); await tick();
  assert.deepEqual(rpc.requests.filter((request) => request.method === 'turn/interrupt'), [
    { method: 'turn/interrupt', params: { threadId: 'cancel-thread', turnId: 'late-timeout' } },
  ]);
});

test('only a host terminal reply completes authoring and completed runs detach cancellation', async (t) => {
  const rpc = proposalRpc();
  const connection = await CodexAccountConnection.open({ rpc }); t.after(() => connection.close());
  const controller = new AbortController();
  const session = proposalSession(controller.signal);
  const missing = assert.rejects(connection.modelWorker().run(session), /without a completed model script/);
  await tick();
  await rpc.serverRequest('item/tool/call', { threadId: 'cancel-thread', namespace: 'bim_model', tool: 'run_model_script',
    arguments: { language: 'javascript', source: 'return { done: true };' } });
  rpc.emit('turn/completed', { threadId: 'cancel-thread', turn: { id: 'cancel-turn', status: 'completed' } });
  await missing;
  controller.abort(); await tick();
  assert.equal(rpc.requests.some((request) => request.method === 'turn/interrupt'), false);

  const success = new AbortController();
  const completed = connection.modelWorker().run(proposalSession(success.signal, async () => ({ ok: true, done: true })));
  await tick();
  await assert.rejects(rpc.serverRequest('item/tool/call', { threadId: 'cancel-thread', namespace: 'bim_model', tool: 'unknown_tool', arguments: {} }), /unsupported/);
  await rpc.serverRequest('item/tool/call', { threadId: 'cancel-thread', namespace: 'bim_model', tool: 'run_model_script', arguments: {} });
  await assert.rejects(rpc.serverRequest('item/tool/call', { threadId: 'cancel-thread', namespace: 'bim_model', tool: 'run_model_script', arguments: {} }), /already finished/);
  rpc.emit('turn/completed', { threadId: 'cancel-thread', turn: { id: 'cancel-turn', status: 'completed' } });
  await completed; success.abort(); await tick();
  assert.equal(rpc.requests.some((request) => request.method === 'turn/interrupt'), false);
});
