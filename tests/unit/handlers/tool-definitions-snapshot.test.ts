/**
 * Characterization snapshots of the LLM-visible tool surface.
 *
 * These freeze the exact JSON that `getToolDefinitions()` emits to MCP clients across
 * every meaningful config branch. They are the headline guarantee of the handler refactor
 * (docs/plans/completed/2026-06-11-architecture-consolidation-plan.md, Stage A1): the bytes an LLM sees must not
 * change. Any diff here during the refactor means a behavior change slipped in — investigate,
 * do not bless the new snapshot.
 *
 * To intentionally change the tool surface (a real feature), run vitest with -u and review the
 * fixture diff in code review.
 */

import { describe, expect, it } from 'vitest';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { READ_ONLY_WRITE_POLICY } from '../../../src/server/multi-target-destination-config.js';
import { injectTargetSchema, multiTargetToolDefinitions } from '../../../src/server/multi-target-tools.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { btp, FULL, features, onprem } from './handler-test-config.js';

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
  it.each([false, true])('discovery changes only navigation, BTP=%s', async (isBtp) => {
    const config = isBtp ? btp(FULL) : onprem(FULL);
    const original = getToolDefinitions({ ...config, denyActions: ['SAPNavigate.relations'] }, true, features());
    const tools = getToolDefinitions({ ...config }, true, features(), {
      discoveryMap: new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]),
    });
    expect(tools.filter((tool) => tool.name !== 'SAPNavigate')).toEqual(
      original.filter((tool) => tool.name !== 'SAPNavigate'),
    );
    const navigation = tools.find((tool) => tool.name === 'SAPNavigate');
    await expect(JSON.stringify(navigation, null, 2)).toMatchFileSnapshot(
      `../../fixtures/tool-definitions/${isBtp ? 'btp' : 'onprem'}-live-relations-navigate.json`,
    );
  });
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

describe('multi-target tool surface snapshot (LLM-visible, ADR-0006/0008)', () => {
  const multiTargetTarget = {
    target: 'A4H/100',
    sid: 'A4H',
    client: '100',
    description: 'A4H development',
    language: 'EN',
    destinationName: 'ARC1_A4H_100_PP',
    authentication: 'PrincipalPropagation' as const,
    identity: 'per-user' as const,
    proxyType: 'OnPremise' as const,
    hasCloudConnectorLocationId: false,
    requestedPolicy: { allowDataPreview: false, allowFreeSQL: false, ...READ_ONLY_WRITE_POLICY },
    effectivePolicy: { allowDataPreview: false, allowFreeSQL: false, ...READ_ONLY_WRITE_POLICY },
    connectionFingerprint: 'connection',
    fingerprint: 'fingerprint',
  };
  const surfaces: Array<[string, ServerConfig]> = [
    ['multi-target-readonly', { ...DEFAULT_CONFIG, multiTargetEndpoints: true }],
    [
      'multi-target-data-sql',
      { ...DEFAULT_CONFIG, multiTargetEndpoints: true, allowDataPreview: true, allowFreeSQL: true },
    ],
  ];
  for (const [name, config] of surfaces) {
    it(`is stable: ${name}`, async () => {
      const tools = multiTargetToolDefinitions(getToolDefinitions(config), config);
      await expect(JSON.stringify(tools, null, 2)).toMatchFileSnapshot(`../../fixtures/tool-definitions/${name}.json`);
    });
  }
  it('is stable: multi-target-aggregate-one-target', async () => {
    const config = { ...DEFAULT_CONFIG, multiTargetEndpoints: true };
    const tools = multiTargetToolDefinitions(getToolDefinitions(config), config).map((tool) =>
      injectTargetSchema(tool, [multiTargetTarget]),
    );
    await expect(JSON.stringify(tools, null, 2)).toMatchFileSnapshot(
      '../../fixtures/tool-definitions/multi-target-aggregate-one-target.json',
    );
  });
});
