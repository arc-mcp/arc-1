import { describe, expect, it } from 'vitest';
import {
  isSupportedMultiTargetArcProperty,
  MULTI_TARGET_ARC_PROPERTIES,
  parseDestinationBoolean,
  parseDestinationWritePolicy,
  READ_ONLY_WRITE_POLICY,
} from '../../../src/server/multi-target-destination-config.js';

describe('multi-target destination property contract', () => {
  it('keeps the supported v1 property list narrow and case-sensitive', () => {
    expect(MULTI_TARGET_ARC_PROPERTIES).toEqual([
      'arc1.enabled',
      'arc1.allow_data_preview',
      'arc1.allow_free_sql',
      'arc1.target_alias',
      'arc1.allow_writes',
      'arc1.allowed_packages',
      'arc1.allow_transport_writes',
      'arc1.allow_git_writes',
    ]);
    expect(isSupportedMultiTargetArcProperty('arc1.enabled')).toBe(true);
    expect(isSupportedMultiTargetArcProperty('arc1.target_alias')).toBe(true);
    expect(isSupportedMultiTargetArcProperty('ARC1.Enabled')).toBe(false);
    expect(isSupportedMultiTargetArcProperty('arc1.Target_Alias')).toBe(false);
  });

  it('parses only explicit destination booleans', () => {
    expect(parseDestinationBoolean(' TRUE ')).toBe(true);
    expect(parseDestinationBoolean('false')).toBe(false);
    expect(parseDestinationBoolean(undefined)).toBeUndefined();
    expect(parseDestinationBoolean('yes')).toBeUndefined();
  });
});

describe('parseDestinationWritePolicy', () => {
  const pp = 'PrincipalPropagation' as const;
  it('returns the read-only policy when no write key is present', () => {
    expect(parseDestinationWritePolicy({ 'arc1.enabled': 'true' }, pp)).toEqual({
      ok: true,
      policy: READ_ONLY_WRITE_POLICY,
    });
  });
  it('accepts a complete PP write opt-in', () => {
    expect(
      parseDestinationWritePolicy(
        { 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP, ZTEAM*', 'arc1.allow_transport_writes': 'true' },
        pp,
      ),
    ).toEqual({
      ok: true,
      policy: {
        allowWrites: true,
        allowedPackages: ['$TMP', 'ZTEAM*'],
        allowTransportWrites: true,
        allowGitWrites: false,
      },
    });
  });
  it.each([
    [
      { 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP' },
      'BasicAuthentication',
      'WRITE_REQUIRES_PRINCIPAL_PROPAGATION',
    ],
    [{ 'arc1.allowed_packages': '$TMP' }, 'BasicAuthentication', 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION'],
    [{ 'arc1.allow_git_writes': 'yes' }, 'BasicAuthentication', 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION'],
    [{ 'arc1.allow_writes': 'yes', 'arc1.allowed_packages': '$TMP' }, pp, 'INVALID_WRITE_POLICY'],
    [{ 'arc1.allow_writes': 'true' }, pp, 'INVALID_WRITE_POLICY'],
    [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '' }, pp, 'INVALID_WRITE_POLICY'],
    [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP,,Z*' }, pp, 'INVALID_WRITE_POLICY'],
    [{ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': 'Z**' }, pp, 'INVALID_WRITE_POLICY'],
    [{ 'arc1.allow_transport_writes': 'true' }, pp, 'INVALID_WRITE_POLICY'],
    [{ 'arc1.allow_writes': 'false', 'arc1.allow_git_writes': 'true' }, pp, 'INVALID_WRITE_POLICY'],
  ] as const)('rejects %o on %s with %s', (properties, auth, code) => {
    expect(parseDestinationWritePolicy(properties, auth)).toMatchObject({ ok: false, code });
  });
  it('keeps a Basic destination with only explicit false write keys as a read target (Q3)', () => {
    expect(
      parseDestinationWritePolicy(
        { 'arc1.allow_writes': 'false', 'arc1.allow_git_writes': 'false' },
        'BasicAuthentication',
      ),
    ).toEqual({ ok: true, policy: READ_ONLY_WRITE_POLICY });
  });
  it('keeps allow_writes=false read-only even when packages are listed', () => {
    expect(parseDestinationWritePolicy({ 'arc1.allow_writes': 'false', 'arc1.allowed_packages': 'Z*' }, pp)).toEqual({
      ok: true,
      policy: READ_ONLY_WRITE_POLICY,
    });
  });
  it('rejects more than 64 package patterns and freezes the accepted policy', () => {
    const many = Array.from({ length: 65 }, (_, i) => `Z${i}`).join(',');
    expect(
      parseDestinationWritePolicy({ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': many }, pp),
    ).toMatchObject({ ok: false, code: 'INVALID_WRITE_POLICY' });
    const accepted = parseDestinationWritePolicy({ 'arc1.allow_writes': 'true', 'arc1.allowed_packages': 'Z*' }, pp);
    expect(accepted.ok && Object.isFrozen(accepted.policy) && Object.isFrozen(accepted.policy.allowedPackages)).toBe(
      true,
    );
  });
});
