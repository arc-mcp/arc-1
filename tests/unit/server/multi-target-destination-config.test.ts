import { describe, expect, it } from 'vitest';
import {
  isSupportedMultiTargetArcProperty,
  isWriteRelatedArcProperty,
  MULTI_TARGET_ARC_PROPERTIES,
  parseDestinationBoolean,
} from '../../../src/server/multi-target-destination-config.js';

describe('multi-target destination property contract', () => {
  it('keeps the supported v1 property list narrow and case-sensitive', () => {
    expect(MULTI_TARGET_ARC_PROPERTIES).toEqual([
      'arc1.enabled',
      'arc1.allow_data_preview',
      'arc1.allow_free_sql',
      'arc1.target_alias',
    ]);
    expect(isSupportedMultiTargetArcProperty('arc1.enabled')).toBe(true);
    expect(isSupportedMultiTargetArcProperty('arc1.target_alias')).toBe(true);
    expect(isSupportedMultiTargetArcProperty('ARC1.Enabled')).toBe(false);
    expect(isSupportedMultiTargetArcProperty('arc1.Target_Alias')).toBe(false);
    expect(isWriteRelatedArcProperty('arc1.allow_writes')).toBe(true);
    expect(isWriteRelatedArcProperty('arc1.allow_data_preview')).toBe(false);
  });

  it('parses only explicit destination booleans', () => {
    expect(parseDestinationBoolean(' TRUE ')).toBe(true);
    expect(parseDestinationBoolean('false')).toBe(false);
    expect(parseDestinationBoolean(undefined)).toBeUndefined();
    expect(parseDestinationBoolean('yes')).toBeUndefined();
  });
});
