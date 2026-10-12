import { describe, expect, it } from 'vitest';
import { acceptFallback } from '../../../src/adt/accept-fallback.js';

const path = '/sap/bc/adt/textelements/programs/ZTEST/source/selections';
const media = 'application/vnd.sap.adt.textelements.selections.v1';
const exception = (id: string, number: string) =>
  `<exception><type id="ExceptionResourceNotAcceptable"/><properties><entry key="T100KEY-ID">${id}</entry><entry key="T100KEY-NO">${number}</entry></properties></exception>`;

describe('406 Accept fallback', () => {
  it.each([
    ['SEDX_ADT', '110'],
    ['SEDX_ADT', '107'],
    ['DS', '512'],
    ['DS', '549'],
    ['SEDX_ADT', '106'],
    ['SEDX_ADT', '102'],
    ['SEDX_ADT', '101'],
    ['00', '001'],
    ['OTHER', '999'],
  ])('does not negotiate text-part application errors %s/%s', (id, number) => {
    expect(acceptFallback(exception(id, number), media, 'PUT', path)).toBeUndefined();
  });

  it('uses the existing XML parser for prefixed, quoted and entity-encoded properties', () => {
    const body = `<e:exception xmlns:e="urn:test"><e:type id='ExceptionResourceNotAcceptable'/><e:entry key='T100KEY-MSGID'>SEDX&#95;ADT</e:entry><e:entry key='T100KEY-MSGNO'>110</e:entry></e:exception>`;
    expect(acceptFallback(body, media, 'PUT', path)).toBeUndefined();
  });

  it('does not interpret a validation message containing a MIME type as negotiation', () => {
    expect(acceptFallback(`${exception('SEDX_ADT', '110')} application/json`, media, 'PUT', path)).toBeUndefined();
  });

  it.each(['classes', 'programs', 'functiongroups'])('recognizes namespaced %s text parts', (collection) => {
    expect(
      acceptFallback(
        exception('DS', '512'),
        media,
        'PUT',
        `/sap/bc/adt/textelements/${collection}/%2FNS%2FTEST/source/symbols`,
      ),
    ).toBeUndefined();
  });

  it('preserves framework negotiation and errors without an application message class', () => {
    expect(
      acceptFallback(`${exception('SADT_RESOURCE', '044')} Accepted: ${media}`, 'application/xml', 'PUT', path),
    ).toBe(media);
    for (const body of [exception('SADT_RESOURCE', '044'), exception('', ''), 'Not acceptable']) {
      expect(acceptFallback(body, media, 'PUT', path)).toBe('application/xml');
    }
  });

  it('keeps the validation exception scoped to text-part PUTs', () => {
    const body = exception('DS', '512');
    expect(acceptFallback(body, media, 'GET', path)).toBe('application/xml');
    expect(acceptFallback(body, media, 'PUT', '/sap/bc/adt/oo/classes/ZTEST/source/main')).toBe('application/xml');
  });

  it('keeps inferred types and generic fallback behavior', () => {
    expect(acceptFallback('Expected application/json', media, 'GET', path)).toBe('application/json');
    expect(acceptFallback('Not acceptable', media, 'GET', path)).toBe('application/xml');
    expect(acceptFallback('Not acceptable', 'application/xml', 'GET', path)).toBe('*/*');
    expect(acceptFallback('Not acceptable', '*/*', 'GET', path)).toBeUndefined();
  });
});
