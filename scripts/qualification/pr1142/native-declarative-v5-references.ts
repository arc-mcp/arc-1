/** The observed BDEF template class is a read-only reference, never a disposable owner. */
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { declarativeV5Fixtures } from './native-declarative-v5-fixtures.js';
export interface DeclarativeReadOnlyReference { owner: string; referencedBy: string }
export function declarativeV5References(fixtures: readonly DeclarativeFixture[]): readonly DeclarativeReadOnlyReference[] {
  const suffix = fixtures[0]?.name.slice(-16);
  if (!suffix || JSON.stringify(fixtures) !== JSON.stringify(declarativeV5Fixtures(suffix)))
    throw new Error('Read-only references require the exact V5 fixture graph.');
  const behavior = fixtures.find(f => f.type === 'BDEF')!;
  return Object.freeze([Object.freeze({
    owner: `/sap/bc/adt/oo/classes/zbp_${behavior.name.slice(1).toLowerCase()}`,
    referencedBy: behavior.owner,
  })]);
}
