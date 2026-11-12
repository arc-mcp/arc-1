import { expect, it } from 'vitest';
import { spliceContent } from '../../../src/context/content-splice.js';

it.each([
  ['before\r\nold\r\nline\r\nafter', 'old\nline', 'new\nline', 'before\r\nnew\r\nline\r\nafter'],
  ['before old after', 'old', '', 'before  after'],
  ['before old after', 'old', ' ', 'before   after'],
  ['prefix\nold\r\nsuffix', 'old', 'new', 'prefix\nnew\r\nsuffix'],
])('replaces one match while preserving surrounding bytes', (source, oldContent, newContent, newSource) => {
  expect(spliceContent(source, oldContent, newContent)).toEqual({ success: true, newSource });
});
it.each([
  ['aaaa', 'aa', 'b', 'ambiguous'],
  ['old old', 'old', 'new', 'ambiguous'],
  ['Old', 'old', 'new', 'not found'],
  ['before', '', 'x', 'empty'],
  ['old', 'old', 'old', 'no source change'],
  ['old\r\nline', 'old\nline', 'old\r\nline', 'no source change'],
])('refuses an unsafe or ineffective replacement', (source, oldContent, newContent, error) => {
  expect(spliceContent(source, oldContent, newContent)).toEqual({
    success: false,
    error: expect.stringContaining(error),
  });
});
