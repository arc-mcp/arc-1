import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataResultScope, DEFAULT_DATA_PREVIEW_RESPONSE_BYTES } from '../../../src/adt/data-result-context.js';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const writeFailure = vi.hoisted(() => ({ error: undefined as unknown }));
vi.mock('../../../src/handlers/write.js', () => ({
  handleSAPWrite: async () => {
    throw writeFailure.error;
  },
}));
// Admission is tested elsewhere; keep these error-mapping tests independent of the route gate.
vi.mock('../../../src/server/multi-target-tools.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  multiTargetInvocationDecision: () => 'allowed',
}));

const SECRETS = ['ZSECRET_PROG', 'SECRETUSER', 'A4HK900001', 'secret-sap-text'];

async function call(toolName: string, args: Record<string, unknown>, readFailure?: unknown) {
  const client = {
    createDataResultScope: () => new DataResultScope(DEFAULT_DATA_PREVIEW_RESPONSE_BYTES),
    getSystemInfo: async () => {
      throw readFailure;
    },
  };
  const result = await handleToolCall(
    client as never,
    { ...DEFAULT_CONFIG, targetId: 'A4H/001' },
    toolName,
    args,
    undefined,
    undefined,
    undefined,
    true,
    undefined,
    'REQ-REFUSAL',
  );
  const text = result.content[0]?.text ?? '';
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  return JSON.parse(text);
}

function sapError(status: number, type: string, message: string, path = '/sap/bc/adt/programs/programs/zsecret_prog') {
  const body = `<exc:exception><type id="${type}"/><localizedMessage>${message}</localizedMessage></exc:exception>`;
  return new AdtApiError(message, status, path, body);
}

const create = { action: 'create', type: 'PROG', name: 'ZSECRET_PROG', package: '$TMP', source: 'REPORT x.' };
const update = { action: 'update', type: 'PROG', name: 'ZSECRET_PROG', source: 'REPORT x.' };

describe('multi-target deterministic SAP refusals and unknown mutation outcomes', () => {
  afterEach(() => {
    writeFailure.error = undefined;
  });

  it('reports an existing object on create as a non-retryable refusal', async () => {
    const error = sapError(
      500,
      'ExceptionResourceCreationFailure',
      'Resource ZSECRET_PROG does already exist secret-sap-text',
    );
    error.creationOutcome = 'unknown';
    writeFailure.error = error;
    const payload = await call('SAPWrite', create);
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: false, target: 'A4H/001' });
    expect(payload.message).toContain('already exists, so this create request did not create it');
    expect(payload.message).toContain('Do not retry the create');
    expect(payload.message).not.toContain('Retry once');
  });

  it('does not trust free-text "already exists" without the structured exception type', async () => {
    const error = new AdtApiError('x', 500, '/sap/bc/adt/programs/programs', 'resource ZSECRET_PROG already exists');
    error.creationOutcome = 'unknown';
    writeFailure.error = error;
    const payload = await call('SAPWrite', create);
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: false });
    expect(payload.message).toContain('cannot confirm whether the change was applied');
  });

  it('reports a lock conflict without the lock owner or request', async () => {
    writeFailure.error = sapError(
      500,
      'ExceptionResourceLockedByAnotherUser',
      'Object is locked by user SECRETUSER in transport A4HK900001',
    );
    const payload = await call('SAPWrite', update);
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: false });
    expect(payload.message).toContain('locked by another user or session');
    expect(payload.message).toContain('Read the object back before repeating the change');
  });

  it('reports an unsupported operation as non-retryable', async () => {
    const payload = await call(
      'SAPRead',
      { type: 'SYSTEM' },
      sapError(500, 'ExceptionMethodNotSupported', 'secret-sap-text', '/sap/bc/adt/core/discovery'),
    );
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: false });
    expect(payload.message).toContain('does not support this operation');
    expect(payload.message).not.toContain('Read the object back');
  });

  it('reports an uninitialized class test include as non-retryable', async () => {
    writeFailure.error = sapError(
      500,
      'ExceptionResourceSaveFailure',
      'ZSECRET_PROG does not have any inactive version secret-sap-text',
      '/sap/bc/adt/oo/classes/zsecret_prog/includes/testclasses',
    );
    const payload = await call('SAPWrite', { action: 'update', type: 'CLAS', name: 'ZCL_X', source: 'x' });
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: false });
    expect(payload.message).toContain('include="testclasses"');
  });

  it('treats an unknown activation outcome as a mutation even on a read-scoped tool', async () => {
    const error = new AdtApiError('secret-sap-text', 500, '/sap/bc/adt/core/discovery', 'secret-sap-text');
    error.activationOutcome = 'unknown';
    const payload = await call('SAPRead', { type: 'SYSTEM' }, error);
    expect(payload).toMatchObject({ retryable: false });
    expect(payload.message).toContain('cannot confirm whether the change was applied');
  });

  it('keeps an object-exists body on a non-create 5xx on the default path', async () => {
    const payload = await call(
      'SAPRead',
      { type: 'SYSTEM' },
      sapError(500, 'ExceptionResourceCreationFailure', 'ZSECRET_PROG already exists', '/sap/bc/adt/core/discovery'),
    );
    expect(payload).toMatchObject({ retryable: true });
    expect(payload.message).toContain('Retry once');
  });

  it('keeps a real 503 on a read retryable', async () => {
    const payload = await call(
      'SAPRead',
      { type: 'SYSTEM' },
      new AdtApiError('secret-sap-text', 503, '/sap/bc/adt/core/discovery', 'secret-sap-text'),
    );
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: true });
    expect(payload.message).toContain('Retry once');
  });

  it.each([
    ['server error', new AdtApiError('secret-sap-text', 500, '/sap/bc/adt/programs/programs/x', 'secret-sap-text')],
    ['network failure', new AdtNetworkError('secret-sap-text')],
  ])('advises read-back, never a retry, after a mutation %s', async (_kind, error) => {
    writeFailure.error = error;
    const payload = await call('SAPWrite', update);
    expect(payload).toMatchObject({ error: 'SAP_REQUEST_FAILED', retryable: false });
    expect(payload.message).toContain('cannot confirm whether the change was applied');
    expect(payload.message).toContain('read the object back');
    expect(payload.message).not.toContain('Retry once');
  });
});
