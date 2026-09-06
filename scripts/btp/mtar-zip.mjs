import { crc32 } from 'node:zlib';
import { fromBufferPromise } from 'yauzl';

// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in untrusted archive names.
const UNSAFE_NAME = /[\\:\x00-\x1f\x7f]/;

export const LIMITS = Object.freeze({
  archiveBytes: 256 * 1024 * 1024,
  entryBytes: 128 * 1024 * 1024,
  expandedBytes: 512 * 1024 * 1024,
  metadataBytes: 1024 * 1024,
  entries: 20_000,
  nameBytes: 512,
});

export class InspectionFailure extends Error {
  constructor(code, message, member = undefined) {
    super(message);
    this.code = code;
    this.member = member;
  }
}

export function requireCheck(condition, code, message, member = undefined) {
  if (!condition) throw new InspectionFailure(code, message, member);
}

function safeName(name, limits) {
  // Reject rather than normalize: two spellings must never denote the same deployment path.
  const parts = name.replace(/\/$/, '').split('/');
  requireCheck(
    Buffer.byteLength(name) <= limits.nameBytes &&
      !UNSAFE_NAME.test(name) &&
      parts.every((part) => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part)),
    'UNSAFE_PATH',
    'Archive contains an unsafe or non-portable member name.',
  );
}

/** Sequential, bounded ZIP reads. No extraction; bodies not requested by retain() are discarded. */
export async function readZip(buffer, label, budget, retain) {
  const limits = budget.limits;
  const files = new Map();
  const names = new Map();
  const ranges = [];
  let zip;
  try {
    zip = await fromBufferPromise(buffer, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    requireCheck(zip.entryCount <= limits.entries - budget.entries, 'LIMIT', 'Archive entry limit exceeded.', label);
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      safeName(name, limits);
      requireCheck(
        Buffer.from(name, 'utf8').equals(entry.fileNameRaw),
        'UNSUPPORTED_ENTRY',
        'Legacy or conflicting filename encodings are not supported.',
      );
      const member = `${label}:${name}`;
      const directory = name.endsWith('/');
      const canonical = name.replace(/\/$/, '').toLowerCase();
      requireCheck(!names.has(canonical), 'DUPLICATE_PATH', 'Duplicate or case-ambiguous member.', member);
      names.set(canonical, directory);
      const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
      requireCheck(
        kind === 0 || kind === (directory ? 0o040000 : 0o100000),
        'UNSUPPORTED_ENTRY',
        'Symlinks and special files are not supported.',
        member,
      );
      requireCheck(!entry.isEncrypted(), 'ENCRYPTED', 'Encrypted entries cannot be inspected.', member);
      requireCheck(
        [0, 8].includes(entry.compressionMethod),
        'COMPRESSION',
        'Only stored/deflated ZIPs are supported.',
        member,
      );
      requireCheck((entry.generalPurposeBitFlag & ~0x80e) === 0, 'UNSUPPORTED_ENTRY', 'Unsupported ZIP flags.', member);
      const local = await zip.readLocalFileHeaderPromise(entry);
      ranges.push([entry.relativeOffsetOfLocalHeader, local.fileDataStart + entry.compressedSize]);
      requireCheck(
        local.fileName.equals(entry.fileNameRaw) &&
          local.generalPurposeBitFlag === entry.generalPurposeBitFlag &&
          local.compressionMethod === entry.compressionMethod,
        'INTEGRITY',
        'Local and central ZIP headers disagree.',
        member,
      );
      if (!(entry.generalPurposeBitFlag & 8)) {
        requireCheck(
          local.crc32 === entry.crc32 &&
            (local.compressedSize === 0xffffffff || local.compressedSize === entry.compressedSize) &&
            (local.uncompressedSize === 0xffffffff || local.uncompressedSize === entry.uncompressedSize),
          'INTEGRITY',
          'Local and central ZIP sizes/CRC disagree.',
          member,
        );
      }
      requireCheck(++budget.entries <= limits.entries, 'LIMIT', 'Archive entry limit exceeded.', member);
      const keepLimit = retain(name);
      const max = directory ? 0 : Math.min(limits.entryBytes, keepLimit ?? limits.entryBytes);
      requireCheck(entry.uncompressedSize <= max, 'LIMIT', 'Expanded entry size limit exceeded.', member);
      requireCheck(
        entry.uncompressedSize <= limits.expandedBytes - budget.bytes,
        'LIMIT',
        'Combined expanded size limit exceeded.',
        member,
      );
      const chunks = [];
      let bytes = 0;
      let checksum = 0;
      const stream = await zip.openReadStreamPromise(entry);
      try {
        for await (const chunk of stream) {
          bytes += chunk.length;
          budget.bytes += chunk.length;
          requireCheck(
            bytes <= max && budget.bytes <= limits.expandedBytes,
            'LIMIT',
            'Expansion limit exceeded.',
            member,
          );
          checksum = crc32(chunk, checksum);
          if (keepLimit !== undefined) chunks.push(chunk);
        }
      } finally {
        stream.destroy();
      }
      requireCheck(
        bytes === entry.uncompressedSize && checksum === entry.crc32,
        'INTEGRITY',
        'ZIP size/CRC mismatch.',
        member,
      );
      if (!directory) {
        files.set(name, keepLimit === undefined ? undefined : Buffer.concat(chunks, bytes));
        budget.members.push({ archive: label, path: name, bytes });
      }
    }
    // Also reject a file that is used as another entry's parent directory.
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      requireCheck(ranges[i][0] >= ranges[i - 1][1], 'INTEGRITY', 'Overlapping ZIP members.', label);
    }
    for (const name of names.keys()) {
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        requireCheck(
          names.get(parts.slice(0, i).join('/')) !== false,
          'DUPLICATE_PATH',
          'File/directory collision.',
          label,
        );
      }
    }
    return files;
  } catch (error) {
    if (error instanceof InspectionFailure) throw error;
    // ZIP exceptions can contain attacker-controlled filenames: never print the raw exception.
    throw new InspectionFailure('INVALID_ZIP', 'ZIP is corrupt, truncated or unsupported.', label);
  } finally {
    zip?.close();
  }
}
