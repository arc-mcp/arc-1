/** Fixed disposable native CDS/RAP fixtures; no execution, publication, table data or foreign mutations. */
import { pinnedDeclarativeSelection, type PinnedDeclarativeType } from "../../../src/adt/pinned-repository-owner.js";

export interface DeclarativeFixture {
  type: PinnedDeclarativeType;
  name: string;
  owner: string;
  packageName: '$TMP';
  description: string;
  source: string;
  updatedSource: string;
  dependencies: readonly string[];
}

export function declarativeFixtures(suffix: string): readonly DeclarativeFixture[] {
  return fixedFixtures(suffix, 'v1');
}

/** A separate name/marker family; no consumed v1 owner or recovery receipt is repurposed. */
export function declarativeV2Fixtures(suffix: string): readonly DeclarativeFixture[] {
  return fixedFixtures(suffix, 'v2');
}

/** V4 never reuses a historical suffix or name family, including the mutation-free v2 failure. */
export function declarativeV4Fixtures(suffix: string): readonly DeclarativeFixture[] {
  if (['61EDD87470C55DB0', '590FEFA202D7EDEC', 'F4C656905A65AA61'].includes(suffix))
    throw new Error('A historical declarative suffix cannot be reused.');
  return fixedFixtures(suffix, 'v4');
}

function fixedFixtures(suffix: string, protocol: 'v1' | 'v2' | 'v4'): readonly DeclarativeFixture[] {
  if (!/^[A-F0-9]{16}$/.test(suffix)) throw new Error('A fresh uppercase 16-hex fixture suffix is required.');
  const family = protocol === 'v1' ? 'N' : protocol.toUpperCase();
  const view = `ZARC1_${family}V_${suffix}`;
  const abstract = `ZARC1_${family}A_${suffix}`;
  const marker = `ARC1 declarative ${protocol === 'v1' ? '' : `${protocol} `}${suffix}`;
  const owner = (type: PinnedDeclarativeType, name: string) => pinnedDeclarativeSelection(type, name).objectUrl;
  const fixture = (type: PinnedDeclarativeType, name: string, body: string, dependencies: readonly string[] = []): DeclarativeFixture =>
    Object.freeze({ type, name, owner: owner(type, name), packageName: '$TMP', description: marker,
      source: `// ${marker}\n${body}\n`, updatedSource: `// ${marker}\n// revised fixture comment\n${body}\n`, dependencies: Object.freeze([...dependencies]) });
  return Object.freeze([
    fixture('DDLS', view, `@EndUserText.label: '${marker}'
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.allowExtensions: true
define root view entity ${view} as select from sflight
{
  key carrid as Carrier,
  key connid as ConnectionId,
  key fldate as FlightDate
}`),
    fixture('DDLS', abstract, `@EndUserText.label: '${marker}'
define root abstract entity ${abstract}
{
  Item : abap.char(10);
}`),
    fixture('DCLS', `ZARC1_${family}D_${suffix}`, `@EndUserText.label: '${marker}'
@MappingRole: true
define role ZARC1_${family}D_${suffix}
{
  grant select on ${view};
}`, [owner('DDLS', view)]),
    fixture('DDLX', `ZARC1_${family}X_${suffix}`, `@Metadata.layer: #CUSTOMER
annotate view ${view} with
{
  @UI.lineItem: [{ position: 10, label: 'Probe' }]
  Carrier;
}`, [owner('DDLS', view)]),
    // Abstract BDEF has no implementation class or transactional behavior.
    // SAP reference: ABENBDL_BDEF_ABSTRACT_HEADER and ABENBDL_DEFINE_BEH_ABSTRACT.
    fixture('BDEF', abstract, `abstract;
strict ( 2 );
with hierarchy;
define behavior for ${abstract}
{
  field ( mandatory : execute ) Item;
}`, [owner('DDLS', abstract)]),
    fixture('SRVD', `ZARC1_${family}S_${suffix}`, `@EndUserText.label: '${marker}'
define service ZARC1_${family}S_${suffix}
{
  expose ${view} as Flights;
}`, [owner('DDLS', view)]),
  ]);
}

/** Preserve every dependency of an uncertain fixture; an existing child can still refer to its base. */
export function declarativePreservationClosure(fixtures: readonly DeclarativeFixture[], owners: Iterable<string>) {
  const known = new Map(fixtures.map(fixture => [fixture.owner, fixture]));
  const preserved = new Set<string>();
  function add(owner: string) {
    if (preserved.has(owner)) return;
    const fixture = known.get(owner);
    if (!fixture) throw new Error('Preservation requires an exact owned fixture.');
    preserved.add(owner);
    for (const dependency of fixture.dependencies) add(dependency);
  }
  for (const owner of owners) add(owner);
  return preserved;
}
