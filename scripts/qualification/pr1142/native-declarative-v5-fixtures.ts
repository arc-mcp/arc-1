/** Versioned fixture graph; qualification belongs to the separately reviewed fixed V5 entry. */
import { type DeclarativeFixture, declarativeV4Fixtures } from './native-declarative-fixtures.js';

/** Reuse the frozen six-owner V4 graph without changing any consumed builder or evidence contract. */
export function declarativeV5Fixtures(suffix: string): readonly DeclarativeFixture[] {
  if (typeof suffix !== 'string' || suffix === '013FECCE68663763')
    throw new Error('A fresh nonhistorical V5 fixture suffix is required.');
  const rename = (value: string) => value
    .replaceAll('ZARC1_V4', 'ZARC1_V5')
    .replaceAll('zarc1_v4', 'zarc1_v5')
    .replaceAll('ARC1 declarative v4 ', 'ARC1 declarative v5 ');
  return Object.freeze(declarativeV4Fixtures(suffix).map(fixture => {
    const name = rename(fixture.name);
    const source = (value: string) => {
      const renamed = rename(value);
      if (fixture.type !== 'BDEF') return renamed;
      const declaration = `define behavior for ${name}\n`;
      if (renamed.split(declaration).length !== 2)
        throw new Error('The fixed abstract entity declaration changed; review the V5 fixture.');
      // SAP's mandatory:execute semantics require with hierarchy AND entity-level with control.
      return renamed.replace(declaration, `define behavior for ${name} with control\n`);
    };
    return Object.freeze({
      ...fixture, name, owner: rename(fixture.owner), description: rename(fixture.description),
      source: source(fixture.source), updatedSource: source(fixture.updatedSource),
      dependencies: Object.freeze(fixture.dependencies.map(rename)),
    });
  }));
}
