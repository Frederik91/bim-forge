import { sign } from 'node:crypto';
import { REPOSITORY } from './publish-request.mjs';

export const APP = Object.freeze({ id: 5415714, clientId: 'Iv23ligvo5ZCrcGwARug',
  slug: 'bim-forge-factory-frederik91', installationId: 173874051 });
export const PERMISSIONS = Object.freeze({ contents: 'write', pull_requests: 'write',
  administration: 'read', issues: 'read', metadata: 'read' });

export function assertPermissions(actual) {
  if (!actual || Object.keys(actual).length !== Object.keys(PERMISSIONS).length ||
      Object.entries(PERMISSIONS).some(([key, value]) => actual[key] !== value)) {
    throw new Error('Publisher App permissions do not match the approved scope');
  }
}

export async function withPublisherIdentity(privateKey, operation, { fetchImpl = fetch, now = Date.now() } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(now / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: APP.clientId })}`;
  const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  let token;
  const api = async (method, endpoint, credential, body, allowMissing = false) => {
    let response;
    try { response = await fetchImpl(`https://api.github.com${endpoint}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential}`,
        'User-Agent': APP.slug, 'X-GitHub-Api-Version': '2026-03-10',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }); } catch { throw new Error('GitHub request could not be completed'); }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const error = new Error(`GitHub request failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw new Error('GitHub response exceeds the publisher limit');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('GitHub returned an invalid JSON response'); }
  };
  try {
    const app = await api('GET', '/app', jwt);
    if (app.id !== APP.id || app.slug !== APP.slug || app.owner?.login !== 'Frederik91') throw new Error('Publisher App identity mismatch');
    assertPermissions(app.permissions);
    const installation = await api('GET', `/repos/${REPOSITORY}/installation`, jwt);
    if (installation.id !== APP.installationId || installation.app_id !== APP.id ||
        installation.account?.login !== 'Frederik91' || installation.repository_selection !== 'selected' || installation.suspended_at) {
      throw new Error('Publisher installation identity or scope mismatch');
    }
    assertPermissions(installation.permissions);
    const access = await api('POST', `/app/installations/${APP.installationId}/access_tokens`, jwt, {
      repositories: ['bim-forge'], permissions: PERMISSIONS,
    });
    token = access.token;
    if (typeof token !== 'string' || !token) throw new Error('Publisher installation token missing');
    assertPermissions(access.permissions);
    const lifetime = Date.parse(access.expires_at) - now;
    if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 3_660_000) throw new Error('Publisher token lifetime is invalid');
    const scope = await api('GET', '/installation/repositories?per_page=100', token);
    if (scope.total_count !== 1 || scope.repositories?.length !== 1 || scope.repositories[0].full_name !== REPOSITORY) {
      throw new Error('Publisher token repository scope is invalid');
    }
    const request = async (method, resource, body, allowMissing = false) => {
      if (typeof resource !== 'string' || !/^\/[a-zA-Z0-9_./?=&%:-]*$/.test(resource) || resource.includes('..') || resource.includes('//')) {
        throw new Error('Publisher request path is not permitted');
      }
      if (method === 'GET') {
        const reads = [
          /^\/$/, /^\/git\/ref\/heads\/(?:main|factory\/publish\/issue-[1-9]\d*-[a-f0-9]{20})$/,
          /^\/git\/commits\/[a-f0-9]{40}$/, /^\/git\/trees\/[a-f0-9]{40}\?recursive=1$/,
          /^\/contents\/(?:\.github\/CODEOWNERS|policy\/gate\.json|STATE\.md|package\.json)\?ref=[a-f0-9]{40}$/,
          /^\/branches\/main\/protection$/, /^\/rulesets\?includes_parents=true&per_page=100$/,
          /^\/issues\/[1-9]\d*$/, /^\/issues\?state=open&labels=loop-pause-all&per_page=1$/,
          /^\/pulls\/[1-9]\d*$/, /^\/pulls\?state=all&head=Frederik91%3Afactory%2Fpublish%2Fissue-[1-9]\d*-[a-f0-9]{20}&per_page=100$/,
        ];
        if (!reads.some((pattern) => pattern.test(resource))) {
          throw new Error('Publisher read operation is not permitted');
        }
      } else if (method === 'POST') {
        if (!['/git/trees', '/git/commits', '/git/refs', '/pulls'].includes(resource)) throw new Error('Publisher write operation is not permitted');
        if (resource === '/git/refs' && !/^refs\/heads\/factory\/publish\/issue-[1-9]\d*-[a-f0-9]{20}$/.test(body?.ref ?? '')) {
          throw new Error('Publisher can create only its own new factory branches');
        }
        if (resource === '/pulls' && (body?.base !== 'main' || body?.draft !== true ||
            !/^factory\/publish\/issue-[1-9]\d*-[a-f0-9]{20}$/.test(body?.head ?? ''))) {
          throw new Error('Publisher can create only draft PRs targeting main');
        }
      } else throw new Error('Publisher method is not permitted');
      return api(method, `/repos/${REPOSITORY}${resource === '/' ? '' : resource}`, token, body, allowMissing);
    };
    return await operation(request);
  } finally {
    if (token) await api('DELETE', '/installation/token', token);
  }
}
