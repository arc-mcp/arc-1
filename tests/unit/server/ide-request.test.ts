import { describe, expect, it } from 'vitest';
import { textResult } from '../../../src/handlers/shared.js';
import { appendIdeLinks } from '../../../src/server/ide-links.js';
import { resolveHttpIdeContext } from '../../../src/server/ide-request.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const config = {
  ...DEFAULT_CONFIG,
  transport: 'http-streamable' as const,
  ideLinks: 'eclipse' as const,
  ideSystemId: 'A4H',
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
};
const source = textResult('CLASS zcl_test DEFINITION.');
const args = { type: 'CLAS', name: 'ZCL_TEST' };
const headers = { 'arc1-ide-client': 'eclipse' };

describe('request-local Eclipse preferences', () => {
  it('uses only the selected target SID, including route aliases', () => {
    for (const targetId of ['A4H/001', 'A4H/100', 'A4H-2025/001']) {
      expect(resolveHttpIdeContext({ ...config, targetId }, headers)).toEqual({
        style: 'eclipse',
        systemId: 'A4H',
        target: targetId,
      });
    }
    expect(resolveHttpIdeContext({ ...config, targetId: undefined }, headers)).toBeUndefined();
  });
  it('requires both the admin ceiling and an explicit unambiguous preference', () => {
    for (const client of ['', 'vscode', 'claude', 'copilot', 'Eclipse', 'eclipse,eclipse', ['eclipse', 'eclipse']]) {
      expect(resolveHttpIdeContext(config, { 'arc1-ide-client': client })).toBeUndefined();
    }
    expect(resolveHttpIdeContext({ ...config, ideLinks: 'off' }, headers)).toBeUndefined();
    expect(resolveHttpIdeContext({ ...config, transport: 'stdio' }, headers)).toBeUndefined();
    expect(resolveHttpIdeContext(config)).toBeUndefined();
    expect(
      resolveHttpIdeContext(config, { 'arc1-ide-client': 'vscode', 'arc1-ide-destinations-v1': 'A4H/001=DEV' }),
    ).toBeUndefined();
  });
  it('supports traditional single-target HTTP without destination mappings', () => {
    const single = { ...config, targetId: undefined, multiTargetEndpoints: false, destinationName: 'BTP_DESTINATION' };
    expect(resolveHttpIdeContext(single, headers)).toEqual({ style: 'eclipse', systemId: 'A4H', target: undefined });
    expect(appendIdeLinks(source, 'SAPRead', args, single)).toBe(source);
  });
  it('refuses mismatched target/SID contexts and errors at the sink', () => {
    for (const context of [
      { style: 'eclipse' as const, systemId: 'A4H', target: 'A4H/100' },
      { style: 'eclipse' as const, systemId: 'A4H' },
      { style: 'eclipse' as const, systemId: 'DEV', target: 'A4H/001' },
    ])
      expect(appendIdeLinks(source, 'SAPRead', args, config, context)).toBe(source);
    expect(
      appendIdeLinks({ ...source, isError: true }, 'SAPRead', args, config, resolveHttpIdeContext(config, headers))
        .content,
    ).toEqual(source.content);
  });
});
