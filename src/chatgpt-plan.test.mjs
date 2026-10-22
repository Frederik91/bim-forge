import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ChatGPTPlanConnection,
  consumeAuthorizationCallback,
  createAuthorization,
  verifyOpenAIIdentity,
} from './chatgpt-plan.mjs';

const now = Date.parse('2026-10-22T12:00:00.000Z');
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

function idToken({ clientId = 'oaiapp_bim_forge', nonce = 'nonce', subject = 'account-1', privateKey = keys.privateKey } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://auth.openai.com', aud: clientId, sub: subject, nonce,
    email: 'designer@example.com', name: 'Model Designer',
    iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600,
  })).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

test('authorization creates fresh PKCE and rejects mismatched or incomplete callbacks', () => {
  const first = createAuthorization({ hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111', redirectUri: 'http://127.0.0.1:1455/auth/callback' });
  const second = createAuthorization({ hostId: 'urn:uuid:11111111-1111-4111-8111-111111111111', redirectUri: 'http://127.0.0.1:1455/auth/callback' });
  const url = new URL(first.authorizationUrl);
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'BIM Forge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(first.codeVerifier).digest('base64url'));
  assert.notEqual(first.state, second.state); assert.notEqual(first.nonce, second.nonce);
  assert.throws(() => consumeAuthorizationCallback('/auth/callback?code=x&state=wrong&client_id=oaiapp_x', first), /verified/);
  assert.throws(() => consumeAuthorizationCallback(`/auth/callback?state=${first.state}`, first), /authorization code/);
  assert.throws(() => consumeAuthorizationCallback(`/auth/callback?code=x&state=${first.state}`, first), /issued client/);
  assert.deepEqual(consumeAuthorizationCallback(`/auth/callback?code=x&state=${first.state}&client_id=oaiapp_x`, first), { code: 'x', clientId: 'oaiapp_x' });
});

test('ID token verification checks signature, issuer, audience, expiry and nonce', async () => {
  const options = { clientId: 'oaiapp_bim_forge', nonce: 'nonce', now, jwks: { keys: [jwk] } };
  assert.deepEqual(await verifyOpenAIIdentity(idToken(), options), {
    issuer: 'https://auth.openai.com', subject: 'account-1', email: 'designer@example.com', name: 'Model Designer',
  });
  await assert.rejects(verifyOpenAIIdentity(idToken({ nonce: 'other' }), options), /nonce/);
  await assert.rejects(verifyOpenAIIdentity(idToken({ clientId: 'oaiapp_other' }), options), /audience/);
  await assert.rejects(verifyOpenAIIdentity(idToken(), { ...options, jwks: { keys: [{ ...jwk, use: 'enc' }] } }), /signing key/);
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await assert.rejects(verifyOpenAIIdentity(idToken({ privateKey: other.privateKey }), options), /signature/);
});

test('local connection completes sign-in, discovers models, serializes refresh and revokes on sign-out', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-chatgpt-plan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storageFile = path.join(directory, 'connection.json');
  const protectedPaths = [];
  let authorization;
  let refreshes = 0;
  let revocations = 0;
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/api/accounts/oauth/token')) {
      const body = new URLSearchParams(options.body);
      if (body.get('grant_type') === 'refresh_token') {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return Response.json({
          access_token: 'access-rotated', refresh_token: 'refresh-rotated', id_token: 'unverified-refresh-id-token', expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        });
      }
      assert.equal(body.get('client_id'), 'oaiapp_bim_forge');
      assert.equal(body.get('redirect_uri'), new URL(authorization).searchParams.get('redirect_uri'));
      return Response.json({
        id_token: idToken({ nonce: new URL(authorization).searchParams.get('nonce') }),
        access_token: 'access-initial', refresh_token: 'refresh-initial', expires_in: 3600,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      });
    }
    if (url === 'https://api.openai.com/v1/models') return Response.json({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hidden' },
      { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list' },
    ] });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' });
    if (url.endsWith('/api/accounts/oauth/revoke')) { revocations += 1; return new Response('', { status: 200 }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  const connection = await ChatGPTPlanConnection.open({
    storageFile,
    fetchImpl,
    now: () => now,
    protectFile: async (file) => { protectedPaths.push(file); },
    openBrowser: async (url) => {
      authorization = url;
      const request = new URL(url);
      const callback = new URL(request.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ code: 'authorization-code', state: request.searchParams.get('state'), client_id: 'oaiapp_bim_forge' });
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.doesNotMatch(await response.text(), /access-initial|authorization-code/);
    },
  });
  assert.equal(connection.publicSession().connected, false);
  const session = await connection.signIn();
  assert.equal(session.connected, true); assert.equal(session.sharing, true);
  assert.equal(session.account.email, 'designer@example.com');
  assert.deepEqual(session.models.map((model) => model.slug), ['gpt-6.1-sol', 'gpt-6-luna']);
  assert.equal(session.selectedModel, 'gpt-6.1-sol');
  await connection.selectModel('gpt-6-luna');
  await assert.rejects(connection.selectModel('hidden-model'), /available/);
  assert.equal(connection.selectedModel(), 'gpt-6-luna');

  connection.saved.profile.expiresAt = now;
  assert.deepEqual(await Promise.all([connection.getAccessToken(), connection.getAccessToken()]), ['access-rotated', 'access-rotated']);
  assert.equal(refreshes, 1);
  const saved = JSON.parse(await fs.readFile(storageFile, 'utf8'));
  assert.equal(saved.profile.refreshToken, 'refresh-rotated');
  assert.equal(saved.profile.accessToken, 'access-rotated');
  assert.notEqual(saved.profile.idToken, 'unverified-refresh-id-token');
  assert.ok(protectedPaths.some((file) => file === storageFile));
  const reopened = await ChatGPTPlanConnection.open({ storageFile, fetchImpl, now: () => now, protectFile: async () => {} });
  assert.equal(reopened.publicSession().connected, true);
  assert.equal(reopened.selectedModel(), 'gpt-6-luna');

  const signedOut = await connection.signOut();
  assert.equal(signedOut.connected, false); assert.equal(signedOut.revocationConfirmed, true); assert.equal(revocations, 1);
  const after = await fs.readFile(storageFile, 'utf8');
  assert.doesNotMatch(after, /access-rotated|refresh-rotated/);
  assert.match(after, /oaiapp_bim_forge/);
});

