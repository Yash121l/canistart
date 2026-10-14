#!/usr/bin/env node
import { GitHubError } from './github.js';
import { main, parseArgs } from './cli.js';
import { VERSION } from './index.js';
import { recordRun } from './telemetry.js';

const argv = process.argv.slice(2);
const started = Date.now();

/** The kind of run, for telemetry. Flags are reported as booleans, never with their values. */
function describeRun(): { command: string; json: boolean; agent: boolean } {
  try {
    const args = parseArgs(argv);
    const command = args.version ? 'version' : args.help || args.target === undefined ? 'help' : 'check';
    return { command, json: args.json, agent: args.agent };
  } catch {
    return { command: 'invalid_args', json: false, agent: false };
  }
}

async function run(): Promise<number> {
  try {
    return await main(argv, process.env);
  } catch (error: unknown) {
    const detail = error instanceof GitHubError ? error.message : (error as Error).message;
    process.stderr.write(`canistart: ${detail}\n`);
    return 3;
  }
}

const code = await run();
process.exitCode = code;
recordRun({ ...describeRun(), version: VERSION, duration_ms: Date.now() - started, exit_code: code });
