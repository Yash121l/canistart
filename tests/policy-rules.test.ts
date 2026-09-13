import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPolicy, sentences } from '../src/policy-rules.js';

function text(name: string): string {
  return readFileSync(`tests/fixtures/policy-texts/${name}`, 'utf8');
}

describe('sentences', () => {
  it('unwraps hard-wrapped prose so a sentence stays whole', () => {
    expect(sentences('**We do not allow autonomous agents to\nbe used** for this.')).toEqual([
      'We do not allow autonomous agents to be used for this.',
    ]);
  });
});

describe('readPolicy', () => {
  it('reads the Astral policy litestar adopted as an autonomous agent ban', () => {
    const reading = readPolicy(text('litestar-AI_POLICY.md'));
    expect(reading.stance).toBe('bans_autonomous_agents');
    expect(reading.stanceSentence).toContain('We do not allow autonomous agents');
  });

  it('reads storybook as requiring disclosure', () => {
    const reading = readPolicy(text('storybook-CONTRIBUTING.md'));
    expect(reading.stance).toBe('requires_disclosure');
    expect(reading.stanceSentence).toContain('please disclose the tool used');
  });

  it('reads docusaurus as requiring disclosure', () => {
    const reading = readPolicy(text('docusaurus-CONTRIBUTING.md'));
    expect(reading.stance).toBe('requires_disclosure');
    expect(reading.stanceSentence).toContain('indicate that in your PR description');
  });

  it('reads TanStack Query as permitting AI with responsibility', () => {
    const reading = readPolicy(text('tanstack-query-CONTRIBUTING.md'));
    expect(reading.stance).toBe('permits_with_responsibility');
    expect(reading.stanceSentence).toContain('you remain responsible');
  });

  it('reads sqlalchemy as permitting AI but auto-closing unsolicited pull requests', () => {
    const reading = readPolicy(text('sqlalchemy-CONTRIBUTING.md'));
    expect(reading.stance).toBe('permits_with_responsibility');
    expect(reading.flags.map((flag) => flag.id)).toContain('auto_close_unsolicited');
    const flag = reading.flags.find((f) => f.id === 'auto_close_unsolicited');
    expect(flag?.sentence).toContain('closed automatically, by a bot');
  });

  it('returns unknown when a document says nothing about AI', () => {
    const reading = readPolicy('Run the tests with `npm test` before opening a pull request.');
    expect(reading.stance).toBe('unknown');
    expect(reading.stanceSentence).toBeUndefined();
  });

  it('does not read an explicit "no need to ask for assignment" as an assignment rule', () => {
    const reading = readPolicy('You do not need to ask for assignment to work on any issue.');
    expect(reading.flags).toEqual([]);
  });

  it('flags a developer certificate of origin', () => {
    const reading = readPolicy('Every commit must carry a Signed-off-by line.');
    expect(reading.flags.map((flag) => flag.id)).toEqual(['dco']);
  });
});
