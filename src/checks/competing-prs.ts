import type { ApiPull, ApiSearchResult, ApiTimelineEvent } from '../api-types.js';
import { referencesIssue } from '../reference.js';
import { count } from '../text.js';
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

function verdict(merged: ApiPull[], open: ApiPull[], closed: ApiPull[]): Pick<CheckResult, 'status' | 'summary'> {
  if (merged.length > 0) {
    return {
      status: 'fail',
      summary: `Already merged: ${merged.map((pull) => `#${pull.number}`).join(', ')} references this issue.`,
    };
  }
  if (open.length > 0) {
    return {
      status: 'fail',
      summary: `${count(open.length, 'open pull request')} already ${open.length === 1 ? 'targets' : 'target'} this issue.`,
    };
  }
  if (closed.length > 0) {
    return { status: 'warn', summary: `${count(closed.length, 'closed, unmerged pull request')} tried this before.` };
  }
  return { status: 'pass', summary: 'No pull request references this issue.' };
}

export async function checkCompetingPrs(ctx: CheckContext): Promise<CheckResult> {
  const numbers = await candidateNumbers(ctx);
  const fetched = await Promise.all(
    numbers.map((number) =>
      ctx.client.get<ApiPull>(`repos/${ctx.ref.owner}/${ctx.ref.repo}/pulls/${number}`).catch(() => undefined),
    ),
  );
  const pulls = fetched.filter((pull): pull is ApiPull => pull !== undefined);
  const evidence = await Promise.all(pulls.map((pull) => describe(ctx, pull)));

  return {
    id: 'competing_prs',
    ...verdict(
      pulls.filter((pull) => pull.merged_at),
      pulls.filter((pull) => !pull.merged_at && pull.state === 'open'),
      pulls.filter((pull) => !pull.merged_at && pull.state !== 'open'),
    ),
    evidence,
    blocks_agents: false,
  };
}
