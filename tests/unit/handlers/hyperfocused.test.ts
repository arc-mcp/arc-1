/**
 * Unit tests for hyperfocused mode (single universal SAP tool).
 */

import { describe, expect, it } from 'vitest';
import {
  expandHyperfocusedArgs,
  getHyperfocusedScope,
  getHyperfocusedToolDefinition,
} from '../../../src/handlers/hyperfocused.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('hyperfocused mode', () => {
  describe('expandHyperfocusedArgs', () => {
    it('routes read action to SAPRead', () => {
      const result = expandHyperfocusedArgs({ action: 'read', type: 'CLAS', name: 'ZCL_TEST', version: 'inactive' });
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.toolName).toBe('SAPRead');
        expect(result.expandedArgs.type).toBe('CLAS');
        expect(result.expandedArgs.name).toBe('ZCL_TEST');
        expect(result.expandedArgs.version).toBe('inactive');
      }
    });

    it('routes search action to SAPSearch', () => {
      const result = expandHyperfocusedArgs({ action: 'search', params: { query: 'ZCL*' } });
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.toolName).toBe('SAPSearch');
        expect(result.expandedArgs.query).toBe('ZCL*');
      }
    });

    it('routes write action to SAPWrite', () => {
      const result = expandHyperfocusedArgs({
        action: 'write',
        type: 'CLAS',
        name: 'ZCL_TEST',
        params: { action: 'update', source: 'CLASS zcl_test...' },
      });
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.toolName).toBe('SAPWrite');
        expect(result.expandedArgs.type).toBe('CLAS');
        expect(result.expandedArgs.action).toBe('update');
        expect(result.expandedArgs.source).toBe('CLASS zcl_test...');
      }
    });

    it('routes all valid actions', () => {
      const actions = [
        'read',
        'search',
        'query',
        'write',
        'activate',
        'navigate',
        'lint',
        'diagnose',
        'transport',
        'git',
        'context',
        'manage',
      ];
      for (const action of actions) {
        const result = expandHyperfocusedArgs({ action });
        expect('error' in result).toBe(false);
      }
    });

    it('returns error for unknown action', () => {
      const result = expandHyperfocusedArgs({ action: 'invalid' });
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('Unknown action');
      }
    });

    it('top-level type/name take precedence over params', () => {
      const result = expandHyperfocusedArgs({
        action: 'read',
        type: 'CLAS',
        name: 'ZCL_A',
        params: { type: 'PROG', name: 'ZREPORT' },
      });
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.expandedArgs.type).toBe('CLAS');
        expect(result.expandedArgs.name).toBe('ZCL_A');
      }
    });
  });

  describe('getHyperfocusedScope', () => {
    it('returns read scope for read actions', () => {
      expect(getHyperfocusedScope('read')).toBe('read');
      expect(getHyperfocusedScope('search')).toBe('read');
      expect(getHyperfocusedScope('context')).toBe('read');
    });

    it('returns write scope for write actions', () => {
      expect(getHyperfocusedScope('write')).toBe('write');
      expect(getHyperfocusedScope('activate')).toBe('write');
    });

    it('returns read scope for mixed delegators (concrete action enforced downstream)', () => {
      expect(getHyperfocusedScope('manage')).toBe('read');
      expect(getHyperfocusedScope('transport')).toBe('read');
      expect(getHyperfocusedScope('git')).toBe('read');
    });

    it('returns sql scope for query', () => {
      expect(getHyperfocusedScope('query')).toBe('sql');
    });
  });

  describe('getHyperfocusedToolDefinition', () => {
    it('returns a single tool named SAP', () => {
      const config = { ...DEFAULT_CONFIG };
      const tool = getHyperfocusedToolDefinition(config);
      expect(tool.name).toBe('SAP');
      expect(tool.description).toContain('Universal SAP tool');
    });

    it('includes all configured actions when writes and SQL are allowed', () => {
      const config = { ...DEFAULT_CONFIG, allowWrites: true, allowFreeSQL: true, allowTransportWrites: true };
      const tool = getHyperfocusedToolDefinition(config);
      const schema = tool.inputSchema as Record<string, any>;
      const actions = schema.properties.action.enum as string[];
      expect(actions).toContain('read');
      expect(actions).toContain('query');
      expect(actions).toContain('write');
      expect(actions).toContain('transport');
      expect(actions).toContain('git');
    });

    it('excludes mutating delegators when writes are off but keeps mixed read delegators', () => {
      const config = { ...DEFAULT_CONFIG, allowWrites: false };
      const tool = getHyperfocusedToolDefinition(config);
      const schema = tool.inputSchema as Record<string, any>;
      const actions = schema.properties.action.enum as string[];
      expect(actions).toContain('read');
      expect(actions).not.toContain('query');
      expect(actions).not.toContain('write');
      expect(actions).not.toContain('activate');
      expect(actions).toContain('transport');
      expect(actions).toContain('git');
      // Mixed delegators stay visible because their read sub-actions are usable.
      // Mutating sub-actions are guarded by concrete ACTION_POLICY entries downstream.
      expect(actions).toContain('manage');
    });

    it('excludes query action when free SQL is blocked', () => {
      const config = { ...DEFAULT_CONFIG, allowWrites: true, allowFreeSQL: false };
      const tool = getHyperfocusedToolDefinition(config);
      const schema = tool.inputSchema as Record<string, any>;
      const actions = schema.properties.action.enum as string[];
      expect(actions).not.toContain('query');
    });
  });

  describe('getToolDefinitions integration', () => {
    it('returns single SAP tool in hyperfocused mode', () => {
      const config = { ...DEFAULT_CONFIG, toolMode: 'hyperfocused' as const };
      const tools = getToolDefinitions(config);
      expect(tools.length).toBe(1);
      expect(tools[0]!.name).toBe('SAP');
    });

    it('returns 11 tools in standard mode with all capabilities enabled', () => {
      const config = {
        ...DEFAULT_CONFIG,
        toolMode: 'standard' as const,
        allowWrites: true,
        allowFreeSQL: true,
        allowTransportWrites: true,
      };
      const tools = getToolDefinitions(config);
      expect(tools.length).toBeGreaterThanOrEqual(11);
      expect(tools.find((t) => t.name === 'SAPRead')).toBeDefined();
    });

    it('returns minimal tool set in standard mode with safe defaults', () => {
      const config = { ...DEFAULT_CONFIG, toolMode: 'standard' as const };
      const tools = getToolDefinitions(config);
      // Safe defaults (allowWrites=false, allowFreeSQL=false): no SAPWrite, SAPActivate, SAPQuery.
      // SAPTransport is always registered when featureTransport is not 'off' (reads only gated by scope).
      expect(tools.find((t) => t.name === 'SAPWrite')).toBeUndefined();
      expect(tools.find((t) => t.name === 'SAPActivate')).toBeUndefined();
      expect(tools.find((t) => t.name === 'SAPQuery')).toBeUndefined();
      expect(tools.find((t) => t.name === 'SAPRead')).toBeDefined();
      expect(tools.find((t) => t.name === 'SAPSearch')).toBeDefined();
      expect(tools.find((t) => t.name === 'SAPManage')).toBeDefined();
      expect(tools.find((t) => t.name === 'SAPTransport')).toBeDefined();
    });
  });

  it('advertises additionalProperties:false, matching the strict runtime schema', () => {
    // Regression: hyperfocused returns early from getToolDefinitions, so it skipped the loop that
    // stamps strictness — leaving the mode most likely to trigger a full-object dump advertising a
    // permissive contract while SAPHyperfocusedSchema rejected unknown keys.
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, toolMode: 'hyperfocused' }, true);
    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.name).toBe('SAP');
    expect((tool.inputSchema as Record<string, unknown>).additionalProperties).toBe(false);
  });
});
