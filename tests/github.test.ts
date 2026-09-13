import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureKey, HttpGitHubClient, NotFoundError, RateLimitError, GitHubError } from '../src/github.js';
import { FixtureGitHubClient } from '../src/fixture-client.js';

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fixtureKey', () => {
  it('is stable and filesystem safe', () => {
    expect(fixtureKey('repos/meriyah/meriyah/issues/650')).toBe('repos-meriyah-meriyah-issues-650');
    expect(fixtureKey('search/issues', { q: 'repo:a/b is:pr 1', per_page: 50 })).toBe(
      'search-issues-per_page-50-q-repo-a-b-is-pr-1',
    );
  });
});

describe('HttpGitHubClient', () => {
  it('sends the api version, accept and authorization headers', async () => {
    const fetchMock = vi.fn(async () => response(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpGitHubClient('tok_123');

    await expect(client.get('repos/a/b', { per_page: 20 })).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/a/b?per_page=20');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_123');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['Accept']).toBe('application/vnd.github+json');
  });

  it('omits authorization when there is no token', async () => {
    const fetchMock = vi.fn(async () => response(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await new HttpGitHubClient(undefined).get('repos/a/b');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('throws NotFoundError on 404', async () => {
    vi.stubGlobal('fetch', async () => response(404, { message: 'Not Found' }));
    await expect(new HttpGitHubClient(undefined).get('repos/a/b')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws RateLimitError on a 403 with an exhausted quota', async () => {
    vi.stubGlobal('fetch', async () =>
      response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
    );
    const error = await new HttpGitHubClient(undefined).get('repos/a/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).resetAt?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('throws a plain GitHubError on a 403 that is not a rate limit', async () => {
    vi.stubGlobal('fetch', async () => response(403, { message: 'Forbidden' }, { 'x-ratelimit-remaining': '42' }));
    const error = await new HttpGitHubClient(undefined).get('repos/a/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).not.toBeInstanceOf(RateLimitError);
    expect((error as GitHubError).status).toBe(403);
  });

  it('throws RateLimitError on a 429', async () => {
    vi.stubGlobal('fetch', async () => response(429, { message: 'Too many requests' }));
    await expect(new HttpGitHubClient(undefined).get('repos/a/b')).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('FixtureGitHubClient', () => {
  it('reads recorded responses and 404s on anything unrecorded', async () => {
    const client = new FixtureGitHubClient('tests/fixtures/meriyah-meriyah-650');
    await expect(client.get<{ number: number }>('repos/meriyah/meriyah/issues/650')).resolves.toMatchObject({
      number: 650,
    });
    await expect(client.get('repos/meriyah/meriyah/contents/CONTRIBUTING.md')).rejects.toBeInstanceOf(NotFoundError);
  });
});
