import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { isCtsRequestAbsent, readCtsTree, readCtsTreeAfterDelete } from '../../../src/adt/pinned-cts-evidence.js';

const id = 'A4HK000000',
  path = `/sap/bc/adt/cts/transportrequests/${id}`;
const body = readFileSync(new URL('../../fixtures/xml/cts-request-not-found-a4h-758.xml', import.meta.url), 'utf8');
const missing = (xml = body, status = 404, requestPath = path) => new AdtApiError('missing', status, requestPath, xml);

describe('exact CTS native missing-resource evidence', () => {
  it('accepts the captured typed A4H response and equivalent exception namespace alias', () => {
    expect(isCtsRequestAbsent(missing(), id)).toBe(true);
    expect(
      isCtsRequestAbsent(missing(body.replaceAll('exc:', 'other:').replace('xmlns:exc=', 'xmlns:other=')), id),
    ).toBe(true);
    expect(
      isCtsRequestAbsent(
        missing(body.replace(/<message[\s\S]*?<\/message>/, '<message lang="DE">Lokalisierte Diagnose.</message>')),
        id,
      ),
    ).toBe(true);
  });
  it.each([200, 400, 401, 403, 410, 500])('refuses status%s despite an otherwise exact body', (status) =>
    expect(isCtsRequestAbsent(missing(body, status), id)).toBe(false),
  );
  it.each([
    '',
    '<html>Not found</html>',
    body.replace('ExceptionResourceNotFound', 'ExceptionAuthorization'),
    body.replace('com.sap.adt', 'com.example'),
    body.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
    body.replace('SADT_RESOURCE', 'SADT_AUTH'),
    body.replace('>002<', '>003<'),
    body.replace('>Transport Request/Task<', '>ABAP Class<'),
    body.replace(`>${id}<`, '>A4HK999999<'),
    body.replace('<properties>', '<properties xmlns="urn:foreign">'),
    body.replace('</properties>', '<entry key="T100KEY-V2">A4HK999999</entry></properties>'),
    body.replace('</properties>', '<entry key="T100KEY-V2">A4HK000000</entry></properties>'),
    body.replace('</exc:exception>', '<properties/></exc:exception>'),
    body.replace('</exc:exception>', '<namespace id="com.sap.adt"/></exc:exception>'),
    body.replace('</exc:exception>', '<extra/></exc:exception>'),
    body.replace('</exc:exception>', '<message lang="EN">Duplicate</message></exc:exception>'),
    body.replace('</message>', '<extra/></message>'),
    `<!DOCTYPE exception [<!ENTITY x "x">]>${body}`,
    body + ' '.repeat(32 * 1024),
  ])('refuses missing, foreign, contradictory, duplicate or oversized evidence %#', (xml) =>
    expect(isCtsRequestAbsent(missing(xml), id)).toBe(false),
  );
  it('binds the exact request path and canonical ID, not a matching message alone', () => {
    expect(isCtsRequestAbsent(missing(body, 404, '/private'), id)).toBe(false);
    expect(isCtsRequestAbsent(missing(), 'A4HK999999')).toBe(false);
    expect(isCtsRequestAbsent(missing(), '../A4HK000000')).toBe(false);
    expect(isCtsRequestAbsent({ statusCode: 404, path, responseBody: body }, id)).toBe(false);
  });
  it('leaves preflight reads strict and enables only the explicit post-delete reader', async () => {
    const error = missing(),
      get = vi.fn().mockRejectedValue(error),
      http = { get } as unknown as AdtHttpClient;
    await expect(readCtsTree(http, id)).rejects.toBe(error);
    await expect(readCtsTreeAfterDelete(http, id)).resolves.toEqual({ tasks: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
