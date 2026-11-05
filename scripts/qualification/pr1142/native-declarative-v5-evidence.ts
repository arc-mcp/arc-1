/** V5 binds the consumed predecessor facts and uses the existing raw-JPEG prerequisites. */
import {
  readSavedDeclarativeIntent,
  readSavedDeclarativePrerequisites,
  type DeclarativeBinding,
} from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { DECLARATIVE_V5_HISTORY } from './native-declarative-v5-history.js';
export const DECLARATIVE_V5 = 'pr1142-native-declarative-v5';
export function readV5Intent(binding: DeclarativeBinding) {
  return readSavedDeclarativeIntent(binding, 'v5', DECLARATIVE_V5_HISTORY);
}
export function readV5Prerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readV5Intent>,
  sample: string,
  now: number,
) {
  return readSavedDeclarativePrerequisites(binding, intent, sample, now, {
    version: 'v5',
    extension: 'jpg',
    signature: jpegEvidenceSignature,
  });
}
