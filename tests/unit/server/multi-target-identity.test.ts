import { describe, expect, it } from 'vitest';
import {
  PINNED_MCP_PATH_PATTERN,
  PINNED_RESOURCE_METADATA_PATH_PATTERN,
  TARGET_ID_PATTERN,
  TARGET_SYSTEM_ALIAS_PATTERN,
  targetFromPinnedMcpPath,
} from '../../../src/server/multi-target-identity.js';

describe('multi-target public identity syntax', () => {
  it.each(['A4H', 'A4H-2025', `A${'B'.repeat(31)}`])('accepts the bounded public system segment %s', (value) => {
    expect(TARGET_SYSTEM_ALIAS_PATTERN.test(value)).toBe(true);
    expect(TARGET_ID_PATTERN.test(`${value}/001`)).toBe(true);
  });

  it.each([
    'A4',
    `A${'B'.repeat(32)}`,
    'a4h-2025',
    '1A4',
    '-A4H',
    'A4H-',
    'A4H_2025',
    'A4H.2025',
    'A4H/2025',
    'A4H 2025',
  ])('rejects the unsafe or ambiguous public system segment %s', (value) => {
    expect(TARGET_SYSTEM_ALIAS_PATTERN.test(value)).toBe(false);
    expect(TARGET_ID_PATTERN.test(`${value}/001`)).toBe(false);
  });

  it('uses the same alias syntax for pinned MCP and protected-resource routes', () => {
    expect(targetFromPinnedMcpPath('/A4H-2025/001/mcp')).toBe('A4H-2025/001');
    expect(PINNED_MCP_PATH_PATTERN.test('/A4H-2025/001/mcp')).toBe(true);
    expect(PINNED_RESOURCE_METADATA_PATH_PATTERN.test('/.well-known/oauth-protected-resource/A4H-2025/001/mcp')).toBe(
      true,
    );
    expect(targetFromPinnedMcpPath('/a4h-2025/001/mcp')).toBeUndefined();
  });
});
