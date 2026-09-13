import { describe, expect, it } from 'vitest';
import { checkRepoHealth } from '../src/checks/repo-health.js';
import type { CheckContext } from '../src/types.js';
import { stubClient } from './stub-client.js';

const REF = { owner: 'o', repo: 'r', number: 1 };
const NOW = new Date('2026-09-13T12:00:00Z');

function pull(
  number: number,
  mergedAt: string | null,
  association = 'CONTRIBUTOR',
  login = `dev${number}`,
): Record<string, unknown> {
  return {
    number,
    title: `pr ${number}`,
    html_url: `https://github.com/o/r/pull/${number}`,
    state: 'closed',
    merged_at: mergedAt,
    created_at: '2026-09-01T00:00:00Z',
    closed_at: mergedAt ?? '2026-09-02T00:00:00Z',
    user: { login },
    author_association: association,
  };
}

function context(repo: Record<string, unknown>, closed: unknown[]): CheckContext {
  return {
    ref: REF,
    now: NOW,
    client: stubClient({
      'repos-o-r': {
        full_name: 'o/r',
        html_url: 'https://github.com/o/r',
        archived: false,
        pushed_at: '2026-09-12T00:00:00Z',
        open_issues_count: 5,
        default_branch: 'main',
        ...repo,
      },
      'repos-o-r-pulls-direction-desc-per_page-20-sort-updated-state-closed': closed,
      'search-issues-per_page-1-q-repo-o-r-is-pr-is-open': { total_count: 3, items: [] },
    }),
  };
}

describe('checkRepoHealth', () => {
  it('fails on an archived repository', async () => {
    const result = await checkRepoHealth(context({ archived: true }, []));
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/archived/);
  });

  it('passes when recent outside work gets merged', async () => {
    const result = await checkRepoHealth(
      context({}, [pull(1, '2026-09-10T00:00:00Z'), pull(2, '2026-09-05T00:00:00Z')]),
    );
    expect(result.status).toBe('pass');
    expect(result.summary).toMatch(/100% merge rate/);
    expect(result.evidence[1]?.text).toMatch(/median \d+h/);
    expect(result.evidence[3]?.text).toBe('3 open pull requests');
  });

  it('warns when most recent pull requests were closed unmerged', async () => {
    const result = await checkRepoHealth(
      context({}, [pull(1, '2026-09-10T00:00:00Z'), pull(2, null), pull(3, null), pull(4, null)]),
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toMatch(/only 25%/);
  });

  it('warns when only insiders and bots have had work merged', async () => {
    const result = await checkRepoHealth(
      context({}, [
        pull(1, '2026-09-10T00:00:00Z', 'MEMBER', 'maintainer'),
        pull(2, '2026-09-09T00:00:00Z', 'CONTRIBUTOR', 'renovate[bot]'),
      ]),
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toMatch(/no outside contribution merged/);
  });

  it('warns when the last outside merge is older than a month', async () => {
    const result = await checkRepoHealth(context({}, [pull(1, '2026-06-01T00:00:00Z')]));
    expect(result.status).toBe('warn');
  });
});
