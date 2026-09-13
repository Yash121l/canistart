import { describe, expect, it } from 'vitest';
import { canistart } from '../src/index.js';
import { decide } from '../src/decide.js';
import { FixtureGitHubClient } from '../src/fixture-client.js';
import type { CheckResult } from '../src/types.js';

const NOW = new Date('2026-09-13T12:00:00Z');

function check(status: CheckResult['status'], blocks_agents = false): CheckResult {
  return { id: 'policy', status, summary: '', evidence: [], blocks_agents };
}

describe('decide', () => {
  it('is GO when every check passes or is skipped', () => {
    expect(decide([check('pass'), check('skip')], { agent: false })).toEqual({ verdict: 'GO', exit_code: 0 });
  });

  it('is CAUTION on a warning', () => {
    expect(decide([check('pass'), check('warn')], { agent: false })).toEqual({ verdict: 'CAUTION', exit_code: 1 });
  });

  it('is STOP on a failure', () => {
    expect(decide([check('warn'), check('fail')], { agent: false })).toEqual({ verdict: 'STOP', exit_code: 2 });
  });

  it('turns an agent-blocking warning into STOP only with --agent', () => {
    const checks = [check('warn', true)];
    expect(decide(checks, { agent: false }).verdict).toBe('CAUTION');
    expect(decide(checks, { agent: true }).verdict).toBe('STOP');
  });
});

async function verdict(target: string, agent = false): Promise<string> {
  const [slug, number] = target.split('#');
  const dir = `tests/fixtures/${(slug as string).replace('/', '-')}-${number}`;
  const result = await canistart(target, { client: new FixtureGitHubClient(dir), now: NOW, agent });
  return result.verdict;
}

describe('recorded issues', () => {
  it('goes on soran-ghaderi/torchebm#323, a fresh issue nobody has claimed', async () => {
    await expect(verdict('soran-ghaderi/torchebm#323')).resolves.toBe('GO');
  });

  it('stops on cline/cline#4932, which has five open competing pull requests', async () => {
    await expect(verdict('cline/cline#4932')).resolves.toBe('STOP');
  });

  it('stops on meriyah/meriyah#650, which picked up an open pull request', async () => {
    await expect(verdict('meriyah/meriyah#650')).resolves.toBe('STOP');
  });

  it('stops on sqlalchemy/sqlalchemy#13583, where a bot closes unsolicited pull requests', async () => {
    await expect(verdict('sqlalchemy/sqlalchemy#13583')).resolves.toBe('STOP');
  });

  it('cautions on greghesp/ha-bambulab#2131, where the thread points at a merged fix', async () => {
    await expect(verdict('greghesp/ha-bambulab#2131')).resolves.toBe('CAUTION');
  });

  it('cautions on python-jsonschema/jsonschema#1218, open for over two years', async () => {
    await expect(verdict('python-jsonschema/jsonschema#1218')).resolves.toBe('CAUTION');
  });

  it('cautions on litestar-org/litestar#2595 but stops an agent, because the org bans them', async () => {
    await expect(verdict('litestar-org/litestar#2595')).resolves.toBe('CAUTION');
    await expect(verdict('litestar-org/litestar#2595', true)).resolves.toBe('STOP');
  });

  it('reports the policy sentence that blocks agents', async () => {
    const result = await canistart('litestar-org/litestar#2595', {
      client: new FixtureGitHubClient('tests/fixtures/litestar-org-litestar-2595'),
      now: NOW,
      agent: true,
    });
    const policy = result.checks.find((c) => c.id === 'policy');
    expect(policy?.blocks_agents).toBe(true);
    expect(policy?.evidence[0]?.text).toContain('We do not allow autonomous agents');
    expect(policy?.evidence[0]?.url).toBe('https://github.com/litestar-org/.github/blob/main/AI_POLICY.md');
  });
});
