/** V4 binds the consumed predecessor facts and uses the existing raw-JPEG prerequisites. */
import {
  readSavedDeclarativeIntent,
  readSavedDeclarativePrerequisites,
  type DeclarativeBinding,
} from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { DECLARATIVE_V4_HISTORY } from './native-declarative-v4-history.js';
export const DECLARATIVE_V4 = 'pr1142-native-declarative-v4';
export function readV4Intent(binding: DeclarativeBinding) {
  return readSavedDeclarativeIntent(binding, 'v4', DECLARATIVE_V4_HISTORY);
}
export function readV4Prerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readV4Intent>,
  sample: string,
  now: number,
) {
  return readSavedDeclarativePrerequisites(binding, intent, sample, now, {
    version: 'v4',
    extension: 'jpg',
    signature: jpegEvidenceSignature,
  });
}
