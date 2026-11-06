#!/usr/bin/env node
/** Local source transfer helper. No SAP connection or ARC-1 configuration is loaded. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

const SOURCE_LIMIT = 200_000;
const ENVELOPE_LIMIT = 300_000;

function readBounded(fd, limit) {
  const bytes = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < bytes.length) {
    const count = readSync(fd, bytes, size, bytes.length - size, null);
    if (count === 0) break;
    size += count;
  }
  if (size > limit) throw new Error(`Input exceeds ${limit} bytes; use a smaller source part.`);
  return bytes.subarray(0, size);
}

function decode(bytes) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function inspect(source) {
  if (typeof source !== 'string' || !source || source.includes('\0'))
    throw new Error('Source must be non-empty UTF-8 text without NUL characters.');
  if (source.startsWith('\ufeff'))
    throw new Error('Source starts with a UTF-8 BOM; save the file as UTF-8 without BOM.');
  const bytes = Buffer.from(source, 'utf8');
  // JSON can contain lone surrogates; never silently replace them during verification.
  if (decode(bytes) !== source) throw new Error('Source contains invalid Unicode.');
  if (bytes.length > SOURCE_LIMIT) throw new Error(`Source exceeds ${SOURCE_LIMIT} bytes.`);
  return { sourceBytes: bytes.length, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
}

function readFile(path) {
  // Non-blocking open lets us refuse FIFOs instead of waiting for a writer on POSIX.
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Source path must be a regular file.');
    if (stat.size > SOURCE_LIMIT) throw new Error(`Source exceeds ${SOURCE_LIMIT} bytes.`);
    const source = decode(readBounded(fd, SOURCE_LIMIT));
    return { source, ...inspect(source) };
  } finally {
    closeSync(fd);
  }
}

function verify(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
    throw new Error('Expected a source envelope.');
  const actual = inspect(envelope.source);
  if (envelope.sourceBytes !== actual.sourceBytes || envelope.sourceSha256 !== actual.sourceSha256)
    throw new Error('Source integrity mismatch; refuse SAPWrite.');
  return { verified: true, ...actual };
}

function readEnvelope() {
  const input = decode(readBounded(0, ENVELOPE_LIMIT));
  try {
    return JSON.parse(input);
  } catch {
    // JSON parser errors can include source excerpts; do not echo them.
    throw new Error('Invalid source envelope JSON.');
  }
}

try {
  const [command, path, ...extra] = process.argv.slice(2);
  let result;
  if (command === 'read' && path && extra.length === 0) result = readFile(path);
  else if (command === 'verify' && path === undefined) result = verify(readEnvelope());
  else throw new Error('Usage: arc1-source read FILE | arc1-source verify < envelope.json');
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) + 1 > ENVELOPE_LIMIT)
    throw new Error(`Encoded envelope exceeds ${ENVELOPE_LIMIT} bytes.`);
  process.stdout.write(`${json}\n`);
} catch (error) {
  process.stderr.write(`arc1-source: ${error instanceof Error ? error.message : 'Source transfer failed'}\n`);
  process.exitCode = 1;
}
