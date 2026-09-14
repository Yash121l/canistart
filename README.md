# canistart

[![CI](https://github.com/Yash121l/canistart/actions/workflows/ci.yml/badge.svg)](https://github.com/Yash121l/canistart/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/canistart.svg)](https://www.npmjs.com/package/canistart)

```
npx canistart https://github.com/meriyah/meriyah/issues/650
```

```
STOP  meriyah/meriyah#650  Improve the type def for `Labels`

[ok] issue              Issue is open, unassigned and 3 days old.
[ x] competing_prs      1 open pull request already targets this issue.
     https://github.com/meriyah/meriyah/pull/652
[ok] already_fixed      No commit or merged pull request looks like a fix for this.
[ -] maintainer_signals Nobody has commented on this issue.
[ -] policy             No contributing or AI policy document found.
[ok] repo_health        Repo merges outside work: 100% merge rate, last outside merge 2 days ago.
```

The issue looks open and unclaimed. Somebody opened a pull request for it three days
ago. GitHub does not show that on the issue page unless the author linked it with a
closing keyword.

A clean one looks like this:

```
GO  soran-ghaderi/torchebm#323  BaseScheduler has no __repr__, so scheduled parameters print as bare values

[ok] issue              Issue is open, unassigned and 0 days old.
[ok] competing_prs      No pull request references this issue.
[ok] already_fixed      No commit or merged pull request looks like a fix for this.
[ok] maintainer_signals Nothing in the comments says to stop.
[ok] policy             Contributing docs: says nothing about AI.
[ok] repo_health        Repo merges outside work: 95% merge rate, last outside merge 6 days ago.
```

A comment can settle it on its own:

```
STOP  greghesp/ha-bambulab#2131  [Bug] P1S firmware 01.07.00.00 AMS slots shown as Empty since integration 2.2.23

[ok] issue              Issue is open, unassigned and 0 days old.
[ok] competing_prs      No pull request references this issue.
[ !] already_fixed      May already be fixed: the discussion points at 2 merged pull requests.
     https://github.com/greghesp/ha-bambulab/pull/2105
[ x] maintainer_signals maintainer said fixed elsewhere: "Can you please test with v2.2.26?"
     https://github.com/greghesp/ha-bambulab/issues/2131#issuecomment-5649177608
[ok] policy             Contributing docs: says nothing about AI.
[ok] repo_health        Repo merges outside work: 100% merge rate, last outside merge 1 day ago.
```

## Field test

On 2026-09-13 I ran it over the six newest `help wanted` issues in prettier, the six newest
`good first issue` issues in Apache Airflow, and the one `help wanted` issue in Vitest.
Thirteen of thirteen came back STOP. Every one already had between one and three open pull
requests that the issue page did not show.

## Why

I spent two days picking issues to contribute to. Out of twelve candidates, three were
already fixed on main, two had five or more competing pull requests (one of them already
approved), and one was in an organisation whose AI policy bans autonomous agents. All of
it was visible from the GitHub API in under a minute. Existing tools do this from the
maintainer's side. This does it from the contributor's side, before you write anything.

## What it checks

- **issue.** State, assignees, lock, blocking labels (`needs discussion`, `blocked`,
  `wontfix`, `duplicate`, `question`, `needs design`, `stale`), age, dormancy, whether
  any maintainer has replied.
- **competing_prs.** Pull requests that reference the issue, found through the search
  API and the issue timeline, deduplicated. References to other repositories are
  discarded. Open ones fail, merged ones fail, closed unmerged ones warn.
- **already_fixed.** The closing commit if the issue is closed, commits in the
  repository that mention the issue, and merged pull requests the discussion points at.
- **maintainer_signals.** What the comments say. Each comment is classified by author
  role (`OWNER`, `MEMBER` or `COLLABORATOR` is a maintainer, everyone else is a
  contributor; bots are skipped) and matched against a small set of phrases: cannot
  reproduce, already fixed elsewhere, hold off, claimed, won't fix. A maintainer saying
  it is fixed elsewhere, on hold or not going to happen fails. A maintainer who cannot
  reproduce it warns, as does anyone else carrying one of those signals in the last
  sixty days. The matched sentence and the comment link are quoted.
- **policy.** `CONTRIBUTING.md`, `AI_POLICY.md`, the pull request template and the code
  of conduct, in the repository and in the organisation's `.github` repository. A fixed
  set of patterns, no model calls, classifies the AI stance as `bans_autonomous_agents`,
  `bans_ai`, `requires_disclosure`, `permits_with_responsibility` or `unknown`, and flags
  a CLA, a DCO, an ask-first rule, or a bot that closes unsolicited pull requests. The
  matching sentence is always quoted.
- **repo_health.** Archived, merge rate over the last twenty closed pull requests,
  median time from open to merge, when an outside contributor last had something merged,
  open pull request count.

## Verdicts and exit codes

| verdict | exit | meaning |
| --- | --- | --- |
| GO | 0 | open, unclaimed, no competing work, no policy problem, the repo merges outside pull requests |
| CAUTION | 1 | worth a look first: closed competing attempts, a dormant issue, a maintainer who cannot reproduce it, somebody who recently claimed it, disclosure rules, a slow repo |
| STOP | 2 | closed or already fixed, assigned, an open competing pull request, a maintainer who said it is fixed elsewhere, on hold or not planned, an archived repo, a bot that closes unsolicited pull requests |
| | 3 | canistart itself failed |

`--agent` turns an AI or autonomous-agent ban into STOP instead of CAUTION, and prints
the sentence that caused it:

```
$ canistart litestar-org/litestar#2595 --agent
STOP  litestar-org/litestar#2595  Enhancement: Add recursive relations to PiccoloDTO
...
policy says: AI_POLICY.md: "We do not allow autonomous agents to be used for contributing to our projects."
```

## Using it from an agent

Gate the agent on the exit code before it starts work.

In the script that hands an issue to the agent:

```sh
#!/bin/sh
issue="$1"
npx -y canistart "$issue" --agent --no-color || exit 1
claude -p "Fix $issue"
```

For anything that reads JSON:

```sh
if ! npx -y canistart "$ISSUE" --agent --json > verdict.json; then
  jq -r '.verdict, (.checks[] | select(.status != "pass") | .summary)' verdict.json
  exit 1
fi
```

`--json` gives `{verdict, exit_code, issue, checks, generated_at, canistart_version}`,
where each check is `{id, status, summary, evidence: [{text, url}], blocks_agents}`.

## Options

```
canistart <issue-url | owner/repo#number> [options]

  --agent        you are an autonomous agent: an AI ban becomes STOP
  --json         machine readable output
  --token <t>    GitHub token (else GITHUB_TOKEN, GH_TOKEN, gh auth token)
  --no-color     plain output
  --version      print the version
  --help         print this message
```

Without a token it uses the anonymous limit of sixty requests an hour, which one run can
exhaust. It says so in the output when that happens.

## Library

```ts
import { canistart } from 'canistart';

const result = await canistart('owner/repo#1', { agent: true, token: process.env.GITHUB_TOKEN });
```

Each check is an independent async function that takes a `GitHubClient`, so you can pass
your own transport or recorded fixtures. Node 20 or newer, ESM, no runtime dependencies.

## Development

```sh
pnpm install
pnpm test        # builds, then runs vitest
pnpm typecheck
```

Tests never touch the network. They run against JSON recorded from the real API with
`gh api`, under `tests/fixtures`. Re-record with `node scripts/record-fixtures.mjs` after
`pnpm build`. The policy classifier is tested against the real contributing documents of
litestar, sqlalchemy, Storybook, Docusaurus and TanStack Query.

Publishing runs from `.github/workflows/publish.yml` on a `v*` tag and needs an
`NPM_TOKEN` repository secret.

## Limits

No model calls, so "already fixed" is only as good as what the API states outright: a
closing commit, a referencing commit, a merged pull request somebody linked.
`maintainer_signals` is keyword matching, not understanding: it looks for a short list of
phrases in comment sentences, skipping quoted lines and code blocks. It misses a
maintainer who says the same thing in other words, and it can fire on a sentence that
only looks like one of them. Always read the comment it quotes before acting on the
verdict. GitHub only. It reads; it never comments, assigns or opens anything.

## License

MIT
