import type { IssueRef } from './parse.js';

const HTML_ANCHOR = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
const CROSS_REPO_SHORT = /[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+/g;
const ISSUE_URL = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/(?:issues|pull)\/(\d+)/g;

export function referencesIssue(text: string | null | undefined, ref: IssueRef): boolean {
  if (!text) return false;
  let found = false;
  const stripped = text
    .replace(HTML_ANCHOR, ' ')
    .replace(ISSUE_URL, (_match, owner: string, repo: string, number: string) => {
      found ||= owner === ref.owner && repo === ref.repo && Number(number) === ref.number;
      return ' ';
    })
    .replace(CROSS_REPO_SHORT, ' ');
  return found || new RegExp(String.raw`(?:^|[^\w/#])#${ref.number}(?!\d)`).test(stripped);
}
