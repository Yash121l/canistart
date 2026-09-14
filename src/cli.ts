#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { FixtureGitHubClient } from './fixture-client.js';
import { canistart, VERSION, type CanistartResult } from './index.js';
import type { CheckResult } from './types.js';

const USAGE = `canistart <issue-url | owner/repo#number> [options]

  --agent        you are an autonomous agent: an AI ban becomes STOP
  --json         machine readable output
  --token <t>    GitHub token (else GITHUB_TOKEN, GH_TOKEN, gh auth token)
  --no-color     plain output
  --version      print the version
  --help         print this message

Exit codes: 0 go, 1 caution, 2 stop, 3 error.`;

export interface CliArgs {
  target: string | undefined;
  json: boolean;
  agent: boolean;
  color: boolean;
  token: string | undefined;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    target: undefined,
    json: false,
    agent: false,
    color: true,
    token: undefined,
    help: false,
    version: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--json') args.json = true;
    else if (arg === '--agent') args.agent = true;
    else if (arg === '--no-color') args.color = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--version' || arg === '-v') args.version = true;
    else if (arg === '--token') args.token = argv[++index];
    else if (arg.startsWith('--token=')) args.token = arg.slice('--token='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (args.target === undefined) args.target = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

export function findToken(explicit: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const fromEnv = explicit ?? env['GITHUB_TOKEN'] ?? env['GH_TOKEN'];
  if (fromEnv) return fromEnv;
  try {
    const output = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

const MARKERS: Record<CheckResult['status'], string> = { pass: 'ok', warn: ' !', fail: ' x', skip: ' -' };
const COLORS: Record<string, string> = {
  GO: '\u001b[32m',
  CAUTION: '\u001b[33m',
  STOP: '\u001b[31m',
};

export function render(
  result: CanistartResult,
  options: { color: boolean; agent: boolean; token: boolean },
): string {
  const verdict = options.color ? `${COLORS[result.verdict] ?? ''}${result.verdict}\u001b[0m` : result.verdict;
  const lines = [
    `${verdict}  ${result.issue.owner}/${result.issue.repo}#${result.issue.number}  ${result.issue.title}`,
    '',
  ];
  for (const check of result.checks) {
    lines.push(`[${MARKERS[check.status]}] ${check.id.padEnd(18)} ${check.summary}`);
    if (check.status === 'warn' || check.status === 'fail') {
      const urls = [...new Set(check.evidence.map((evidence) => evidence.url))];
      for (const url of urls.slice(0, 2)) lines.push(`     ${url}`);
    }
  }
  const policy = result.checks.find((check) => check.id === 'policy');
  if (options.agent && policy?.blocks_agents) {
    lines.push('', `policy says: ${policy.evidence[0]?.text ?? policy.summary}`);
  }
  if (!options.token) {
    lines.push('', 'No token found, so this ran on the anonymous limit of 60 requests an hour.');
  }
  return lines.join('\n');
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseArgs(argv);
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (args.help || args.target === undefined) {
    process.stdout.write(`${USAGE}\n`);
    return args.help ? 0 : 3;
  }

  const fixtureDir = env['CANISTART_FIXTURE_DIR'];
  const token = fixtureDir === undefined ? findToken(args.token, env) : undefined;
  const result = await canistart(args.target, {
    agent: args.agent,
    ...(token === undefined ? {} : { token }),
    ...(fixtureDir === undefined ? {} : { client: new FixtureGitHubClient(fixtureDir) }),
    ...(env['CANISTART_NOW'] === undefined ? {} : { now: new Date(env['CANISTART_NOW']) }),
  });

  const color = args.color && env['NO_COLOR'] === undefined && process.stdout.isTTY === true;
  const output = args.json
    ? JSON.stringify(result, null, 2)
    : render(result, {
        color,
        agent: args.agent,
        token: token !== undefined || fixtureDir !== undefined,
      });
  process.stdout.write(`${output}\n`);
  return result.exit_code;
}
