import { describe, expect, it } from 'vitest';
import { matchesExpectedToolCall, scoreExpectedToolCallParameters } from '../../evals/expected-call.js';
import type { ExpectedToolCall, LLMToolCall } from '../../evals/types.js';

const actual: LLMToolCall = {
  name: 'SAPQuery',
  arguments: {
    sql: "SELECT t~tabname FROM dd02l AS t WHERE t~tabname LIKE 'Z%' ORDER BY t~tabname DESCENDING",
    maxRows: 5,
  },
};

describe('expected eval tool-call matching', () => {
  it('accepts required patterns and rejected-dialect forbidden patterns', () => {
    const expected: ExpectedToolCall = {
      tool: 'SAPQuery',
      requiredArgs: { maxRows: 5 },
      argumentPatterns: {
        sql: {
          required: [/\bFROM\s+DD02L\s+AS\s+T\b/i, /\bT~TABNAME\b/i, /\bDESCENDING\b/i],
          forbidden: [/\bDESC\b(?!ENDING)/i, /\bLIMIT\b/i, /\bTOP\b/i, /\bT\./i],
        },
      },
    };

    expect(matchesExpectedToolCall(actual, expected)).toBe(true);
    expect(scoreExpectedToolCallParameters(actual, expected)).toBe(1);
  });

  it('fails and partially scores a required SQL pattern that is absent', () => {
    const expected: ExpectedToolCall = {
      tool: 'SAPQuery',
      argumentPatterns: { sql: { required: [/\bASCENDING\b/i, /\bDESCENDING\b/i] } },
    };

    expect(matchesExpectedToolCall(actual, expected)).toBe(false);
    expect(scoreExpectedToolCallParameters(actual, expected)).toBe(0.5);
  });

  it('fails and partially scores a forbidden SQL dialect pattern that is present', () => {
    const invalid: LLMToolCall = {
      name: 'SAPQuery',
      arguments: { sql: 'SELECT TOP 5 t.tabname FROM dd02l t' },
    };
    const expected: ExpectedToolCall = {
      tool: 'SAPQuery',
      argumentPatterns: { sql: { forbidden: [/\bTOP\b/i, /\b[A-Z_]\w*\./i, /\bFROM\s+DD02L\s+T\b/i] } },
    };

    expect(matchesExpectedToolCall(invalid, expected)).toBe(false);
    expect(scoreExpectedToolCallParameters(invalid, expected)).toBe(0);
  });

  it('resets stateful regexes so repeated scoring is deterministic', () => {
    const expected: ExpectedToolCall = {
      tool: 'SAPQuery',
      argumentPatterns: { sql: { required: [/SELECT/g] } },
    };

    expect(scoreExpectedToolCallParameters(actual, expected)).toBe(1);
    expect(scoreExpectedToolCallParameters(actual, expected)).toBe(1);
  });

  it('treats a non-string argument as failing required content checks', () => {
    const expected: ExpectedToolCall = {
      tool: 'SAPQuery',
      argumentPatterns: { maxRows: { required: [/5/] } },
    };

    expect(matchesExpectedToolCall(actual, expected)).toBe(false);
    expect(scoreExpectedToolCallParameters(actual, expected)).toBe(0);
  });
});
