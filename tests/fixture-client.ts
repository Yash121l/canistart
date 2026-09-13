import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureKey, NotFoundError, type GitHubClient, type Query } from '../src/github.js';

export class FixtureGitHubClient implements GitHubClient {
  constructor(private readonly dir: string) {}

  async get<T>(path: string, query?: Query): Promise<T> {
    const file = join(this.dir, `${fixtureKey(path, query)}.json`);
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      throw new NotFoundError(path);
    }
  }
}
