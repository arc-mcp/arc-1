import { describe, expect, it } from 'vitest';
import {
  declarativeFixtures,
  declarativePreservationClosure,
  declarativeV2Fixtures,
  declarativeV4Fixtures,
} from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import { validateRapSource } from '../../../src/adt/rap-preflight.js';
import { runPreWriteLint } from '../../../src/handlers/write-helpers.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe.each([
  { protocol: 'v1', factory: declarativeFixtures },
  { protocol: 'v2', factory: declarativeV2Fixtures },
  { protocol: 'v4', factory: declarativeV4Fixtures },
])('$protocol fixed fixtures', ({ protocol, factory }) => {
  const fixtures = factory('0123456789ABCDEF');
  it('uses only distinct disposable resources with already-created dependencies', () => {
    const seen = new Set<string>();
    expect(fixtures).toHaveLength(6);
    expect(new Set(fixtures.map((f) => f.type))).toEqual(new Set(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD']));
    for (const fixture of fixtures) {
      expect(seen.has(fixture.owner)).toBe(false);
      expect(fixture.name.length).toBeLessThanOrEqual(30);
      expect(fixture.packageName).toBe('$TMP');
      expect(fixture.dependencies.every((dependency) => seen.has(dependency))).toBe(true);
      expect(fixture.updatedSource.replace('// revised fixture comment\n', '')).toBe(fixture.source);
      seen.add(fixture.owner);
    }
    expect(fixtures.find((f) => f.type === 'BDEF')!.source).not.toContain('implementation in class');
    expect(fixtures.some((f) => f.source.includes('publish'))).toBe(false);
  });
  it.each(
    fixtures.flatMap((fixture) => [
      { ...fixture, variant: 'initial' },
      { ...fixture, source: fixture.updatedSource, variant: 'updated' },
    ]),
  )('checks the declared target and available local rules for $type $variant source', (fixture) => {
    const view = fixtures[0],
      abstract = fixtures[1];
    const declarations =
      fixture.type === 'DDLS'
        ? [
            fixture === view || fixture.name === view.name
              ? `define root view entity ${fixture.name} as select from sflight`
              : `define root abstract entity ${fixture.name}`,
          ]
        : fixture.type === 'DCLS'
          ? [`define role ${fixture.name}`, `grant select on ${view.name};`]
          : fixture.type === 'DDLX'
            ? [`annotate view ${view.name} with`]
            : fixture.type === 'BDEF'
              ? [`abstract;`, `define behavior for ${abstract.name}`]
              : [`define service ${fixture.name}`, `expose ${view.name} as Flights;`];
    for (const declaration of declarations) expect(fixture.source).toContain(declaration);
    if (['DDLS', 'BDEF', 'DDLX'].includes(fixture.type)) {
      const result = validateRapSource(fixture.type, fixture.source, { systemType: 'onprem', abapRelease: '758' });
      expect(result.errors).toEqual([]);
    }
    if (fixture.type === 'DDLS') {
      const lint = runPreWriteLint(fixture.source, fixture.type, fixture.name, {
        ...DEFAULT_CONFIG,
        systemType: 'onprem',
        abapRelease: '758',
        lintBeforeWrite: true,
      });
      expect(lint.blocked, lint.result?.content[0].text).toBe(false);
    }
  });
  it.each(['', 'a'.repeat(16), 'A'.repeat(15), 'A'.repeat(17), '../foreign', `${'A'.repeat(15)}?`])(
    'refuses an unsafe fixture suffix: %s',
    (suffix) => {
      expect(() => factory(suffix)).toThrow();
    },
  );
  it('preserves a child and its base while leaving unrelated owners eligible for cleanup', () => {
    const role = fixtures.find((f) => f.type === 'DCLS')!;
    const result = declarativePreservationClosure(fixtures, [role.owner]);
    expect(result).toEqual(new Set([role.owner, ...role.dependencies]));
    expect(result.has(fixtures.find((f) => f.type === 'BDEF')!.owner)).toBe(false);
  });
  it('refuses an unknown cleanup owner', () => {
    expect(() => declarativePreservationClosure(fixtures, ['/sap/bc/adt/ddic/ddl/sources/foreign'])).toThrow();
  });

  it.each(fixtures)('carries the exact disposable marker in $type $name, in both source versions', (fixture) => {
    const marker = `ARC1 declarative ${protocol === 'v1' ? '' : `${protocol} `}0123456789ABCDEF`;
    expect(fixture.description).toBe(marker);
    expect(marker.length).toBeLessThanOrEqual(60);
    for (const source of [fixture.source, fixture.updatedSource]) {
      expect(source.startsWith(`// ${marker}\n`)).toBe(true);
      // DDLX and BDEF carry no entity label: their marker is the comment and the owner description.
      expect(source.includes(`@EndUserText.label: '${marker}'`)).toBe(['DDLS', 'DCLS', 'SRVD'].includes(fixture.type));
    }
  });
  it('pins every cleanup dependency edge, including the separate abstract BDEF base', () => {
    const view = fixtures[0],
      abstract = fixtures[1];
    expect(fixtures.map((fixture) => [fixture.owner, fixture.dependencies])).toEqual([
      [view.owner, []],
      [abstract.owner, []],
      [fixtures.find((fixture) => fixture.type === 'DCLS')!.owner, [view.owner]],
      [fixtures.find((fixture) => fixture.type === 'DDLX')!.owner, [view.owner]],
      [fixtures.find((fixture) => fixture.type === 'BDEF')!.owner, [abstract.owner]],
      [fixtures.find((fixture) => fixture.type === 'SRVD')!.owner, [view.owner]],
    ]);
  });
});

it('keeps every v2 owner and marker disjoint from v1 even with the same suffix', () => {
  const old = declarativeFixtures('0123456789ABCDEF');
  const current = declarativeV2Fixtures('0123456789ABCDEF');
  expect(current).toHaveLength(6);
  for (const fixture of current) {
    expect(fixture.name).toMatch(/^ZARC1_V2[VADXS]_[A-F0-9]{16}$/);
    expect(old.some((prior) => prior.owner === fixture.owner || prior.description === fixture.description)).toBe(false);
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.dependencies)).toBe(true);
  }
});
