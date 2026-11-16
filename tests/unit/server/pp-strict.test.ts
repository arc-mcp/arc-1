import { describe, expect, it } from 'vitest';
import type { MultiTargetErrorBuilder } from '../../../src/server/multi-target-server.js';
import { strictPpNonJwtError } from '../../../src/server/pp-strict.js';

describe('strictPpNonJwtError', () => {
  it('refuses a single-target API key caller without invoking a multi-target error builder', () => {
    const builder: MultiTargetErrorBuilder = () => {
      throw new Error('unexpected multi-target builder');
    };
    expect(strictPpNonJwtError(false, builder)).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining('SAP_PP_STRICT=true') }],
    });
  });

  it('uses the structured multi-target PP error', () => {
    const builder: MultiTargetErrorBuilder = (code, message, details, authReason) => ({
      code,
      message,
      details,
      authReason,
    });
    expect(strictPpNonJwtError(true, builder)).toMatchObject({
      code: 'PP_SETUP_FAILED',
      authReason: 'pp_exchange_failed',
      details: { retryable: true },
    });
  });
});
