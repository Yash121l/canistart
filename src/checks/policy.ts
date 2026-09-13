import type { ApiContent, ApiWorkflowList } from '../api-types.js';
import { readPolicy, type AiStance, type PolicyFlag, type PolicyFlagId } from '../policy-rules.js';
import type { CheckContext, CheckResult, Evidence } from '../types.js';

const POLICY_PATHS = [
  'CONTRIBUTING.md',
  '.github/CONTRIBUTING.md',
  'docs/CONTRIBUTING.md',
  'AI_POLICY.md',
  '.github/AI_POLICY.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'CODE_OF_CONDUCT.md',
];

const STANCE_TEXT: Record<AiStance, string> = {
  bans_autonomous_agents: 'bans autonomous agents',
  bans_ai: 'does not accept AI-generated contributions',
  requires_disclosure: 'requires you to disclose AI use',
  permits_with_responsibility: 'allows AI use if you take responsibility',
  unknown: 'says nothing about AI',
};

const FLAG_TEXT: Record<PolicyFlagId, string> = {
  cla: 'a contributor license agreement is required',
  dco: 'commits must be signed off (DCO)',
  assignment_first: 'ask before starting',
  auto_close_unsolicited: 'unsolicited pull requests are closed automatically',
};

const STANCE_ORDER: AiStance[] = [
  'unknown',
  'permits_with_responsibility',
  'requires_disclosure',
  'bans_ai',
  'bans_autonomous_agents',
];

export function decodeContent(file: ApiContent): string {
  return file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content;
}

async function loadFiles(ctx: CheckContext): Promise<ApiContent[]> {
  const repos = [`${ctx.ref.owner}/${ctx.ref.repo}`, `${ctx.ref.owner}/.github`];
  const requests = repos.flatMap((repo) =>
    POLICY_PATHS.map((path) =>
      ctx.client.get<ApiContent>(`repos/${repo}/contents/${path}`).catch(() => undefined),
    ),
  );
  return (await Promise.all(requests)).filter((file): file is ApiContent => file !== undefined);
}

async function workflowFlags(ctx: CheckContext): Promise<Evidence[]> {
  const list = await ctx.client
    .get<ApiWorkflowList>(`repos/${ctx.ref.owner}/${ctx.ref.repo}/actions/workflows`, { per_page: 100 })
    .catch(() => ({ workflows: [] }) satisfies ApiWorkflowList);
  return list.workflows
    .filter((workflow) => /\b(cla|dco)\b/i.test(`${workflow.name} ${workflow.path}`))
    .map((workflow) => ({ text: `workflow "${workflow.name}" gates pull requests`, url: workflow.html_url }));
}

export async function checkPolicy(ctx: CheckContext): Promise<CheckResult> {
  const files = await loadFiles(ctx);
  let stance: AiStance = 'unknown';
  const evidence: Evidence[] = [];
  const flags = new Map<PolicyFlagId, PolicyFlag>();

  for (const file of files) {
    const reading = readPolicy(decodeContent(file));
    if (STANCE_ORDER.indexOf(reading.stance) > STANCE_ORDER.indexOf(stance)) {
      stance = reading.stance;
      evidence.unshift({ text: `${file.path}: "${reading.stanceSentence ?? ''}"`, url: file.html_url });
    }
    for (const flag of reading.flags) {
      if (!flags.has(flag.id)) {
        flags.set(flag.id, flag);
        evidence.push({ text: `${file.path}: "${flag.sentence}"`, url: file.html_url });
      }
    }
  }
  evidence.push(...(await workflowFlags(ctx)));

  const notes = [...flags.keys()].map((id) => FLAG_TEXT[id]);
  const summary = [`Contributing docs: ${STANCE_TEXT[stance]}`, ...notes].join('; ') + '.';
  const banned = stance === 'bans_autonomous_agents' || stance === 'bans_ai';

  if (flags.has('auto_close_unsolicited')) {
    return { id: 'policy', status: 'fail', summary, evidence, blocks_agents: banned };
  }
  if (banned || notes.length > 0 || stance === 'requires_disclosure') {
    return { id: 'policy', status: 'warn', summary, evidence, blocks_agents: banned };
  }
  if (files.length === 0) {
    return {
      id: 'policy',
      status: 'skip',
      summary: 'No contributing or AI policy document found.',
      evidence,
      blocks_agents: false,
    };
  }
  return { id: 'policy', status: 'pass', summary, evidence, blocks_agents: false };
}
