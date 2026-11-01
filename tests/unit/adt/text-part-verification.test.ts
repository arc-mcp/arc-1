import { expect, it } from 'vitest';
import { textPartMatchesRequest } from '../../../src/adt/text-part-changes.js';

it('accepts native key padding, case, CRLF and trailing value padding', () => {
  expect(textPartMatchesRequest('selections', 'p_key=Key', 'P_KEY   =Key  \r\n')).toBe(true);
});
it('requires dictionary references to survive while allowing SAP to resolve labels', () => {
  expect(
    textPartMatchesRequest(
      'selections',
      '@DDICReference\nP_KEY=Requested label',
      '@DDICReference\r\nP_KEY   =Dictionary label',
    ),
  ).toBe(true);
  expect(textPartMatchesRequest('selections', '@DDICReference\nP_KEY=', 'P_KEY=Dictionary label')).toBe(false);
});
it.each([
  ['001=New', '001=Old'],
  ['001=New\n002=Second', '001=New'],
  ['001=New', '001=New\n002=Extra'],
  ['', '001=Still present'],
  ['001= leading', '001=leading'],
  ['001=One\n001=Two', '001=Two'],
  ['not an entry', ''],
  ['@MaxLength:20\n001=Text', '@MaxLength:10\n001=Text'],
  ['@MaxLength:20', ''],
  ['@Unknown:yes\n001=Text', '001=Text'],
  ['@MaxLength:999999999999999999999999\n001=Text', '@MaxLength:999999999999999999999999\n001=Text'],
  ['@MaxLength:20\n@MaxLength:20\n001=Text', '@MaxLength:20\n001=Text'],
  ['@DDICReference\n@DDICReference\n001=Text', '@DDICReference\n001=Text'],
])('does not verify changed or ambiguous symbols: %j', (requested, actual) => {
  expect(textPartMatchesRequest('symbols', requested, actual)).toBe(false);
});
it('recognizes empty native placeholders as an empty replacement', () => {
  expect(textPartMatchesRequest('selections', '', 'P_KEY   =?...\nP_OTHER=')).toBe(true);
  expect(textPartMatchesRequest('headings', '', 'listHeader=\ncolumnHeader_1=')).toBe(true);
  expect(textPartMatchesRequest('symbols', '001=', '')).toBe(true);
});
