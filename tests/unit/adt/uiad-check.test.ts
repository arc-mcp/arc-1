import { describe, expect, it, vi } from 'vitest';
import { syntaxCheck } from '../../../src/adt/devtools.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const uri = '/sap/bc/adt/fiori/uiad/%2FARC%2FTEST';
const report = (body: string) =>
  `<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun">${body}</chkrun:checkRunReports>`;
function http(body: string) {
  return { post: vi.fn(async () => ({ body })) } as unknown as AdtHttpClient;
}

describe('UIAD JSON candidate check', () => {
  it('sends exact candidate bytes as JSON and preserves SAP semantic diagnostics', async () => {
    const client = http(
      report(
        `<chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${uri.toLowerCase()}" chkrun:status="processed"><chkrun:checkMessage chkrun:type="E" chkrun:shortText="Technical Catalog ID is initial." chkrun:uri="${uri}/source/main#start=2,159" chkrun:code="SUI_UIAD_CHECK(101)"><chkrun:t100Key chkrun:msgid="SUI_UIAD_CHECK" chkrun:msgno="101"/></chkrun:checkMessage></chkrun:checkReport>`,
      ),
    );
    const source = '{\n "description": "Ä & <test>"\n}';
    const result = await syntaxCheck(client, defaultSafetyConfig(), uri, {
      content: source,
      artifactContentType: 'application/json',
    });
    const body = vi.mocked(client.post).mock.calls[0][1] as string;
    expect(body).toContain('chkrun:contentType="application/json"');
    expect(Buffer.from(body.match(/<chkrun:content>(.*?)<\/chkrun:content>/s)![1], 'base64').toString()).toBe(source);
    expect(result).toMatchObject({
      checked: true,
      hasErrors: true,
      messages: [{ code: 'SUI_UIAD_CHECK(101)', t100: { id: 'SUI_UIAD_CHECK', number: '101' }, line: 2, column: 159 }],
    });
  });

  it.each([
    '<html>Sign in</html>',
    '',
    '<checkMessages/>',
    report('<chkrun:checkReport chkrun:status="notProcessed"/>'),
    report('<chkrun:checkReport/>'),
    report('<chkrun:checkReport chkrun:status="processed" chkrun:reporter="other"/>'),
    report(
      '<chkrun:checkReport chkrun:status="processed" chkrun:reporter="abapCheckRun" chkrun:triggeringUri="/sap/bc/adt/fiori/uiad/OTHER"/>',
    ),
    '<chkrun:checkRunReports><chkrun:checkReport chkrun:status="processed">',
  ])('does not claim an unavailable or unrelated response was checked: %s', async (body) => {
    const result = await syntaxCheck(http(body), defaultSafetyConfig(), uri, {
      content: '{}',
      artifactContentType: 'application/json',
    });
    expect(result.checked).toBe(false);
  });
});
