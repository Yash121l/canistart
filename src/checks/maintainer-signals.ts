import type { ApiComment, ApiIssue } from '../api-types.js';
import type { CheckContext, CheckResult, Evidence } from '../types.js';

export type SignalClass = 'wontfix' | 'hold' | 'already_fixed_elsewhere' | 'cannot_reproduce' | 'claimed';

const SIGNAL_RULES: { id: SignalClass; text: string; patterns: RegExp[] }[] = [
  {
    id: 'wontfix',
    text: 'this will not be fixed',
    patterns: [
      /\bwon(?:'|’)?t fix\b/i,
      /\bwontfix\b/i,
      /\bnot planned\b/i,
      /\bout of scope\b/i,
      /\bnot going to\b/i,
    ],
  },
  {
    id: 'hold',
    text: 'hold off',
    patterns: [
      /\bplease hold\b/i,
      /\bon hold\b/i,
      /\bhold off\b/i,
      /\bwait (?:for|until)\b/i,
      /\bnot (?:yet )?accepted\b/i,
      /\bneeds (?:a )?design\b/i,
      /\blet(?:'|’)?s discuss first\b/i,
      /\bwe should discuss\b/i,
    ],
  },
  {
    id: 'already_fixed_elsewhere',
    text: 'fixed elsewhere',
    patterns: [
      /\balready fixed\b/i,
      /\bfixed in v?\d/i,
      /\bfixed (?:in|by) #\d+/i,
      /\bduplicate of #\d+/i,
      /\btry (?:with )?v?\d/i,
      /\btest with v?\d/i,
      /\bplease (?:update|upgrade) to\b/i,
    ],
  },
  {
    id: 'cannot_reproduce',
    text: 'they cannot reproduce it',
    patterns: [
      /\b(?:can(?:'|’)?t|can ?not|could ?n(?:'|’)?t|could not|unable to)\s+reproduce\b/i,
      /\bnot reproducible\b/i,
      /\bworks for me\b/i,
      /\bplease provide (?:a |an )?(?:(?:screen )?recording|repro|reproduction|minimal (?:reproducible )?example)\b/i,
    ],
  },
  {
    id: 'claimed',
    text: 'they are working on it',
    patterns: [
      /\bi(?:'|’)?(?:m| am) working on (?:this|it)\b/i,
      /\bi(?:'|’)?(?:ll| will) take (?:this|it)\b/i,
      /\bi(?:'|’)?(?:d| would) like to work on\b/i,
      /\bassign(?:ed)? (?:this )?to me\b/i,
      /(?:^|\s)\/assign\b/i,
    ],
  },
];

const MAINTAINER_ROLES = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const BLOCKING_SIGNALS = new Set<SignalClass>(['wontfix', 'hold', 'already_fixed_elsewhere']);
const RECENT_DAYS = 60;
const MAX_SENTENCE = 160;

interface Signal {
  id: SignalClass;
  role: 'maintainer' | 'contributor';
  login: string;
  sentence: string;
  url: string;
}

function isBot(comment: ApiComment): boolean {
  return comment.user.type === 'Bot' || comment.user.login.endsWith('[bot]');
}

function sentences(body: string): string[] {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function trim(sentence: string): string {
  return sentence.length > MAX_SENTENCE ? `${sentence.slice(0, MAX_SENTENCE - 1)}…` : sentence;
}

function classify(comment: ApiComment, issueUrl: string): Signal | undefined {
  const role = MAINTAINER_ROLES.has(comment.author_association) ? 'maintainer' : 'contributor';
  for (const rule of SIGNAL_RULES) {
    for (const sentence of sentences(comment.body ?? '')) {
      if (rule.patterns.some((pattern) => pattern.test(sentence))) {
        return { id: rule.id, role, login: comment.user.login, sentence: trim(sentence), url: comment.html_url ?? issueUrl };
      }
    }
  }
  return undefined;
}

function isRecent(comment: ApiComment, now: Date): boolean {
  if (comment.created_at === undefined) return false;
  return now.getTime() - new Date(comment.created_at).getTime() <= RECENT_DAYS * 86_400_000;
}

function phrase(signal: Signal): string {
  const text = SIGNAL_RULES.find((rule) => rule.id === signal.id)?.text ?? signal.id;
  return `${signal.role} said ${text}: "${signal.sentence}"`;
}

function evidenceOf(signals: Signal[]): Evidence[] {
  return signals.map((signal) => ({ text: `@${signal.login} (${signal.role}) ${phrase(signal)}`, url: signal.url }));
}

export async function checkMaintainerSignals({ client, ref, now }: CheckContext): Promise<CheckResult> {
  const path = `repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  const issue = await client.get<ApiIssue>(path);
  const comments = (await client.get<ApiComment[]>(`${path}/comments`, { per_page: 100 })).filter(
    (comment) => !isBot(comment),
  );
  if (comments.length === 0) {
    return {
      id: 'maintainer_signals',
      status: 'skip',
      summary: 'Nobody has commented on this issue.',
      evidence: [],
      blocks_agents: false,
    };
  }

  const signals: Signal[] = [];
  for (const comment of comments) {
    const signal = classify(comment, issue.html_url);
    if (signal === undefined) continue;
    const counts =
      signal.role === 'maintainer' && signal.id !== 'claimed' ? true : isRecent(comment, now);
    if (counts) signals.push(signal);
  }
  const rank = (signal: Signal): number =>
    (signal.role === 'maintainer' ? 0 : SIGNAL_RULES.length) +
    SIGNAL_RULES.findIndex((rule) => rule.id === signal.id);
  const ranked = signals.sort((a, b) => rank(a) - rank(b));
  const blocking = ranked.find((signal) => signal.role === 'maintainer' && BLOCKING_SIGNALS.has(signal.id));
  const loudest = blocking ?? ranked[0];
  if (loudest === undefined) {
    return {
      id: 'maintainer_signals',
      status: 'pass',
      summary: 'Nothing in the comments says to stop.',
      evidence: [],
      blocks_agents: false,
    };
  }

  const evidence = evidenceOf([loudest, ...ranked.filter((signal) => signal !== loudest)]);
  return {
    id: 'maintainer_signals',
    status: blocking ? 'fail' : 'warn',
    summary: phrase(loudest),
    evidence,
    blocks_agents: blocking !== undefined,
  };
}
