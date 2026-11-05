import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { declarativeSnapshot } from '../../../scripts/qualification/pr1142/native-declarative-evidence.js';
import type { DeclarativeFixture } from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import {
  pinnedDeclarativeSelection,
  pinnedDeclarativeStateLinkVersion,
} from '../../../src/adt/pinned-repository-owner.js';

const native = JSON.parse(
  readFileSync(new URL('../../fixtures/declarative-owners/failed-v3-ddls-20261102.json', import.meta.url), 'utf8'),
) as { fixture: DeclarativeFixture; metadata: string };
it('accepts the actual inactive v3 DDLS metadata and exact updated bytes without following its owned relative state link', async () => {
  const get = vi.fn(async (path: string) => ({
    statusCode: 200,
    headers: { 'content-type': path.endsWith('?version=inactive') ? 'text/plain' : 'application/xml' },
    body: path.endsWith('?version=inactive') ? native.fixture.updatedSource : native.metadata,
  }));
  await expect(
    declarativeSnapshot({ get } as never, native.fixture, native.fixture.updatedSource, false, () => {}, {
      deadline: Date.now() + 10000,
    }),
  ).resolves.toMatchObject({
    activeVerified: false,
    sourceHash: '06b0b8832019beef3310cf3b4e3d05d908a191c7aac67be5eb892f32fa4b2d5f',
  });
  expect(get.mock.calls.map(([path]) => path)).toEqual([
    native.fixture.owner,
    `${native.fixture.owner}/source/main?version=inactive`,
  ]);
});

const owner = native.fixture.owner;
const relative = `./${owner.slice(owner.lastIndexOf('/') + 1)}`;
it.each(['active', 'inactive'] as const)('recognizes only the owned %s state spellings', (version) => {
  expect(pinnedDeclarativeStateLinkVersion('DDLS', owner, `${relative}?version=${version}`)).toBe(version);
  expect(pinnedDeclarativeStateLinkVersion('DDLS', owner, `${owner}/source/main?version=${version}`)).toBe(version);
});
const families = ['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD'] as const;
it.each(families)('recognizes exact owned relative alternatives for %s (synthetic lexical identity)', (type) => {
  for (const name of ['ZARC1_OWNED', '/ABC/ZARC1_OWNED']) {
    const selected = pinnedDeclarativeSelection(type, name);
    for (const version of ['active', 'inactive'] as const) {
      const href = `./${selected.objectUrl.split('/').at(-1)}?version=${version}`;
      expect(pinnedDeclarativeStateLinkVersion(type, selected.objectUrl, href)).toBe(version);
    }
  }
});
it.each([
  undefined,
  '',
  `${relative}?version=active#x`,
  `${relative}?version=active&x=1`,
  `${relative}?version=active&version=active`,
  `${relative}?version=Active`,
  `${relative}?version=%61ctive`,
  `${relative}?version=active\n`,
  `${relative}?version=active\r`,
  `${relative}?version=active\u2028`,
  ` ${relative}?version=active`,
  `${relative}/?version=active`,
  `${relative}/source/main?version=active`,
  `../${relative.slice(2)}?version=active`,
  `${relative.slice(2)}?version=active`,
  `././${relative.slice(2)}?version=active`,
  './foreign?version=active',
  `${relative.toUpperCase()}?version=active`,
  './%7aarc1_v2v_f4c656905a65aa61?version=active',
  `${owner}?version=active`,
  `${owner}/source/main?version=inactive&x=1`,
  `https://a4h.marianzeis.de${owner}?version=active`,
  `//evil.example${owner}?version=active`,
  `.\\${relative.slice(2)}?version=active`,
  `${relative}?version=inactive%00`,
])('refuses unqualified, foreign or normalized href %j', (href) => {
  for (const type of families) {
    const selected = pinnedDeclarativeSelection(type, native.fixture.name);
    const candidate = href?.replaceAll(owner, selected.objectUrl);
    expect(pinnedDeclarativeStateLinkVersion(type, selected.objectUrl, candidate)).toBeUndefined();
  }
});
it('continues to refuse an active snapshot that advertises its exact relative inactive counterpart', async () => {
  const get = vi.fn(async () => ({
    statusCode: 200,
    headers: { 'content-type': 'application/xml' },
    body: (native as unknown as { activeMetadata: string }).activeMetadata,
  }));
  await expect(
    declarativeSnapshot({ get } as never, native.fixture, native.fixture.source, true, () => {}, {
      deadline: Date.now() + 10000,
    }),
  ).rejects.toMatchObject({ reason: 'metadata-state-link' });
  expect(get).toHaveBeenCalledTimes(1);
});

it('refuses duplicate relative alternatives before reading a source', async () => {
  const atom = `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${relative}?version=active" rel="http://www.sap.com/adt/relations/objectstates"/>`;
  const body = native.metadata.replace('</ddl:ddlSource>', `${atom}</ddl:ddlSource>`);
  const get = vi.fn(async () => ({ statusCode: 200, headers: { 'content-type': 'application/xml' }, body }));
  await expect(
    declarativeSnapshot({ get } as never, native.fixture, native.fixture.updatedSource, false, () => {}, {
      deadline: Date.now() + 10000,
    }),
  ).rejects.toMatchObject({ reason: 'metadata-state-link' });
  expect(get).toHaveBeenCalledTimes(1);
});
