export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

const NAME = String.raw`[A-Za-z0-9._-]+`;
const URL_FORM = new RegExp(
  String.raw`^(?:https?://)?(?:www\.)?github\.com/(${NAME})/(${NAME})/(?:issues|pull)/(\d+)(?:[/#?].*)?$`,
);
const SHORT_FORM = new RegExp(String.raw`^(${NAME})/(${NAME})#(\d+)$`);

export function parseIssueRef(input: string): IssueRef {
  const text = input.trim();
  const match = URL_FORM.exec(text) ?? SHORT_FORM.exec(text);
  const number = match ? Number(match[3]) : 0;
  if (!match || !match[1] || !match[2] || number < 1) {
    throw new Error(
      `Not a GitHub issue reference: "${input}". Use https://github.com/owner/repo/issues/123 or owner/repo#123.`,
    );
  }
  return { owner: match[1], repo: match[2], number };
}
