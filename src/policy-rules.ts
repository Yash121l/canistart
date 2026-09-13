export type AiStance =
  | 'bans_autonomous_agents'
  | 'bans_ai'
  | 'requires_disclosure'
  | 'permits_with_responsibility'
  | 'unknown';

export type PolicyFlagId = 'cla' | 'dco' | 'assignment_first' | 'auto_close_unsolicited';

export interface PolicyFlag {
  id: PolicyFlagId;
  sentence: string;
}

export interface PolicyReading {
  stance: AiStance;
  stanceSentence: string | undefined;
  flags: PolicyFlag[];
}

const AI_TERM = /\b(?:ai|a\.i\.|llms?|large language models?|copilot|chatgpt|codex|claude)\b/i;

const STANCE_RULES: { stance: AiStance; patterns: RegExp[]; needsAiTerm: boolean }[] = [
  {
    stance: 'bans_autonomous_agents',
    needsAiTerm: false,
    patterns: [
      /\b(?:do|does|will|would|can)\s+not\s+(?:allow|permit|accept|want)\b[\s\S]{0,100}?\b(?:autonomous|fully automated)\b/i,
      /\b(?:autonomous|fully automated)\b[\s\S]{0,100}?\b(?:are|is|will be)\s+(?:not\s+(?:allowed|permitted|accepted|welcome)|banned|prohibited|rejected|closed)\b/i,
      /\bcreated autonomously\b/i,
      /\bno autonomous\b/i,
    ],
  },
  {
    stance: 'bans_ai',
    needsAiTerm: false,
    patterns: [
      /\bai[- ]generated\b[\s\S]{0,80}?\b(?:not\s+(?:accepted|allowed|permitted|welcome)|banned|prohibited|rejected)\b/i,
      /\bwe\s+(?:do|will)\s+not\s+accept\b[\s\S]{0,80}?\b(?:ai|llm)\b/i,
      /\bno\s+(?:ai|llm)[- ](?:generated|written|assisted)\b/i,
    ],
  },
  {
    stance: 'requires_disclosure',
    needsAiTerm: true,
    patterns: [
      /\b(?:disclose|disclosed|disclosure|please indicate|indicate that in your|must (?:be )?(?:stated|mentioned|declared))\b/i,
    ],
  },
  {
    stance: 'permits_with_responsibility',
    needsAiTerm: true,
    patterns: [
      /\b(?:you (?:remain|are) responsible|remain responsible|responsible for (?:the|any|every|understanding))\b/i,
      /\b(?:we|the team)\s+(?:support|welcome|welcomes|encourage)\b[\s\S]{0,40}?\bus(?:e|ing)\b/i,
      /\bwelcomes? the use of\b/i,
      /\bmay use\b/i,
      /\bto help\b/i,
    ],
  },
];

const FLAG_RULES: { id: PolicyFlagId; patterns: RegExp[] }[] = [
  {
    id: 'auto_close_unsolicited',
    patterns: [
      /\bclos(?:e|es|ed)\s+automatically\b[\s\S]{0,40}?\bbot\b/i,
      /\bbot\b[\s\S]{0,60}?\bautomatically clos(?:e|es|ed)\b/i,
      /\bunsolicited pull requests?\b[\s\S]{0,80}?\b(?:closed|rejected|ignored)\b/i,
    ],
  },
  {
    id: 'assignment_first',
    patterns: [
      /\b(?:ask|asking|request|requesting|wait|waiting)\b[\s\S]{0,60}?\bassign(?:ed|ment)?\b/i,
      /\bwait for (?:a |an )?(?:maintainer|approval|triage|sign-off)\b/i,
      /\b(?:assigned|claim(?:ed)?)\b[\s\S]{0,40}?\bbefore\b[\s\S]{0,40}?\b(?:start|open|submit|work)/i,
      /\bmust first be proposed as an issue\b/i,
    ],
  },
  { id: 'cla', patterns: [/\bcontributor license agreement\b/i, /\bCLA\b/] },
  { id: 'dco', patterns: [/\bsigned-off-by\b/i, /\bdeveloper certificate of origin\b/i] },
];

const STANCE_ORDER: AiStance[] = [
  'unknown',
  'permits_with_responsibility',
  'requires_disclosure',
  'bans_ai',
  'bans_autonomous_agents',
];

export function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>|]/g, '')
    .replace(/\n(?!\s*\n)/g, ' ')
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length > 0);
}

export function readPolicy(text: string): PolicyReading {
  const lines = sentences(text);
  let stance: AiStance = 'unknown';
  let stanceSentence: string | undefined;
  const flags: PolicyFlag[] = [];
  const seen = new Set<PolicyFlagId>();

  for (const line of lines) {
    for (const rule of STANCE_RULES) {
      const matches =
        (!rule.needsAiTerm || AI_TERM.test(line)) && rule.patterns.some((pattern) => pattern.test(line));
      if (matches && STANCE_ORDER.indexOf(rule.stance) > STANCE_ORDER.indexOf(stance)) {
        stance = rule.stance;
        stanceSentence = line;
      }
    }
    if (/\b(?:do not|don't|dont|no)\s+need to\b/i.test(line)) continue;
    for (const rule of FLAG_RULES) {
      if (!seen.has(rule.id) && rule.patterns.some((pattern) => pattern.test(line))) {
        seen.add(rule.id);
        flags.push({ id: rule.id, sentence: line });
      }
    }
  }
  return { stance, stanceSentence, flags };
}
