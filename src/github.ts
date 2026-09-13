export type Query = Record<string, string | number>;

export interface GitHubClient {
  get<T>(path: string, query?: Query): Promise<T>;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class NotFoundError extends GitHubError {
  constructor(path: string) {
    super(`Not found: ${path}`, 404, path);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends GitHubError {
  readonly resetAt: Date | undefined;

  constructor(path: string, status: number, resetAt: Date | undefined) {
    const when = resetAt ? ` Resets at ${resetAt.toISOString()}.` : '';
    super(`GitHub rate limit reached on ${path}.${when}`, status, path);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

export function fixtureKey(path: string, query?: Query): string {
  const parts = Object.entries(query ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => [key, String(value)]);
  return [path, ...parts]
    .join('-')
    .replace(/[^A-Za-z0-9_]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.replace(/^\//, ''), 'https://api.github.com/');
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function resetAtFrom(headers: Headers): Date | undefined {
  const reset = Number(headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : undefined;
}

export class HttpGitHubClient implements GitHubClient {
  constructor(private readonly token: string | undefined) {}

  async get<T>(path: string, query?: Query): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'canistart',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(buildUrl(path, query), { headers });
    if (response.ok) return (await response.json()) as T;

    if (response.status === 404) throw new NotFoundError(path);
    const rateLimited =
      response.status === 429 ||
      (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if (rateLimited) throw new RateLimitError(path, response.status, resetAtFrom(response.headers));
    throw new GitHubError(`GitHub returned ${response.status} for ${path}`, response.status, path);
  }
}
