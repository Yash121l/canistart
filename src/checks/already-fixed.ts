import type { ApiComment, ApiIssue, ApiPull, ApiTimelineEvent } from '../api-types.js';
import { count } from '../text.js';
import type { CheckContext, CheckResult, Evidence } from '../types.js';

const MAX_MENTIONS = 5;

function mentionedNumbers(comments: ApiComment[], ref: { number: number }): number[] {
  const numbers = new Set<number>();
  for (const comment of comments) {
    for (const match of (comment.body ?? '').matchAll(/(?:^|[^\w/#])#(\d+)(?!\d)/g)) {
      const number = Number(match[1]);
      if (number !== ref.number) numbers.add(number);
    }
  }
  return [...numbers].slice(0, MAX_MENTIONS);
}

function closingCommit(events: ApiTimelineEvent[]): string | undefined {
  const closed = events.filter((event) => event.event === 'closed' && event.commit_id);
  return closed.at(-1)?.commit_id ?? undefined;
}

function closedResult(issue: ApiIssue, events: ApiTimelineEvent[]): CheckResult {
  const commit = closingCommit(events);
  const detail = commit ? ` by commit ${commit.slice(0, 7)}` : ` as ${issue.state_reason ?? issue.state}`;
  return {
    id: 'already_fixed',
    status: 'fail',
    summary: `Issue was already closed${detail}.`,
    evidence: [{ text: `closed on ${issue.closed_at ?? 'an unknown date'}`, url: issue.html_url }],
    blocks_agents: false,
  };
}

async function referencingCommits(ctx: CheckContext, events: ApiTimelineEvent[]): Promise<Evidence[]> {
  const base = `repos/${ctx.ref.owner}/${ctx.ref.repo}`;
  const shas = events
    .filter((event) => event.event === 'referenced' && event.commit_id)
    .map((event) => event.commit_id as string)
    .slice(0, MAX_MENTIONS);
  const found = await Promise.all(
    shas.map(async (sha) => {
      const commit = await ctx.client.get<{ html_url: string }>(`${base}/commits/${sha}`).catch(() => undefined);
      return commit ? { text: `commit ${sha.slice(0, 7)} mentions this issue`, url: commit.html_url } : undefined;
    }),
  );
  return found.filter((evidence): evidence is Evidence => evidence !== undefined);
}

async function linkedMergedPulls(ctx: CheckContext, comments: ApiComment[]): Promise<Evidence[]> {
  const base = `repos/${ctx.ref.owner}/${ctx.ref.repo}`;
  const found = await Promise.all(
    mentionedNumbers(comments, ctx.ref).map(async (number) => {
      const pull = await ctx.client.get<ApiPull>(`${base}/pulls/${number}`).catch(() => undefined);
      return pull?.merged_at
        ? { text: `the thread points at merged #${number}: ${pull.title}`, url: pull.html_url }
        : undefined;
    }),
  );
  return found.filter((evidence): evidence is Evidence => evidence !== undefined);
}

export async function checkAlreadyFixed(ctx: CheckContext): Promise<CheckResult> {
  const path = `repos/${ctx.ref.owner}/${ctx.ref.repo}/issues/${ctx.ref.number}`;
  const issue = await ctx.client.get<ApiIssue>(path);
  const comments = await ctx.client.get<ApiComment[]>(`${path}/comments`, { per_page: 100 });
  const events = await ctx.client.get<ApiTimelineEvent[]>(`${path}/timeline`, { per_page: 100 }).catch(() => []);

  if (issue.state !== 'open') return closedResult(issue, events);

  const commits = await referencingCommits(ctx, events);
  const pulls = await linkedMergedPulls(ctx, comments);
  const evidence = [...commits, ...pulls];
  if (evidence.length === 0) {
    return {
      id: 'already_fixed',
      status: 'pass',
      summary: 'No commit or merged pull request looks like a fix for this.',
      evidence,
      blocks_agents: false,
    };
  }

  const parts: string[] = [];
  if (commits.length > 0) {
    parts.push(`${count(commits.length, 'commit')} in this repo mention${commits.length === 1 ? 's' : ''} it`);
  }
  if (pulls.length > 0) parts.push(`the discussion points at ${count(pulls.length, 'merged pull request')}`);
  return {
    id: 'already_fixed',
    status: 'warn',
    summary: `May already be fixed: ${parts.join(' and ')}.`,
    evidence,
    blocks_agents: false,
  };
}
