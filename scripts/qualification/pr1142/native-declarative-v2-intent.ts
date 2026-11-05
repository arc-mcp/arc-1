/** Historical v2 remains PNG-only with its original fixed protocol and prerequisite behavior. */
import {
  readSavedDeclarativeIntent,
  readSavedDeclarativePrerequisites,
  type DeclarativeBinding,
} from './native-declarative-prerequisites.js';
export { privateEvidence, PREREQUISITE_AGE_MS, type DeclarativeBinding } from './native-declarative-prerequisites.js';
export const DECLARATIVE_V2 = 'pr1142-native-declarative-v2';
export const DECLARATIVE_V2_NODE = 'v22.21.1';
export function readV2Intent(binding: DeclarativeBinding) {
  return readSavedDeclarativeIntent(binding, 'v2');
}
export type V2Intent = ReturnType<typeof readV2Intent>;
export function readV2Prerequisites(binding: DeclarativeBinding, intent: V2Intent, sample: string, now: number) {
  return readSavedDeclarativePrerequisites(binding, intent, sample, now, {
    version: 'v2',
    extension: 'png',
    signature: (body) => body.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  });
}
