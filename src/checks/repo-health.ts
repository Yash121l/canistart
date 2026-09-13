import type { ApiPull, ApiRepo, ApiSearchResult } from '../api-types.js';
import { count } from '../text.js';
import type { CheckContext, CheckResult, Evidence } from '../types.js';

const OUTSIDE_MERGE_DAYS = 30;
const MIN_MERGE_RATE = 0.4;
const INSIDER_ROLES = new Set(['OWNER', 'MEMBER']);

function isBot(login: string): boolean {
  return login.endsWith('[bot]');
}

function medianHours(pulls: ApiPull[]): number | undefined {
  const hours = pulls
    .map((pull) => (new Date(pull.merged_at as string).getTime() - new Date(pull.created_at).getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  const middle = hours[Math.floor(hours.length / 2)];
  return middle === undefined ? undefined : Math.round(middle);
}

interface Metrics {
  rate: number;
  median: number | undefined;
  lastOutside: ApiPull | undefined;
  outsideDays: number | undefined;
}

function measure(closed: ApiPull[], now: Date): Metrics {
  const merged = closed.filter((pull) => pull.merged_at);
  const lastOutside = merged.find((pull) => !INSIDER_ROLES.has(pull.author_association) && !isBot(pull.user.login));
  return {
    rate: closed.length > 0 ? merged.length / closed.length : 1,
    median: medianHours(merged),
    lastOutside,
    outsideDays: lastOutside
      ? Math.floor((now.getTime() - new Date(lastOutside.merged_at as string).getTime()) / 86_400_000)
      : undefined,
  };
}

function report(repo: ApiRepo, closed: ApiPull[], openCount: number, metrics: Metrics): Evidence[] {
  const { median, lastOutside, outsideDays } = metrics;
  const mergedCount = closed.filter((pull) => pull.merged_at).length;
  return [
    {
      text: `${mergedCount} of the last ${count(closed.length, 'closed pull request')} ${mergedCount === 1 ? 'was' : 'were'} merged`,
      url: `${repo.html_url}/pulls?q=is%3Apr+is%3Aclosed`,
    },
    ...(median === undefined ? [] : [{ text: `median ${median}h from open to merge`, url: repo.html_url }]),
    {
      text: lastOutside
        ? `last outside contribution merged ${count(outsideDays ?? 0, 'day')} ago (#${lastOutside.number} by @${lastOutside.user.login})`
        : 'no outside contribution among the last 20 closed pull requests',
      url: lastOutside ? lastOutside.html_url : repo.html_url,
    },
    { text: count(openCount, 'open pull request'), url: `${repo.html_url}/pulls` },
  ];
}

export async function checkRepoHealth({ client, ref, now }: CheckContext): Promise<CheckResult> {
  const slug = `${ref.owner}/${ref.repo}`;
  const repo = await client.get<ApiRepo>(`repos/${slug}`);
  if (repo.archived) {
    return {
      id: 'repo_health',
      status: 'fail',
      summary: 'Repository is archived and no longer accepts pull requests.',
      evidence: [{ text: `archived, last pushed ${repo.pushed_at.slice(0, 10)}`, url: repo.html_url }],
      blocks_agents: false,
    };
  }

  const closed = await client.get<ApiPull[]>(`repos/${slug}/pulls`, {
    state: 'closed',
    per_page: 20,
    sort: 'updated',
    direction: 'desc',
  });
  const openCount = await client
    .get<ApiSearchResult>('search/issues', { q: `repo:${slug} is:pr is:open`, per_page: 1 })
    .then((search) => search.total_count)
    .catch(() => repo.open_issues_count);

  const metrics = measure(closed, now);
  const evidence = report(repo, closed, openCount, metrics);
  const warnings: string[] = [];
  if (metrics.rate < MIN_MERGE_RATE) {
    warnings.push(`only ${Math.round(metrics.rate * 100)}% of recent pull requests were merged`);
  }
  if (metrics.outsideDays === undefined || metrics.outsideDays > OUTSIDE_MERGE_DAYS) {
    warnings.push(`no outside contribution merged in the last ${OUTSIDE_MERGE_DAYS} days`);
  }
  if (warnings.length > 0) {
    return { id: 'repo_health', status: 'warn', summary: `${warnings.join('; ')}.`, evidence, blocks_agents: false };
  }
  return {
    id: 'repo_health',
    status: 'pass',
    summary: `Repo merges outside work: ${Math.round(metrics.rate * 100)}% merge rate, last outside merge ${count(metrics.outsideDays ?? 0, 'day')} ago.`,
    evidence,
    blocks_agents: false,
  };
}
