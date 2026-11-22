import { describe, expect, it } from 'vitest';
import {
  classIncludeUrl,
  functionGroupIncludeObjectUrl,
  functionGroupObjectUrl,
  functionModuleObjectUrl,
  objectUrlForType,
} from '../../../src/handlers/object-types.js';

describe('object URL builders refuse traversal names', () => {
  it('objectUrlForType throws for "." and ".."', () => {
    expect(() => objectUrlForType('CLAS', '.')).toThrow();
    expect(() => objectUrlForType('CLAS', '..')).toThrow();
  });
  it('classIncludeUrl throws for ".."', () => {
    expect(() => classIncludeUrl('..', 'definitions')).toThrow();
  });
  it('still builds a normal URL', () => {
    expect(objectUrlForType('CLAS', 'ZCL_X')).toBe('/sap/bc/adt/oo/classes/ZCL_X');
  });
  it('refuses dot segments in function group, include, and module names', () => {
    expect(() => functionGroupObjectUrl('..')).toThrow();
    expect(() => functionGroupIncludeObjectUrl('ZFG', '..')).toThrow();
    expect(() => functionModuleObjectUrl('ZFG', '.')).toThrow();
    expect(() => objectUrlForType('TABL/DTI', '..')).toThrow();
  });
});
