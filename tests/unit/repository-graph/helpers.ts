import { type GraphResponse, graphInputSchema } from '../../../src/repository-graph/contract.js';

export const KEY = 'graph-only-key-012345678901234567890123456';
export function response(action: GraphResponse['action'] = 'search'): GraphResponse {
  return {
    apiVersion: 2,
    systemKey: 'TEST-001',
    audience: 'trial',
    action,
    coverage: {
      status: 'partial',
      generation: '1',
      asOf: '2026-09-06T12:00:00.000Z',
      scope: 'Z*',
      extractorVersion: 'test-v2',
      sourceCounts: { parsed: 10, failed: 1, partial: 0, dynamicTargets: 2 },
    },
    nodes: [],
    edges: [],
    couplings: [],
    startStatus: 'not_requested',
    targetStatus: 'not_requested',
    hasMore: false,
    truncationReasons: [],
    pathFound: null,
    scope: { depth: 1, direction: 'both' },
  };
}
export function request(action = 'search') {
  return graphInputSchema.parse({ action, ...(action === 'search' ? { query: 'Z' } : {}) });
}
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
