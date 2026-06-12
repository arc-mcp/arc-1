#!/usr/bin/env node

/**
 * Portable helpers for local E2E shell scripts.
 *
 * Keep JSON parsing and log classification in Node.js so the shell scripts do
 * not depend on GNU-only grep flags or platform-specific text processing.
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

/**
 * Generate a short, letters-only run id (3 uppercase A-Z chars). Letters-only so
 * it survives tests/helpers/run-id.ts sanitization unchanged and is valid inside
 * BDEF/CDS identifiers. `rng` is injectable for deterministic tests.
 */
export function generateRunId(rng = Math.random) {
  let n = Math.floor(rng() * 26 * 26 * 26);
  let s = '';
  for (let i = 0; i < 3; i++) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/** Resolve a free TCP port by binding to port 0 and reading the assigned port. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function readHealthField(rawJson, field) {
  try {
    const parsed = JSON.parse(rawJson || '{}');
    const value = parsed?.[field];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  } catch {
    // malformed health response; caller gets the stable fallback below
  }
  return 'unknown';
}

export function isErrorLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return String(parsed?.level ?? '').toLowerCase() === 'error';
    } catch {
      return false;
    }
  }

  return /\]\s+ERROR:/.test(line);
}

export function summarizeLogErrors(logText, limit = 5) {
  const normalized = logText.replace(/\r\n/g, '\n');
  const lines = normalized.length === 0 ? [] : normalized.replace(/\n$/, '').split('\n');
  const errorLines = lines.filter(isErrorLogLine);

  return {
    lineCount: lines.length,
    errorCount: errorLines.length,
    lastErrors: errorLines.slice(-limit),
  };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

function printErrorSummary(logFile) {
  let logText = '';
  try {
    logText = readFileSync(logFile, 'utf8');
  } catch {
    console.log(`-- Log: ${logFile} (0 lines)`);
    return;
  }

  const summary = summarizeLogErrors(logText);
  console.log(`-- Log: ${logFile} (${summary.lineCount} lines)`);
  if (summary.errorCount > 0) {
    console.log(`!! Found ${summary.errorCount} error(s) in server log. Last 5:`);
    for (const line of summary.lastErrors) {
      console.log(line);
    }
    console.log('');
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'health-field') {
    const [field] = args;
    const raw = await readStdin();
    console.log(readHealthField(raw, field));
    return;
  }

  if (command === 'error-summary') {
    const [logFile] = args;
    if (!logFile) {
      console.error('Usage: node scripts/e2e-local-utils.mjs error-summary <log-file>');
      process.exitCode = 1;
      return;
    }
    printErrorSummary(logFile);
    return;
  }

  if (command === 'run-id') {
    console.log(generateRunId());
    return;
  }

  if (command === 'free-port') {
    console.log(await findFreePort());
    return;
  }

  console.error('Usage: node scripts/e2e-local-utils.mjs <health-field|error-summary|run-id|free-port> ...');
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
