import { describe, expect, it } from 'vitest';
import {
  assertCanonicalAdtObjectUri,
  assertNoUrlDotSegments,
  encodeObjectNameSegment,
  isTraversalSegment,
} from '../../../src/adt/path-safety.js';
import { serverDrivenObjectUrl } from '../../../src/adt/server-driven.js';

describe('isTraversalSegment', () => {
  it.each(['.', '..', ' .. ', '%2e', '%2E', '%2e%2e', '%2E%2E'])('flags %s as traversal', (value) => {
    expect(isTraversalSegment(value)).toBe(true);
  });
  it.each(['ZI_SALESORDER', '...', 'A%2FB', ''])('allows %s', (value) => {
    expect(isTraversalSegment(value)).toBe(false);
  });
});

describe('encodeObjectNameSegment', () => {
  it('refuses "." and ".." so a name cannot climb out of its collection', () => {
    expect(() => encodeObjectNameSegment('.')).toThrow();
    expect(() => encodeObjectNameSegment('..')).toThrow();
  });
  it('encodes separators into a single segment', () => {
    expect(encodeObjectNameSegment('A/B')).toBe('A%2FB');
    expect(encodeObjectNameSegment('/DMO/R_X')).toBe('%2FDMO%2FR_X');
  });
  it('passes a normal name through and leaves a literal "..." alone', () => {
    expect(encodeObjectNameSegment('ZI_SALESORDER')).toBe('ZI_SALESORDER');
    expect(encodeObjectNameSegment('...')).toBe('...');
  });
});

describe('alternate object builders and final request path', () => {
  it.each(['.', '..'])('refuses server-driven name %s', (name) => {
    expect(() => serverDrivenObjectUrl('DSFD', name)).toThrow();
    expect(() => serverDrivenObjectUrl('TABL/DTI', name)).toThrow();
  });
  it.each([
    '/sap/bc/adt/oo/classes/.',
    '/sap/bc/adt/oo/classes/..',
    '/sap/bc/adt/oo/classes/%2e.',
    '/sap/bc/adt/oo/classes/..%2F..\\x',
  ])('refuses unsafe raw request path %s', (path) => expect(() => assertNoUrlDotSegments(path)).toThrow());
  it('keeps encoded slashes in names and a dot pattern in queries', () => {
    expect(assertNoUrlDotSegments('/sap/bc/adt/oo/classes/%2FDMO%2FZCL_X?query=..')).toContain('%2FDMO%2FZCL_X');
    expect(assertNoUrlDotSegments('/sap/opu/odata/sap/X/..%2Fkey')).toBe('/sap/opu/odata/sap/X/..%2Fkey');
  });
});

describe('canonical object URI', () => {
  it('accepts a namespaced object name while keeping the ADT host-relative boundary', () => {
    expect(assertCanonicalAdtObjectUri('/sap/bc/adt/oo/classes/%2FDMO%2FZCL_X')).toBe(
      '/sap/bc/adt/oo/classes/%2FDMO%2FZCL_X',
    );
  });
  it.each(['https://evil.example/sap/bc/adt/oo/classes/ZCL_X', '/sap/opu/odata/sap/X', '/sap/bc/adt/oo/classes/..'])(
    'rejects %s',
    (uri) => expect(() => assertCanonicalAdtObjectUri(uri)).toThrow(),
  );
});
