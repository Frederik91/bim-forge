import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_ENDPOINT = `${ISSUER}/api/accounts/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const DISCOVERY_ENDPOINT = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_ENDPOINT = `${ISSUER}/.well-known/jwks.json`;
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const REQUIRED_SCOPE = 'chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const DYNAMIC_CLIENT = 'dynamic_agent_client';
const STORE_VERSION = 1;
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_AUTH_RESPONSE_BYTES = 256 * 1024;

export class ChatGPTPlanError extends Error {}

const fail = (message) => { throw new ChatGPTPlanError(message); };
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const scopes = (value) => typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];

function defaultStorageDirectory() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'BIM Forge', 'chatgpt');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'BIM Forge', 'chatgpt');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'bim-forge', 'chatgpt');
}

async function responseJson(response, label, maxBytes = MAX_AUTH_RESPONSE_BYTES) {
  if (!response?.ok) fail(`${label} failed with HTTP ${response?.status ?? 'unknown'}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) fail(`${label} exceeded the response limit.`);
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} returned invalid JSON.`); }
}

function validateStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== STORE_VERSION) fail('The saved ChatGPT connection is invalid.');
  if (typeof value.hostId !== 'string' || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.hostId)) fail('The saved ChatGPT host identifier is invalid.');
  if (value.registrationClientId !== null && typeof value.registrationClientId !== 'string') fail('The saved ChatGPT registration is invalid.');
  if (value.profile !== null && (typeof value.profile !== 'object' || Array.isArray(value.profile))) fail('The saved ChatGPT profile is invalid.');
  if (value.profile) {
    const profile = value.profile;
    if (typeof profile.clientId !== 'string' || !profile.clientId.startsWith('oaiapp_')
        || profile.issuer !== ISSUER || typeof profile.subject !== 'string' || !profile.subject
        || ![profile.email, profile.name].every((item) => item === null || typeof item === 'string')
        || ![profile.idToken, profile.accessToken, profile.refreshToken].every((item) => item === null || typeof item === 'string')
        || !Array.isArray(profile.scopes) || profile.scopes.some((item) => typeof item !== 'string')
        || !Number.isSafeInteger(profile.expiresAt) || profile.expiresAt < 0) fail('The saved ChatGPT profile is invalid.');
  }
  if (!Array.isArray(value.models) || value.models.some((model) => !model || typeof model.slug !== 'string' || typeof model.displayName !== 'string')) fail('The saved ChatGPT models are invalid.');
  if (value.selectedModel !== null && typeof value.selectedModel !== 'string') fail('The saved ChatGPT model selection is invalid.');
  return value;
}

let windowsSid;
function protectCredentialFile(file) {
  if (process.platform !== 'win32') return fs.chmod(file, 0o600);
  if (windowsSid === undefined) {
    const found = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const match = found.status === 0 ? found.stdout.match(/"(S-1-[0-9-]+)"\s*$/m) : null;
    windowsSid = match?.[1] ?? null;
  }
  if (!windowsSid) fail('Could not identify the current Windows account for credential protection.');
  const secured = spawnSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${windowsSid}:F`], { encoding: 'utf8', windowsHide: true });
  if (secured.status !== 0) fail('Could not protect the saved ChatGPT credentials for the current Windows account.');
}

async function writeAtomic(file, value, protectFile = protectCredentialFile) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${random(8)}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await protectFile(temporary);
    await fs.rename(temporary, file);
    await protectFile(file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function openSystemBrowser(url) {
  const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => { child.unref(); resolve(); });
    child.once('error', reject);
  });
}

export function createAuthorization({ hostId, redirectUri, clientId = DYNAMIC_CLIENT, email = null, idToken = null } = {}) {
  if (typeof hostId !== 'string' || !hostId.startsWith('urn:uuid:')) fail('A stable ChatGPT host identifier is required.');
  const callback = new URL(redirectUri);
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== CALLBACK_PATH) fail('ChatGPT sign-in requires an exact 127.0.0.1 loopback callback.');
  const state = random();
  const nonce = random();
  const codeVerifier = random(64);
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const authorization = new URL(AUTHORIZE_ENDPOINT);
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    ext_agent_host_id: hostId,
    ...(clientId === DYNAMIC_CLIENT ? { agent_name_hint: 'BIM Forge' } : {}),
    ...(clientId !== DYNAMIC_CLIENT && idToken ? { id_token_hint: idToken } : {}),
    ...(clientId !== DYNAMIC_CLIENT && email ? { login_hint: email } : {}),
  }).toString();
  return Object.freeze({ authorizationUrl: authorization.toString(), state, nonce, codeVerifier, codeChallenge, redirectUri, clientId });
}

export function consumeAuthorizationCallback(callbackUrl, transaction) {
  const callback = new URL(callbackUrl, transaction.redirectUri);
  if (callback.origin + callback.pathname !== transaction.redirectUri) fail('ChatGPT returned to an unexpected callback.');
  if (callback.searchParams.get('state') !== transaction.state) fail('ChatGPT sign-in could not be verified.');
  if (callback.searchParams.has('error')) fail(callback.searchParams.get('error') === 'access_denied' ? 'ChatGPT sign-in was cancelled.' : 'ChatGPT sign-in could not be completed.');
  const code = callback.searchParams.get('code');
  if (!code) fail('ChatGPT sign-in did not return an authorization code.');
  const returnedClientId = callback.searchParams.get('client_id');
  if (transaction.clientId === DYNAMIC_CLIENT && !returnedClientId) fail('ChatGPT registration did not return an issued client identifier.');
  if (transaction.clientId !== DYNAMIC_CLIENT && returnedClientId && returnedClientId !== transaction.clientId) fail('ChatGPT returned a different client registration.');
  return Object.freeze({ code, clientId: returnedClientId ?? transaction.clientId });
}

function decodeJsonPart(value, label) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { fail(`The ChatGPT ID token has an invalid ${label}.`); }
}

export async function verifyOpenAIIdentity(idToken, { clientId, nonce, fetchImpl = globalThis.fetch, now = Date.now(), jwks = null } = {}) {
  if (typeof idToken !== 'string') fail('ChatGPT did not return an ID token.');
  const parts = idToken.split('.');
  if (parts.length !== 3) fail('The ChatGPT ID token is malformed.');
  const header = decodeJsonPart(parts[0], 'header');
  const payload = decodeJsonPart(parts[1], 'payload');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') fail('The ChatGPT ID token uses an unsupported signature.');
  const keySet = jwks ?? await responseJson(await fetchImpl(JWKS_ENDPOINT, { headers: { Accept: 'application/json' } }), 'ChatGPT signing-key discovery');
  const jwk = Array.isArray(keySet?.keys) ? keySet.keys.find((item) => item?.kid === header.kid
    && item?.kty === 'RSA' && (!item.alg || item.alg === 'RS256') && (!item.use || item.use === 'sig')) : null;
  if (!jwk) fail('The ChatGPT ID token signing key is unavailable.');
  let publicKey;
  try { publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { fail('The ChatGPT ID token signing key is invalid.'); }
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'));
  if (!valid) fail('The ChatGPT ID token signature is invalid.');
  const seconds = Math.floor(now / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== ISSUER || !audience.includes(clientId)) fail('The ChatGPT ID token issuer or audience is invalid.');
  if (!Number.isSafeInteger(payload.exp) || payload.exp < seconds - CLOCK_TOLERANCE_SECONDS) fail('The ChatGPT ID token has expired.');
  if (!Number.isSafeInteger(payload.iat) || payload.iat > seconds + CLOCK_TOLERANCE_SECONDS) fail('The ChatGPT ID token issue time is invalid.');
  if (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf > seconds + CLOCK_TOLERANCE_SECONDS)) fail('The ChatGPT ID token is not active.');
  if (payload.nonce !== nonce) fail('The ChatGPT ID token nonce did not match.');
  if (typeof payload.sub !== 'string' || !payload.sub) fail('The ChatGPT ID token has no subject.');
  return Object.freeze({ issuer: payload.iss, subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : null, name: typeof payload.name === 'string' ? payload.name : null });
}

async function callbackListener(transactionFactory, timeoutMs) {
  let settle;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  let consumed = false;
  const server = http.createServer((request, response) => {
    if (consumed || request.method !== 'GET' || !request.url?.startsWith(CALLBACK_PATH)) { response.writeHead(404); response.end('Not found.'); return; }
    consumed = true;
    try {
      const value = consumeAuthorizationCallback(request.url, transactionFactory());
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><title>BIM Forge connected</title><h1>ChatGPT connected to BIM Forge</h1><p>You can close this window and return to the room study.</p>');
      settle.resolve(value);
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><title>Connection failed</title><h1>ChatGPT could not be connected</h1><p>Return to BIM Forge and try again.</p>');
      settle.reject(error);
    } finally { server.close(); }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const timer = setTimeout(() => { server.close(); settle.reject(new ChatGPTPlanError('ChatGPT sign-in timed out.')); }, timeoutMs);
  result.finally(() => clearTimeout(timer)).catch(() => {});
  return { server, result, redirectUri: `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}` };
}

export class ChatGPTPlanConnection {
  static async open(options = {}) {
    const storageFile = options.storageFile ?? path.join(defaultStorageDirectory(), 'connection.json');
    let saved;
    try { saved = validateStore(JSON.parse(await fs.readFile(storageFile, 'utf8'))); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      saved = { version: STORE_VERSION, hostId: `urn:uuid:${crypto.randomUUID()}`, registrationClientId: null, profile: null, models: [], selectedModel: null };
      await writeAtomic(storageFile, saved, options.protectFile);
    }
    return new ChatGPTPlanConnection(saved, { ...options, storageFile });
  }

  constructor(saved, options) {
    this.saved = structuredClone(validateStore(saved));
    this.storageFile = options.storageFile;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.openBrowser = options.openBrowser ?? openSystemBrowser;
    this.protectFile = options.protectFile;
    this.now = options.now ?? (() => Date.now());
    this.signInTimeoutMs = options.signInTimeoutMs ?? 5 * 60 * 1000;
    this.refreshPromise = null;
    this.signInPromise = null;
  }

  async save() { await writeAtomic(this.storageFile, this.saved, this.protectFile); }

  publicSession() {
    const profile = this.saved.profile;
    const connected = Boolean(profile?.accessToken && profile?.refreshToken && profile?.idToken);
    const sharing = connected && profile.scopes.includes(REQUIRED_SCOPE);
    return Object.freeze({
      connected,
      sharing,
      account: profile ? Object.freeze({ email: profile.email, name: profile.name }) : null,
      models: Object.freeze(this.saved.models.map((model) => Object.freeze({ ...model }))),
      selectedModel: this.saved.selectedModel,
    });
  }

  selectedModel() {
    if (!this.saved.selectedModel || !this.saved.models.some((model) => model.slug === this.saved.selectedModel)) fail('Choose an available ChatGPT model before preparing a proposal.');
    return this.saved.selectedModel;
  }

  async signIn() {
    if (this.signInPromise) return this.signInPromise;
    this.signInPromise = this.#signIn().finally(() => { this.signInPromise = null; });
    return this.signInPromise;
  }

  async #signIn() {
    let transaction;
    const listener = await callbackListener(() => transaction, this.signInTimeoutMs);
    const existing = this.saved.profile;
    const clientId = existing?.clientId ?? this.saved.registrationClientId ?? DYNAMIC_CLIENT;
    transaction = createAuthorization({
      hostId: this.saved.hostId,
      redirectUri: listener.redirectUri,
      clientId,
      email: existing?.email ?? null,
      idToken: existing?.idToken ?? null,
    });
    let callback;
    try {
      await this.openBrowser(transaction.authorizationUrl);
      callback = await listener.result;
    } catch (error) {
      listener.server.close();
      throw error;
    }
    if (clientId === DYNAMIC_CLIENT) {
      this.saved.registrationClientId = callback.clientId;
      await this.save();
    }
    const tokenResponse = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: callback.clientId, code: callback.code,
        code_verifier: transaction.codeVerifier, redirect_uri: transaction.redirectUri, resource: RESOURCE,
      }),
    });
    const tokens = await responseJson(tokenResponse, 'ChatGPT token exchange');
    const identity = await verifyOpenAIIdentity(tokens.id_token, { clientId: callback.clientId, nonce: transaction.nonce, fetchImpl: this.fetchImpl, now: this.now() });
    if (existing && (existing.issuer !== identity.issuer || existing.subject !== identity.subject)) fail('ChatGPT returned a different account for this saved connection.');
    const grantedScopes = scopes(tokens.scope);
    if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || !Number.isSafeInteger(tokens.expires_in) || tokens.expires_in < 1) fail('ChatGPT returned incomplete plan credentials.');
    this.saved.profile = {
      clientId: callback.clientId,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scopes: grantedScopes,
      expiresAt: this.now() + tokens.expires_in * 1000,
    };
    this.saved.registrationClientId = callback.clientId;
    await this.save();
    if (grantedScopes.includes(REQUIRED_SCOPE)) await this.refreshModels().catch(() => {});
    return this.publicSession();
  }

  async getAccessToken() {
    const profile = this.saved.profile;
    if (!profile?.accessToken || !profile?.refreshToken || !profile.scopes.includes(REQUIRED_SCOPE)) fail('Connect a ChatGPT plan before preparing a proposal.');
    if (profile.expiresAt > this.now() + 60_000) return profile.accessToken;
    if (!this.refreshPromise) this.refreshPromise = this.#refresh().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async #refresh() {
    const profile = this.saved.profile;
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE }),
    });
    const tokens = await responseJson(response, 'ChatGPT token refresh');
    if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || !Number.isSafeInteger(tokens.expires_in) || tokens.expires_in < 1) fail('ChatGPT returned incomplete refreshed credentials.');
    const grantedScopes = scopes(tokens.scope || profile.scopes.join(' '));
    this.saved.profile = {
      ...profile,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      // The original, verified ID token is only a login hint. Do not persist a
      // refreshed ID token unless it has gone through the same OIDC validation.
      idToken: profile.idToken,
      scopes: grantedScopes,
      expiresAt: this.now() + tokens.expires_in * 1000,
    };
    await this.save();
    if (!grantedScopes.includes(REQUIRED_SCOPE)) fail('ChatGPT plan usage is no longer enabled for this connection.');
    return this.saved.profile.accessToken;
  }

  async refreshModels() {
    const accessToken = await this.getAccessToken();
    const payload = await responseJson(await this.fetchImpl(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }), 'ChatGPT model discovery');
    if (!Array.isArray(payload?.models)) fail('ChatGPT model discovery returned an invalid catalog.');
    const seen = new Set();
    const models = [];
    for (const model of payload.models) {
      if (model?.visibility !== 'list' || typeof model.slug !== 'string' || typeof model.display_name !== 'string' || !model.slug || seen.has(model.slug)) continue;
      if (model.slug.length > 100 || model.display_name.length > 120) continue;
      seen.add(model.slug); models.push({ slug: model.slug, displayName: model.display_name });
    }
    if (!models.length) fail('No ChatGPT models are available for this connection.');
    this.saved.models = models;
    if (!models.some((model) => model.slug === this.saved.selectedModel)) this.saved.selectedModel = models[0].slug;
    await this.save();
    return this.publicSession();
  }

  async selectModel(model) {
    if (typeof model !== 'string' || !this.saved.models.some((item) => item.slug === model)) fail('Choose a model available to the connected ChatGPT account.');
    this.saved.selectedModel = model;
    await this.save();
    return this.publicSession();
  }

  async signOut() {
    const profile = this.saved.profile;
    let revocationConfirmed = true;
    if (profile?.refreshToken) {
      try {
        const discovery = await responseJson(await this.fetchImpl(DISCOVERY_ENDPOINT, { headers: { Accept: 'application/json' } }), 'OpenAI sign-out discovery');
        const endpoint = new URL(discovery.revocation_endpoint);
        if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'auth.openai.com') fail('OpenAI returned an unsupported sign-out endpoint.');
        const response = await this.fetchImpl(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: profile.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }),
        });
        if (!response.ok) revocationConfirmed = false;
      } catch { revocationConfirmed = false; }
    }
    if (profile) this.saved.profile = { clientId: profile.clientId, issuer: profile.issuer, subject: profile.subject, email: profile.email, name: profile.name, idToken: null, accessToken: null, refreshToken: null, scopes: [], expiresAt: 0 };
    this.saved.models = [];
    this.saved.selectedModel = null;
    await this.save();
    return Object.freeze({ ...this.publicSession(), revocationConfirmed });
  }
}

