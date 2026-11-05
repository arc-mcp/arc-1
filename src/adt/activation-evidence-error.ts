/** Keep native diagnostic text separate from the safe execution-evidence failure message. */
import type { ActivationResult } from './devtools.js';
import { AdtSafetyError } from './errors.js';

export function boundedActivationResult(result: ActivationResult): ActivationResult {
  return {
    ...result,
    messages: result.messages.slice(0, 5).map((message) => message.slice(0, 500)),
    ...(result.details
      ? {
          details: result.details.slice(0, 5).map((detail) => ({
            ...detail,
            text: detail.text.slice(0, 500),
            ...(detail.uri ? { uri: detail.uri.slice(0, 500) } : {}),
          })),
        }
      : {}),
  };
}

export class ActivationEvidenceError extends AdtSafetyError {
  readonly nativeActivation: ActivationResult;
  constructor(messages: string[], details: ActivationResult['details']) {
    super('SAP did not affirm activation execution. Inspect the active and inactive owner before continuing.');
    this.nativeActivation = boundedActivationResult({ success: false, messages, details });
  }
}
