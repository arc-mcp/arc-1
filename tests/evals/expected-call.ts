/** Shared expected-tool-call matching for every eval provider. */

import type { EvalScenario, ExpectedToolCall, LLMToolCall } from './types.js';

function sameExpectedValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual.toUpperCase() === expected.toUpperCase();
  }
  return actual === expected;
}

function patternMatches(pattern: RegExp, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  pattern.lastIndex = 0;
  const matches = pattern.test(value);
  pattern.lastIndex = 0;
  return matches;
}

function parameterChecks(actual: LLMToolCall, expected: ExpectedToolCall): boolean[] {
  const checks: boolean[] = [];

  for (const [key, value] of Object.entries(expected.requiredArgs ?? {})) {
    checks.push(sameExpectedValue(actual.arguments[key], value));
  }
  for (const key of expected.requiredArgKeys ?? []) {
    checks.push(key in actual.arguments);
  }
  for (const [key, patterns] of Object.entries(expected.argumentPatterns ?? {})) {
    const value = actual.arguments[key];
    for (const pattern of patterns.required ?? []) checks.push(patternMatches(pattern, value));
    for (const pattern of patterns.forbidden ?? []) checks.push(!patternMatches(pattern, value));
  }

  return checks;
}

export function matchesExpectedToolCall(actual: LLMToolCall, expected: ExpectedToolCall): boolean {
  return actual.name === expected.tool && parameterChecks(actual, expected).every(Boolean);
}

export function scoreExpectedToolCallParameters(actual: LLMToolCall, expected: ExpectedToolCall): number {
  const checks = parameterChecks(actual, expected);
  if (checks.length === 0) return 1;
  return checks.filter(Boolean).length / checks.length;
}

/** Apply the shared pass rule used by the in-process and CLI-backed eval providers. */
export function scenarioPasses(
  scenario: EvalScenario,
  overallScore: number,
  parameterScore: number,
  passThreshold: number,
): boolean {
  return overallScore >= passThreshold && (!scenario.requireFullParameters || parameterScore === 1);
}
