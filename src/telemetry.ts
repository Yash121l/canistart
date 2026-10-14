import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Anonymous usage telemetry. One event per run: which command ran, how long it took and
// how it exited. Never argument values, issue URLs, repository names, tokens or output.
// Opt out with DO_NOT_TRACK=1 or CANISTART_TELEMETRY=0. Off in CI and under tests.

// Public client key for the maintainer's PostHog project. It can only write events.
const POSTHOG_KEY = 'phc_oLm8fb7L4CXDqGdJcc7a6boCtR8rVjf6dNx7G995eGdy';
const ENDPOINT = 'https://us.i.posthog.com/i/v0/e/';
const TIMEOUT_MS = 8000;

// Runs in a detached child process so the CLI exits without waiting on the network.
const SENDER = `fetch(${JSON.stringify(ENDPOINT)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: process.env.CANISTART_TELEMETRY_PAYLOAD, signal: AbortSignal.timeout(${TIMEOUT_MS}) }).catch(() => {})`;

const NOTICE = `canistart collects anonymous usage data (command, version, OS, duration, exit code)
to see how it is used. It never sends issue URLs, repository names, tokens or results.
Turn it off with CANISTART_TELEMETRY=0 or DO_NOT_TRACK=1. This notice is shown once.
`;

interface State {
  installId: string;
  noticeShown: boolean;
}

export interface RunEvent {
  command: string;
  version: string;
  duration_ms: number;
  exit_code: number;
  [extra: string]: string | number | boolean | null;
}

const isOff = (value: string | undefined): boolean =>
  value !== undefined && ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
const isOn = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && !isOff(value);

export function telemetryEnabled(env: NodeJS.ProcessEnv): boolean {
  if (isOn(env['DO_NOT_TRACK'])) return false;
  if (isOff(env['CANISTART_TELEMETRY'])) return false;
  if (isOn(env['CI']) || env['VITEST'] !== undefined || env['NODE_ENV'] === 'test') return false;
  return true;
}

export function configDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === 'win32' && env['APPDATA']) return join(env['APPDATA'], 'canistart');
  return join(env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'canistart');
}

function loadState(dir: string): State | null {
  const file = join(dir, 'telemetry.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<State>;
    if (typeof parsed.installId === 'string' && parsed.installId) {
      return { installId: parsed.installId, noticeShown: parsed.noticeShown === true };
    }
  } catch {
    // first run, or unreadable: start fresh below
  }
  const state: State = { installId: randomUUID(), noticeShown: false };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    return null; // can't persist an id, so don't send anything
  }
  return state;
}

function markNoticeShown(dir: string, state: State): void {
  try {
    writeFileSync(join(dir, 'telemetry.json'), `${JSON.stringify({ ...state, noticeShown: true }, null, 2)}\n`);
  } catch {
    // ignore
  }
}

/** Sends one cli_command_run event from a detached process. Never throws and never blocks exit. */
export function recordRun(event: RunEvent, env: NodeJS.ProcessEnv = process.env): void {
  try {
    if (!telemetryEnabled(env)) return;
    const dir = configDir(env);
    const state = loadState(dir);
    if (state === null) return;
    if (!state.noticeShown) {
      process.stderr.write(`\n${NOTICE}`);
      markNoticeShown(dir, state);
    }
    const payload = JSON.stringify({
      api_key: POSTHOG_KEY,
      event: 'cli_command_run',
      distinct_id: state.installId,
      properties: {
        app: 'canistart',
        ...event,
        os: process.platform,
        arch: process.arch,
        node_version: process.versions.node,
        $process_person_profile: false,
      },
    });
    const child = spawn(process.execPath, ['-e', SENDER], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { PATH: env['PATH'] ?? '', CANISTART_TELEMETRY_PAYLOAD: payload },
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // telemetry must never affect the CLI
  }
}
