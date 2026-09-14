import { describe, expect, it } from 'vitest';
import { checkMaintainerSignals } from '../src/checks/maintainer-signals.js';
import type { CheckContext } from '../src/types.js';
import { stubClient } from './stub-client.js';

const NOW = new Date('2026-09-13T12:00:00Z');
const REF = { owner: 'o', repo: 'r', number: 7 };

interface Comment {
  login?: string;
  role?: string;
  body: string;
  created_at?: string;
  type?: string;
}

function comment({ login = 'someone', role = 'NONE', body, created_at = '2026-09-10T00:00:00Z', type }: Comment) {
  return {
    user: { login, ...(type === undefined ? {} : { type }) },
    author_association: role,
    body,
    created_at,
    html_url: `https://github.com/o/r/issues/7#issuecomment-1`,
  };
}

function context(comments: unknown[]): CheckContext {
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
      },
      'repos-o-r-issues-7-comments-per_page-100': comments,
    }),
  };
}

function maintainer(body: string, created_at?: string) {
  return comment({ login: 'maint', role: 'COLLABORATOR', body, ...(created_at ? { created_at } : {}) });
}

describe('checkMaintainerSignals', () => {
  it('skips when nobody has commented', async () => {
    const result = await checkMaintainerSignals(context([]));
    expect(result.status).toBe('skip');
  });

  it('passes when the comments carry no signal', async () => {
    const result = await checkMaintainerSignals(context([maintainer('Thanks for the report, taking a look.')]));
    expect(result.status).toBe('pass');
  });

  it('fails when a maintainer points at a fix elsewhere', async () => {
    const result = await checkMaintainerSignals(context([maintainer('Can you please test with v2.2.26?')]));
    expect(result.status).toBe('fail');
    expect(result.blocks_agents).toBe(true);
    expect(result.summary).toBe('maintainer said fixed elsewhere: "Can you please test with v2.2.26?"');
    expect(result.evidence[0]?.url).toBe('https://github.com/o/r/issues/7#issuecomment-1');
  });

  it('fails on the other already-fixed wordings', async () => {
    for (const body of [
      'This is already fixed on main.',
      'Fixed in v4.2.0.',
      'fixed by #22722',
      'Duplicate of #120.',
      'Please update to 3.1 and tell me if it persists.',
    ]) {
      const result = await checkMaintainerSignals(context([maintainer(body)]));
      expect(result.status, body).toBe('fail');
    }
  });

  it('fails when a maintainer asks you to hold', async () => {
    const result = await checkMaintainerSignals(context([maintainer('please hold a while')]));
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/maintainer said hold off/);
  });

  it('fails on the other hold wordings', async () => {
    for (const body of [
      'This is on hold until the redesign lands.',
      'Please wait for the RFC to land.',
      'This is not yet accepted.',
      'It needs a design first.',
      "Let's discuss first before anyone opens a pull request.",
    ]) {
      expect((await checkMaintainerSignals(context([maintainer(body)]))).status, body).toBe('fail');
    }
  });

  it('fails when a maintainer says it will not be fixed', async () => {
    for (const body of [
      "We won't fix this.",
      'wontfix',
      'Closing, not planned.',
      'That is out of scope for this project.',
      'We are not going to support that.',
    ]) {
      const result = await checkMaintainerSignals(context([maintainer(body)]));
      expect(result.status, body).toBe('fail');
      expect(result.summary).toMatch(/maintainer said this will not be fixed/);
    }
  });

  it('warns when a maintainer cannot reproduce it', async () => {
    const result = await checkMaintainerSignals(
      context([maintainer("Please provide a screen recording, I can't reproduce this problem")]),
    );
    expect(result.status).toBe('warn');
    expect(result.blocks_agents).toBe(false);
    expect(result.summary).toMatch(/maintainer said they cannot reproduce it/);
  });

  it('warns on the other cannot-reproduce wordings', async () => {
    for (const body of [
      'I cannot reproduce this on main.',
      'I could not reproduce it with your steps.',
      'Unable to reproduce.',
      'This is not reproducible here.',
      'Works for me on 2.1.',
      'Please provide a minimal example.',
    ]) {
      expect((await checkMaintainerSignals(context([maintainer(body)]))).status, body).toBe('warn');
    }
  });

  it('warns when somebody recently claimed the issue', async () => {
    for (const body of [
      "I'm working on this.",
      'I will take this.',
      "I'd like to work on this one.",
      'Please assign this to me.',
      '/assign',
    ]) {
      const result = await checkMaintainerSignals(context([comment({ login: 'dev', body })]));
      expect(result.status, body).toBe('warn');
      expect(result.summary, body).toMatch(/contributor said they are working on it/);
    }
  });

  it('ignores a claim older than sixty days', async () => {
    const result = await checkMaintainerSignals(
      context([comment({ login: 'dev', body: "I'm working on this.", created_at: '2026-01-01T00:00:00Z' })]),
    );
    expect(result.status).toBe('pass');
  });

  it('warns when a contributor reports it is already fixed', async () => {
    const result = await checkMaintainerSignals(
      context([comment({ login: 'dev', body: 'This was fixed by #22722, which is merged.' })]),
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toMatch(/contributor said fixed elsewhere/);
  });

  it('skips bot comments', async () => {
    const result = await checkMaintainerSignals(
      context([comment({ login: 'stale[bot]', role: 'NONE', type: 'Bot', body: 'This is out of scope, closing.' })]),
    );
    expect(result.status).toBe('skip');
  });

  it('ignores quoted issue text', async () => {
    const result = await checkMaintainerSignals(
      context([maintainer('> I cannot reproduce this on my machine\n\nThanks, I will look into it.')]),
    );
    expect(result.status).toBe('pass');
  });

  it('reports the strongest signal first and keeps every match as evidence', async () => {
    const result = await checkMaintainerSignals(
      context([
        comment({ login: 'dev', body: "I'm working on this." }),
        maintainer('We are not going to support that.'),
      ]),
    );
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/^maintainer said this will not be fixed/);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]?.text).toMatch(/@maint \(maintainer\)/);
    expect(result.evidence[1]?.text).toMatch(/@dev \(contributor\)/);
  });

  it('trims a long sentence in the evidence', async () => {
    const result = await checkMaintainerSignals(context([maintainer(`${'x'.repeat(400)} already fixed`)]));
    expect(result.evidence[0]?.text.length).toBeLessThan(220);
  });
});
