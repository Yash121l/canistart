# Changelog

## 0.2.0

- New check `maintainer_signals` reads the issue comments. A maintainer saying the thing
  is fixed elsewhere, on hold, or not planned is now STOP; a maintainer who cannot
  reproduce it, or anyone who claimed the issue in the last sixty days, is CAUTION.
- This changes verdicts. `greghesp/ha-bambulab#2131`, where a collaborator wrote "Can you
  please test with v2.2.26?", moves from CAUTION to STOP.
- Comment fixtures now record the comment date, link and author type.

## 0.1.0

First release.

- `canistart <issue>` prints a GO, CAUTION or STOP verdict with exit codes 0, 1, 2 and 3.
- Checks: issue state and labels, competing pull requests, already-fixed signals,
  contributing and AI policy, repository health.
- `--agent` turns an AI or autonomous-agent ban into STOP and quotes the sentence.
- `--json` for machine-readable output, `canistart` importable as a library.
