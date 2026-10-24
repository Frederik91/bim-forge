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
        tool: 'submit_proposal', arguments: { summary: 'done' },
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
    executeTool: async (name, argumentsValue) => {
      calls.push([name, argumentsValue]); return { ok: true, done: true };
    },
    recordProviderEvent: (event) => { events.push(event); },
  };
  const worker = connection.modelWorker();
  await worker.run(session);
  assert.deepEqual(worker.identity, { provider: 'openai-codex-app-server', model: 'gpt-test' });
  assert.deepEqual(calls, [['submit_proposal', { summary: 'done' }]]);
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
    developerInstructions: 'Use only tools in the bim_model namespace. Call exactly one tool at a time. Finish only after submit_proposal or decline_request returns done true. Do not use shell, files, web, apps, or other tools.',
    dynamicTools: [{
      type: 'namespace', name: 'bim_model',
      description: 'Bounded BIM inspection, deterministic preview, and human-review proposal tools.',
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
    executeTool: async () => ({ ok: true, done: false }), recordProviderEvent: () => {},
  }), /turn timeout/);
  await tick();
  assert.equal(rpc.requests.some((request) => request.method === 'turn/interrupt'
    && JSON.stringify(request.params) === JSON.stringify({ threadId: 'thread-timeout', turnId: 'turn-timeout' })), true);
});
