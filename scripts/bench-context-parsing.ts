/** CPU-only synthetic benchmark. No SAP/network I/O, credentials or source files. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Version } from '@abaplint/core';
import { extractContract } from '../src/context/contract.js';
import { extractDependencies } from '../src/context/deps.js';
import { ContextParseCache } from '../src/context/parse-cache.js';

function fixture(name: string, lines: number): string {
  return [
    `CLASS ${name} DEFINITION PUBLIC.`,
    'PUBLIC SECTION.',
    'CLASS-METHODS run.',
    'ENDCLASS.',
    `CLASS ${name} IMPLEMENTATION.`,
    'METHOD run.',
    'DATA value TYPE i.',
    ...Array.from({ length: lines - 9 }, () => 'value = value + 1.'),
    'ENDMETHOD.',
    'ENDCLASS.',
  ].join('\n');
}
function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}
function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}
const reports = [];
for (const lines of [300, 1000]) {
  const sources = Array.from({ length: 20 }, (_, i) => ({
    name: `ZCL_BENCH_${i}`,
    source: fixture(`ZCL_BENCH_${i}`, lines),
  }));
  for (const depth of [1, 2]) {
    const cache = new ContextParseCache();
    const baseline = () =>
      sources.map(({ source, name }) => ({
        contract: extractContract(source, name, 'CLAS', Version.v758),
        deps: depth === 2 ? extractDependencies(source, name, true, Version.v758) : [],
      }));
    const cached = () =>
      sources.map(({ source, name }) => ({
        contract: cache.contract(source, name, 'CLAS', Version.v758),
        deps: depth === 2 ? cache.dependencies(source, name, Version.v758) : [],
      }));
    const coldMs = elapsed(() => assert.deepEqual(cached(), baseline()));
    // Equality and JIT warm-up happen above, outside the measured warm repetitions.
    const uncached = [],
      warm = [];
    for (let i = 0; i < 7; i++) {
      uncached.push(elapsed(baseline));
      warm.push(elapsed(cached));
    }
    reports.push({
      dependencies: sources.length,
      sourceLines: lines,
      depth,
      validationAndWarmupMs: Math.round(coldMs),
      uncachedMedianMs: +median(uncached).toFixed(2),
      warmMedianMs: +median(warm).toFixed(2),
      retained: cache.stats(),
    });
  }
}
process.stdout.write(`${JSON.stringify({ node: process.version, parserLanguage: '758', reports }, null, 2)}\n`);
