import { sign, type KeyLike } from 'node:crypto';
import { REPOSITORY } from './publish-request.ts';

export const APP = Object.freeze({ id: 5415714, clientId: 'Iv23ligvo5ZCrcGwARug',
  slug: 'bim-forge-factory-frederik91', installationId: 173874051 });
export const PERMISSIONS = Object.freeze({ contents: 'write', pull_requests: 'write',
  administration: 'read', issues: 'read', metadata: 'read' });

type FetchImplementation = (input: string, init: RequestInit) => Promise<Response>;
export type PublisherRequest = (
  method: unknown,
  resource: unknown,
  body?: unknown,
  allowMissing?: boolean,
) => Promise<unknown>;

interface PublisherIdentityOptions {
  readonly fetchImpl?: FetchImplementation;
  readonly now?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertPermissions(actual: unknown): void {
  if (!isRecord(actual) || Object.keys(actual).length !== Object.keys(PERMISSIONS).length
      || Object.entries(PERMISSIONS).some(([key, value]) => actual[key] !== value)) {
    throw new Error('Publisher App permissions do not match the approved scope');
  }
}

export async function withPublisherIdentity<Result>(
  privateKey: KeyLike,
  operation: (request: PublisherRequest) => Promise<Result> | Result,
  { fetchImpl = fetch, now = Date.now() }: PublisherIdentityOptions = {},
): Promise<Result> {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(now / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: APP.clientId })}`;
  const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  let token: string | undefined;
  const api = async (
    method: string,
    endpoint: string,
    credential: string,
    body?: unknown,
    allowMissing = false,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.github.com${endpoint}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${credential}`,
          'User-Agent': APP.slug,
          'X-GitHub-Api-Version': '2026-03-10',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('GitHub request could not be completed'); }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const error = new Error(`GitHub request failed with HTTP ${response.status}`);
      Object.defineProperty(error, 'status', { value: response.status, enumerable: true });
      throw error;
    }
    if (response.status === 204) return null;
    if (!response.body) throw new Error('GitHub returned an invalid JSON response');
    let length = 0;
    const chunks: Uint8Array[] = [];
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
    if (!isRecord(app) || app.id !== APP.id || app.slug !== APP.slug
        || !isRecord(app.owner) || app.owner.login !== 'Frederik91') {
      throw new Error('Publisher App identity mismatch');
    }
    assertPermissions(app.permissions);
    const installation = await api('GET', `/repos/${REPOSITORY}/installation`, jwt);
    if (!isRecord(installation) || installation.id !== APP.installationId || installation.app_id !== APP.id
        || !isRecord(installation.account) || installation.account.login !== 'Frederik91'
        || installation.repository_selection !== 'selected' || installation.suspended_at) {
      throw new Error('Publisher installation identity or scope mismatch');
    }
    assertPermissions(installation.permissions);
    const access = await api('POST', `/app/installations/${APP.installationId}/access_tokens`, jwt, {
      repositories: ['bim-forge'], permissions: PERMISSIONS,
    });
    if (!isRecord(access) || typeof access.token !== 'string' || !access.token) {
      throw new Error('Publisher installation token missing');
    }
    token = access.token;
    assertPermissions(access.permissions);
    const lifetime = typeof access.expires_at === 'string' ? Date.parse(access.expires_at) - now : Number.NaN;
    if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 3_660_000) {
      throw new Error('Publisher token lifetime is invalid');
    }
    const scope = await api('GET', '/installation/repositories?per_page=100', token);
    if (!isRecord(scope) || scope.total_count !== 1 || !Array.isArray(scope.repositories)
        || scope.repositories.length !== 1 || !isRecord(scope.repositories[0])
        || scope.repositories[0].full_name !== REPOSITORY) {
      throw new Error('Publisher token repository scope is invalid');
    }
    const credential = token;
    const request: PublisherRequest = async (method, resource, body, allowMissing = false) => {
      if (typeof resource !== 'string' || !/^\/[a-zA-Z0-9_./?=&%:-]*$/.test(resource)
          || resource.includes('..') || resource.includes('//')) {
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
        if (!reads.some((pattern) => pattern.test(resource))) throw new Error('Publisher read operation is not permitted');
      } else if (method === 'POST') {
        if (!['/git/trees', '/git/commits', '/git/refs', '/pulls'].includes(resource)) {
          throw new Error('Publisher write operation is not permitted');
        }
        if (resource === '/git/refs' && (!isRecord(body)
            || typeof body.ref !== 'string' || !/^refs\/heads\/factory\/publish\/issue-[1-9]\d*-[a-f0-9]{20}$/.test(body.ref))) {
          throw new Error('Publisher can create only its own new factory branches');
        }
        if (resource === '/pulls' && (!isRecord(body) || body.base !== 'main' || body.draft !== true
            || typeof body.head !== 'string' || !/^factory\/publish\/issue-[1-9]\d*-[a-f0-9]{20}$/.test(body.head))) {
          throw new Error('Publisher can create only draft PRs targeting main');
        }
      } else throw new Error('Publisher method is not permitted');
      return api(method, `/repos/${REPOSITORY}${resource === '/' ? '' : resource}`, credential, body, allowMissing);
    };
    return await operation(request);
  } finally {
    if (token) await api('DELETE', '/installation/token', token);
  }
}
