import { describe, expect, it } from 'vitest';

import {
  asciiTrim,
  canonicalDataSourceName,
  canonicalDataSourceNames,
  DataSourceNameError,
  dataSourcePolicyFingerprint,
  MAX_DATA_SOURCE_NAME_LENGTH,
  parseBlockedDataSourcesCsv,
  shortPolicyFingerprint,
} from '../../../src/adt/data-source-name.js';

describe('canonicalDataSourceName', () => {
  it.each([
    ['plain uppercase', 'USR02', 'USR02'],
    ['ASCII lowercase folds up', 'usr02', 'USR02'],
    ['mixed case', 'UsR02', 'USR02'],
    ['ASCII surrounding whitespace is trimmed', '  usr02\t\n', 'USR02'],
    ['namespace slashes', '/dmo/i_flight', '/DMO/I_FLIGHT'],
    ['dollar is a legal name character', '$tmp_view', '$TMP_VIEW'],
    ['underscores with digits', 'z_table_2', 'Z_TABLE_2'],
    ['maximum length is accepted', `Z${'A'.repeat(MAX_DATA_SOURCE_NAME_LENGTH - 1)}`, `Z${'A'.repeat(127)}`],
  ])('accepts %s', (_label, input, expected) => {
    expect(canonicalDataSourceName(input)).toBe(expected);
  });

  // The security property: Unicode case folding must never produce an allowed ASCII name.
  // JavaScript's toUpperCase() maps ſ→S, ß→SS, ﬀ→FF and ﬃ→FFI, so validating after folding would
  // let non-ASCII input impersonate a different identity. Raw ASCII validation runs first.
  it.each([
    ['U+017F LATIN SMALL LETTER LONG S (folds to S)', 'uſr02'],
    ['sharp s (folds to SS)', 'ußr02'],
    ['ff ligature (folds to FF)', 'usﬀr'],
    ['ffi ligature (folds to FFI)', 'ﬃ'],
    ['dotless i (folds to I)', 'usrı'],
    ['Kelvin sign', 'USR0K'],
    ['U+3000 ideographic space is NOT trimmed', '　USR02'],
    ['U+00A0 no-break space is NOT trimmed', ' USR02'],
    ['U+200B zero-width space', 'USR02​'],
    ['full-width digits', 'USR０２'],
  ])('rejects non-ASCII input: %s', (_label, input) => {
    expect(() => canonicalDataSourceName(input)).toThrow(DataSourceNameError);
  });

  it('never folds non-ASCII into an allowed name', () => {
    // The whole point: these must NOT become USR02 / SS / S.
    for (const input of ['uſr02', 'ußr02', '　USR02']) {
      expect(() => canonicalDataSourceName(input)).toThrow(/not an exact technical name/);
    }
    expect('uſr02'.toUpperCase()).toBe('USR02'); // documents the trap being defended against
  });

  it.each([
    ['empty', ''],
    ['ASCII whitespace only', '   \t\n '],
    ['wildcard suffix', 'SCARR*'],
    ['wildcard prefix', '*SCARR'],
    ['type prefix', 'TABL:SCARR'],
    ['negation', '!SCARR'],
    ['single quoting', "'SCARR'"],
    ['double quoting', '"SCARR"'],
    ['regex syntax', '^SCARR$.*'],
    ['embedded space', 'US R02'],
    ['semicolon', 'USR02;DELETE'],
    ['comma inside a single name', 'USR02,PA0002'],
    ['parenthesis', 'USR02()'],
    ['hyphen', 'US-R02'],
    ['dot', 'US.R02'],
    ['punctuation only: slash', '/'],
    ['punctuation only: dollar', '$'],
    ['punctuation only: underscores', '___'],
    ['punctuation only: mixed', '/$_/'],
    ['over the length limit', 'Z'.repeat(MAX_DATA_SOURCE_NAME_LENGTH + 1)],
  ])('rejects %s', (_label, input) => {
    expect(() => canonicalDataSourceName(input)).toThrow(DataSourceNameError);
  });

  it('never silently removes characters', () => {
    // The prototype's TABLE_QUERY builder stripped invalid characters instead of refusing.
    // Anything that would need stripping must throw, so checked identity == executed identity.
    for (const lossy of ['USR02;', 'USR 02', 'USR02()', 'US-R02']) {
      expect(() => canonicalDataSourceName(lossy)).toThrow(DataSourceNameError);
    }
  });

  it('labels the offending value without dumping unbounded content', () => {
    const long = `${'X'.repeat(400)}*`;
    try {
      canonicalDataSourceName(long, 'SAP_BLOCKED_DATA_SOURCES entry #1 of 1');
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SAP_BLOCKED_DATA_SOURCES entry #1 of 1');
      expect(message.length).toBeLessThan(400);
    }
  });
});

describe('asciiTrim', () => {
  it('trims only ASCII whitespace', () => {
    expect(asciiTrim(' \t\r\nUSR02 \n')).toBe('USR02');
    expect(asciiTrim('　USR02　')).toBe('　USR02　');
    expect(asciiTrim(' USR02')).toBe(' USR02');
  });
});

describe('canonicalDataSourceNames', () => {
  it('deduplicates while preserving first-occurrence order', () => {
    expect(canonicalDataSourceNames(['spfli', 'USR02', 'SPFLI', 'pa0002', 'usr02'])).toEqual([
      'SPFLI',
      'USR02',
      'PA0002',
    ]);
  });
});

describe('parseBlockedDataSourcesCsv', () => {
  it.each([
    ['empty string', ''],
    ['single space', ' '],
    ['ASCII whitespace run', ' \t\r\n '],
  ])('treats %s as off', (_label, input) => {
    expect(parseBlockedDataSourcesCsv(input)).toEqual([]);
  });

  it.each([
    ['single entry', 'USR02', ['USR02']],
    ['two entries', 'USR02,PA0002', ['USR02', 'PA0002']],
    ['surrounding spaces per field', ' usr02 , pa0002 ', ['USR02', 'PA0002']],
    ['duplicates collapse, first order kept', 'spfli,USR02,SPFLI,usr02', ['SPFLI', 'USR02']],
    ['namespaced entry', '/dmo/i_flight,scarr', ['/DMO/I_FLIGHT', 'SCARR']],
  ])('parses %s', (_label, input, expected) => {
    expect(parseBlockedDataSourcesCsv(input)).toEqual(expected);
  });

  // Once the value is active, every field is mandatory. The prototype used .filter(Boolean) and
  // silently dropped these, so a stray separator quietly disabled or shortened the policy.
  it.each([
    ['separator only', ','],
    ['repeated separators only', ',,,'],
    ['leading comma', ',USR02'],
    ['trailing comma', 'USR02,'],
    ['repeated inner comma', 'USR02,,PA0002'],
    ['whitespace field', 'USR02, ,PA0002'],
    ['trailing comma with space', 'USR02, '],
  ])('rejects %s as a startup error', (_label, input) => {
    expect(() => parseBlockedDataSourcesCsv(input)).toThrow(DataSourceNameError);
  });

  it('a separator-only value never silently disables the policy', () => {
    // Regression for the prototype behaviour: ',' parsed to [] and turned the control off.
    expect(() => parseBlockedDataSourcesCsv(',')).toThrow(/empty/);
  });

  it('a non-ASCII-whitespace-only value is an error, not off', () => {
    expect(() => parseBlockedDataSourcesCsv('　')).toThrow(DataSourceNameError);
  });

  it('identifies the failing token position and the configured source', () => {
    try {
      parseBlockedDataSourcesCsv('USR02,SCARR*,PA0002', 'SAP_BLOCKED_DATA_SOURCES');
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SAP_BLOCKED_DATA_SOURCES');
      expect(message).toContain('#2 of 3');
      expect(message).toContain('SCARR*');
    }
  });

  it('uses the CLI flag label when that is the active source', () => {
    expect(() => parseBlockedDataSourcesCsv('USR02,', '--blocked-data-sources')).toThrow(/--blocked-data-sources/);
  });

  it.each(['USR02,SCARR*', 'USR02,TABL:SCARR', 'USR02,!SCARR', "USR02,'SCARR'", 'USR02,US R02'])(
    'rejects unsupported grammar in %j',
    (input) => {
      expect(() => parseBlockedDataSourcesCsv(input)).toThrow(DataSourceNameError);
    },
  );
});

describe('dataSourcePolicyFingerprint', () => {
  it('is stable, order-independent, and duplicate-independent', () => {
    const a = dataSourcePolicyFingerprint(['USR02', 'PA0002']);
    expect(dataSourcePolicyFingerprint(['PA0002', 'USR02'])).toBe(a);
    expect(dataSourcePolicyFingerprint(['USR02', 'PA0002', 'USR02'])).toBe(a);
  });

  it('changes when the effective policy changes', () => {
    expect(dataSourcePolicyFingerprint(['USR02'])).not.toBe(dataSourcePolicyFingerprint(['USR02', 'PA0002']));
    expect(dataSourcePolicyFingerprint([])).not.toBe(dataSourcePolicyFingerprint(['USR02']));
  });

  it('is a full sha256 hex digest with a short display form', () => {
    expect(dataSourcePolicyFingerprint(['USR02'])).toMatch(/^[0-9a-f]{64}$/);
    expect(shortPolicyFingerprint(['USR02'])).toBe(dataSourcePolicyFingerprint(['USR02']).slice(0, 12));
  });
});
