import { describe, expect, it } from 'vitest';
import { checkCompetingPrs } from '../src/checks/competing-prs.js';
import { referencesIssue } from '../src/reference.js';
import type { CheckContext } from '../src/types.js';
import { stubClient } from './stub-client.js';

const REF = { owner: 'o', repo: 'r', number: 42 };
const NOW = new Date('2026-09-13T12:00:00Z');

describe('referencesIssue', () => {
  it.each([
    'fixes #42',
    'Closes #42.',
    'see https://github.com/o/r/issues/42 for context',
    'https://github.com/o/r/pull/42',
    'title (#42)',
  ])('accepts %s', (text) => {
    expect(referencesIssue(text, REF)).toBe(true);
  });

  it.each([
    'fixes #421',
    'fixes #4',
    'bumps hono, see other/repo#42',
    '<li><a href="https://github.com/honojs/hono/issues/42">#42</a></li>',
    'https://github.com/other/repo/issues/42',
    '',
  ])('rejects %s', (text) => {
    expect(referencesIssue(text, REF)).toBe(false);
  });
});

function context(search: unknown, timeline: unknown, pulls: Record<string, unknown>): CheckContext {
  return {
    ref: REF,
    now: NOW,
    client: stubClient({
      'search-issues-per_page-50-q-repo-o-r-is-pr-42': search,
      'repos-o-r-issues-42-timeline-per_page-100': timeline,
      ...pulls,
    }),
  };
}

function pull(number: number, state: string, mergedAt: string | null): Record<string, unknown> {
  return {
    number,
    title: `pr ${number}`,
    html_url: `https://github.com/o/r/pull/${number}`,
    state,
    draft: false,
    merged_at: mergedAt,
    created_at: '2026-09-01T00:00:00Z',
    user: { login: `author${number}` },
    author_association: 'CONTRIBUTOR',
    body: 'fixes #42',
  };
}

describe('checkCompetingPrs', () => {
  it('passes when nothing references the issue', async () => {
    const result = await checkCompetingPrs(context({ total_count: 0, items: [] }, [], {}));
    expect(result.status).toBe('pass');
    expect(result.summary).toMatch(/No pull request references/);
  });

  it('ignores search hits whose reference points at another repository', async () => {
    const noise = { ...pull(9, 'open', null), body: 'bumps hono, see honojs/hono#42' };
    const result = await checkCompetingPrs(context({ total_count: 1, items: [noise] }, [], {}));
    expect(result.status).toBe('pass');
  });

  it('fails on an open competing pull request and reports its review state', async () => {
    const result = await checkCompetingPrs(
      context({ total_count: 1, items: [pull(11, 'open', null)] }, [], {
        'repos-o-r-pulls-11': pull(11, 'open', null),
        'repos-o-r-pulls-11-reviews-per_page-100': [
          { user: { login: 'maint' }, state: 'APPROVED', submitted_at: '2026-09-02T00:00:00Z' },
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/1 open/);
    expect(result.evidence[0]?.text).toMatch(/#11 open by @author11, approved/);
  });

  it('fails when a merged pull request already references the issue', async () => {
    const result = await checkCompetingPrs(
      context({ total_count: 0, items: [] }, [
        {
          event: 'cross-referenced',
          source: {
            type: 'issue',
            issue: {
              number: 21,
              html_url: 'https://github.com/o/r/pull/21',
              state: 'closed',
              repository: { full_name: 'o/r' },
              pull_request: { merged_at: '2026-09-05T00:00:00Z' },
            },
          },
        },
      ], { 'repos-o-r-pulls-21': pull(21, 'closed', '2026-09-05T00:00:00Z') }),
    );
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/merged/);
  });

  it('warns when only closed, unmerged pull requests reference the issue', async () => {
    const result = await checkCompetingPrs(
      context({ total_count: 1, items: [pull(31, 'closed', null)] }, [], {
        'repos-o-r-pulls-31': pull(31, 'closed', null),
      }),
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toMatch(/1 closed/);
  });

  it('deduplicates a pull request found by both search and timeline', async () => {
    const result = await checkCompetingPrs(
      context({ total_count: 1, items: [pull(11, 'open', null)] }, [
        {
          event: 'cross-referenced',
          source: {
            type: 'issue',
            issue: {
              number: 11,
              html_url: 'https://github.com/o/r/pull/11',
              state: 'open',
              repository: { full_name: 'o/r' },
              pull_request: { merged_at: null },
            },
          },
        },
      ], {
        'repos-o-r-pulls-11': pull(11, 'open', null),
        'repos-o-r-pulls-11-reviews-per_page-100': [],
      }),
    );
    expect(result.evidence).toHaveLength(1);
    expect(result.summary).toMatch(/1 open/);
  });

  it('ignores cross references from other repositories', async () => {
    const result = await checkCompetingPrs(
      context({ total_count: 0, items: [] }, [
        {
          event: 'cross-referenced',
          source: {
            type: 'issue',
            issue: {
              number: 99,
              html_url: 'https://github.com/x/y/pull/99',
              state: 'open',
              repository: { full_name: 'x/y' },
              pull_request: { merged_at: null },
            },
          },
        },
      ], {}),
    );
    expect(result.status).toBe('pass');
  });
});
