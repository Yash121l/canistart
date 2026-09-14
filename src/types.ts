import type { GitHubClient } from './github.js';
import type { IssueRef } from './parse.js';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export type CheckId =
  | 'issue'
  | 'competing_prs'
  | 'already_fixed'
  | 'maintainer_signals'
  | 'policy'
  | 'repo_health';

export interface Evidence {
  text: string;
  url: string;
}

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  summary: string;
  evidence: Evidence[];
  blocks_agents: boolean;
}

export type Verdict = 'GO' | 'CAUTION' | 'STOP';

export interface CheckContext {
  client: GitHubClient;
  ref: IssueRef;
  now: Date;
}
