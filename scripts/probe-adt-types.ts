/**
 * ADT type-availability probe — diagnostic CLI.
 *
 * Runs against your configured SAP test system (env vars: TEST_SAP_* or SAP_*,
 * loaded via .env). Reports for each ADT object type:
 *   1. whether the collection URL is in /sap/bc/adt/discovery
 *   2. how the collection URL responds to a bare GET
 *   3. whether a known SAP-shipped object of that type can actually be read
 *   4. whether the system's SAP_BASIS release meets a known floor
 *
 * The report also includes quality metrics: coverage per signal, how well the
 * discovery map agreed with the authoritative known-object probe, and which
 * types fell through to "ambiguous". This is diagnostic tooling — it doesn't
 * change product behavior. Use it to understand a landscape, or to capture a
 * fixture set that replay-based unit tests can use forever.
 *
 * Usage:
 *   tsx scripts/probe-adt-types.ts                    # print report to stdout
 *   tsx scripts/probe-adt-types.ts --format json      # machine-readable JSON
 *   tsx scripts/probe-adt-types.ts --output probe.json
 *   tsx scripts/probe-adt-types.ts --save-fixtures tests/fixtures/probe/my-system
 *   tsx scripts/probe-adt-types.ts --types TABL,BDEF  # probe a subset
 */

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { AdtClient } from '../src/adt/client.js';
import { resolveCookies } from '../src/adt/cookies.js';
import { fetchDiscoveryDocument } from '../src/adt/discovery.js';
import { AdtApiError } from '../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../src/adt/safety.js';
import { parseInstalledComponents } from '../src/adt/xml-parser.js';
import { CATALOG } from '../src/probe/catalog.js';
import { createRecordingFetcher } from '../src/probe/fixtures.js';
import { formatTable } from '../src/probe/format.js';
import { computeQuality } from '../src/probe/quality.js';
import { type HttpProbeFn, type ProbeFetchResult, probeType } from '../src/probe/runner.js';
import type { InstalledProduct, ProbeReport, ProbedSystem } from '../src/probe/types.js';

interface CliArgs {
  format: 'table' | 'json';
  output?: string;
  saveFixtures?: string;
  types?: string[];
  help: boolean;
}

function getFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (args[i]?.startsWith(prefix)) return args[i].slice(prefix.length);
  }
  return undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const format = (getFlag(argv, 'format') ?? 'table') as 'table' | 'json';
  if (format !== 'table' && format !== 'json') {
    throw new Error(`Invalid --format '${format}'. Use: table | json`);
  }
  const typesRaw = getFlag(argv, 'types');
  const types = typesRaw
    ? typesRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined;
  return {
    format,
    output: getFlag(argv, 'output'),
    saveFixtures: getFlag(argv, 'save-fixtures'),
    types,
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printUsage(): void {
  process.stderr.write(`Usage: tsx scripts/probe-adt-types.ts [options]

Options:
  --format <table|json>        Output format (default: table)
  --output <file>              Also write the JSON report to this path
  --save-fixtures <dir>        Record every HTTP response for replay tests
  --types TABL,BDEF,...        Probe only these types (default: all)
  --help, -h                   Show this help

Env (read from .env, TEST_SAP_* preferred over SAP_*):
  TEST_SAP_URL / SAP_URL           SAP system URL (required)
  TEST_SAP_USER / SAP_USER         SAP username (required unless cookies set)
  TEST_SAP_PASSWORD / SAP_PASSWORD SAP password (required unless cookies set)
  TEST_SAP_CLIENT / SAP_CLIENT     SAP client (default: 100)
  TEST_SAP_LANGUAGE / SAP_LANGUAGE SAP language (default: EN)
  TEST_SAP_INSECURE / SAP_INSECURE Skip TLS verification (default: false)
  SAP_COOKIE_FILE                  Path to Netscape-format cookie file
  SAP_COOKIE_STRING                Inline cookies (key1=val1; key2=val2)
`);
}

function readCreds(): {
  baseUrl: string;
  username: string;
  password: string;
  client: string;
  language: string;
  insecure: boolean;
  cookies?: Record<string, string>;
} {
  const baseUrl = process.env.TEST_SAP_URL ?? process.env.SAP_URL ?? '';
  const username = process.env.TEST_SAP_USER ?? process.env.SAP_USER ?? '';
  const password = process.env.TEST_SAP_PASSWORD ?? process.env.SAP_PASSWORD ?? '';
  const client = process.env.TEST_SAP_CLIENT ?? process.env.SAP_CLIENT ?? '100';
  const language = process.env.TEST_SAP_LANGUAGE ?? process.env.SAP_LANGUAGE ?? 'EN';
  const insecure = (process.env.TEST_SAP_INSECURE ?? process.env.SAP_INSECURE ?? '') === 'true';
  const cookies = resolveCookies(process.env.SAP_COOKIE_FILE, process.env.SAP_COOKIE_STRING);
  if (!baseUrl) {
    throw new Error('Missing SAP_URL / TEST_SAP_URL. See --help for details.');
  }
  if (!cookies && (!username || !password)) {
    throw new Error(
      'Missing SAP credentials. Set TEST_SAP_USER/TEST_SAP_PASSWORD (or SAP_COOKIE_FILE / SAP_COOKIE_STRING). See --help for details.',
    );
  }
  return { baseUrl, username, password, client, language, insecure, cookies };
}

/**
 * Wrap AdtHttpClient in the neutral HttpProbeFn shape: never throws, extracts
 * HTTP status even for 4xx/5xx responses (which the underlying client throws on).
 */
function buildFetcher(client: AdtClient): HttpProbeFn {
  return async (url, method) => {
    const start = Date.now();
    try {
      const resp = method === 'HEAD' ? await client.http.head(url) : await client.http.get(url);
      return {
        statusCode: resp.statusCode,
        body: resp.body,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      if (err instanceof AdtApiError) {
        const result: ProbeFetchResult = {
          statusCode: err.statusCode,
          body: err.responseBody,
          errorMessage: err.message,
          durationMs,
        };
        return result;
      }
      return {
        networkError: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs,
      };
    }
  };
}

async function detectSystem(client: AdtClient): Promise<{
  abapRelease?: string;
  systemType?: 'onprem' | 'btp' | 'unknown';
  products?: InstalledProduct[];
}> {
  try {
    const resp = await client.http.get('/sap/bc/adt/system/components');
    const components = parseInstalledComponents(resp.body);
    const basis = components.find((c) => c.name.toUpperCase() === 'SAP_BASIS');
    const hasCloud = components.some((c) => c.name.toUpperCase() === 'SAP_CLOUD');
    const products: InstalledProduct[] = components.map((c) => ({
      name: c.name,
      release: c.release,
      spLevel: c.spLevel || undefined,
      description: c.description || undefined,
    }));
    return {
      abapRelease: basis?.release || undefined,
      systemType: hasCloud ? 'btp' : 'onprem',
      products,
    };
  } catch {
    return { systemType: 'unknown' };
  }
}

async function run(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }

  const creds = readCreds();
  const authLabel = creds.cookies && !creds.username ? 'cookies' : `user ${creds.username}`;
  process.stderr.write(`Probing ${creds.baseUrl} (client ${creds.client}, ${authLabel})…\n`);

  const client = new AdtClient({
    baseUrl: creds.baseUrl,
    username: creds.username,
    password: creds.password,
    client: creds.client,
    language: creds.language,
    insecure: creds.insecure,
    cookies: creds.cookies ?? {},
    safety: unrestrictedSafetyConfig(),
  });

  // fetchDiscoveryDocument returns { map, nhiPresent }; the probe only needs the discovery map.
  // (Reading `.map` here is what keeps `discoveryMap.has/.size/.keys` valid below — see tsconfig.scripts.json
  // which now typechecks this file so the shape can't drift again.)
  const [discovery, sysinfo] = await Promise.all([fetchDiscoveryDocument(client.http), detectSystem(client)]);
  const discoveryMap = discovery.map;

  const entries = args.types ? CATALOG.filter((e) => args.types?.includes(e.type)) : CATALOG;
  if (args.types && entries.length === 0) {
    throw new Error(`--types filter matched nothing. Known types: ${CATALOG.map((e) => e.type).join(', ')}`);
  }

  const baseFetcher = buildFetcher(client);
  const recording = args.saveFixtures ? createRecordingFetcher(baseFetcher, args.saveFixtures) : undefined;
  const fetcher = recording?.fetcher ?? baseFetcher;

  const results = [];
  for (const entry of entries) {
    process.stderr.write(`  ${entry.type.padEnd(6)} `);
    const result = await probeType(fetcher, entry, discoveryMap, sysinfo.abapRelease);
    process.stderr.write(`${result.verdict}\n`);
    results.push(result);
  }

  const system: ProbedSystem = {
    baseUrl: creds.baseUrl,
    client: creds.client,
    abapRelease: sysinfo.abapRelease,
    systemType: sysinfo.systemType,
    products: sysinfo.products,
    discoveryMapSize: discoveryMap.size,
    probedAt: new Date().toISOString(),
  };

  const report: ProbeReport = {
    system,
    results,
    quality: computeQuality(results),
    schemaVersion: 1,
  };

  if (recording) {
    recording.writeMeta({
      baseUrl: system.baseUrl,
      client: system.client,
      abapRelease: system.abapRelease,
      systemType: system.systemType,
      products: system.products,
      discoveryMapKeys: [...discoveryMap.keys()].sort(),
      probedAt: system.probedAt,
    });
    process.stderr.write(`Fixtures written to ${args.saveFixtures}\n`);
  }

  if (args.output) {
    writeFileSync(args.output, JSON.stringify(report, null, 2));
    process.stderr.write(`JSON report written to ${args.output}\n`);
  }

  if (args.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTable(report)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
