import type { ApiPull, ApiRepo, ApiSearchResult } from '../api-types.js';
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

export async function checkRepoHealth({ client, ref, now }: CheckContext): Promise<CheckResult> {
  const slug = `${ref.owner}/${ref.repo}`;
  const repo = await client.get<ApiRepo>(`repos/${slug}`);
  const evidence: Evidence[] = [];

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

  const merged = closed.filter((pull) => pull.merged_at);
  const rate = closed.length > 0 ? merged.length / closed.length : 1;
  const median = medianHours(merged);
  const lastOutside = merged.find((pull) => !INSIDER_ROLES.has(pull.author_association) && !isBot(pull.user.login));
  const outsideDays = lastOutside
    ? Math.floor((now.getTime() - new Date(lastOutside.merged_at as string).getTime()) / 86_400_000)
    : undefined;

  evidence.push({
    text: `${merged.length} of the last ${closed.length} closed pull requests were merged`,
    url: `${repo.html_url}/pulls?q=is%3Apr+is%3Aclosed`,
  });
  if (median !== undefined) evidence.push({ text: `median ${median}h from open to merge`, url: repo.html_url });
  evidence.push({
    text: lastOutside
      ? `last outside contribution merged ${outsideDays} days ago (#${lastOutside.number} by @${lastOutside.user.login})`
      : 'no outside contribution among the last 20 closed pull requests',
    url: lastOutside ? lastOutside.html_url : repo.html_url,
  });
  evidence.push({ text: `${openCount} open pull requests`, url: `${repo.html_url}/pulls` });

  const warnings: string[] = [];
  if (rate < MIN_MERGE_RATE) warnings.push(`only ${Math.round(rate * 100)}% of recent pull requests were merged`);
  if (outsideDays === undefined || outsideDays > OUTSIDE_MERGE_DAYS) {
    warnings.push(`no outside contribution merged in the last ${OUTSIDE_MERGE_DAYS} days`);
  }
  if (warnings.length > 0) {
    return { id: 'repo_health', status: 'warn', summary: `${warnings.join('; ')}.`, evidence, blocks_agents: false };
  }
  return {
    id: 'repo_health',
    status: 'pass',
    summary: `Repo merges outside work: ${Math.round(rate * 100)}% merge rate, last outside merge ${outsideDays} days ago.`,
    evidence,
    blocks_agents: false,
  };
}
