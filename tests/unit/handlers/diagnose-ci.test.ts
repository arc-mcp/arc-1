import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createClient } from './setup-undici-mock.js';

vi.mock('../../../src/adt/ci-quality.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/adt/ci-quality.js')>();
  return {
    ...actual,
    runAtcCiCheck: vi.fn(),
    runAunitCiCheck: vi.fn(),
  };
});

const { runAtcCiCheck, runAunitCiCheck } = await import('../../../src/adt/ci-quality.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { diagnoseCiQualityFailed } = await import('../../../src/handlers/diagnose.js');
const { getToolSchema } = await import('../../../src/handlers/schemas.js');
const { textResult, toolJson } = await import('../../../src/handlers/shared.js');

describe('SAPDiagnose CI actions', () => {
  beforeEach(() => {
    vi.mocked(runAtcCiCheck).mockReset();
    vi.mocked(runAunitCiCheck).mockReset();
  });

  it('routes atc_ci to the headless ATC client with origin and object set', async () => {
    vi.mocked(runAtcCiCheck).mockResolvedValue({
      status: 'completed',
      durationMs: 12,
      fail: true,
      summary: { findingCount: 1, errorCount: 1, warningCount: 0, infoCount: 0 },
      findings: [{ file: 'testFile', message: 'boom', source: 'CHK', line: 1, severity: 'error' }],
      reportXml: '<checkstyle/>',
    });
    const client = createClient();
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
      action: 'atc_ci',
      packages: ['Z_TEST'],
      packageTrees: ['Z_TEST_TREE'],
      softwareComponents: ['/DMO/SWC'],
      variant: 'MY_TEST',
      failOnSeverity: 'warning',
      timeoutSeconds: 120,
    });
    expect(result.isError).toBeUndefined();
    expect(runAtcCiCheck).toHaveBeenCalledWith(
      client.http,
      client.safety,
      expect.objectContaining({
        origin: client.baseUrl,
        objectSet: {
          packages: ['Z_TEST'],
          packageTrees: ['Z_TEST_TREE'],
          softwareComponents: ['/DMO/SWC'],
        },
        variant: 'MY_TEST',
        failOnSeverity: 'warning',
        timeoutSeconds: 120,
      }),
    );
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({
      status: 'completed',
      fail: true,
      reportXml: '<checkstyle/>',
    });
  });

  it('routes unittest_ci to the headless AUnit client', async () => {
    vi.mocked(runAunitCiCheck).mockResolvedValue({
      status: 'completed',
      durationMs: 8,
      fail: false,
      summary: { tests: 1, failures: 0, errors: 0, skipped: 0 },
      tests: [{ classname: 'C', name: 'PASSES', status: 'passed' }],
      reportXml: '<testsuites/>',
    });
    const client = createClient();
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
      action: 'unittest_ci',
      softwareComponents: ['/DMO/REPO'],
      evaluateResults: false,
      ownTests: true,
      timeoutSeconds: 90,
    });
    expect(result.isError).toBeUndefined();
    expect(runAunitCiCheck).toHaveBeenCalledWith(
      client.http,
      client.safety,
      expect.objectContaining({
        origin: client.baseUrl,
        objectSet: {
          packages: undefined,
          packageTrees: undefined,
          softwareComponents: ['/DMO/REPO'],
        },
        evaluateResults: false,
        ownTests: true,
        timeoutSeconds: 90,
      }),
    );
    expect(JSON.parse(result.content[0]?.text ?? '')).toMatchObject({ fail: false, reportXml: '<testsuites/>' });
  });

  it('accepts the CI actions in the Zod schema', () => {
    const schema = getToolSchema('SAPDiagnose', false)!;
    expect(schema.safeParse({ action: 'atc_ci', packages: ['Z_TEST'] }).success).toBe(true);
    expect(schema.safeParse({ action: 'unittest_ci', softwareComponents: ['/DMO/SWC'] }).success).toBe(true);
    expect(schema.safeParse({ action: 'atc_ci', failOnSeverity: 'fatal' }).success).toBe(false);
  });
});

describe('diagnoseCiQualityFailed', () => {
  it('returns true only for CI actions whose payload has fail=true', () => {
    const failing = textResult(toolJson({ fail: true, status: 'completed' }));
    const passing = textResult(toolJson({ fail: false, status: 'completed' }));
    expect(diagnoseCiQualityFailed({ action: 'atc_ci' }, failing)).toBe(true);
    expect(diagnoseCiQualityFailed({ action: 'unittest_ci' }, failing)).toBe(true);
    expect(diagnoseCiQualityFailed({ action: 'atc_ci' }, passing)).toBe(false);
    expect(diagnoseCiQualityFailed({ action: 'atc' }, failing)).toBe(false);
    expect(diagnoseCiQualityFailed({ action: 'unittest_ci' }, { ...failing, isError: true })).toBe(true);
  });
});
