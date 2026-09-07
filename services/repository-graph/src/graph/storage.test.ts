import { describe, expect, it } from 'vitest';
import { metadataFingerprint, soakConfig } from './soak.js';
import { walBytesBetween } from './storage.js';
import type { GraphImport } from './types.js';

describe('bounded sizing experiment', () => {
  it('requires an isolated key and explicit bounded package scopes', () => {
    expect(() => soakConfig({})).toThrow();
    const env = { ARC_GRAPH_SYSTEM_KEY: 'SOAK-TEST', ARC_GRAPH_SOAK_PACKAGES: 'SABP*,ZAPP' };
    expect(soakConfig(env)).toMatchObject({ objects: 3000, passes: 2 });
    expect(() => soakConfig({ ...env, ARC_GRAPH_HANA_BOOTSTRAP: 'true' })).toThrow('Bootstrap');
    for (const change of [
      { ARC_GRAPH_SYSTEM_KEY: 'PROD' },
      { ARC_GRAPH_SOAK_PACKAGES: '*' },
      { ARC_GRAPH_SOAK_OBJECTS: '10001' },
      { ARC_GRAPH_SOAK_PASSES: '6' },
      { ARC_GRAPH_SOAK_MINUTES: 'NaN' },
    ])
      expect(() => soakConfig({ ...env, ...change })).toThrow();
  });
  it('handles WAL segment boundaries and unavailable counters without inventing zero', () => {
    expect(walBytesBetween('0/FFFFFFF0', '1/10')).toBe(32);
    expect(walBytesBetween(null, '1/10')).toBeNull();
    expect(walBytesBetween('1/10', '0/0')).toBeNull();
    expect(walBytesBetween('bad', '0/0')).toBeNull();
  });
  it('fingerprints content independently of row ordering and counters', () => {
    const input: GraphImport = {
      systemKey: 'SOAK-TEST',
      scope: 'Z*',
      extractorVersion: 'test',
      nodes: [
        { systemKey: 'SOAK-TEST', type: 'PROG', name: 'ZA' },
        { systemKey: 'SOAK-TEST', type: 'PROG', name: 'ZB' },
      ],
      observations: [],
    };
    expect(metadataFingerprint(input)).toBe(metadataFingerprint({ ...input, nodes: [...input.nodes].reverse() }));
    expect(metadataFingerprint(input)).not.toBe(metadataFingerprint({ ...input, nodes: input.nodes.slice(1) }));
  });
});
