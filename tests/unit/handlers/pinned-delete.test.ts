import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const native = await import('../../../src/adt/pinned-delete.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPWrite } = await import('../../../src/handlers/write.js');
const { requestContext, getCurrentContext } = await import('../../../src/server/context.js');
const args = { action: 'delete', type: 'CLAS', name: 'ZCL_TEST' };

function fixture() {
  const policy = {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  };
  const config = {
    ...DEFAULT_CONFIG,
    multiTargetEndpoints: true,
    targetId: policy.target,
    multiTargetWrite: policy,
    allowWrites: true,
    ppEnabled: true,
    ppStrict: true,
  };
  const client = new AdtClient({
    baseUrl: 'https://sap.example.test',
    safety: { ...defaultSafetyConfig(), allowWrites: true, multiTargetWrite: policy },
  });
  const adapter = vi
    .spyOn(native, 'deletePinnedOwner')
    .mockResolvedValue({ ok: true, state: 'deleted', phase: 'absence-readback', retryable: false });
  return { client, config, adapter };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  mockFetch.mockImplementation(() => {
    throw new Error('Unexpected SAP request outside the native adapter');
  });
});

describe('pinned owner deletion admission through shared dispatch', () => {
  it('carries the request cancellation signal and correlation into the native context/result', async () => {
    const { client, config, adapter } = fixture();
    const controller = new AbortController();
    let activeRequestId: string | undefined;
    adapter.mockImplementation(async () => {
      activeRequestId = getCurrentContext()?.requestId;
      return { ok: true, state: 'deleted', phase: 'absence-readback', retryable: false };
    });
    const result = await requestContext.run(
      { requestId: 'delete-correlation', signal: controller.signal, target: 'A4H/001', identity: 'per-user' },
      () => handleToolCall(client, config, 'SAPWrite', args),
    );
    expect(adapter.mock.calls[0][1].requestPolicy.signal).toBe(controller.signal);
    expect(activeRequestId).toBeTruthy();
    expect(JSON.parse(result.content[0].text).requestId).toBe(activeRequestId);
  });
  it.each(['CLAS', 'INTF'])(
    'deletes %s without source/hash and supplies a registered bounded context',
    async (type) => {
      const { client, config, adapter } = fixture();
      const result = await handleToolCall(client, config, 'SAPWrite', { ...args, type });
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        ok: true,
        state: 'deleted',
        target: 'A4H/001',
        action: 'delete',
        type,
        name: args.name,
        retryable: false,
      });
      expect(adapter).toHaveBeenCalledTimes(1);
      const [active, context, input] = adapter.mock.calls[0];
      expect(() => assertMutationContext(active.safety, context)).not.toThrow();
      expect(context.requestPolicy).toMatchObject({ noReplay: true, retryTransientErrors: false });
      expect(context.requestPolicy.deadline).toBeGreaterThan(Date.now());
      expect(context.requestPolicy.deadline).toBeLessThanOrEqual(Date.now() + 300_000);
      expect(input).toEqual({ type, name: args.name, transport: undefined });
    },
  );
  it.each([
    ['unchanged', 'PINNED_WRITE_REFUSED'],
    ['delete-rejected', 'PINNED_WRITE_REFUSED'],
    ['delete-unconfirmed', 'PINNED_WRITE_INCOMPLETE'],
    ['deleted', 'PINNED_WRITE_INCOMPLETE'],
  ] as const)('preserves incomplete native state %s', async (state, error) => {
    const { client, config, adapter } = fixture();
    adapter.mockResolvedValue({
      ok: false,
      state,
      phase: 'unlock',
      retryable: false,
      cleanupFailed: true,
      sessionClosed: true,
    });
    const result = await handleToolCall(client, config, 'SAPWrite', args);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      state,
      error,
      retryable: false,
      cleanupFailed: true,
      sessionClosed: true,
    });
  });
  it.each(['reader', 'deny-action'] as const)('refuses %s before invoking the native adapter', async (gate) => {
    const { client, config, adapter } = fixture();
    if (gate === 'deny-action') config.denyActions = ['SAPWrite.delete'];
    const result = await handleToolCall(client, config, 'SAPWrite', args, {
      token: 'test',
      clientId: 'test',
      scopes: gate === 'reader' ? ['read'] : ['read', 'write'],
    });
    expect(result.isError).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    'missing-target',
    'wrong-target',
    'missing-config-policy',
    'missing-client-policy',
    'read-only',
    'non-strict',
    'disabled-policy',
  ] as const)('fails closed for %s without legacy fallback', async (gate) => {
    const { client, config, adapter } = fixture();
    if (gate === 'missing-target') config.targetId = '';
    if (gate === 'wrong-target') config.targetId = 'OTHER/001';
    if (gate === 'missing-config-policy') (config as any).multiTargetWrite = undefined;
    if (gate === 'missing-client-policy') client.safety.multiTargetWrite = undefined;
    if (gate === 'read-only') client.safety.allowWrites = false;
    if (gate === 'non-strict') config.ppStrict = false;
    if (gate === 'disabled-policy') config.multiTargetWrite.enabled = false;
    const result = await handleSAPWrite(client, args, config, undefined, { isPerUserClient: true });
    expect(result.isError).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { type: 'PROG' },
    { source: 'report ztest.' },
    { expectedSourceHash: 'a'.repeat(64) },
    { include: 'definitions' },
    { package: '$TMP' },
    { objects: [] },
  ])('refuses unqualified delete input %j', async (extra) => {
    const { client, config, adapter } = fixture();
    const result = await handleSAPWrite(client, { ...args, ...extra }, config, undefined, { isPerUserClient: true });
    expect(result.isError).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('does not turn a lone pinned safety marker into a legacy write', async () => {
    const { client, adapter } = fixture();
    const result = await handleSAPWrite(client, args, { ...DEFAULT_CONFIG, allowWrites: true }, undefined, {
      isPerUserClient: true,
    });
    expect(result.isError).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
