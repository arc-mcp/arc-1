/** Fixed v3 accepts bounded, unmodified JPEG captures under honest .jpg names. No image conversion. */
import {
  readSavedDeclarativeIntent,
  readSavedDeclarativePrerequisites,
  type DeclarativeBinding,
} from './native-declarative-prerequisites.js';

export const DECLARATIVE_V3 = 'pr1142-native-declarative-v3';
export const DECLARATIVE_V3_NODE = 'v22.21.1';

/** Bounded JPEG marker/segment validation, not decoding or verification of the operator's SM12 observation. */
export function jpegEvidenceSignature(body: Buffer) {
  if (body.length < 20 || body.length > 8 * 1024 * 1024 || body.readUInt16BE(0) !== 0xffd8) return false;
  let offset = 2,
    frame = false,
    scan = false;
  while (offset < body.length) {
    if (body[offset++] !== 0xff) return false;
    while (body[offset] === 0xff) offset++;
    const marker = body[offset++];
    if (marker === 0xd9) return frame && scan && offset === body.length;
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      offset + 2 > body.length
    )
      return false;
    const length = body.readUInt16BE(offset);
    if (length < 2 || offset + length > body.length) return false;
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || length < 8 || body[offset + 2] !== 8) return false;
      const height = body.readUInt16BE(offset + 3),
        width = body.readUInt16BE(offset + 5),
        components = body[offset + 7];
      if (!height || !width || ![1, 3, 4].includes(components) || length !== 8 + components * 3) return false;
      frame = true;
    } else if (
      !(
        marker === 0xc4 ||
        marker === 0xdb ||
        marker === 0xdd ||
        marker === 0xda ||
        marker === 0xfe ||
        (marker >= 0xe0 && marker <= 0xef)
      )
    )
      return false;
    if (marker === 0xda) {
      if (!frame || length < 6 || ![1, 2, 3, 4].includes(body[offset + 2]) || length !== 6 + body[offset + 2] * 2)
        return false;
      scan = true;
    }
    offset += length;
    if (marker === 0xda) {
      while (offset < body.length) {
        if (body[offset] !== 0xff) {
          offset++;
          continue;
        }
        const next = body[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
    }
  }
  return false;
}

export function readV3Intent(binding: DeclarativeBinding) {
  return readSavedDeclarativeIntent(binding, 'v3');
}
export function readV3Prerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readV3Intent>,
  sample: string,
  now: number,
) {
  return readSavedDeclarativePrerequisites(binding, intent, sample, now, {
    version: 'v3',
    extension: 'jpg',
    signature: jpegEvidenceSignature,
  });
}
