import { createRequire } from 'node:module';
import { checkAlreadyFixed } from './checks/already-fixed.js';
import { checkCompetingPrs } from './checks/competing-prs.js';
import { checkIssue } from './checks/issue.js';
import { checkPolicy } from './checks/policy.js';
import { checkRepoHealth } from './checks/repo-health.js';
import { decide } from './decide.js';
import { fixtureKey, HttpGitHubClient, type GitHubClient, type Query } from './github.js';
import { parseIssueRef } from './parse.js';
import type { ApiIssue } from './api-types.js';
import type { CheckContext, CheckResult, Verdict } from './types.js';

export { decide } from './decide.js';
export { parseIssueRef, type IssueRef } from './parse.js';
export { GitHubError, HttpGitHubClient, NotFoundError, RateLimitError, type GitHubClient } from './github.js';
export type { CheckId, CheckResult, CheckStatus, Evidence, Verdict } from './types.js';

export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;

export interface CanistartOptions {
  agent?: boolean;
  token?: string;
  client?: GitHubClient;
  now?: Date;
}

export interface CanistartResult {
  verdict: Verdict;
  exit_code: number;
  issue: { owner: string; repo: string; number: number; title: string; state: string; url: string };
  checks: CheckResult[];
  generated_at: string;
  canistart_version: string;
}

function cache(client: GitHubClient): GitHubClient {
  const entries = new Map<string, Promise<unknown>>();
  return {
    get<T>(path: string, query?: Query): Promise<T> {
      const key = fixtureKey(path, query);
      const hit = entries.get(key) ?? client.get<T>(path, query);
      entries.set(key, hit);
      return hit as Promise<T>;
    },
  };
}

export async function canistart(target: string, options: CanistartOptions = {}): Promise<CanistartResult> {
  const ref = parseIssueRef(target);
  const ctx: CheckContext = {
    ref,
    now: options.now ?? new Date(),
    client: cache(options.client ?? new HttpGitHubClient(options.token)),
  };

  const issue = await ctx.client.get<ApiIssue>(`repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
  const checks = [
    await checkIssue(ctx),
    await checkCompetingPrs(ctx),
    await checkAlreadyFixed(ctx),
    await checkPolicy(ctx),
    await checkRepoHealth(ctx),
  ];
  const decision = decide(checks, { agent: options.agent ?? false });

  return {
    ...decision,
    issue: { ...ref, title: issue.title, state: issue.state, url: issue.html_url },
    checks,
    generated_at: ctx.now.toISOString(),
    canistart_version: VERSION,
  };
}
