import { describe, expect, it } from 'vitest';
import { assertSeaNodeVersion, parseSeaVersionOutput } from '../../../scripts/sea/runtime-policy.mjs';

describe('standalone Node runtime policy', () => {
  it.each(['22.23.4', '22.23.10', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0'])(
    'accepts patched %s',
    (version) => expect(() => assertSeaNodeVersion(version)).not.toThrow(),
  );

  it.each([
    '22.23.3',
    '22.22.99',
    '24.22.0',
    '24.21.99',
    '26.12.0',
    '26.11.99',
    '20.99.0',
    '23.0.0',
    '28.0.0',
    '22.23',
    'v22.23.4',
    '22.23.4-rc.1',
    '22.023.4',
    '22.999999999999999999999.0',
    'invalid',
  ])('refuses unqualified %s', (version) =>
    expect(() => assertSeaNodeVersion(version)).toThrow('Unsupported SEA Node version'),
  );

  it('requires the actual runtime probe and the matching application version', () => {
    expect(parseSeaVersionOutput('ARC1_NODE_VERSION=22.23.4\r\n1.9.0\r\n', '1.9.0')).toBe('22.23.4');
    for (const output of [
      '1.9.0',
      'OTHER=22.23.4\n1.9.0',
      'ARC1_NODE_VERSION=22.23.4\n1.9.0\nextra',
      'ARC1_NODE_VERSION=22.23.4\n1.8.0',
    ]) {
      expect(() => parseSeaVersionOutput(output, '1.9.0')).toThrow('Expected exactly');
    }
    expect(() => parseSeaVersionOutput('ARC1_NODE_VERSION=22.23.3\n1.9.0', '1.9.0')).toThrow(
      'Unsupported SEA Node version',
    );
  });
});
