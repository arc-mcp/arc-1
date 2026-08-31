#!/usr/bin/env node

/**
 * Smoke-test npm executable resolution for the package-name invocation:
 *
 *   npx -y arc-1@latest --help
 *
 * The registry version cannot be tested before publish, so this builds a local
 * package tarball and asks npx to execute that tarball directly. This exercises
 * npm's real bin-selection logic and catches the "could not determine
 * executable to run" regression.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = mkdtempSync(join(tmpdir(), 'arc1-npx-smoke-'));

function fail(message, result) {
  console.error(message);
  if (result?.stdout) console.error(`\nstdout:\n${result.stdout}`);
  if (result?.stderr) console.error(`\nstderr:\n${result.stderr}`);
  process.exit(1);
}

function parsePackOutput(stdout) {
  const jsonStart = stdout.indexOf('[');
  if (jsonStart === -1) {
    fail('npm pack did not emit JSON output.', { stdout });
  }

  try {
    const metadata = JSON.parse(stdout.slice(jsonStart));
    const filename = metadata?.[0]?.filename;
    if (typeof filename !== 'string' || filename.length === 0) {
      fail('npm pack JSON output did not include a tarball filename.', { stdout });
    }
    return filename;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`Failed to parse npm pack JSON output: ${message}`, { stdout });
  }
}

function runBuiltBin(bin, args, expectedStatus = 0, envOverrides = {}) {
  const result = spawnSync(process.execPath, [join(repoRoot, 'bin', bin), ...args], {
    cwd: tempDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      SAP_URL: '',
      SAP_USER: '',
      SAP_PASSWORD: '',
      SAP_ALLOW_WRITES: 'false',
      SAP_ALLOW_TRANSPORT_WRITES: 'false',
      SAP_ALLOW_GIT_WRITES: 'false',
      ARC1_CACHE: 'none',
      ...envOverrides,
    },
  });
  if (result.status !== expectedStatus) {
    fail(`Built ${bin} ${args.join(' ')} exited ${result.status}; expected ${expectedStatus}.`, result);
  }
  return result;
}

function runPackedNpx(tarballSpec, args) {
  const result = spawnSync('npx', ['-y', tarballSpec, ...args], {
    cwd: tempDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      npm_config_loglevel: 'error',
      SAP_URL: '',
      SAP_USER: '',
      SAP_PASSWORD: '',
      SAP_ALLOW_WRITES: 'false',
      SAP_ALLOW_TRANSPORT_WRITES: 'false',
      SAP_ALLOW_GIT_WRITES: 'false',
      ARC1_CACHE: 'none',
    },
  });
  if (result.status !== 0) {
    fail(`Packed npx ${args.join(' ')} exited ${result.status}; expected 0.`, result);
  }
  return result;
}

try {
  const version = runBuiltBin('arc1.js', ['version']);
  if (!/^ARC-1 v\d+\.\d+\.\d+/m.test(version.stdout)) {
    fail('Built arc1 version output was malformed.', version);
  }

  const aliasVersion = runBuiltBin('arc1-cli.js', ['version']);
  if (aliasVersion.stdout !== version.stdout) {
    fail('arc1-cli is not behaving as an exact arc1 alias.', aliasVersion);
  }

  const tools = runBuiltBin('arc1.js', ['tools']);
  if (!tools.stdout.includes('SAPRead') || !tools.stdout.includes('SAPDiagnose')) {
    fail('Built arc1 tools output did not contain the core tool surface.', tools);
  }

  const typo = runBuiltBin('arc1.js', ['versoin'], 2);
  if (!/too many arguments|unknown command/i.test(typo.stderr)) {
    fail('Built arc1 did not emit a strict usage diagnostic for a misspelled command.', typo);
  }

  const configBefore = runBuiltBin('arc1.js', ['--allow-writes=false', 'config', 'show', '--format', 'json']);
  const configAfter = runBuiltBin('arc1.js', ['config', 'show', '--format', 'json', '--allow-writes=false']);
  for (const result of [configBefore, configAfter]) {
    try {
      if (JSON.parse(result.stdout)?.effectivePolicy?.allowWrites !== false) {
        fail('Built arc1 did not resolve a root config option around a nested subcommand.', result);
      }
    } catch (err) {
      fail(`Built arc1 config show emitted invalid JSON: ${err instanceof Error ? err.message : String(err)}`, result);
    }
  }

  const missingUrl = runBuiltBin('arc1.js', ['call', 'SAPRead', '--json', '{}'], 2);
  if (!/SAP_URL.*configured/i.test(missingUrl.stderr)) {
    fail('Built arc1 did not classify a missing direct SAP target as a usage error.', missingUrl);
  }

  const schemaError = runBuiltBin(
    'arc1.js',
    ['call', 'SAPManage', '--json', '{"action":"cache_stats","bogus":true}'],
    1,
  );
  if (!/validation|invalid/i.test(schemaError.stderr)) {
    fail('Built arc1 did not map a generic tool-schema failure to exit 1.', schemaError);
  }

  const writeDenied = runBuiltBin(
    'arc1.js',
    [
      'call',
      'SAPWrite',
      '--json',
      '{"action":"create","type":"PROG","name":"ZARC1_SMOKE","package":"$TMP","description":"smoke","source":"REPORT zarc1_smoke."}',
    ],
    1,
    { SAP_URL: 'https://sap.example.invalid' },
  );
  if (!/writ|disabled|allow/i.test(writeDenied.stderr)) {
    fail('Built arc1 did not route a hidden SAPWrite through the normal safety denial.', writeDenied);
  }

  const envelope = runBuiltBin('arc1.js', [
    'call',
    'SAPManage',
    '--json',
    '{"action":"cache_stats"}',
    '--output',
    'json',
  ]);
  try {
    const parsed = JSON.parse(envelope.stdout);
    if (!Array.isArray(parsed.content)) fail('Built arc1 JSON output was not a ToolResult envelope.', envelope);
  } catch (err) {
    fail(`Built arc1 generic JSON output was invalid: ${err instanceof Error ? err.message : String(err)}`, envelope);
  }

  const largeOutput = runBuiltBin('arc1.js', [
    'call',
    'SAPLint',
    '--json',
    '{"action":"list_rules"}',
    '--output',
    'json',
  ]);
  try {
    const parsed = JSON.parse(largeOutput.stdout);
    const text = parsed.content?.[0]?.text;
    if (typeof text !== 'string' || text.length < 5_000 || !text.endsWith('}')) {
      fail('Built arc1 large JSON result looked truncated.', largeOutput);
    }
  } catch (err) {
    fail(`Built arc1 large output was invalid JSON: ${err instanceof Error ? err.message : String(err)}`, largeOutput);
  }

  const lintSource = join(tempDir, 'zarc1_smoke.prog.abap');
  writeFileSync(lintSource, 'REPORT zarc1_smoke.\n', 'utf8');
  const lint = runBuiltBin('arc1.js', ['lint', lintSource, '--format', 'json']);
  try {
    const issues = JSON.parse(lint.stdout);
    if (!Array.isArray(issues)) fail('Built arc1 lint did not emit a JSON issue array.', lint);
  } catch (err) {
    fail(`Built arc1 lint emitted invalid JSON: ${err instanceof Error ? err.message : String(err)}`, lint);
  }

  const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', tempDir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (pack.status !== 0) {
    fail('npm pack failed.', pack);
  }

  const filename = parsePackOutput(pack.stdout);
  const tarballSpec = `./${filename}`;
  const packedHelp = runPackedNpx(tarballSpec, ['--help']);
  if (!packedHelp.stdout.includes('ARC-1') || !packedHelp.stdout.includes('Commands:')) {
    fail('Packed npx help output did not look like the ARC-1 CLI.', packedHelp);
  }

  const packedVersion = runPackedNpx(tarballSpec, ['version']);
  if (!/^ARC-1 v\d+\.\d+\.\d+/m.test(packedVersion.stdout)) {
    fail('Packed npx version output was malformed.', packedVersion);
  }

  const packedTools = runPackedNpx(tarballSpec, ['tools']);
  if (!packedTools.stdout.includes('SAPRead') || !packedTools.stdout.includes('SAPDiagnose')) {
    fail('Packed npx tools output did not contain the core tool surface.', packedTools);
  }

  const packedLint = runPackedNpx(tarballSpec, ['lint', lintSource, '--format', 'json']);
  try {
    const issues = JSON.parse(packedLint.stdout);
    if (!Array.isArray(issues)) fail('Packed npx lint did not emit a JSON issue array.', packedLint);
  } catch (err) {
    fail(`Packed npx lint emitted invalid JSON: ${err instanceof Error ? err.message : String(err)}`, packedLint);
  }

  console.log('Built-bin and npx package-name executable smoke tests passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
