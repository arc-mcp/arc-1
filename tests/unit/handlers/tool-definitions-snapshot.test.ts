/**
 * Characterization snapshots of the LLM-visible tool surface.
 *
 * These freeze the exact JSON that `getToolDefinitions()` emits to MCP clients across
 * every meaningful config branch. They are the headline guarantee of the handler refactor
 * (docs/plans/architecture-consolidation-plan.md, Stage A1): the bytes an LLM sees must not
 * change. Any diff here during the refactor means a behavior change slipped in — investigate,
 * do not bless the new snapshot.
 *
 * To intentionally change the tool surface (a real feature), run vitest with -u and review the
 * fixture diff in code review.
 */

import { describe, expect, it } from 'vitest';
import type { FeatureStatus, ResolvedFeatures } from '../../../src/adt/types.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function feat(id: string, available: boolean): FeatureStatus {
  // Deterministic: no probedAt timestamp, no message.
  return { id, available, mode: 'auto' };
}

/** A complete ResolvedFeatures with every feature available unless overridden. */
function features(overrides: Partial<Record<keyof ResolvedFeatures, boolean>> = {}): ResolvedFeatures {
  const on = (k: keyof ResolvedFeatures) => (overrides[k] === undefined ? true : (overrides[k] as boolean));
  return {
    hana: feat('hana', on('hana')),
    abapGit: feat('abapGit', on('abapGit')),
    gcts: feat('gcts', on('gcts')),
    rap: feat('rap', on('rap')),
    amdp: feat('amdp', on('amdp')),
    ui5: feat('ui5', on('ui5')),
    transport: feat('transport', on('transport')),
    ui5repo: feat('ui5repo', on('ui5repo')),
    flp: feat('flp', on('flp')),
  };
}

const onprem = (o: Partial<ServerConfig> = {}): ServerConfig => ({ ...DEFAULT_CONFIG, systemType: 'onprem', ...o });
const btp = (o: Partial<ServerConfig> = {}): ServerConfig => ({ ...DEFAULT_CONFIG, systemType: 'btp', ...o });

// Maximal write/data surface — captures SAPWrite, SAPTransport, SAPGit, SAPQuery, SAPManage in full.
const FULL: Partial<ServerConfig> = {
  allowWrites: true,
  allowTransportWrites: true,
  allowGitWrites: true,
  allowDataPreview: true,
  allowFreeSQL: true,
};

interface Variant {
  name: string;
  config: ServerConfig;
  textSearchAvailable?: boolean;
  resolvedFeatures?: ResolvedFeatures;
}

const VARIANTS: Variant[] = [
  // Hyperfocused mode — single universal tool, early-return branch.
  { name: 'onprem-hyperfocused', config: onprem({ ...FULL, toolMode: 'hyperfocused' }), resolvedFeatures: features() },
  { name: 'btp-hyperfocused', config: btp({ ...FULL, toolMode: 'hyperfocused' }), resolvedFeatures: features() },

  // Standard on-prem — read-only (DEFAULT-like) and full, both text-search states.
  {
    name: 'onprem-readonly-textsearch-off',
    config: onprem(),
    textSearchAvailable: false,
    resolvedFeatures: features(),
  },
  {
    name: 'onprem-full-textsearch-on',
    config: onprem({ ...FULL, allowedPackages: ['ZARC1', 'Z*'] }),
    textSearchAvailable: true,
    resolvedFeatures: features(),
  },
  // Unrestricted packages ([] → no package-restriction note appended to SAPWrite).
  {
    name: 'onprem-full-unrestricted-packages',
    config: onprem({ ...FULL, allowedPackages: [] }),
    textSearchAvailable: true,
    resolvedFeatures: features(),
  },

  // Standard BTP — read-only and full.
  { name: 'btp-readonly-textsearch-off', config: btp(), textSearchAvailable: false, resolvedFeatures: features() },
  {
    name: 'btp-full-textsearch-on',
    config: btp({ ...FULL, allowedPackages: ['ZBTP'] }),
    textSearchAvailable: true,
    resolvedFeatures: features(),
  },

  // Feature gates: SAPGit hidden when neither git backend is available.
  {
    name: 'onprem-full-git-off',
    config: onprem(FULL),
    textSearchAvailable: true,
    resolvedFeatures: features({ gcts: false, abapGit: false }),
  },
  // Feature gate: SAPTransport hidden when transport feature is off.
  {
    name: 'onprem-full-transport-off',
    config: onprem({ ...FULL, featureTransport: 'off' }),
    textSearchAvailable: true,
    resolvedFeatures: features(),
  },
];

describe('tool-definitions snapshot (LLM-visible surface)', () => {
  for (const v of VARIANTS) {
    it(`is stable: ${v.name}`, async () => {
      const tools = getToolDefinitions(v.config, v.textSearchAvailable, v.resolvedFeatures);
      const json = JSON.stringify(tools, null, 2);
      await expect(json).toMatchFileSnapshot(`../../fixtures/tool-definitions/${v.name}.json`);
    });
  }

  it('covers every standard tool across the variant set', () => {
    // Guard: the variant matrix must collectively exercise all 12 standard tools, so the
    // snapshots actually lock the whole surface (not just the always-on ones).
    const seen = new Set<string>();
    for (const v of VARIANTS) {
      if (v.config.toolMode === 'hyperfocused') continue;
      for (const t of getToolDefinitions(v.config, v.textSearchAvailable, v.resolvedFeatures)) {
        seen.add(t.name);
      }
    }
    for (const name of [
      'SAPRead',
      'SAPSearch',
      'SAPWrite',
      'SAPActivate',
      'SAPNavigate',
      'SAPQuery',
      'SAPTransport',
      'SAPGit',
      'SAPContext',
      'SAPLint',
      'SAPDiagnose',
      'SAPManage',
    ]) {
      expect(seen).toContain(name);
    }
  });
});
