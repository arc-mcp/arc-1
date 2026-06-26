import type { BTPProxyConfig } from '@arc-mcp/xsuaa-auth/btp';
import { describe, expect, it } from 'vitest';
import { selectPerUserProxy } from '../../../src/server/server.js';

// A startup-resolved Cloud Connector proxy descriptor, as createPerUserClient receives it.
function btpProxy(): BTPProxyConfig {
  return { host: 'connectivityproxy.internal', port: 20003, protocol: 'http', getProxyToken: async () => 'tok' };
}

describe('selectPerUserProxy', () => {
  it('reuses the startup proxy unchanged for an OnPremise destination without a Location ID', () => {
    const proxy = btpProxy();
    expect(selectPerUserProxy({ ProxyType: 'OnPremise' }, proxy)).toBe(proxy);
  });

  it("applies the OnPremise destination's CloudConnectorLocationId over the startup proxy's", () => {
    const proxy = btpProxy();
    const result = selectPerUserProxy({ ProxyType: 'OnPremise', CloudConnectorLocationId: 'scc-tokyo' }, proxy);

    expect(result).not.toBe(proxy); // dual-SCC: a fresh descriptor, startup proxy left untouched
    expect(result?.locationId).toBe('scc-tokyo');
    expect(result?.host).toBe('connectivityproxy.internal'); // other fields preserved
  });

  it('returns no proxy for an Internet destination even when the Connectivity proxy is bound', () => {
    // S/4HANA Public Cloud (SAMLAssertion) must connect directly, not through the SCC.
    expect(selectPerUserProxy({ ProxyType: 'Internet' }, btpProxy())).toBeUndefined();
  });

  it('returns no proxy when none is bound (guards the !btpProxy half of the condition)', () => {
    expect(
      selectPerUserProxy({ ProxyType: 'OnPremise', CloudConnectorLocationId: 'scc-tokyo' }, undefined),
    ).toBeUndefined();
  });
});
