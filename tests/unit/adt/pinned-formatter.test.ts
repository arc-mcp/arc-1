import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import type { PrettyPrinterSettings } from '../../../src/adt/devtools.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtResponse } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import {
  FORMATTER_SETTINGS_CONTENT_TYPE,
  FORMATTER_SETTINGS_PATH,
  parsePinnedFormatterDocument,
  patchPinnedFormatterSettings,
} from '../../../src/adt/pinned-formatter.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const xml = (indentation = 'true', style = 'keywordUpper', extra = '') =>
  `<?xml version="1.0" encoding="utf-8"?><p:PrettyPrinterSettings xmlns:p="http://www.sap.com/adt/prettyprintersettings" p:indentation="${indentation}" p:style="${style}" ${extra}/>`;

function setup(body = xml(), etag?: string) {
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    safety: {
      ...unrestrictedSafetyConfig(),
      // These are target settings, so repository/CTS admission is deliberately empty.
      allowedPackages: [],
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: [],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  const controller = new AbortController();
  const context = pinnedMutationContext(
    client.safety,
    {
      deadline: Date.now() + 30000,
      signal: controller.signal,
    },
    { unlockFailed: false },
  );
  let native = body;
  const reply = () => ({
    statusCode: 200,
    headers: {
      'content-type': `${FORMATTER_SETTINGS_CONTENT_TYPE}; charset=utf-8`,
      ...(etag ? { etag } : {}),
    },
    body: native,
  });
  const get = vi.spyOn(client.http, 'get').mockImplementation(async () => reply());
  const put = vi.spyOn(client.http, 'put').mockImplementation(async (_path, value) => {
    native = String(value);
    return { statusCode: 204, headers: {}, body: '' };
  });
  const patch = (value: Partial<PrettyPrinterSettings>) =>
    patchPinnedFormatterSettings(client.http, client.safety, context, value);
  return { client, context, controller, get, put, patch, reply };
}

describe('pinned native formatter patch candidate', () => {
  it('preserves the newer Workbench preferences exposed by the complete v5 representation', async () => {
    const attributes =
      'p:keepIdentifier="true" p:formatMethodCalls="true" p:condenseMethodCalls="true" p:formatValue="true" p:defaultAutoStyle="keywordLower"';
    const test = setup(xml('true', 'keywordUpper', attributes));
    const before = parsePinnedFormatterDocument(test.reply().body).unrelated;
    expect(await test.patch({ indentation: false, style: 'keywordLower' })).toMatchObject({
      ok: true,
      state: 'updated',
    });
    expect(parsePinnedFormatterDocument(String(test.put.mock.calls[0][1])).unrelated).toEqual(before);
    expect(test.get.mock.calls[0][1]).toEqual({ Accept: '*/*' });
  });

  it.each([1, 2, 3, 4, 6])(
    'refuses an unqualified v%s representation before PUT instead of resetting omitted preferences',
    async (version) => {
      const test = setup();
      test.get.mockResolvedValue({
        ...test.reply(),
        headers: { 'content-type': `application/vnd.sap.adt.ppsettings.v${version}+xml` },
      });
      expect(await test.patch({ indentation: false })).toMatchObject({ ok: false, phase: 'read', state: 'unchanged' });
      expect(test.put).not.toHaveBeenCalled();
      expect(test.get).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves native attributes, namespaces, comments and unselected style while changing indentation', async () => {
    const body = xml('true', 'keywordLower', 'extra="A &amp; B" xmlns:x="urn:other" x:flag="keep"').replace(
      '/>',
      '><!--native comment--></p:PrettyPrinterSettings>',
    );
    const test = setup(body, '"version-1"');
    expect(await test.patch({ indentation: false })).toMatchObject({
      ok: true,
      state: 'updated',
      phase: 'readback',
      concurrency: 'strong-etag',
      before: { indentation: true, style: 'keywordLower' },
      settings: { indentation: false, style: 'keywordLower' },
      retryable: false,
    });
    expect(test.put).toHaveBeenCalledExactlyOnceWith(
      FORMATTER_SETTINGS_PATH,
      expect.stringContaining('<!--native comment-->'),
      FORMATTER_SETTINGS_CONTENT_TYPE,
      { Accept: '*/*', 'If-Match': '"version-1"' },
      test.context.requestPolicy,
    );
    const saved = parsePinnedFormatterDocument(String(test.put.mock.calls[0][1]));
    expect(saved.unrelated).toEqual({ '{}extra': 'A & B', '{urn:other}flag': 'keep' });
    expect(test.get).toHaveBeenCalledTimes(2);
    for (const call of test.get.mock.calls)
      expect(call).toEqual([FORMATTER_SETTINGS_PATH, { Accept: '*/*' }, test.context.requestPolicy]);
  });

  it.each([undefined, 'W/"weak"'])(
    'reports unconditional native writes when no strong ETag exists (%s)',
    async (etag) => {
      const test = setup(xml(), etag);
      expect(await test.patch({ style: 'none' })).toMatchObject({ ok: true, concurrency: 'native-unconditional' });
      expect(test.put.mock.calls[0][3]).not.toHaveProperty('If-Match');
    },
  );

  it('preserves the meaning of numeric/literal entity references and quoted native attributes', async () => {
    const test = setup(xml('true', 'keywordUpper', `extra='&#x41;&#65; " &amp;lt;'`));
    expect(await test.patch({ style: 'none' })).toMatchObject({ ok: true, state: 'updated' });
    const sent = parsePinnedFormatterDocument(String(test.put.mock.calls[0][1]));
    expect(sent.unrelated).toEqual({ '{}extra': 'AA " &lt;' });
  });

  it('preserves character-reference whitespace separately from literal XML attribute whitespace', async () => {
    const test = setup(xml('true', 'keywordUpper', 'extra="a&#10;b&#13;c&#9;d\r\ne\tf"'));
    expect(await test.patch({ style: 'none' })).toMatchObject({ ok: true, state: 'updated' });
    const sent = parsePinnedFormatterDocument(String(test.put.mock.calls[0][1]));
    expect(sent.unrelated).toEqual({ '{}extra': 'a\nb\rc\td e f' });
  });

  it('skips an already-matching patch without a modifying request', async () => {
    const test = setup();
    expect(await test.patch({ style: 'keywordUpper' })).toMatchObject({
      ok: true,
      state: 'unchanged',
      phase: 'read',
      settings: { indentation: true, style: 'keywordUpper' },
    });
    expect(test.put).not.toHaveBeenCalled();
    expect(test.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    xml().replace(' p:style="keywordUpper"', ''),
    xml().replace(' p:indentation="true"', ''),
    xml('unknown'),
    xml('true', 'future-style'),
    xml().replace('www.sap.com', 'wrong.example'),
    xml().replace('encoding="utf-8"', 'encoding="utf-16"'),
    xml('true', 'keywordUpper', 'extra="&unknown;"'),
    xml('true', 'keywordUpper', 'extra="&#0;"'),
    xml().replace('/>', '><p:future/></p:PrettyPrinterSettings>'),
    xml().replace('/>', '>unexpected text</p:PrettyPrinterSettings>'),
    xml('true', 'keywordUpper', 'xmlns:q="http://www.sap.com/adt/prettyprintersettings" q:style="none"'),
    xml('true', 'keywordUpper', 'missing:flag="x"'),
    xml().replace('<?xml version="1.0" encoding="utf-8"?>', '<!DOCTYPE p [<!ENTITY x "bad">]>'),
    `${xml()}${xml()}`,
    '<broken',
    xml('true', 'keywordUpper', `extra="${'x'.repeat(17000)}"`),
  ])('refuses unqualified native settings without guessing defaults', async (body) => {
    const test = setup(body);
    expect(await test.patch({ style: 'none' })).toMatchObject({ ok: false, state: 'unchanged', phase: 'read' });
    expect(test.put).not.toHaveBeenCalled();
  });

  it.each([{}, { indentation: 'false' }, { style: 'unknown' }, { user: 'OTHER', style: 'none' }, null, []])(
    'rejects invalid patches before native reads: %j',
    async (input) => {
      const test = setup();
      expect(await test.patch(input as Partial<PrettyPrinterSettings>)).toMatchObject({
        ok: false,
        state: 'unchanged',
        phase: 'validation',
      });
      expect(test.get).not.toHaveBeenCalled();
      expect(test.put).not.toHaveBeenCalled();
    },
  );

  it('requires the registered pinned context and enabled mutation policy', async () => {
    const test = setup();
    const invoke = (context = test.context) =>
      patchPinnedFormatterSettings(test.client.http, test.client.safety, context, { style: 'none' });
    expect(await invoke({ ...test.context })).toMatchObject({ ok: false, state: 'unchanged' });
    expect(await invoke(setup().context)).toMatchObject({ ok: false, state: 'unchanged' });
    test.client.safety.allowWrites = false;
    expect(await invoke()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(test.get).not.toHaveBeenCalled();
    expect(test.put).not.toHaveBeenCalled();
  });

  it('rejects a non-XML response or malformed native ETag before PUT', async () => {
    const responses: AdtResponse[] = [
      { statusCode: 200, body: xml(), headers: { 'content-type': 'text/html' } },
      {
        statusCode: 200,
        body: xml(),
        headers: { 'content-type': FORMATTER_SETTINGS_CONTENT_TYPE, etag: '"bad\r\nheader"' },
      },
    ];
    for (const response of responses) {
      const test = setup();
      test.get.mockResolvedValue(response);
      expect(await test.patch({ style: 'none' })).toMatchObject({ ok: false, state: 'unchanged' });
      expect(test.put).not.toHaveBeenCalled();
    }
  });

  it.each([400, 403, 412, 423, 429, 500])(
    'classifies native write rejection/uncertainty without retry (%s)',
    async (status) => {
      const test = setup();
      test.put.mockRejectedValue(new AdtApiError('Private native diagnostic', status, FORMATTER_SETTINGS_PATH));
      const result = await test.patch({ style: 'none' });
      expect(result).toMatchObject({
        ok: false,
        state: status < 429 ? 'update-rejected' : 'update-unconfirmed',
        phase: 'write',
        statusCode: status,
        retryable: false,
      });
      expect(JSON.stringify(result)).not.toContain('Private native diagnostic');
      expect(test.put).toHaveBeenCalledTimes(1);
      expect(test.get).toHaveBeenCalledTimes(1);
    },
  );

  it('reports an ambiguous transport failure after submission without rollback or retry', async () => {
    const test = setup();
    test.put.mockRejectedValue(new Error('connection reset'));
    expect(await test.patch({ style: 'none' })).toMatchObject({
      ok: false,
      state: 'update-unconfirmed',
      phase: 'write',
      retryable: false,
    });
    expect(test.put).toHaveBeenCalledTimes(1);
  });

  it.each(['mismatch', 'unrelated-loss', 'readback-failure'] as const)(
    'does not claim success after %s',
    async (kind) => {
      const test = setup(xml('true', 'keywordUpper', 'extra="keep"'));
      test.get.mockResolvedValueOnce(test.reply());
      if (kind === 'readback-failure') test.get.mockRejectedValueOnce(new Error('read failed'));
      else
        test.get.mockResolvedValueOnce({
          ...test.reply(),
          body: kind === 'mismatch' ? xml() : xml('true', 'none'),
        });
      expect(await test.patch({ style: 'none' })).toMatchObject({
        ok: false,
        state: 'update-unconfirmed',
        phase: 'readback',
      });
      expect(test.put).toHaveBeenCalledTimes(1);
    },
  );

  it('stops before reads when cancelled and before PUT when cancelled during preflight', async () => {
    const before = setup();
    before.controller.abort();
    expect(await before.patch({ style: 'none' })).toMatchObject({ ok: false, state: 'unchanged' });
    expect(before.get).not.toHaveBeenCalled();
    const during = setup();
    during.get.mockImplementationOnce(async () => {
      during.controller.abort();
      return during.reply();
    });
    expect(await during.patch({ style: 'none' })).toMatchObject({ ok: false, state: 'unchanged' });
    expect(during.put).not.toHaveBeenCalled();
  });

  it('captures the patch before awaiting native metadata', async () => {
    const test = setup();
    const patch: Partial<PrettyPrinterSettings> = { style: 'none' };
    test.get.mockImplementationOnce(async () => {
      patch.style = 'keywordLower';
      return test.reply();
    });
    expect(await test.patch(patch)).toMatchObject({ ok: true, settings: { style: 'none' } });
  });
});
