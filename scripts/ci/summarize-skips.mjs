#!/usr/bin/env node
/**
 * Integration-test skip summary.
 *
 * Reads a vitest run log (stdin or a file path) and groups `↓ <test> [<reason>]`
 * lines into the categories documented in `docs/integration-test-skips.md`.
 * Prints a compact table so operators can tell at a glance whether a run's
 * skip profile matches the target system (S/4, plain NW, BTP ABAP, etc.).
 *
 * Usage:
 *   npm run test:integration 2>&1 | tee /tmp/run.log
 *   node scripts/ci/summarize-skips.mjs /tmp/run.log
 *
 * Or pipe directly:
 *   npm run test:integration 2>&1 | node scripts/ci/summarize-skips.mjs
 *
 * Or use the npm shortcut:
 *   npm run test:integration:skip-summary
 */

import { readFileSync } from 'node:fs';

/**
 * Ordered categorization rules. First regex that matches wins.
 *
 * The order matters: put specific matches before catch-alls. Keep this table
 * in sync with `docs/integration-test-skips.md` — skip messages are the public
 * API of the taxonomy.
 */
const CATEGORIES = [
  {
    name: 'S/4-only demo content',
    shortName: 's4-demo',
    patterns: [
      /\/DMO\//,
      /ZCL_DEMO_D_CALC_AMOUNT/,
      /BOBF/i,
      /I_ABAPPACKAGE/,
    ],
    hint: 'Flight Reference / BOBF content ships on S/4HANA only.',
  },
  {
    name: 'Release gap (pre-7.52 / pre-RAP)',
    shortName: 'release-gap',
    patterns: [
      /DOMA reads not supported/i,
      /DTEL v2 content type/i,
      /\/datapreview\/ddic endpoint not available/i,
      /\/ddic\/domains endpoint not available/i,
      /\/ddic\/tables collection not available/i,
      /TABL source read not available/i,
      /\/packages endpoint not available/i,
      /usageReferences endpoint unstable/i,
      /transport create not supported/i,
      /TRAN metadata .* on this release/i,
      /SAPQuery relies on \/datapreview/i,
    ],
    hint: 'ADT endpoint or content type not available on this SAP_BASIS level.',
  },
  {
    name: 'Backend quirk (trial / release-specific bug)',
    shortName: 'backend-quirk',
    patterns: [
      /lock-handle session correlation/i,
      /PageChipInstances service unstable/i,
      /batch_create aggregated inner-object failure/i,
      /Stale partial-create/i,
      /HTTP 400 for custom class source offset/i,
    ],
    hint: 'Known backend instability on specific releases.',
  },
  {
    name: 'Infrastructure gap (e2e fixture not seeded)',
    shortName: 'infra-fixture',
    patterns: [
      /ZCL_ARC1/i,
      /ZIF_ARC1/i,
      /ZARC1_TEST_REPORT/i,
      /ZARC1_E2E_WRITE/i,
      /ZI_ARC1_I33/i,
      /Persistent fixture .* is missing/i,
      /npm run test:e2e/i,
      /fixture sync skipped this object/i,
      /no revisions recorded for this object/i,
      /has no (?:upstream|revisions)/i,
      /fixture sync likely produced a stub/i,
      /VERSIONS returned non-JSON/i,
      /No custom CLAS\/INTF found/i,
      /No objects in \$DEMO_SOI_DRAFT/i,
      /system has (?:no|nothing)/i,
      /Where-used index empty/i,
      /Custom Z fixtures missing/i,
    ],
    hint: 'Run `npm run test:e2e` once against the target system to seed. Some fixtures need a modern SAP release.',
  },
  {
    name: 'Credentials / policy (opt-in or missing config)',
    shortName: 'policy',
    patterns: [
      /SAP credentials not configured/i,
      /TEST_TRANSPORT_PACKAGE not configured/i,
      /TEST_TRANSPORT_OBJECT_NAME/i,
      /Transports not enabled on MCP server/i,
      /scope denied/i,
    ],
    hint: 'Opt-in env var not set, or test user lacks SAP authorization.',
  },
  {
    name: 'Uninstalled / unconfigured backend features',
    shortName: 'backend-unsupported',
    patterns: [
      /gCTS/i,
      /abapGit/i,
      /No DDLS object/i,
      /No short dumps/i,
      /RSHOWTIM/i,
      /Version source endpoint unavailable/i,
      /Version source HEAD fetch unsupported/i,
      /Backend feature not supported/i,
      /Backend does not support/i,
    ],
    hint: 'Feature present on this release but not installed/configured.',
  },
  {
    name: 'Missing fixture (other)',
    shortName: 'other-fixture',
    patterns: [/Required test fixture not found/i, /NO_FIXTURE/i],
    hint: 'Test expects a fixture that the target system does not ship.',
  },
];

function classify(message) {
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((re) => re.test(message))) return cat;
  }
  return { name: 'Uncategorized', shortName: 'uncategorized', hint: 'Add a pattern to summarize-skips.mjs.' };
}

/**
 * Parse a vitest verbose-reporter log line of the form:
 *   `     ↓ <test title> <duration>ms [<skip reason>]`
 *
 * Older vitest versions omit duration. We accept either shape.
 * Returns `{ title, message }` or null.
 */
function parseSkipLine(line) {
  // Strip ANSI escapes so a colored terminal log still parses.
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
  // The `↓` glyph (U+2193) marks a skipped test in vitest's default output.
  const match = clean.match(/↓\s+(.+?)(?:\s+\d+(?:\.\d+)?m?s)?\s+\[(.+?)\]\s*$/);
  if (!match) return null;
  return { title: match[1].trim(), message: match[2].trim() };
}

async function readInput(argv) {
  const arg = argv.slice(2).find((a) => !a.startsWith('--'));
  if (arg) {
    return readFileSync(arg, 'utf-8');
  }
  if (process.stdin.isTTY) {
    process.stderr.write(
      'No input. Pipe a vitest run log in, or pass a file path.\n' +
        'Example: npm run test:integration 2>&1 | node scripts/ci/summarize-skips.mjs\n',
    );
    process.exit(2);
  }
  // Stream stdin asynchronously — readFileSync(0) fails on piped FDs in Node 22.
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/**
 * Parse the vitest summary footer (`Tests  X passed | Y skipped (Z)`) so we
 * can reconcile our per-test `↓` count against the run's overall skip count.
 * The delta is the number of tests skipped via file/describe-level mechanisms
 * (e.g. whole BTP suites skipping on missing credentials), which vitest
 * summarizes per file rather than per test.
 */
function parseOverallSkipCount(lines) {
  for (const rawLine of lines) {
    const clean = rawLine.replace(/\x1b\[[0-9;]*m/g, '');
    const m = clean.match(/Tests\s+(?:\d+\s+failed\s+\|\s+)?(?:\d+\s+passed\s+\|\s+)?(\d+)\s+skipped/);
    if (m) return Number.parseInt(m[1], 10);
  }
  return null;
}

async function main() {
  const raw = await readInput(process.argv);
  const lines = raw.split(/\r?\n/);
  const skips = [];
  for (const line of lines) {
    const parsed = parseSkipLine(line);
    if (parsed) skips.push(parsed);
  }
  const overallSkipCount = parseOverallSkipCount(lines);

  if (skips.length === 0) {
    process.stdout.write('No skipped tests found in input.\n');
    process.stdout.write('(The log must be a vitest run with default/verbose reporter output.)\n');
    process.exit(0);
  }

  // Group by category.
  const buckets = new Map();
  for (const s of skips) {
    const cat = classify(s.message);
    if (!buckets.has(cat.name)) buckets.set(cat.name, { cat, items: [] });
    buckets.get(cat.name).items.push(s);
  }

  // Sort buckets by size descending.
  const sorted = [...buckets.values()].sort((a, b) => b.items.length - a.items.length);

  const total = skips.length;
  process.stdout.write(`Skip summary — ${total} test${total === 1 ? '' : 's'} skipped\n`);
  process.stdout.write('─'.repeat(72) + '\n');

  for (const bucket of sorted) {
    const header = `${pad(bucket.cat.name, 50)} ${String(bucket.items.length).padStart(4)} test${bucket.items.length === 1 ? '' : 's'}`;
    process.stdout.write(`${header}\n`);
    process.stdout.write(`  ${bucket.cat.hint}\n`);
    // Show up to 3 representative examples per bucket (dedupe by message).
    const seen = new Set();
    const samples = [];
    for (const item of bucket.items) {
      if (!seen.has(item.message)) {
        seen.add(item.message);
        samples.push(item);
        if (samples.length === 3) break;
      }
    }
    for (const s of samples) {
      const truncatedTitle = s.title.length > 42 ? `${s.title.slice(0, 41)}…` : s.title;
      const truncatedMessage = s.message.length > 60 ? `${s.message.slice(0, 59)}…` : s.message;
      process.stdout.write(`    • ${pad(truncatedTitle, 42)}  ${truncatedMessage}\n`);
    }
    const extras = bucket.items.length - samples.length;
    if (extras > 0) {
      process.stdout.write(`    (+ ${extras} more)\n`);
    }
    process.stdout.write('\n');
  }

  if (overallSkipCount !== null && overallSkipCount > total) {
    const delta = overallSkipCount - total;
    process.stdout.write(
      `Note: vitest reported ${overallSkipCount} total skipped tests — ${delta} more than the ${total} shown above.\n` +
        '      These are whole suites skipped via file/describe-level logic (e.g. BTP tests\n' +
        "      skipping when BTP credentials aren't configured) — they don't emit per-test ↓ lines.\n",
    );
    process.stdout.write('\n');
  }

  process.stdout.write('See docs/integration-test-skips.md for the full taxonomy and per-system skip profiles.\n');
}

main();
