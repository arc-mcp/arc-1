import type { MultiTargetErrorBuilder } from './multi-target-server.js';

/** Refuse a non-JWT caller before any shared SAP client is used in explicitly strict PP mode. */
export function strictPpNonJwtError(
  multiTarget: boolean,
  multiError: MultiTargetErrorBuilder,
): Record<string, unknown> {
  if (multiTarget) {
    return multiError(
      'PP_SETUP_FAILED',
      'Multi-target routes require an XSUAA JWT for strict principal propagation. Sign in with XSUAA and try again.',
      { retryable: true },
      'pp_exchange_failed',
    );
  }
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Principal propagation requires a JWT token (SAP_PP_STRICT=true). API key authentication is not supported in strict PP mode.',
      },
    ],
    isError: true,
  };
}
