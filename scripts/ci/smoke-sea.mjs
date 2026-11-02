#!/usr/bin/env node
/**
 * Smoke test for a built ARC-1 single executable:  node scripts/ci/smoke-sea.mjs <path-to-exe>
 *
 * Verifies the embedded patched Node runtime, --version, a full MCP handshake + tools/list, and that the SQLite
 * cache opens through the node:sqlite fallback (the native better-sqlite3 addon is not embedded).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSeaVersionOutput, SEA_NODE_VERSION_PREFIX } from '../sea/runtime-policy.mjs';

const exe = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(exe)) {
  console.error('Usage: node scripts/ci/smoke-sea.mjs <path-to-executable>');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const TIMEOUT_MS = 120_000; // the first start of a fresh binary includes the antivirus scan

function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}

// Only the --version child receives the probe; MCP stdout must remain JSON-RPC only.
const probeDir = mkdtempSync(join(tmpdir(), 'arc1-sea-runtime-'));
const probePath = join(probeDir, 'runtime probe.cjs');
let versionRun;
try {
  writeFileSync(probePath, `process.stdout.write(${JSON.stringify(SEA_NODE_VERSION_PREFIX)} + process.versions.node + '\\n');`);
  const requireOption = `--require ${JSON.stringify(probePath.replaceAll('\\', '/'))}`;
  versionRun = spawnSync(exe, ['--version'], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, requireOption].filter(Boolean).join(' ') },
  });
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}
if (versionRun.status !== 0) fail(`--version failed (exit ${versionRun.status}): ${versionRun.stderr}`);
try {
  console.log(`ok  embedded Node ${parseSeaVersionOutput(versionRun.stdout, version)}`);
} catch (err) {
  fail(`${err.message}\n--version stdout:\n${versionRun.stdout}`);
}
console.log(`ok  --version ${version}`);

const tmp = mkdtempSync(join(tmpdir(), 'arc1-sea-smoke-'));
const cacheFile = join(tmp, 'cache.db');

function startServer() {
  const child = spawn(exe, [], {
    env: { ...process.env, SAP_URL: 'http://127.0.0.1:9', ARC1_CACHE: 'sqlite', ARC1_CACHE_FILE: cacheFile },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  const waiters = [];
  child.stdout.on('data', (d) => {
    stdout += d;
    for (const w of [...waiters]) w();
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const readResponse = (id) =>
    new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response for id ${id}`)), TIMEOUT_MS);
      const check = () => {
        // The last segment may be a partial line: large responses arrive in several pipe chunks.
        const lines = stdout.split('\n').slice(0, -1);
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.id === id) {
            clearTimeout(timer);
            waiters.splice(waiters.indexOf(check), 1);
            resolveResponse(message);
            return;
          }
        }
      };
      waiters.push(check);
      check();
    });
  return { child, send, readResponse, stderr: () => stderr };
}

const server = startServer();
try {
  const started = Date.now();
  server.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sea-smoke', version: '1' } },
  });
  const init = await server.readResponse(1);
  if (!init.result?.serverInfo?.name) fail(`initialize returned no serverInfo: ${JSON.stringify(init)}`);
  console.log(`ok  initialize in ${Date.now() - started} ms (${init.result.serverInfo.name})`);

  server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (await server.readResponse(2)).result?.tools ?? [];
  if (tools.length === 0) fail('tools/list returned no tools');
  console.log(`ok  tools/list: ${tools.length} tools`);

  if (server.stderr().includes('SQLite cache unavailable')) fail(`SQLite cache fell back to memory:\n${server.stderr()}`);
  if (!existsSync(cacheFile) || statSync(cacheFile).size === 0) fail(`SQLite cache file was not created: ${cacheFile}`);
  console.log('ok  persistent SQLite cache opened (node:sqlite fallback)');
} catch (err) {
  fail(`${err instanceof Error ? err.message : err}\n--- stderr ---\n${server.stderr()}`);
} finally {
  server.child.kill();
  // best-effort-cleanup
  await new Promise((r) => setTimeout(r, 300));
  rmSync(tmp, { recursive: true, force: true });
}
console.log('SMOKE PASSED');
process.exit(0);
