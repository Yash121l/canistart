import { describe, expect, it } from 'vitest';
import { checkAlreadyFixed } from '../src/checks/already-fixed.js';
import type { CheckContext } from '../src/types.js';
import { stubClient } from './stub-client.js';

const REF = { owner: 'o', repo: 'r', number: 42 };
const NOW = new Date('2026-09-13T12:00:00Z');

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 't',
    html_url: 'https://github.com/o/r/issues/42',
    state: 'open',
    state_reason: null,
    locked: false,
    assignees: [],
    labels: [],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-10T00:00:00Z',
    user: { login: 'reporter' },
    author_association: 'NONE',
    body: null,
    ...overrides,
  };
}

function context(responses: Record<string, unknown>): CheckContext {
  return {
    ref: REF,
    now: NOW,
    client: stubClient({
      'repos-o-r-issues-42': issue(),
      'repos-o-r-issues-42-comments-per_page-100': [],
      'repos-o-r-issues-42-timeline-per_page-100': [],
      ...responses,
    }),
  };
}

describe('checkAlreadyFixed', () => {
  it('passes when nothing points at a fix', async () => {
    const result = await checkAlreadyFixed(context({}));
    expect(result.status).toBe('pass');
  });

  it('fails when the issue was closed by a commit', async () => {
    const result = await checkAlreadyFixed(
      context({
        'repos-o-r-issues-42': issue({ state: 'closed', state_reason: 'completed' }),
        'repos-o-r-issues-42-timeline-per_page-100': [
          { event: 'closed', commit_id: 'abc1234def', commit_url: 'https://api.github.com/repos/o/r/commits/abc1234def' },
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/closed by commit abc1234/);
  });

  it('fails when the issue is closed as completed without a commit', async () => {
    const result = await checkAlreadyFixed(
      context({ 'repos-o-r-issues-42': issue({ state: 'closed', state_reason: 'completed' }) }),
    );
    expect(result.status).toBe('fail');
  });

  it('warns when a commit in the repository mentions the issue', async () => {
    const result = await checkAlreadyFixed(
      context({
        'repos-o-r-issues-42-timeline-per_page-100': [{ event: 'referenced', commit_id: 'feed0001' }],
        'repos-o-r-commits-feed0001': { sha: 'feed0001', html_url: 'https://github.com/o/r/commit/feed0001' },
      }),
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toMatch(/1 commit/);
  });

  it('ignores referenced commits that are not in the repository', async () => {
    const result = await checkAlreadyFixed(
      context({ 'repos-o-r-issues-42-timeline-per_page-100': [{ event: 'referenced', commit_id: 'deadbeef' }] }),
    );
    expect(result.status).toBe('pass');
  });

  it('warns when the discussion points at a merged pull request', async () => {
    const result = await checkAlreadyFixed(
      context({
        'repos-o-r-issues-42-comments-per_page-100': [
          { user: { login: 'x' }, author_association: 'NONE', body: 'this looks like it was fixed by #99' },
        ],
        'repos-o-r-pulls-99': {
          number: 99,
          title: 'the fix',
          html_url: 'https://github.com/o/r/pull/99',
          state: 'closed',
          merged_at: '2026-09-05T00:00:00Z',
          created_at: '2026-09-01T00:00:00Z',
          user: { login: 'dev' },
          author_association: 'MEMBER',
        },
      }),
    );
    expect(result.status).toBe('warn');
    expect(result.evidence[0]?.text).toMatch(/#99/);
  });

  it('ignores references in the issue body itself', async () => {
    const result = await checkAlreadyFixed(
      context({ 'repos-o-r-issues-42': issue({ body: 'originally posted in #99' }) }),
    );
    expect(result.status).toBe('pass');
  });
});
