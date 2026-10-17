import { expect, it, vi } from 'vitest';
import { syntaxCheck } from '../../../src/adt/devtools.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

it.each([
  ['<checkRunReports/>', false],
  ['<checkRunReports></checkRunReports>', false],
  ['<checkMessages/>', true],
  ['<checkRunReports><checkReport reporter="abapCheckRun" status="processed"/></checkRunReports>', true],
] as const)('preserves native check evidence and legacy success: %s', async (body, checked) => {
  const http = {
    post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
  } as unknown as AdtHttpClient;
  const result = await syntaxCheck(http, defaultSafetyConfig(), '/sap/bc/adt/programs/programs/ZEVAL');
  expect(result.checked).toBe(checked);
  if (!checked) expect(result.statusText).toContain('no syntax-check report');
});
