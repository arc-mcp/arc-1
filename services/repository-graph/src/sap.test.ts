import { describe, expect, it } from 'vitest';
import { buildSapDiscoveryUrl } from './sap.js';

describe('buildSapDiscoveryUrl', () => {
  it('uses the ADT discovery path and SAP client', () => {
    expect(buildSapDiscoveryUrl('https://sap.example.test:50001/base', '001').toString()).toBe(
      'https://sap.example.test:50001/sap/bc/adt/discovery?sap-client=001',
    );
  });
});
