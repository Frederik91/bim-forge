import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { APP, PERMISSIONS, withPublisherIdentity } from './publisher-identity.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = 1792600000000;
function apiFixture(overrides = {}) {
  const calls = [];
  const responses = {
    '/app': { id: APP.id, slug: APP.slug, owner: { login: 'Frederik91' }, permissions: PERMISSIONS },
    '/repos/Frederik91/bim-forge/installation': { id: APP.installationId, app_id: APP.id,
      account: { login: 'Frederik91' }, repository_selection: 'selected', suspended_at: null, permissions: PERMISSIONS },
    [`/app/installations/${APP.installationId}/access_tokens`]: { token: 'fixture-installation-token',
      permissions: PERMISSIONS, expires_at: new Date(now + 3600000).toISOString() },
    '/installation/repositories?per_page=100': { total_count: 1, repositories: [{ full_name: 'Frederik91/bim-forge' }] },
    '/repos/Frederik91/bim-forge': { full_name: 'Frederik91/bim-forge' }, ...overrides,
  };
  const fetchImpl = async (url, options) => {
    assert.ok(url.startsWith('https://api.github.com/'));
    const endpoint = url.slice('https://api.github.com'.length);
    calls.push({ endpoint, ...options });
    if (endpoint === '/installation/token') return new Response(null, { status: 204 });
    assert.ok(Object.hasOwn(responses, endpoint), `Unexpected endpoint ${endpoint}`);
    return new Response(JSON.stringify(responses[endpoint]), { status: 200 });
  };
  return { calls, fetchImpl };
}

test('authentication signs the expected App identity, restricts the token, and revokes it after use', async () => {
  const api = apiFixture();
  const result = await withPublisherIdentity(privateKey, async (request) => {
    const repo = await request('GET', '/'); return { repository: repo.full_name };
  }, { fetchImpl: api.fetchImpl, now });
  assert.deepEqual(result, { repository: 'Frederik91/bim-forge' });
  assert.equal(JSON.stringify(result).includes('fixture-installation-token'), false);
  const jwt = api.calls[0].headers.Authorization.slice('Bearer '.length);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, APP.clientId);
  const mint = api.calls.find((call) => call.method === 'POST');
  assert.deepEqual(JSON.parse(mint.body), { repositories: ['bim-forge'], permissions: PERMISSIONS });
  assert.equal(api.calls.at(-1).endpoint, '/installation/token');
  for (const call of api.calls) assert.equal(call.redirect, 'error');
});

test('the credential capability refuses merge, approval, settings changes, main writes, and non-draft PRs', async () => {
  const api = apiFixture();
  await withPublisherIdentity(privateKey, async (request) => {
    for (const [method, resource, body] of [
      ['PUT', '/pulls/1/merge'], ['PATCH', '/git/refs/heads/main'], ['DELETE', '/git/refs/heads/main'],
      ['POST', '/pulls/1/reviews', { event: 'APPROVE' }], ['POST', '/check-runs'],
      ['POST', '/git/refs', { ref: 'refs/heads/main', sha: 'a'.repeat(40) }],
      ['POST', '/pulls', { base: 'main', head: 'factory/publish/issue-14-' + 'a'.repeat(20), draft: false }],
      ['GET', '/contents/.env?ref=' + 'a'.repeat(40)], ['GET', '/../../other/repo'], ['GET', '/rulesets?unexpected=true'],
    ]) await assert.rejects(request(method, resource, body));
  }, { fetchImpl: api.fetchImpl, now });
  assert.equal(api.calls.filter((call) => call.method === 'POST').length, 1, 'Only token minting reaches the network');
});

test('wrong identity and elevated App permissions fail before minting a token', async () => {
  const normal = apiFixture();
  for (const overrides of [
    { '/app': { id: 1 } },
    { '/app': { id: APP.id, slug: APP.slug, owner: { login: 'Frederik91' }, permissions: { ...PERMISSIONS, checks: 'write' } } },
    { '/repos/Frederik91/bim-forge/installation': { id: APP.installationId, app_id: APP.id, account: { login: 'Frederik91' }, repository_selection: 'all' } },
  ]) {
    const api = apiFixture(overrides);
    await assert.rejects(withPublisherIdentity(privateKey, () => assert.fail('Operation must not run'), { fetchImpl: api.fetchImpl, now }));
    assert.equal(api.calls.some((call) => call.method === 'POST'), false);
  }
  assert.equal(normal.calls.length, 0);
});

test('invalid token rights, broad scope, and operation failures still revoke minted tokens', async () => {
  for (const overrides of [
    { [`/app/installations/${APP.installationId}/access_tokens`]: { token: 'fixture-token', permissions: { ...PERMISSIONS, administration: 'write' } } },
    { '/installation/repositories?per_page=100': { total_count: 2, repositories: [] } },
  ]) {
    const api = apiFixture(overrides);
    await assert.rejects(withPublisherIdentity(privateKey, () => assert.fail('Operation must not run'), { fetchImpl: api.fetchImpl, now }));
    assert.equal(api.calls.at(-1).endpoint, '/installation/token');
  }
  const api = apiFixture();
  await assert.rejects(withPublisherIdentity(privateKey, () => { throw new Error('Operation refused'); }, { fetchImpl: api.fetchImpl, now }), /refused/);
  assert.equal(api.calls.at(-1).endpoint, '/installation/token');
});

test('network failures do not expose credential-shaped error details', async () => {
  await assert.rejects(withPublisherIdentity(privateKey, () => {}, { now,
    fetchImpl: async () => { throw new Error('private request headers should never appear in the error'); },
  }), (error) => error.message === 'GitHub request could not be completed');
});
