import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { fullConfig } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const diagnose = await import('../../../src/handlers/diagnose.js');

// Supply valid targets so missing-target errors cannot mask the false-default regression.
const targets: Record<string, Record<string, unknown>> = {
  syntax: { type: 'PROG', name: 'ZTEST' },
  unittest: { type: 'CLAS', name: 'ZCL_TEST' },
  unittest_ci: { packages: ['ZTEST'] },
  atc: { type: 'CLAS', name: 'ZCL_TEST' },
  atc_ci: { packages: ['ZTEST'] },
  atc_variants: {},
  cds_testcases: { name: 'ZI_TEST' },
  dumps: {},
  feed_schema: {},
  traces: {},
  trace_start: { traceUser: 'TEST_USER' },
  trace_requests: {},
  trace_cancel: { id: 'TRACE1' },
  system_messages: {},
  gateway_errors: {},
  object_state: { type: 'PROG', name: 'ZTEST' },
  quickfix: { type: 'PROG', name: 'ZTEST', source: 'REPORT ztest.', line: 1 },
  apply_quickfix: {
    type: 'PROG',
    name: 'ZTEST',
    source: 'REPORT ztest.',
    line: 1,
    proposalUri: '/sap/bc/adt/quickfixes/Q1',
    proposalUserContent: 'replacement',
  },
  odata_perf: { url: '/sap/opu/odata/sap/ZTEST_SRV/Items' },
  cds_sql: { name: 'ZI_TEST' },
  sql_trace_state: {},
  set_sql_trace_state: { sqlOn: false },
  sql_trace_directory: {},
  authorization_trace: {},
};
const cases = [
  ...Object.entries(targets).map(([action, args]) => ({ label: action, args: { action, ...args } })),
  { label: 'ATC batch', args: { action: 'atc', objects: [{ type: 'CLAS', name: 'ZCL_TEST' }] } },
  { label: 'syntax batch', args: { action: 'syntax', objects: [{ type: 'CLAS', name: 'ZCL_TEST' }] } },
  {
    label: 'filtered dumps',
    args: { action: 'dumps', filters: [{ attribute: 'runtimeError', operator: 'equals', values: ['TIME_OUT'] }] },
  },
];

describe.each([false, true])('SAPDiagnose includeSubpackages (BTP=%s, #1132)', (isBtp) => {
  const config = fullConfig(isBtp);
  const definition = getToolDefinitions(config).find((tool) => tool.name === 'SAPDiagnose')!;
  const properties = definition.inputSchema.properties as Record<string, unknown>;
  const call = (args: Record<string, unknown>) => handleToolCall(createClient(), config, 'SAPDiagnose', args);

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    // Exercise real dispatch/normalization/validation without executing trace or write actions.
    vi.spyOn(diagnose, 'handleSAPDiagnose').mockResolvedValue({ content: [{ type: 'text', text: 'dispatched' }] });
  });

  it('covers every advertised action', () => {
    const actions = properties.action as { enum: string[] };
    expect(Object.keys(targets).sort()).toEqual([...actions.enum].sort());
  });

  it.each(cases)('dispatches $label with omitted, false and coerced false values', async ({ args }) => {
    for (const value of [undefined, false, 'false']) {
      vi.mocked(diagnose.handleSAPDiagnose).mockClear();
      const result = await call({ ...args, ...(value === undefined ? {} : { includeSubpackages: value }) });
      expect(result, `includeSubpackages=${JSON.stringify(value)}`).toEqual({
        content: [{ type: 'text', text: 'dispatched' }],
      });
      expect(diagnose.handleSAPDiagnose).toHaveBeenCalledTimes(1);
      const normalized = vi.mocked(diagnose.handleSAPDiagnose).mock.calls[0]![1];
      const stripped = value == null || (typeof value === 'string' && value.trim() === '');
      expect(normalized.includeSubpackages).toBe(stripped ? undefined : false);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it.each(cases)('still rejects recursion for $label before dispatch', async ({ args }) => {
    for (const value of [true, 'true']) {
      const result = await call({ ...args, includeSubpackages: value });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('includeSubpackages');
    }
    expect(diagnose.handleSAPDiagnose).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([undefined, false, 'false', true, 'true', 1])(
    'keeps package unittest recursion opt-in: %s',
    async (value) => {
      const result = await call({ action: 'unittest', type: 'devc/k', name: 'ZTEST', includeSubpackages: value });
      expect(result.isError).toBeUndefined();
      expect(diagnose.handleSAPDiagnose).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'unittest',
          type: 'DEVC',
          name: 'ZTEST',
          includeSubpackages: value === undefined ? undefined : [true, 'true', 1].includes(value),
        }),
        expect.anything(),
      );
    },
  );

  it.each(cases.filter(({ label }) => ['syntax', 'unittest_ci', 'syntax batch', 'filtered dumps'].includes(label)))(
    'normalizes client placeholders and boolean spellings for $label',
    async ({ args }) => {
      for (const value of ['0', 'no', 'off', 0, ' FALSE ', null, '', '  ']) {
        vi.mocked(diagnose.handleSAPDiagnose).mockClear();
        const result = await call({ ...args, includeSubpackages: value });
        expect(result.isError).toBeUndefined();
        const normalized = vi.mocked(diagnose.handleSAPDiagnose).mock.calls[0]![1];
        const stripped = value == null || (typeof value === 'string' && value.trim() === '');
        expect(normalized.includeSubpackages).toBe(stripped ? undefined : false);
      }
      vi.mocked(diagnose.handleSAPDiagnose).mockClear();
      for (const value of ['1', 'yes', 'on', 1]) {
        expect((await call({ ...args, includeSubpackages: value })).isError).toBe(true);
      }
      expect(diagnose.handleSAPDiagnose).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['maybe', 2, [], {}, 'null'])('rejects invalid boolean input %j', async (value) => {
    const result = await call({ action: 'dumps', includeSubpackages: value });
    expect(result.isError).toBe(true);
    expect(diagnose.handleSAPDiagnose).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'unittest', type: 'INTF', name: 'ZIF_TEST' },
    { action: 'unittest', name: 'ZTEST', includeSubpackages: true },
    { action: 'atc', type: 'DEVC', name: 'ZTEST', includeSubpackages: true },
    { action: 'atc_ci', packages: ['ZTEST'], coverage: false },
    { action: 'unittest_ci', packages: ['ZTEST'], sqlOn: false },
    { action: 'atc_ci', packages: [] },
    { action: 'syntax', type: 'PROG', name: 'ZTEST', timeoutSeconds: 1 },
    { action: 'dumps', unknown: false },
  ])('preserves unrelated restrictions: %j', async (args) => {
    const result = await call({ includeSubpackages: false, ...args });
    expect(result.isError).toBe(true);
    expect(diagnose.handleSAPDiagnose).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
