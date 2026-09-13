import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPolicy, decodeContent } from '../src/checks/policy.js';
import type { CheckContext } from '../src/types.js';
import { stubClient } from './stub-client.js';

const REF = { owner: 'o', repo: 'r', number: 1 };
const NOW = new Date('2026-09-13T12:00:00Z');

function file(path: string, name: string): Record<string, unknown> {
  return {
    path,
    html_url: `https://github.com/o/r/blob/main/${path}`,
    content: readFileSync(`tests/fixtures/policy-texts/${name}`, 'utf8'),
    encoding: 'utf-8',
  };
}

function context(responses: Record<string, unknown>): CheckContext {
  return { ref: REF, now: NOW, client: stubClient(responses) };
}

describe('decodeContent', () => {
  it('decodes base64 payloads from the contents api', () => {
    expect(decodeContent({ path: 'a', html_url: '', content: 'aGVsbG8=', encoding: 'base64' })).toBe('hello');
  });
});

describe('checkPolicy', () => {
  it('skips when the project has no contributing documents', async () => {
    const result = await checkPolicy(context({}));
    expect(result.status).toBe('skip');
    expect(result.blocks_agents).toBe(false);
  });

  it('warns and blocks agents when the org policy bans autonomous agents', async () => {
    const result = await checkPolicy(
      context({ 'repos-o-github-contents-AI_POLICY-md': file('AI_POLICY.md', 'litestar-AI_POLICY.md') }),
    );
    expect(result.status).toBe('warn');
    expect(result.blocks_agents).toBe(true);
    expect(result.summary).toMatch(/bans autonomous agents/);
    expect(result.evidence[0]?.text).toContain('We do not allow autonomous agents');
  });

  it('fails when a bot closes unsolicited pull requests', async () => {
    const result = await checkPolicy(
      context({
        'repos-o-r-contents-github-CONTRIBUTING-md': file('.github/CONTRIBUTING.md', 'sqlalchemy-CONTRIBUTING.md'),
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/unsolicited pull requests are closed automatically/);
  });

  it('warns when disclosure is required', async () => {
    const result = await checkPolicy(
      context({ 'repos-o-r-contents-CONTRIBUTING-md': file('CONTRIBUTING.md', 'docusaurus-CONTRIBUTING.md') }),
    );
    expect(result.status).toBe('warn');
    expect(result.blocks_agents).toBe(false);
    expect(result.summary).toMatch(/requires you to disclose AI use/);
  });

  it('flags a CLA workflow', async () => {
    const result = await checkPolicy(
      context({
        'repos-o-r-actions-workflows-per_page-100': {
          workflows: [{ name: 'CLA Assistant', path: '.github/workflows/cla.yml', html_url: 'https://github.com/o/r/actions' }],
        },
      }),
    );
    expect(result.evidence.some((e) => e.text.includes('CLA Assistant'))).toBe(true);
  });
});
