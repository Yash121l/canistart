import { describe, expect, it } from 'vitest';
import { parseIssueRef } from '../src/parse.js';

describe('parseIssueRef', () => {
  it.each([
    'https://github.com/meriyah/meriyah/issues/650',
    'http://github.com/meriyah/meriyah/issues/650',
    'github.com/meriyah/meriyah/issues/650',
    'www.github.com/meriyah/meriyah/issues/650',
    'https://github.com/meriyah/meriyah/issues/650#issuecomment-1',
    'https://github.com/meriyah/meriyah/issues/650/',
    'meriyah/meriyah#650',
    '  meriyah/meriyah#650  ',
  ])('parses %s', (input) => {
    expect(parseIssueRef(input)).toEqual({ owner: 'meriyah', repo: 'meriyah', number: 650 });
  });

  it('parses a pull request url as the same reference', () => {
    expect(parseIssueRef('https://github.com/a/b/pull/12')).toEqual({ owner: 'a', repo: 'b', number: 12 });
  });

  it('keeps dots and dashes in repository names', () => {
    expect(parseIssueRef('litestar-org/litestar.io#3')).toEqual({
      owner: 'litestar-org',
      repo: 'litestar.io',
      number: 3,
    });
  });

  it.each([
    '',
    'meriyah/meriyah',
    'meriyah#650',
    'meriyah/meriyah#0',
    'meriyah/meriyah#-1',
    'meriyah/meriyah#abc',
    'https://github.com/meriyah/meriyah',
    'https://gitlab.com/meriyah/meriyah/issues/650',
    'https://github.com/meriyah/meriyah/issues/notanumber',
    'https://github.com/meriyah/meriyah/discussions/650',
  ])('rejects %s', (input) => {
    expect(() => parseIssueRef(input)).toThrow(/issue reference/i);
  });
});
