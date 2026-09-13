import type { CheckResult, Verdict } from './types.js';

export interface Decision {
  verdict: Verdict;
  exit_code: number;
}

export function decide(checks: CheckResult[], options: { agent: boolean }): Decision {
  const blocked = checks.some(
    (check) => check.status === 'fail' || (options.agent && check.blocks_agents),
  );
  if (blocked) return { verdict: 'STOP', exit_code: 2 };
  if (checks.some((check) => check.status === 'warn')) return { verdict: 'CAUTION', exit_code: 1 };
  return { verdict: 'GO', exit_code: 0 };
}
