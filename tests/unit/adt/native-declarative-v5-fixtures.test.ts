import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { declarativeSnapshot } from '../../../scripts/qualification/pr1142/native-declarative-evidence.js';
import {
  declarativeFixtures,
  declarativePreservationClosure,
  declarativeV2Fixtures,
  declarativeV4Fixtures,
} from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import { checkDeclarativeRequest } from '../../../scripts/qualification/pr1142/native-declarative-transport.js';
import { declarativeV5Fixtures } from '../../../scripts/qualification/pr1142/native-declarative-v5-fixtures.js';
import { declarativeV5References } from '../../../scripts/qualification/pr1142/native-declarative-v5-references.js';
import {
  type DeclarativeDriver,
  runNativeDeclarativeWorkflow,
} from '../../../scripts/qualification/pr1142/native-declarative-workflow.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { pinnedDeclarativeSelection } from '../../../src/adt/pinned-repository-owner.js';
import { validateRapSource } from '../../../src/adt/rap-preflight.js';
import { buildCreateXml, createContentTypeForType, runPreWriteLint } from '../../../src/handlers/write-helpers.js';
import { lintAbapSource } from '../../../src/lint/lint.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const suffix = '0123456789ABCDEF',
  fixtures = declarativeV5Fixtures(suffix),
  behavior = fixtures[4];
const old = () => [declarativeFixtures, declarativeV2Fixtures, declarativeV4Fixtures].map((f) => f(suffix));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
it('leaves every consumed source graph unchanged and gives V5 disjoint identities/markers', () => {
  expect(sha(JSON.stringify(old()))).toBe('4382acddc4d7b76a1823d2318bfdf298ddc800bd48d724f084be8e78c4e0178d');
  const historical = new Set(
    old()
      .flat()
      .map((f) => f.owner),
  );
  expect(fixtures).toHaveLength(6);
  expect(new Set(fixtures.map((f) => f.owner)).size).toBe(6);
  expect(fixtures.map((f) => f.type)).toEqual(['DDLS', 'DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD']);
  for (const f of fixtures) {
    expect(historical.has(f.owner)).toBe(false);
    expect(f.name.length).toBeLessThanOrEqual(30);
    expect(f.owner).toBe(pinnedDeclarativeSelection(f.type, f.name).objectUrl);
    expect(f.packageName).toBe('$TMP');
    expect(f.description).toBe(`ARC1 declarative v5 ${suffix}`);
    expect(Object.isFrozen(f)).toBe(true);
    expect(Object.isFrozen(f.dependencies)).toBe(true);
    expect(f.updatedSource.replace('// revised fixture comment\n', '')).toBe(f.source);
    expect(JSON.stringify(f)).not.toContain('V4');
    expect(JSON.stringify(f)).not.toContain('v4');
  }
  expect(Object.isFrozen(fixtures)).toBe(true);
});
it.each([
  '61EDD87470C55DB0',
  '590FEFA202D7EDEC',
  'F4C656905A65AA61',
  '013FECCE68663763',
  '',
  'abcdef0123456789',
  'A'.repeat(15),
  'A'.repeat(17),
  '../foreign',
  1234567890123456,
])('rejects invalid or consumed suffix %s', (value) => {
  expect(() => declarativeV5Fixtures(value as string)).toThrow();
});
it('places with control on the abstract entity, retaining with hierarchy and its mandatory field', () => {
  for (const source of [behavior.source, behavior.updatedSource]) {
    expect(source).toContain(
      `abstract;\nstrict ( 2 );\nwith hierarchy;\ndefine behavior for ${behavior.name} with control\n{\n  field ( mandatory : execute ) Item;\n}`,
    );
    expect(source.match(/\bwith control\b/g)).toHaveLength(1);
    expect(source).not.toMatch(
      /implementation in class|lock master|authorization master|\b(?:create|update|delete)\s*;/i,
    );
  }
  expect(behavior.source.split('\n')[4]).toBe(`define behavior for ${behavior.name} with control`);
  expect(behavior.source.split('\n')[6]).toBe('  field ( mandatory : execute ) Item;');
  expect(fixtures[1].source).toContain(`define root abstract entity ${behavior.name}\n{\n  Item : abap.char(10);`);
  expect(declarativeV4Fixtures(suffix)[4].source).not.toContain('with control');
});
it('changes only naming/markers and the BDEF control clause relative to the qualified four-owner forms', () => {
  const v4 = declarativeV4Fixtures(suffix);
  const restore = (s: string) =>
    s
      .replaceAll('ZARC1_V5', 'ZARC1_V4')
      .replaceAll('zarc1_v5', 'zarc1_v4')
      .replaceAll('ARC1 declarative v5 ', 'ARC1 declarative v4 ');
  for (const [index, f] of fixtures.entries()) {
    for (const key of ['source', 'updatedSource'] as const) {
      const restored = restore(f[key]);
      expect(f.type === 'BDEF' ? restored.replace(' with control\n', '\n') : restored).toBe(v4[index][key]);
    }
  }
  expect(fixtures[0].source).toContain('key connid as ConnectionId,');
  expect(fixtures[5].source).toContain(
    `define service ${fixtures[5].name}\n{\n  expose ${fixtures[0].name} as Flights;\n}`,
  );
  expect(fixtures.some((f) => /\b(?:implementation in class|define service binding|publish)\b/i.test(f.source))).toBe(
    false,
  );
});
it.each(
  fixtures.flatMap((f) => [
    { ...f, variant: 'initial' },
    { ...f, source: f.updatedSource, variant: 'updated' },
  ]),
)('checks available local syntax for $type $variant without claiming SAP semantics', (f) => {
  expect(validateRapSource(f.type, f.source, { systemType: 'onprem', abapRelease: '758' }).errors).toEqual([]);
  if (f.type === 'DDLS')
    expect(
      runPreWriteLint(f.source, f.type, f.name, {
        ...DEFAULT_CONFIG,
        lintBeforeWrite: true,
        systemType: 'onprem',
        abapRelease: '758',
      }).blocked,
    ).toBe(false);
  if (f.type === 'BDEF') {
    const diagnostics = lintAbapSource(f.source, `${f.name.toLowerCase()}.bdef.asbdef`);
    expect(diagnostics.some((d) => d.rule === 'bdef_parser_error')).toBe(false);
    // A single-file parser does not supply this native entity or prove mandatory:execute semantics.
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'bdef_check_syntax', message: `Entity "${f.name}" not found` }),
      ]),
    );
  }
});
it.each(fixtures)('retains exact native CREATE classification and request fence for $type $name', (f) => {
  const selected = pinnedDeclarativeSelection(f.type, f.name),
    xml = buildCreateXml(f.type, f.name, '$TMP', f.description);
  const root = nativeXmlRoot(xml, selected.root, selected.namespace),
    core = 'http://www.sap.com/adt/core';
  expect(root.attribute('name', core)).toBe(f.name);
  expect(root.attribute('type', core)).toBe(selected.native);
  expect(root.child('packageRef', core)?.attribute('name', core)).toBe('$TMP');
  expect(() =>
    checkDeclarativeRequest(
      f,
      'POST',
      f.owner.replace(/\/[^/]+$/, '') + (f.type === 'BDEF' ? '?_package=%24TMP' : ''),
      xml,
    ),
  ).not.toThrow();
  for (const source of [f.source, f.updatedSource])
    expect(() => checkDeclarativeRequest(f, 'PUT', `${f.owner}/source/main?lockHandle=owned`, source)).not.toThrow();
  if (f.type === 'BDEF') {
    expect(root.hasChild('adtTemplate')).toBe(false);
    expect(xml).not.toContain('abstract;');
    expect(createContentTypeForType(f.type, false)).toBe('application/vnd.sap.adt.blues.v1+xml');
  }
  if (f.type === 'SRVD') expect(root.attribute('srvdSourceType', selected.namespace)).toBe('S');
});
it.each([false, true])(
  'does not accept an active default BDEF placeholder as the intended source, active=%s',
  async (active) => {
    const selected = pinnedDeclarativeSelection(behavior.type, behavior.name),
      core = 'http://www.sap.com/adt/core';
    const metadata = `<b:blueSource xmlns:b="${selected.namespace}" xmlns:c="${core}" c:name="${behavior.name}" c:type="BDEF/BDO" c:version="active" c:description="${behavior.description}" c:createdBy="MARIAN" c:changedBy="MARIAN"><c:packageRef c:name="$TMP" c:type="DEVC/K"/></b:blueSource>`;
    const get = async (path: string) => ({
      statusCode: 200,
      headers: { 'content-type': path.includes('/source/main') ? 'text/plain' : 'application/xml' },
      body: path.includes('/source/main')
        ? `unmanaged implementation in class ZBP_PLACEHOLDER unique;\ndefine behavior for ${behavior.name} { create; }`
        : metadata,
    });
    await expect(
      declarativeSnapshot({ get }, behavior, behavior.source, active, () => {}, { deadline: Date.now() + 1000 }),
    ).rejects.toMatchObject({ reason: 'source-content' });
  },
);
it('retains per-owner activation/update and reverse dependency cleanup in the unchanged shared workflow', async () => {
  const log: string[] = [],
    active = new Set<string>(),
    present = new Set<string>();
  let attempted = false;
  const receipt = (activeVerified = false) => ({
    sourceHash: 'a'.repeat(64),
    metadataHash: 'b'.repeat(64),
    activeVerified,
  });
  const driver: DeclarativeDriver = {
    async preflight() {},
    verifySource() {},
    shouldStop: () => false,
    record() {},
    mutationAttempted: () => attempted,
    async create(f) {
      expect(f.dependencies.every((d) => active.has(d))).toBe(true);
      present.add(f.owner);
      attempted = true;
      log.push(`create:${f.owner}`);
      return receipt();
    },
    async activate(f) {
      active.add(f.owner);
      log.push(`activate:${f.owner}`);
      return receipt(true);
    },
    async update(f, prior) {
      expect(prior.activeVerified).toBe(true);
      active.delete(f.owner);
      log.push(`update:${f.owner}`);
      return receipt();
    },
    async remove(f) {
      expect(fixtures.some((child) => present.has(child.owner) && child.dependencies.includes(f.owner))).toBe(false);
      present.delete(f.owner);
      log.push(`delete:${f.owner}`);
    },
    async finalAbsence() {
      expect(present.size).toBe(0);
    },
  };
  expect(await runNativeDeclarativeWorkflow(fixtures, driver)).toMatchObject({
    failure: false,
    finalAbsenceConfirmed: true,
    remaining: [],
  });
  expect(log).toEqual([
    ...fixtures.flatMap((f) => ['create', 'activate', 'update', 'activate'].map((p) => `${p}:${f.owner}`)),
    ...[...fixtures].reverse().map((f) => `delete:${f.owner}`),
  ]);
  expect(declarativePreservationClosure(fixtures, [behavior.owner])).toEqual(
    new Set([behavior.owner, fixtures[1].owner]),
  );
  expect(declarativePreservationClosure(fixtures, [fixtures[5].owner])).toEqual(
    new Set([fixtures[5].owner, fixtures[0].owner]),
  );
});

it('records only the exact expected default class and never grants any mutation to that reference', () => {
  const [reference] = declarativeV5References(fixtures);
  expect(reference).toEqual({
    owner: '/sap/bc/adt/oo/classes/zbp_arc1_v5a_0123456789abcdef',
    referencedBy: behavior.owner,
  });
  expect(Object.isFrozen(reference)).toBe(true);
  for (const method of ['DELETE', 'POST', 'PUT'])
    expect(() => checkDeclarativeRequest(behavior, method, reference.owner, '')).toThrow();
  expect(() => declarativeV5References(fixtures.slice(0, 5))).toThrow();
  expect(() => declarativeV5References(fixtures.map((f) => ({ ...f, source: `${f.source}// extra` })))).toThrow();
  expect(() => declarativeV5References(declarativeV4Fixtures(suffix))).toThrow();
});
