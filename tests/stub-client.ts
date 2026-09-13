import { fixtureKey, NotFoundError, type GitHubClient, type Query } from '../src/github.js';

export function stubClient(responses: Record<string, unknown>): GitHubClient {
  return {
    async get<T>(path: string, query?: Query): Promise<T> {
      const key = fixtureKey(path, query);
      if (!(key in responses)) throw new NotFoundError(path);
      return responses[key] as T;
    },
  };
}
