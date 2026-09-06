#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { inspectMtar } from './mtar-inspection.mjs';

// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters in literal CLI paths.
const FORBIDDEN_ARGUMENT = /[*?[\]{}\x00-\x1f\x7f]/;

const HELP = `Usage: npm run btp:inspect-mtar -- --archive <exact-path.mtar> [--format text|json] [--list]
Inspect a locally built ARC-1 base/UI MTAR; no extraction, network access or deployment.
One explicit archive is required (no globs/newest selection). --list prints all checked member names.
Exit codes: 0 = PASS of stated checks, 1 = archive FAIL, 2 = usage/I/O/checker ERROR.
For machine-readable stdout use npm run --silent btp:inspect-mtar -- --archive <path> --format json.
PASS is not proof of absence of all secrets, valid CF configuration, or SAP identity.
`;

function options(args) {
  const parsed = parseArgs({
    args,
    options: {
      archive: { type: 'string' },
      format: { type: 'string', default: 'text' },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    tokens: true,
    allowPositionals: false,
  });
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new Error('Repeated option');
    seen.add(token.name);
  }
  if (!['text', 'json'].includes(parsed.values.format)) throw new Error('Unknown format');
  if (!parsed.values.help && (!parsed.values.archive || FORBIDDEN_ARGUMENT.test(parsed.values.archive))) {
    throw new Error('One literal archive path is required');
  }
  return parsed.values;
}

try {
  const args = options(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
  } else {
    const result = await inspectMtar(args.archive);
    if (args.format === 'json') {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      // JSON quoting keeps names inert in terminals and clearly identifies untrusted archive data.
      process.stdout.write(`${result.outcome}: ${JSON.stringify(result.artifact.name)}\n`);
      process.stdout.write(
        `Bytes: ${result.artifact.sizeBytes ?? 'unknown'}; SHA-256: ${result.artifact.sha256 ?? 'unavailable'}\n`,
      );
      process.stdout.write(`Checked payloads: ${result.checkedPayloads.length}\n`);
      for (const payload of result.checkedPayloads)
        process.stdout.write(`  ${JSON.stringify(payload.member)}: ${payload.files} files\n`);
      for (const finding of result.findings)
        process.stdout.write(`${finding.code}: ${finding.message} ${JSON.stringify(finding.member ?? '')}\n`);
      if (args.list) {
        for (const member of result.members)
          process.stdout.write(`${JSON.stringify(`${member.archive}:${member.path}`)} (${member.bytes} bytes)\n`);
      }
      process.stdout.write(`${result.qualification}\n`);
    }
    process.exitCode = result.outcome === 'PASS' ? 0 : result.outcome === 'FAIL' ? 1 : 2;
  }
} catch {
  // Do not echo arguments or raw parser exceptions (may contain local secrets).
  process.stderr.write(`Invalid inspection arguments.\n${HELP}`);
  process.exitCode = 2;
}
