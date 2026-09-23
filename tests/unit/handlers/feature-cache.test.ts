import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import {
  getCachedDiscovery,
  getCachedFeatures,
  isBtpSystem,
  isDomainsEndpointAvailable,
  isPackagesEndpointAvailable,
  isTablesEndpointAvailable,
  resetCachedFeatures,
  setCachedDiscovery,
  setCachedFeatures,
} from '../../../src/handlers/feature-cache.js';
import { requestContext } from '../../../src/server/context.js';

function features(partial: Partial<ResolvedFeatures>): ResolvedFeatures {
  return partial as ResolvedFeatures;
}

describe('feature-cache (destination keyed)', () => {
  afterEach(() => {
    resetCachedFeatures();
  });

  it('uses the default store when no destination is given (single-destination mode)', () => {
    setCachedFeatures(features({ systemType: 'onprem' }));
    expect(getCachedFeatures()?.systemType).toBe('onprem');
    expect(isBtpSystem()).toBe(false);
  });

  it('isolates stores per destination', () => {
    setCachedFeatures(features({ systemType: 'btp' }), 'S4D');
    setCachedFeatures(features({ systemType: 'onprem' }), 'S4P');
    expect(getCachedFeatures('S4D')?.systemType).toBe('btp');
    expect(getCachedFeatures('S4P')?.systemType).toBe('onprem');
    expect(getCachedFeatures()).toBeUndefined(); // default store untouched
    expect(isBtpSystem('S4D')).toBe(true);
    expect(isBtpSystem('S4P')).toBe(false);
  });

  it('resolves the destination from the request context when omitted', () => {
    setCachedFeatures(features({ systemType: 'btp' }), 'S4D');
    setCachedFeatures(features({ systemType: 'onprem' }));
    const inRequest = requestContext.run({ requestId: 'REQ-1', destination: 'S4D' }, () => getCachedFeatures());
    expect(inRequest?.systemType).toBe('btp');
    // Without a destination in context, the default store answers
    const noDest = requestContext.run({ requestId: 'REQ-2' }, () => getCachedFeatures());
    expect(noDest?.systemType).toBe('onprem');
  });

  it('uses the public target context as the multi-target feature key', () => {
    setCachedFeatures(features({ systemType: 'btp' }), 'A4H/100');
    setCachedFeatures(features({ systemType: 'onprem' }), 'INTERNAL_DESTINATION');
    const inRequest = requestContext.run(
      { requestId: 'REQ-TARGET', target: 'A4H/100', destination: 'INTERNAL_DESTINATION' },
      () => getCachedFeatures(),
    );
    expect(inRequest?.systemType).toBe('btp');
  });

  it('reports the pre-7.52 domain + package endpoints per discovery state', () => {
    // Both are absent wholesale on NW 7.50/7.51 and present from 7.52 — the gates that turn a
    // raw 404 into a release hint. `undefined` = never probed, which must NOT block writes.
    expect(isDomainsEndpointAvailable()).toBeUndefined();
    expect(isPackagesEndpointAvailable()).toBeUndefined();

    setCachedDiscovery(new Map([['/sap/bc/adt/ddic/structures', ['application/*']]]), 'NW750');
    expect(isDomainsEndpointAvailable('NW750')).toBe(false);
    expect(isPackagesEndpointAvailable('NW750')).toBe(false);

    setCachedDiscovery(
      new Map([
        ['/sap/bc/adt/ddic/domains', ['application/*']],
        ['/sap/bc/adt/packages', ['application/*']],
      ]),
      'S4758',
    );
    expect(isDomainsEndpointAvailable('S4758')).toBe(true);
    expect(isPackagesEndpointAvailable('S4758')).toBe(true);
  });

  it('keys the discovery map per destination with context fallback', () => {
    setCachedDiscovery(new Map([['/sap/bc/adt/ddic/tables', ['application/xml']]]), 'S4D');
    expect(isTablesEndpointAvailable('S4D')).toBe(true);
    expect(isTablesEndpointAvailable('S4P')).toBeUndefined();
    expect(getCachedDiscovery('S4D').size).toBe(1);
    expect(getCachedDiscovery().size).toBe(0);
    const inRequest = requestContext.run({ requestId: 'REQ-3', destination: 'S4D' }, () => isTablesEndpointAvailable());
    expect(inRequest).toBe(true);
  });

  it('an explicit destination argument wins over the request context', () => {
    setCachedFeatures(features({ systemType: 'btp' }), 'S4D');
    setCachedFeatures(features({ systemType: 'onprem' }), 'S4P');
    const result = requestContext.run({ requestId: 'REQ-4', destination: 'S4D' }, () => getCachedFeatures('S4P'));
    expect(result?.systemType).toBe('onprem');
  });

  it('reset clears every destination store', () => {
    setCachedFeatures(features({ systemType: 'btp' }), 'S4D');
    setCachedFeatures(features({ systemType: 'onprem' }));
    resetCachedFeatures();
    expect(getCachedFeatures('S4D')).toBeUndefined();
    expect(getCachedFeatures()).toBeUndefined();
  });
});
