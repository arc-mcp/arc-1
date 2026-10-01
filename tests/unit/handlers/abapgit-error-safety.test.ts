import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const repos = readFileSync(new URL('../../fixtures/xml/abapgit-repos-v2.xml', import.meta.url), 'utf8');
const exception = (content: string) => `<exception><namespace id="org.abapgit.adt"/>${content}</exception>`;

async function run(body: string, action = 'pull', minimalErrors = false, status = 500) {
  setCachedFeatures(featuresOff({ abapGit: true }));
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string | URL, options?: { method?: string }) => {
    if (options?.method === 'POST' && /\/(pull|checks)/.test(String(url))) return mockResponse(status, body);
    return mockResponse(200, repos, { 'x-csrf-token': 'T' });
  });
  const client = new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'user',
    password: 'test',
    safety: { ...unrestrictedSafetyConfig(), allowGitWrites: true },
  });
  return handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPGit', {
    action,
    backend: 'abapgit',
    repoId: '000000000001',
  });
}

describe('abapGit diagnostic confidentiality through dispatch', () => {
  afterEach(resetCachedFeatures);

  it.each([
    [
      'extra messages and properties',
      exception(
        '<message>Rejected</message><localizedMessage>Rejected</localizedMessage>' +
          '<localizedMessage>password=&quot;SENTINEL words&quot;</localizedMessage><entry key="LONGTEXT">token=&quot;SENTINEL&quot;</entry>',
      ),
    ],
    ['encoded request element', exception('<message>&lt;remotePassword&gt;SENTINEL&lt;/remotePassword&gt;</message>')],
    [
      'truncated fallback',
      `<outer>${'x'.repeat(284)}<remotePassword>SENTINELabcdefghijklmnopqrstuvwxyz</remotePassword></outer>`,
    ],
    [
      'repeated naked credential',
      exception(
        '<message>SENTINEL</message><localizedMessage>SENTINEL</localizedMessage>' +
          '<localizedMessage>See SENTINEL</localizedMessage><remotePassword>SENTINEL</remotePassword>',
      ),
    ],
    [
      'late credential element',
      exception(`<message>SENTINEL</message>${' '.repeat(5000)}<remotePassword>SENTINEL</remotePassword>`),
    ],
    [
      'credential-bearing message ID',
      exception('<message>Rejected</message><entry key="T100KEY-ID">password=&quot;SENTINEL&quot;</entry>'),
    ],
    [
      'split T100 label',
      exception(
        '<message>Rejected</message><entry key="T100KEY-V1">pass</entry><entry key="T100KEY-V2">word=SENTINEL</entry>',
      ),
    ],
    [
      'duplicate T100 variables',
      exception(
        '<message>SENTINEL</message><entry key="T100KEY-V1">pass</entry><entry key="T100KEY-V2">word=SENTINEL</entry>' +
          '<entry key="T100KEY-V1">ordinary</entry><entry key="T100KEY-V2">detail</entry>',
      ),
    ],
    [
      'mixed XML and JSON encoding',
      exception(
        '<message>Rejected</message><localizedMessage>Rejected</localizedMessage><localizedMessage>pass&#x5c;u0077ord=SENTINEL</localizedMessage>',
      ),
    ],
    ['URL-encoded path label', exception('<message>https://example.com/to%6ben=SENTINEL</message>')],
    ['ampersand in value', exception('<message>password=FIRST&amp;SENTINEL</message>')],
    ['numeric references', exception('<message>pass&#119;ord=&#34;SENTINEL words&#34;</message>')],
    ['nested encoding', exception('<message>pass&amp;#119;ord=&amp;quot;SENTINEL&amp;quot;</message>')],
    ['encoded URL userinfo', exception('<message>https://user:abc&lt;SENTINEL@example.com/repo.git</message>')],
    ['markup-separated authorization', '<html><td>Authorization: Bearer</td><td>SENTINEL</td></html>'],
    [
      'oversized diagnostic',
      exception(`<message>SENTINEL</message>${' '.repeat(66000)}<remotePassword>SENTINEL</remotePassword>`),
    ],
  ])('omits %s before both pull errors and check results reach the caller', async (_label, body) => {
    for (const action of ['pull', 'check']) {
      const text = JSON.stringify(await run(body, action));
      expect(text).toContain('details omitted');
      expect(text).not.toMatch(/SENTINEL|cdefghijklmnop/);
    }
  });

  it.each([
    '<exception><namespace>org.abapgit.adt</namespace><message>password=SENTINEL</message></exception>',
    exception(`<message>Backend details</message>${' '.repeat(66000)}`),
  ])('preserves check result normalization when details are omitted', async (body) => {
    const result = await run(body, 'check');
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text).result.ok).toBe(false);
    expect(result.content[0]!.text).toContain('details omitted');
  });

  it('omits a credential-bearing HTTP 200 check result', async () => {
    const result = await run(exception('<message>Remote said password=SENTINEL</message>'), 'check', false, 200);
    expect(JSON.parse(result.content[0]!.text).result).toEqual({
      ok: false,
      message: 'abapGit error details omitted because they may contain credentials.',
    });
  });

  it('omits references left encoded after three decoding passes', async () => {
    const text = JSON.stringify(await run(exception('<message>pass&amp;amp;amp;#119;ord=SENTINEL</message>')));
    expect(text).toContain('details omitted');
    expect(text).not.toContain('SENTINEL');
  });

  it.each(['Could not connect to https://github.com', 'Could not connect to https://GitHub.com/org/repo.git'])(
    'keeps a URL that only normalization changes: %s',
    async (message) => {
      const text = (await run(exception(`<message>${message}</message>`), 'check')).content[0]!.text;
      expect(text.toLowerCase()).toContain(message.toLowerCase()); // redactGitText prints the normalized host
    },
  );

  it('omits a credential key beyond the inspected URL prefix', async () => {
    const url = `https://example.com/${'p'.repeat(4100)}?auth=SENTINEL`;
    const text = JSON.stringify(await run(exception(`<message>${url}</message>`), 'check'));
    expect(text).toContain('details omitted');
    expect(text).not.toContain('SENTINEL');
  });

  it('omits encoded credentials in HTTP 200 object rejection messages', async () => {
    const body =
      '<objects><object><obj_type>CLAS</obj_type><obj_name>ZCL_TEST</obj_name><msg_type>E</msg_type>' +
      '<msg_text>https://example.com/to%6ben=SENTINEL</msg_text></object></objects>';
    const result = await run(body, 'pull', false, 200);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('details omitted');
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    expect(result.content[0]!.text).not.toContain('often transient');
  });

  it.each([false, true])('does not guess retry advice for omitted diagnostics, minimal=%s', async (minimal) => {
    const result = await run(exception('<message>No authorization to pull</message>'), 'pull', minimal);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Inspect the full message in SAP');
    expect(result.content[0]!.text).not.toContain('often transient');
  });

  it('retains ordinary decoded diagnostics and the live T100 message-class key', async () => {
    const body = exception(
      '<message>Unknown &lt;X&gt; &amp;lt;</message><localizedMessage>Unknown &lt;X&gt; &amp;lt;</localizedMessage>' +
        '<localizedMessage>See line 4</localizedMessage><entry key="T100KEY-ID">00</entry><entry key="T100KEY-NO">001</entry>',
    );
    const result = await run(body);
    const text = result.content[0]!.text;
    expect(result.isError).toBe(true);
    expect(text).toContain('Unknown <X> &lt;');
    expect(text).toContain('See line 4');
    expect(text).toContain('[00/001]');
    expect((await run(body, 'check')).isError).toBeUndefined();
  });

  it('keeps HTML detail beyond the old body truncation without re-extracting the title', async () => {
    const body =
      `<html><head><title>Application Server Error</title><style>${'.x{color:red;}'.repeat(500)}</style></head>` +
      '<body><span id="msgText">Syntax error in program ZCL_EXAMPLE</span></body></html>';
    expect((await run(body)).content[0]!.text).toContain(
      'Application Server Error: Syntax error in program ZCL_EXAMPLE',
    );
  });

  it('retains minimal-error mode and correlation', async () => {
    const result = await run(exception('<message>Backend details</message>'), 'pull', true);
    expect(result.content[0]!.text).toContain('ARC1_MINIMAL_ERRORS=true');
    expect(result.content[0]!.text).not.toContain('Backend details');
    expect(result.content[0]!.text).toMatch(/request ID/i);
  });
});
