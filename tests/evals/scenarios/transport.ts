/**
 * SAPTransport scenarios — CTS list/get/create/release + FEAT-49 history.
 *
 * The FEAT-49 scenarios (action="history") exist to catch three regression
 * classes surfaced by live Cursor/Sonnet transcripts against A4H:
 *
 *   1. Tool discoverability — LLMs must route natural-language "which
 *      transport contains object X" or "who has object X locked" questions
 *      to SAPTransport(action="history") instead of hand-rolling
 *      SAPQuery on E070 / E071 / TLOCK. That anti-pattern is the reason
 *      FEAT-49 exists at all (it wastes tokens and needs three joined
 *      SQL calls to answer a single intent).
 *   2. Non-CLAS types — only CLAS exposes the per-object /transports
 *      subresource on NetWeaver; the handler swallows 404 and falls back
 *      to transportchecks, so TABL / DDLS / BDEF / PROG / INTF are valid
 *      history inputs and should not be rejected by the LLM.
 *   3. Schema contract — `type` and `name` are both required; the LLM
 *      should not call history with just a name (handler returns an
 *      error with remediation text).
 *
 * The `feat-49` and `transport-history` tags let you run this slice:
 *   EVAL_FILE=transport npm run test:eval
 *   EVAL_TAG=feat-49 npm run test:eval
 *   EVAL_TAG=transport-history npm run test:eval:live   (real SAP)
 */

import type { EvalScenario } from '../types.js';

// ─── Mock payloads ─────────────────────────────────────────────────

const HISTORY_LOCKED_CLAS_MOCK = JSON.stringify({
  object: { type: 'CLAS', name: 'ZCL_ORDER', uri: '/sap/bc/adt/oo/classes/ZCL_ORDER' },
  lockedTransport: 'A4HK900123',
  relatedTransports: [{ id: 'A4HK900123', description: 'Refactor ZCL_ORDER', owner: 'DEVELOPER', status: 'D' }],
  candidateTransports: [],
  summary: 'Object ZCL_ORDER is locked in transport A4HK900123 by DEVELOPER.',
});

const HISTORY_UNLOCKED_TABL_MOCK = JSON.stringify({
  object: { type: 'TABL', name: 'ZFB_CLUB', uri: '/sap/bc/adt/ddic/tables/ZFB_CLUB' },
  relatedTransports: [],
  candidateTransports: [{ id: 'A4HK900200', description: 'Football RAP package', owner: 'DEVELOPER' }],
  summary: 'Object ZFB_CLUB has no active lock; 1 transport(s) available for assignment.',
});

const HISTORY_LOCAL_OBJECT_MOCK = JSON.stringify({
  object: { type: 'CLAS', name: 'ZCL_ARC1_TEST', uri: '/sap/bc/adt/oo/classes/ZCL_ARC1_TEST' },
  relatedTransports: [],
  candidateTransports: [],
  summary: 'Object ZCL_ARC1_TEST has no related or candidate transports (likely $TMP / local object).',
});

// ─── Scenarios ─────────────────────────────────────────────────────

export const SCENARIOS: EvalScenario[] = [
  {
    id: 'transport-check-new-function-group',
    description: 'A transport check for a new function module needs its parent group',
    prompt:
      'Check transport assignment before creating function module Z_ORDER_SAVE in existing function group ZORDER, package ZORDERS. The module does not exist yet; do not create it.',
    category: 'transport',
    tags: ['function-group', 'single-step'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: {
          action: 'check',
          type: 'FUNC',
          name: 'Z_ORDER_SAVE',
          group: 'ZORDER',
          package: 'ZORDERS',
        },
        argumentPatterns: { operation: { forbidden: [/^modify$/i] } },
      },
    ],
    forbidden: ['SAPWrite', 'SAPQuery'],
    requireFullParameters: true,
    maxToolCalls: 1,
  },

  {
    id: 'transport-history-function-group-include',
    description: 'Function-group include history needs the parent group',
    prompt: 'Show transport assignment and locks for include LZORDERF01 in function group ZORDER.',
    category: 'transport',
    tags: ['function-group', 'transport-history', 'single-step'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'INCL', name: 'LZORDERF01', group: 'ZORDER' },
      },
    ],
    forbidden: ['SAPWrite', 'SAPQuery'],
    requireFullParameters: true,
    maxToolCalls: 1,
  },

  // Baseline: list transports (pre-FEAT-49 scenario — keep for coverage).
  {
    id: 'transport-list',
    description: 'List transport requests',
    prompt: 'Show me my open transport requests',
    category: 'transport',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPTransport', requiredArgs: { action: 'list' } }],
    mockResponses: {
      SAPTransport: JSON.stringify([
        { id: 'DEVK900001', description: 'Order processing changes', status: 'modifiable' },
      ]),
    },
  },

  // ─── FEAT-49: reverse lookup (object → transport) ─────────────────

  // 1. Flagship natural-language question — the canonical FEAT-49 prompt.
  {
    id: 'transport-history-which-contains',
    description: 'Reverse lookup — "which transport contains this class?" (the FEAT-49 intent)',
    prompt: 'Which transport contains the ABAP class ZCL_ORDER in my connected SAP system?',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'single-step', 'discoverability'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'CLAS', name: 'ZCL_ORDER' },
      },
    ],
    // The whole reason FEAT-49 exists: stop LLMs hand-rolling three-way
    // joins on E070/E071/TLOCK for a question that has a dedicated tool.
    forbidden: ['SAPQuery'],
    mockResponses: { SAPTransport: HISTORY_LOCKED_CLAS_MOCK },
  },

  // 2. Lock-owner question — same intent, different phrasing.
  {
    id: 'transport-history-who-locked',
    description: 'Lock owner question — who currently holds the edit lock',
    prompt: 'Is the class ZCL_ORDER currently locked? By whom, and in which transport?',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'single-step', 'discoverability'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'CLAS', name: 'ZCL_ORDER' },
      },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPTransport: HISTORY_LOCKED_CLAS_MOCK },
  },

  // 3. Non-CLAS type — handler transparently handles 404 on /transports
  //    and falls back to transportchecks. The LLM must not refuse "because
  //    it's a table" — history works for any write-capable object type.
  {
    id: 'transport-history-tabl-fallback',
    description: 'History works for non-CLAS types (TABL) via transportchecks fallback',
    prompt: 'Show me the transport history for the DDIC table ZFB_CLUB',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'single-step', 'non-clas'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'TABL', name: 'ZFB_CLUB' },
      },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPTransport: HISTORY_UNLOCKED_TABL_MOCK },
  },

  // 4. Candidate-transport phrasing — "which transport could I assign".
  {
    id: 'transport-history-candidate-assignment',
    description: 'Candidate assignment question — unlocked object, available transports',
    prompt: 'Which open transport requests could I assign my changes to ZFB_CLUB to?',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'single-step'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'TABL', name: 'ZFB_CLUB' },
      },
    ],
    acceptable: [
      // SAPTransport(action="list") is broader but still useful here; the
      // object-specific answer is better because it filters by package.
      { tool: 'SAPTransport', requiredArgs: { action: 'list' } },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPTransport: HISTORY_UNLOCKED_TABL_MOCK },
  },

  // 5. $TMP / local object — history should return the "no transports"
  //    summary without surfacing a misleading error.
  {
    id: 'transport-history-local-object',
    description: 'Local ($TMP) object — history returns empty with explanatory summary',
    prompt: 'What transport is the class ZCL_ARC1_TEST in?',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'single-step'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'CLAS', name: 'ZCL_ARC1_TEST' },
      },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: { SAPTransport: HISTORY_LOCAL_OBJECT_MOCK },
  },

  // 6. Anti-pattern canary — the reason FEAT-49 shipped. Live transcript
  //    showed Sonnet reach for SAPQuery("SELECT ... FROM e070 INNER JOIN
  //    e071 ...") when SAPTransport wasn't advertised. With the tool now
  //    registered, any SAPQuery call here is a discoverability regression.
  {
    id: 'transport-history-forbid-cts-sql-scan',
    description: 'Reverse lookup must not be answered via SQL scan on E070/E071/TLOCK',
    prompt:
      'In my SAP backend, find which transport request contains the object ZBP_R_FBCLUBTP. ' +
      'I need the request number, its owner, and the short description.',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'anti-pattern'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', type: 'CLAS', name: 'ZBP_R_FBCLUBTP' },
      },
    ],
    // Three-way SQL join on CTS base tables was the pre-FEAT-49 workaround.
    forbidden: ['SAPQuery'],
    mockResponses: {
      SAPTransport: JSON.stringify({
        object: {
          type: 'CLAS',
          name: 'ZBP_R_FBCLUBTP',
          uri: '/sap/bc/adt/oo/classes/ZBP_R_FBCLUBTP',
        },
        lockedTransport: 'A4HK901086',
        relatedTransports: [
          {
            id: 'A4HK901086',
            description: 'Z_RAP_VB_1 Football clubs & players RAP',
            owner: 'MARIAN',
            status: 'D',
          },
        ],
        candidateTransports: [],
        summary: 'Object ZBP_R_FBCLUBTP is locked in transport A4HK901086 by MARIAN.',
      }),
    },
  },

  // 7. Schema contract — calling history without `type` must be wrong.
  //    The handler returns '"type" and "name" are required'; the LLM
  //    should include both from the start (or disambiguate via SAPSearch).
  {
    id: 'transport-history-requires-type',
    description: 'History action requires both type and name',
    prompt: 'Run a transport history lookup for ZCL_ORDER',
    category: 'transport',
    tags: ['feat-49', 'transport-history', 'schema-contract'],
    optimal: [
      {
        tool: 'SAPTransport',
        requiredArgs: { action: 'history', name: 'ZCL_ORDER' },
        requiredArgKeys: ['type'],
      },
    ],
    acceptable: [
      // A pre-flight SAPSearch to disambiguate the type is reasonable.
      { tool: 'SAPSearch', requiredArgs: { query: 'ZCL_ORDER' } },
    ],
    forbidden: ['SAPQuery'],
    mockResponses: {
      SAPTransport: HISTORY_LOCKED_CLAS_MOCK,
      SAPSearch: JSON.stringify([{ objectType: 'CLAS/OC', objectName: 'ZCL_ORDER', packageName: '$TMP' }]),
    },
  },
];
