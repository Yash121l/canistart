import type { ApiPull, ApiSearchResult, ApiTimelineEvent } from '../api-types.js';
import { referencesIssue } from '../reference.js';
import type { CheckContext, CheckResult, Evidence } from '../types.js';

const MAX_PULLS = 15;

interface ApiReview {
  user: { login: string };
  state: string;
  submitted_at?: string | null;
}

async function candidateNumbers({ client, ref }: CheckContext): Promise<number[]> {
  const search = await client
    .get<ApiSearchResult>('search/issues', { q: `repo:${ref.owner}/${ref.repo} is:pr ${ref.number}`, per_page: 50 })
    .catch(() => ({ total_count: 0, items: [] }) satisfies ApiSearchResult);
  const timeline = await client
    .get<ApiTimelineEvent[]>(`repos/${ref.owner}/${ref.repo}/issues/${ref.number}/timeline`, { per_page: 100 })
    .catch(() => []);

  const numbers = new Set<number>();
  for (const item of search.items) {
    if (item.number !== ref.number && referencesIssue(`${item.title}\n${item.body ?? ''}`, ref)) {
      numbers.add(item.number);
    }
  }
  for (const event of timeline) {
    const source = event.event === 'cross-referenced' ? event.source?.issue : undefined;
    if (source?.pull_request && source.repository?.full_name === `${ref.owner}/${ref.repo}`) {
      numbers.add(source.number);
    }
  }
  return [...numbers].sort((a, b) => b - a).slice(0, MAX_PULLS);
}

async function reviewState(ctx: CheckContext, number: number): Promise<string> {
  const reviews = await ctx.client
    .get<ApiReview[]>(`repos/${ctx.ref.owner}/${ctx.ref.repo}/pulls/${number}/reviews`, { per_page: 100 })
    .catch(() => []);
  const states = new Set(reviews.map((review) => review.state));
  if (states.has('APPROVED')) return 'approved';
  if (states.has('CHANGES_REQUESTED')) return 'changes requested';
  return reviews.length > 0 ? 'reviewed' : 'no review yet';
}

async function describe(ctx: CheckContext, pull: ApiPull): Promise<Evidence> {
  const state = pull.merged_at ? 'merged' : pull.state;
  const extra = state === 'open' ? `, ${await reviewState(ctx, pull.number)}` : '';
  const draft = pull.draft ? ' (draft)' : '';
  return { text: `#${pull.number} ${state}${draft} by @${pull.user.login}${extra}`, url: pull.html_url };
}

export async function checkCompetingPrs(ctx: CheckContext): Promise<CheckResult> {
  const numbers = await candidateNumbers(ctx);
  const pulls: ApiPull[] = [];
  for (const number of numbers) {
    const pull = await ctx.client
      .get<ApiPull>(`repos/${ctx.ref.owner}/${ctx.ref.repo}/pulls/${number}`)
      .catch(() => undefined);
    if (pull) pulls.push(pull);
  }

  const merged = pulls.filter((pull) => pull.merged_at);
  const open = pulls.filter((pull) => !pull.merged_at && pull.state === 'open');
  const closed = pulls.filter((pull) => !pull.merged_at && pull.state !== 'open');
  const evidence = await Promise.all(pulls.map((pull) => describe(ctx, pull)));

  if (merged.length > 0) {
    const labels = merged.map((pull) => `#${pull.number}`).join(', ');
    return {
      id: 'competing_prs',
      status: 'fail',
      summary: `Already merged: ${labels} references this issue.`,
      evidence,
      blocks_agents: false,
    };
  }
  if (open.length > 0) {
    return {
      id: 'competing_prs',
      status: 'fail',
      summary: `${open.length} open pull request${open.length === 1 ? '' : 's'} already targets this issue.`,
      evidence,
      blocks_agents: false,
    };
  }
  if (closed.length > 0) {
    return {
      id: 'competing_prs',
      status: 'warn',
      summary: `${closed.length} closed, unmerged pull request${closed.length === 1 ? '' : 's'} tried this before.`,
      evidence,
      blocks_agents: false,
    };
  }
  return {
    id: 'competing_prs',
    status: 'pass',
    summary: 'No pull request references this issue.',
    evidence,
    blocks_agents: false,
  };
}
