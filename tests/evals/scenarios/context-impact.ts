/**
 * FEAT-33 CDS impact analysis scenarios — SAPContext(action="impact").
 *
 * These prompts come from real Cursor / Claude transcripts during FEAT-33
 * development (see PR #143). They exist to catch three regression classes:
 *
 *   1. Tool discoverability — LLMs must route "what breaks if I change X"
 *      natural-language questions to SAPContext(action="impact") instead of
 *      hand-rolling SAPQuery on DDDDLSRC / ACMDCLSRC / DDLXSRC_SRC.
 *   2. Schema contract — action="impact" is DDLS-only on the server; the
 *      handler defaults `type` to DDLS so the LLM doesn't need to supply it
 *      redundantly. Regression: a missing-type call must still succeed.
 *   3. Non-DDLS guardrail — for CLAS/INTF/PROG/FUNC the handler returns a
 *      text error redirecting to SAPNavigate(references). The LLM should not
 *      choose action="impact" for non-CDS input.
 *
 * The `feat-33` and `cds-impact` tags let you run this bucket in isolation:
 *   EVAL_FILE=context-impact npm run test:eval
 *   EVAL_TAG=feat-33 npm run test:eval
 *   EVAL_TAG=cds-impact npm run test:eval:live   (runs against real SAP)
 */

import type { EvalScenario } from '../types.js';

const IMPACT_I_COUNTRY_MOCK = JSON.stringify({
  name: 'I_COUNTRY',
  type: 'DDLS',
  upstream: {
    tables: [{ name: 'T005', kind: 'table' }],
    views: [],
    associations: [{ name: 'I_Language', kind: 'association' }],
    compositions: [],
  },
  downstream: {
    projectionViews: [{ name: 'C_COUNTRY', kind: 'DDLS/DF' }],
    bdefs: [],
    serviceDefinitions: [],
    serviceBindings: [],
    accessControls: [],
    metadataExtensions: [],
    abapConsumers: [{ name: 'CL_COUNTRY_API', kind: 'CLAS/OC' }],
    tables: [],
    documentation: [],
    other: [],
    summary: { direct: 2, indirect: 0, total: 2 },
  },
  summary: { upstreamCount: 2, downstreamTotal: 2, downstreamDirect: 2 },
});

const IMPACT_I_CURRENCY_MOCK = JSON.stringify({
  name: 'I_CURRENCY',
  type: 'DDLS',
  upstream: { tables: [{ name: 'TCURC' }], views: [], associations: [], compositions: [] },
  downstream: {
    projectionViews: Array.from({ length: 12 }, (_, i) => ({ name: `C_CURRENCY_V${i + 1}`, kind: 'DDLS/DF' })),
    bdefs: [],
    serviceDefinitions: [],
    serviceBindings: [],
    accessControls: [],
    metadataExtensions: [],
    abapConsumers: [{ name: 'CL_CURRENCY_HELPER', kind: 'CLAS/OC' }],
    tables: [],
    documentation: [],
    other: [],
    summary: { direct: 13, indirect: 7, total: 20 },
  },
  summary: { upstreamCount: 1, downstreamTotal: 20, downstreamDirect: 13 },
});

const IMPACT_ZARC1_NOT_FOUND_MOCK =
  'DDL Source ZARC1_TEST_REPORT of version active does not exist. ' +
  'Use SAPSearch(query="ZARC1_TEST_REPORT") to discover the correct object type.';

export const SCENARIOS: EvalScenario[] = [
  // 1. The flagship natural-language question — the whole point of FEAT-33.
  {
    id: 'cds-impact-blast-radius-natural',
    description: 'Blast-radius question in natural language — the canonical FEAT-33 prompt',
    prompt: 'In my SAP system, what breaks if I change the CDS view I_COUNTRY?',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'single-step', 'discoverability'],
    optimal: [{ tool: 'SAPContext', requiredArgs: { action: 'impact', name: 'I_COUNTRY' } }],
    acceptable: [
      // Pre-flight search is acceptable but noisy.
      { tool: 'SAPSearch', requiredArgs: { query: 'I_COUNTRY' } },
      // Calling references directly is worse but still useful.
      { tool: 'SAPNavigate', requiredArgs: { action: 'references', type: 'DDLS', name: 'I_COUNTRY' } },
    ],
    // The biggest discoverability failure we've seen — LLMs text-scanning
    // DDDDLSRC / ACMDCLSRC instead of using the classifier.
    forbidden: ['SAPQuery'],
    mockResponses: { SAPContext: IMPACT_I_COUNTRY_MOCK },
  },

  // 2. Explicit phrasing — "blast-radius analysis for X".
  {
    id: 'cds-impact-blast-radius-explicit',
    description: 'Explicit blast-radius phrasing',
    prompt: 'Blast-radius analysis for I_COUNTRY on my connected SAP backend',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'single-step', 'discoverability'],
    optimal: [{ tool: 'SAPContext', requiredArgs: { action: 'impact', name: 'I_COUNTRY' } }],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPContext: IMPACT_I_COUNTRY_MOCK },
  },

  // 3. Tests the schema fix: Sonnet 4.6 called impact without `type`.
  // Server now defaults type=DDLS. Either form must succeed.
  {
    id: 'cds-impact-missing-type-allowed',
    description: 'Impact call without type — schema defaults to DDLS',
    prompt: 'Run an impact analysis on I_COUNTRY',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'schema-default', 'single-step'],
    optimal: [
      // Both shapes are optimal — handler fills in the default.
      { tool: 'SAPContext', requiredArgs: { action: 'impact', name: 'I_COUNTRY' } },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPContext: IMPACT_I_COUNTRY_MOCK },
  },

  // 4. "Who consumes X" — common phrasing for downstream-only intent.
  {
    id: 'cds-impact-who-consumes',
    description: 'Downstream-consumer question',
    prompt: 'Who consumes the CDS view I_CURRENCY?',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'single-step', 'discoverability'],
    optimal: [{ tool: 'SAPContext', requiredArgs: { action: 'impact', name: 'I_CURRENCY' } }],
    acceptable: [{ tool: 'SAPNavigate', requiredArgs: { action: 'references', type: 'DDLS', name: 'I_CURRENCY' } }],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPContext: IMPACT_I_CURRENCY_MOCK },
  },

  // 5. Fully typed request — baseline correctness, should be trivial.
  {
    id: 'cds-impact-fully-typed',
    description: 'Fully-specified impact request — baseline',
    prompt: 'Run an impact analysis on the CDS view ZARC1_TEST_REPORT',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'single-step'],
    optimal: [
      {
        tool: 'SAPContext',
        requiredArgs: { action: 'impact', type: 'DDLS', name: 'ZARC1_TEST_REPORT' },
      },
    ],
    acceptable: [
      // If the name is wrong, recovering via SAPSearch is the recommended hint.
      { tool: 'SAPSearch', requiredArgs: { query: 'ZARC1_TEST_REPORT' } },
    ],
    mockResponses: {
      SAPContext: IMPACT_ZARC1_NOT_FOUND_MOCK,
      SAPSearch: JSON.stringify([{ objectType: 'PROG/P', objectName: 'ZARC1_TEST_REPORT', packageName: '$TMP' }]),
    },
  },

  // 6. Anti-pattern canary — LLM should never text-scan DDDDLSRC for this.
  {
    id: 'cds-impact-forbid-sql-scan',
    description: 'CDS impact question must not be answered via SQL text-scan on DDDDLSRC',
    prompt: 'Find all CDS views that select from the database table T005 in my SAP system',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'anti-pattern'],
    // "select from T005" phrasing is ambiguous — it can be answered via
    // SAPSearch source_code on the tabname or (for a known view) via impact.
    // The optimal tool is SAPSearch with source-code mode.
    optimal: [
      {
        tool: 'SAPSearch',
        requiredArgs: { searchType: 'source_code' },
        requiredArgKeys: ['query'],
      },
    ],
    acceptable: [
      // Impact on T005 is reasonable if the LLM reads "T005" as a CDS-view
      // upstream and wants to invert — not ideal but not wrong.
      { tool: 'SAPContext', requiredArgs: { action: 'impact' } },
    ],
    // The whole reason FEAT-33 exists: no hand-rolled DDDDLSRC scans.
    forbidden: ['SAPQuery'],
    mockResponses: {
      SAPSearch: JSON.stringify([{ objectType: 'DDLS/DF', objectName: 'I_COUNTRY', packageName: 'SAP_COMMON' }]),
    },
  },

  // 7. Non-DDLS guardrail — impact on a CLAS should NOT be attempted.
  {
    id: 'cds-impact-non-ddls-guardrail',
    description: 'Impact action is DDLS-only — class reference question should route to SAPNavigate',
    prompt: 'Who calls class ZCL_BILLING? Give me the full impact.',
    category: 'context',
    tags: ['feat-33', 'cds-impact', 'guardrail'],
    optimal: [
      {
        tool: 'SAPNavigate',
        requiredArgs: { action: 'references', type: 'CLAS', name: 'ZCL_BILLING' },
      },
    ],
    acceptable: [
      // SAPContext action="usages" performs the same live SAP lookup and is a
      // reasonable answer for the consumer-question intent.
      { tool: 'SAPContext', requiredArgs: { action: 'usages', name: 'ZCL_BILLING' } },
    ],
    // Impact is rejected server-side for non-DDLS and wastes a tool call.
    forbidden: [],
    mockResponses: {
      SAPNavigate: JSON.stringify([{ uri: '/sap/bc/adt/programs/programs/ZTEST/source/main', line: 15, column: 5 }]),
      SAPContext: JSON.stringify({
        name: 'ZCL_BILLING',
        usageCount: 1,
        usages: [{ type: 'PROG', name: 'ZTEST' }],
      }),
    },
  },
];
