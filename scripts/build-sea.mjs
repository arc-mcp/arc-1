#!/usr/bin/env node
/**
 * Builds a single-file ARC-1 executable (Node.js SEA) for the CURRENT platform.
 *
 *   npm run build && node scripts/build-sea.mjs [--out-dir dist-sea]
 *
 * Why: the npm install has ~8,500 files; every one is scanned by antivirus on first start (#957).
 * The executable is one file. It runs the same Node runtime and the same code as the npm package.
 *
 * - The bundle is CommonJS (Node 22 SEA cannot run ESM) and keeps `better-sqlite3` external: a
 *   native addon cannot be embedded, so the persistent cache falls back to `node:sqlite`.
 * - AFF schemas are embedded as SEA assets (`aff/<file>`), read by src/aff/validator.ts.
 * - A SEA blob and its node binary must come from the same Node version and platform, so this
 *   script cannot cross-compile; CI builds each target on a native runner.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const outDirArg = process.argv.indexOf('--out-dir');
const outDir = resolve(root, outDirArg > -1 ? process.argv[outDirArg + 1] : 'dist-sea');
const workDir = join(outDir, '.work');

const osName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
if (!osName) throw new Error(`Unsupported platform ${process.platform}`);
const exeName = `arc-1-${pkg.version}-${osName}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
const exePath = join(outDir, exeName);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})`);
}

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

// 1. Bundle. `import.meta.url` becomes a URL with a "#bundle" fragment so the "run when executed
//    directly" guards in cli.js / extract-sap-cookies.js never match inside the single file.
const bundlePath = join(workDir, 'arc1.cjs');
await build({
  entryPoints: [join(root, 'scripts', 'sea', 'entry.mjs')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundlePath,
  external: ['better-sqlite3'],
  define: { 'import.meta.url': '__arc1BundleUrl' },
  banner: { js: "const __arc1BundleUrl = require('node:url').pathToFileURL(__filename).href + '#bundle';" },
  legalComments: 'none',
  logLevel: 'warning',
});

// 2. Embed assets.
const schemaDir = join(root, 'dist', 'aff', 'schemas');
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith('.json'));
if (schemaFiles.length === 0) throw new Error(`No AFF schemas in ${schemaDir} — run "npm run build" first`);
const assets = Object.fromEntries(schemaFiles.map((f) => [`aff/${f}`, join(schemaDir, f)]));

// 3. Preparation blob (code cache is valid because blob and binary are built on the same platform).
const blobPath = join(workDir, 'sea.blob');
const configPath = join(workDir, 'sea-config.json');
writeFileSync(
  configPath,
  JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
    assets,
  }),
);
run(process.execPath, ['--experimental-sea-config', configPath]);

// 4. Inject into a copy of the running node binary.
mkdirSync(outDir, { recursive: true });
copyFileSync(process.execPath, exePath);
chmodSync(exePath, 0o755);
if (process.platform === 'darwin') run('codesign', ['--remove-signature', exePath]);
await inject(exePath, 'NODE_SEA_BLOB', readFileSync(blobPath), {
  sentinelFuse: SENTINEL_FUSE,
  machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
});
// Apple Silicon refuses unsigned binaries; an ad-hoc signature is enough to run (not to notarize).
if (process.platform === 'darwin') run('codesign', ['--sign', '-', exePath]);

rmSync(workDir, { recursive: true, force: true });
console.log(`Built ${exePath} (Node ${process.version}, ${schemaFiles.length} AFF schemas embedded)`);
