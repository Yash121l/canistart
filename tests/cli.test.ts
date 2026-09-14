import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli.js';

const run = promisify(execFile);
const BIN = 'dist/bin.js';

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function cli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run('node', [BIN, ...args], { env: { ...process.env, ...env } });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return { stdout: failure.stdout, stderr: failure.stderr, code: failure.code };
  }
}

describe('parseArgs', () => {
  it('reads the target and flags', () => {
    const args = parseArgs(['o/r#1', '--json', '--agent', '--no-color', '--token', 'abc']);
    expect(args).toEqual({
      target: 'o/r#1',
      json: true,
      agent: true,
      color: false,
      token: 'abc',
      help: false,
      version: false,
    });
  });

  it('reads --token=value', () => {
    expect(parseArgs(['--token=abc']).token).toBe('abc');
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
  });
});

describe('canistart binary', () => {
  beforeAll(() => {
    if (!existsSync(BIN)) throw new Error('run `pnpm build` before the CLI tests');
  });

  it('prints usage and exits 3 without a target', async () => {
    const result = await cli([]);
    expect(result.code).toBe(3);
    expect(result.stdout).toMatch(/canistart <issue-url/);
  });

  it('exits 3 on an unparseable target', async () => {
    const result = await cli(['not-an-issue']);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/Not a GitHub issue reference/);
  });

  it('reports a stop verdict with exit code 2', async () => {
    const result = await cli(['cline/cline#4932'], {
      CANISTART_FIXTURE_DIR: 'tests/fixtures/cline-cline-4932',
      CANISTART_NOW: '2026-09-13T12:00:00Z',
    });
    expect(result.code).toBe(2);
    expect(result.stdout.split('\n')[0]).toBe(
      'STOP  cline/cline#4932  [Accessibility] Screen reader users can\'t determine if they are in plan or act mode',
    );
    expect(result.stdout).toMatch(/\[ x\] competing_prs {6}5 open pull requests already target this issue\./);
    expect(result.stdout.split('\n').length).toBeLessThan(30);
  });

  it('escalates an AI policy ban to stop under --agent and quotes the policy', async () => {
    const env = {
      CANISTART_FIXTURE_DIR: 'tests/fixtures/litestar-org-litestar-2595',
      CANISTART_NOW: '2026-09-13T12:00:00Z',
    };
    const plain = await cli(['litestar-org/litestar#2595'], env);
    expect(plain.code).toBe(1);
    expect(plain.stdout).toMatch(/^CAUTION/);

    const agent = await cli(['litestar-org/litestar#2595', '--agent'], env);
    expect(agent.code).toBe(2);
    expect(agent.stdout).toMatch(/policy says: AI_POLICY.md: "We do not allow autonomous agents/);
  });

  it('emits json with --json', async () => {
    const result = await cli(['greghesp/ha-bambulab#2131', '--json'], {
      CANISTART_FIXTURE_DIR: 'tests/fixtures/greghesp-ha-bambulab-2131',
      CANISTART_NOW: '2026-09-13T12:00:00Z',
    });
    expect(result.code).toBe(2);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed['verdict']).toBe('STOP');
    expect(parsed['exit_code']).toBe(2);
    expect(parsed['generated_at']).toBe('2026-09-13T12:00:00.000Z');
    expect(parsed['canistart_version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed['issue']).toMatchObject({ owner: 'greghesp', repo: 'ha-bambulab', number: 2131 });
    expect((parsed['checks'] as unknown[]).map((c) => (c as { id: string }).id)).toEqual([
      'issue',
      'competing_prs',
      'already_fixed',
      'maintainer_signals',
      'policy',
      'repo_health',
    ]);
  });

  it('exits 0 on a go verdict', async () => {
    const result = await cli(['soran-ghaderi/torchebm#323', '--no-color'], {
      CANISTART_FIXTURE_DIR: 'tests/fixtures/soran-ghaderi-torchebm-323',
      CANISTART_NOW: '2026-09-13T12:00:00Z',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^GO {2}soran-ghaderi\/torchebm#323 {2}BaseScheduler/);
    expect(result.stdout).not.toMatch(/\[ x\]|\[ !\]/);
  });

  it('prints the version', async () => {
    const result = await cli(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
