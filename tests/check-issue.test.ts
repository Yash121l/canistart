import { describe, expect, it } from 'vitest';
import { checkIssue } from '../src/checks/issue.js';
import type { CheckContext } from '../src/types.js';
import { stubClient } from './stub-client.js';

const NOW = new Date('2026-09-13T12:00:00Z');
const REF = { owner: 'o', repo: 'r', number: 7 };

interface IssueOverrides {
  state?: string;
  locked?: boolean;
  assignees?: { login: string }[];
  labels?: { name: string }[];
  created_at?: string;
  updated_at?: string;
  author_association?: string;
}

function context(issue: IssueOverrides, comments: unknown[] = []): CheckContext {
  return {
    ref: REF,
    now: NOW,
    client: stubClient({
      'repos-o-r-issues-7': {
        number: 7,
        title: 'Something is broken',
        html_url: 'https://github.com/o/r/issues/7',
        state: 'open',
        locked: false,
        assignees: [],
        labels: [],
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-10T00:00:00Z',
        user: { login: 'reporter' },
        author_association: 'NONE',
        ...issue,
      },
      'repos-o-r-issues-7-comments-per_page-100': comments,
    }),
  };
}

describe('checkIssue', () => {
  it('passes for an open, unassigned issue a maintainer has replied to', async () => {
    const result = await checkIssue(
      context({ labels: [{ name: 'help wanted' }] }, [{ user: { login: 'maint' }, author_association: 'MEMBER' }]),
    );
    expect(result.status).toBe('pass');
    expect(result.summary).toMatch(/open, unassigned/);
    expect(result.evidence.some((e) => e.text.includes('help wanted'))).toBe(true);
  });

  it('fails when the issue is closed', async () => {
    const result = await checkIssue(context({ state: 'closed' }));
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/closed/);
  });

  it('fails when the issue is assigned to someone', async () => {
    const result = await checkIssue(context({ assignees: [{ login: 'someone' }] }));
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/@someone/);
  });

  it('fails when the issue is locked', async () => {
    const result = await checkIssue(context({ locked: true }));
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/locked/);
  });

  it('warns on a blocking label', async () => {
    const result = await checkIssue(context({ labels: [{ name: 'Needs Discussion' }] }));
    expect(result.status).toBe('warn');
    expect(result.evidence.some((e) => e.text.includes('needs discussion'))).toBe(true);
  });

  it('warns when the issue has been open for more than a year', async () => {
    const result = await checkIssue(context({ created_at: '2023-11-01T00:00:00Z' }));
    expect(result.status).toBe('warn');
    expect(result.evidence.some((e) => /open for \d+ days/.test(e.text))).toBe(true);
  });

  it('warns when nothing has happened for six months', async () => {
    const result = await checkIssue(context({ updated_at: '2026-01-01T00:00:00Z' }));
    expect(result.status).toBe('warn');
    expect(result.evidence.some((e) => /no activity for \d+ days/.test(e.text))).toBe(true);
  });

  it('warns when no maintainer has acknowledged the issue', async () => {
    const result = await checkIssue(context({}, [{ user: { login: 'other' }, author_association: 'NONE' }]));
    expect(result.status).toBe('warn');
    expect(result.evidence.some((e) => /no maintainer/i.test(e.text))).toBe(true);
  });

  it('treats a maintainer-opened issue as acknowledged', async () => {
    const result = await checkIssue(context({ author_association: 'COLLABORATOR' }));
    expect(result.status).toBe('pass');
  });
});
