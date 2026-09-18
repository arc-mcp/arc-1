/** mbt validate checks schemas, not the chained deployment descriptor's effective properties. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

// Like the documented BTP shell workflow, this check runs on POSIX (use WSL on Windows).
if (process.platform === 'win32') throw new Error('Run BTP descriptor validation in WSL or Linux/macOS.');
const directory = mkdtempSync(join(tmpdir(), 'arc1-mta-chain-'));
try {
  execFileSync(
    'npx',
    [
      '--yes',
      'mbt',
      'mtad-gen',
      '-p',
      'cf',
      '-e',
      'examples/btp/multi-pp/profile.mtaext',
      '-e',
      'examples/btp/multi-pp/target-authorization.mtaext',
      '-t',
      directory,
    ],
    { stdio: 'inherit' },
  );
  const descriptor = parse(readFileSync(join(directory, 'mtad.yaml'), 'utf8'));
  const app = descriptor.modules.find((module) => module.name === 'arc1-mcp-server');
  // Overlay/profile assertions: these fail if the extension chain is not applied.
  assert.equal(app.properties.ARC1_MULTI_TARGET_AUTHORIZATION, 'xsuaa-attribute');
  assert.equal(String(app.properties.ARC1_MULTI_TARGET_ENDPOINTS), 'true');
  assert.equal(app.properties.ARC1_CACHE, 'none');
  assert.equal(app.properties.SAP_DENY_ACTIONS, 'SAPDiagnose.atc,SAPDiagnose.unittest');
  // Effective safety invariants, even where the current base already supplies them.
  // These protect against future base/profile changes; they are not overlay-presence proof.
  assert.equal(String(app.properties.SAP_PP_ENABLED), 'true');
  for (const property of ['SAP_BTP_DESTINATION', 'SAP_BTP_PP_DESTINATION']) assert.ok(!app.properties[property]);
  for (const property of ['SAP_ALLOW_WRITES', 'SAP_ALLOW_DATA_PREVIEW', 'SAP_ALLOW_FREE_SQL'])
    assert.equal(String(app.properties[property]), 'false');
  console.log('Target-authorization MTA chain retains the multi-PP profile and explicit enforcement.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
