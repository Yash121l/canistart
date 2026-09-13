import type { ApiComment, ApiIssue } from '../api-types.js';
import { count } from '../text.js';
import type { CheckContext, CheckResult, Evidence } from '../types.js';

const BLOCKING_LABELS = [
  'needs discussion',
  'blocked',
  'wontfix',
  "won't fix",
  'duplicate',
  'question',
  'needs design',
  'stale',
  'needs decision',
  'on hold',
];

const POSITIVE_LABELS = ['good first issue', 'help wanted', 'accepted', 'prs welcome', 'pr welcome'];

const MAINTAINER_ROLES = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const YEAR_DAYS = 365;
const DORMANT_DAYS = 180;

function daysBetween(from: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(from).getTime()) / 86_400_000);
}

function matchLabels(issue: ApiIssue, wanted: string[]): string[] {
  const names = issue.labels.map((label) => label.name.toLowerCase());
  return wanted.filter((label) => names.includes(label));
}

function blocker(issue: ApiIssue): string | undefined {
  if (issue.state !== 'open') return `Issue is ${issue.state}.`;
  if (issue.locked) return 'Issue is locked, you cannot comment on it.';
  const assignee = issue.assignees[0];
  if (!assignee) return undefined;
  const others = issue.assignees.length > 1 ? ` and ${issue.assignees.length - 1} more` : '';
  return `Issue is assigned to @${assignee.login}${others}.`;
}

function concerns(issue: ApiIssue, acknowledged: boolean, now: Date, evidence: Evidence[]): string[] {
  const url = issue.html_url;
  const warnings: string[] = [];
  const blocking = matchLabels(issue, BLOCKING_LABELS);
  if (blocking.length > 0) {
    warnings.push(`blocking labels: ${blocking.join(', ')}`);
    for (const label of blocking) evidence.push({ text: `labelled "${label}"`, url });
  }
  const age = daysBetween(issue.created_at, now);
  if (age > YEAR_DAYS) {
    warnings.push('open for over a year');
    evidence.push({ text: `open for ${count(age, 'day')}`, url });
  }
  const idle = daysBetween(issue.updated_at, now);
  if (idle > DORMANT_DAYS) {
    warnings.push('dormant');
    evidence.push({ text: `no activity for ${count(idle, 'day')}`, url });
  }
  if (!acknowledged) {
    warnings.push('no maintainer reply');
    evidence.push({ text: 'no maintainer has commented on or opened this issue', url });
  }
  return warnings;
}

export async function checkIssue({ client, ref, now }: CheckContext): Promise<CheckResult> {
  const path = `repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const issue = await client.get<ApiIssue>(path);
  const comments = await client.get<ApiComment[]>(`${path}/comments`, { per_page: 100 });

  const url = issue.html_url;
  const evidence: Evidence[] = [{ text: issue.title, url }];
  for (const label of matchLabels(issue, POSITIVE_LABELS)) evidence.push({ text: `labelled "${label}"`, url });

  const blocked = blocker(issue);
  if (blocked) return { id: 'issue', status: 'fail', summary: blocked, evidence, blocks_agents: false };

  const acknowledged =
    MAINTAINER_ROLES.has(issue.author_association) ||
    comments.some((comment) => MAINTAINER_ROLES.has(comment.author_association));
  const warnings = concerns(issue, acknowledged, now, evidence);
  if (warnings.length > 0) {
    return {
      id: 'issue',
      status: 'warn',
      summary: `Issue is open but ${warnings.join('; ')}.`,
      evidence,
      blocks_agents: false,
    };
  }
  return {
    id: 'issue',
    status: 'pass',
    summary: `Issue is open, unassigned and ${count(daysBetween(issue.created_at, now), 'day')} old.`,
    evidence,
    blocks_agents: false,
  };
}
