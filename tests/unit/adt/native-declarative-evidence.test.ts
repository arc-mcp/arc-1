import { createHash } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import {
  declarativeInventoryClean,
  declarativeOwnerAbsent,
  declarativeSnapshot,
} from '../../../scripts/qualification/pr1142/native-declarative-evidence.js';
import { declarativeFixtures } from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import { AdtApiError, AdtNetworkError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { pinnedDeclarativeSelection } from '../../../src/adt/pinned-repository-owner.js';

const fixtures = declarativeFixtures('0123456789ABCDEF');
const fixture = fixtures.find((row) => row.type === 'BDEF')!;
const selected = pinnedDeclarativeSelection(fixture.type, fixture.name);
const core = 'http://www.sap.com/adt/core';
const atom = 'http://www.w3.org/2005/Atom';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const typed = (id: string) =>
  `<exc:exception xmlns:exc="urn:x"><type id="${id}"/><message>native text</message></exc:exception>`;
const SECRET = 'SECRET-EXCEPTION-TEXT';

function metadata(attributes: { [name: string]: string } = {}, inner = '') {
  const values = {
    name: fixture.name,
    type: selected.native,
    description: fixture.description,
    version: 'inactive',
    createdBy: 'MARIAN',
    changedBy: 'MARIAN',
    ...attributes,
  };
  const rendered = Object.entries(values)
    .map(([name, value]) => `c:${name}="${value}"`)
    .join(' ');
  return `<x:${selected.root} xmlns:x="${selected.namespace}" xmlns:c="${core}" ${rendered}><c:packageRef c:name="${attributes.package ?? '$TMP'}" c:type="DEVC/K"/>${inner}</x:${selected.root}>`;
}
const stateLink = (href: string) =>
  `<a:link xmlns:a="${atom}" rel="http://www.sap.com/adt/relations/objectstates" href="${href}"/>`;

type Answer = { statusCode?: number; body?: string; media?: string } | Error;
let answers: { [path: string]: Answer };
let rows: any[];
const reader = {
  get: async (path: string) => {
    const answer = answers[path];
    if (answer === undefined) throw new Error(`Unexpected read ${path}`);
    if (answer instanceof Error) throw answer;
    return {
      statusCode: answer.statusCode ?? 200,
      headers: answer.media === undefined ? {} : { 'Content-Type': answer.media },
      body: answer.body ?? '',
    };
  },
} as unknown as Pick<AdtHttpClient, 'get'>;
const options = { deadline: Date.now() + 60_000 };
const sourcePath = (version: string) => `${fixture.owner}/source/main?version=${version}`;
const snapshot = (active = false) =>
  declarativeSnapshot(reader, fixture, fixture.source, active, (row) => rows.push(row), options);
beforeEach(() => {
  rows = [];
  answers = {
    [fixture.owner]: { body: metadata(), media: 'application/xml' },
    [sourcePath('inactive')]: { body: fixture.source, media: 'text/plain; charset=utf-8' },
  };
});

it('records the complete native answer before accepting a snapshot, without retaining bodies twice', async () => {
  const receipt = await snapshot();
  const body = metadata();
  expect(rows[0]).toEqual({
    read: fixture.owner,
    status: 200,
    media: 'application/xml',
    bytes: Buffer.byteLength(body),
    sha256: sha(body),
    body,
  });
  expect(rows.find((row) => row.read === sourcePath('inactive'))).toEqual({
    read: sourcePath('inactive'),
    status: 200,
    media: 'text/plain',
    bytes: Buffer.byteLength(fixture.source),
    sha256: sha(fixture.source),
    body: fixture.source,
  });
  expect(rows.at(-1)).toEqual({ snapshot: fixture.owner, receipt });
  expect(rows.filter((row) => row.body !== undefined)).toHaveLength(2);
});

it.each([
  ['metadata-status', { statusCode: 202, body: metadata() }],
  ['metadata-identity', { body: '<other/>' }],
  ['metadata-identity', { body: metadata({ name: 'ZFOREIGN' }) }],
  ['metadata-package', { body: metadata({ package: 'ZOTHER' }) }],
  ['metadata-marker', { body: metadata({ description: 'foreign' }) }],
  ['metadata-version', { body: metadata({ version: 'partly' }) }],
  ['metadata-author', { body: metadata({ changedBy: 'OTHER' }) }],
  // The review's concrete scenario: sources on these types use relative state links.
  ['metadata-state-link', { body: metadata({}, stateLink(`./${fixture.name}/source/main`)) }],
] as const)('refuses with %s and retains the exact refused body', async (reason, answer) => {
  answers[fixture.owner] = answer;
  await expect(snapshot()).rejects.toMatchObject({ reason });
  expect(rows[0].read).toBe(fixture.owner);
  expect(rows[0].body).toBe(answer.body);
  expect(rows[0].sha256).toBe(sha(answer.body));
  expect(rows.some((row) => row.metadata || row.snapshot)).toBe(false);
});
it.each([
  ['source-status', { statusCode: 202, body: fixture.source, media: 'text/plain' }],
  ['source-media', { body: fixture.source, media: 'text/html' }],
  ['source-media', { body: fixture.source }],
  ['source-content', { body: '// foreign source', media: 'text/plain' }],
] as const)('refuses the source with %s after recording it', async (reason, answer) => {
  answers[sourcePath('inactive')] = answer;
  await expect(snapshot()).rejects.toMatchObject({ reason });
  const row = rows.find((candidate) => candidate.read === sourcePath('inactive'));
  expect(row.body).toBe(answer.body);
  expect(row.media).toBe((answer as { media?: string }).media);
  expect(rows.some((candidate) => candidate.snapshot)).toBe(false);
});
it('refuses an active snapshot when the explicit active read falls back to an inactive version', async () => {
  answers[fixture.owner] = { body: metadata({ version: 'active' }) };
  answers[`${fixture.owner}?version=active`] = { body: metadata({ version: 'inactive' }) };
  await expect(snapshot(true)).rejects.toMatchObject({ reason: 'metadata-not-active' });
  expect(rows.at(-1).body).toBe(metadata({ version: 'inactive' }));
});
it('refuses an active snapshot that still advertises an inactive alternative', async () => {
  answers[fixture.owner] = {
    body: metadata({ version: 'active' }, stateLink(`${fixture.owner}/source/main?version=inactive`)),
  };
  await expect(snapshot(true)).rejects.toMatchObject({ reason: 'metadata-state-link' });
});
it('accepts both exact absolute state links on an inactive draft', async () => {
  answers[fixture.owner] = { body: metadata({}, stateLink(`${fixture.owner}/source/main?version=active`)) };
  await expect(snapshot()).resolves.toMatchObject({ activeVerified: false });
});

it('retains a typed read failure with status, size and hash, never its exception text', async () => {
  const body = typed('ExceptionNotAuthorized');
  answers[fixture.owner] = new AdtApiError(SECRET, 403, fixture.owner, body);
  await expect(snapshot()).rejects.toMatchObject({ reason: 'metadata-read-failed', evidence: { status: 403 } });
  expect(rows).toEqual([
    {
      read: fixture.owner,
      failure: 'http-error',
      status: 403,
      bytes: Buffer.byteLength(body),
      sha256: sha(body),
      exceptionType: 'ExceptionNotAuthorized',
      body,
    },
  ]);
  expect(JSON.stringify(rows)).not.toContain(SECRET);
});
it('keeps only the hash of an untyped error body', async () => {
  const body = `<html>${SECRET}</html>`;
  answers[sourcePath('inactive')] = new AdtApiError('x', 500, sourcePath('inactive'), body);
  await expect(snapshot()).rejects.toMatchObject({ reason: 'source-read-failed', evidence: { status: 500 } });
  expect(rows.at(-1)).toEqual({
    read: sourcePath('inactive'),
    failure: 'http-error',
    status: 500,
    bytes: Buffer.byteLength(body),
    sha256: sha(body),
  });
  expect(JSON.stringify(rows)).not.toContain(SECRET);
});
it.each([
  ['network', new AdtNetworkError(SECRET)],
  ['response-limit', new AdtResponseLimitError(10, 20, SECRET)],
  ['unclassified', new Error(SECRET)],
])('reduces a %s failure to a fixed row', async (failure, error) => {
  answers[fixture.owner] = error;
  await expect(snapshot()).rejects.toMatchObject({ reason: 'metadata-read-failed', evidence: {} });
  expect(rows).toEqual([{ read: fixture.owner, failure }]);
});
it('bounds a retained body but keeps its size and hash, even when the parser then refuses it', async () => {
  const body = metadata().padEnd(1024 * 1024 + 1, ' ');
  answers[fixture.owner] = { body };
  await expect(snapshot()).rejects.toMatchObject({ reason: 'metadata-identity' });
  expect(rows[0]).toEqual({
    read: fixture.owner,
    status: 200,
    media: undefined,
    bytes: Buffer.byteLength(body),
    sha256: sha(body),
    bodyOmitted: 'size-limit',
  });
});

const notFound = typed('ExceptionResourceNotFound');
const absent = (target = fixture) => declarativeOwnerAbsent(reader, target, (row) => rows.push(row), options);
it('accepts only a typed 404 as absence and keeps its body', async () => {
  answers[fixture.owner] = new AdtApiError('gone', 404, fixture.owner, notFound);
  await expect(absent()).resolves.toBeUndefined();
  expect(rows[0]).toMatchObject({ status: 404, exceptionType: 'ExceptionResourceNotFound', body: notFound });
  expect(rows[1]).toEqual({ absence: fixture.owner, typed404: true });
});
it.each([
  ['absence-not-typed', 404, 404, '<html>not here</html>', false],
  ['absence-not-typed', 404, 404, typed('ExceptionOther'), true],
  ['absence-not-typed', 500, 500, notFound, true],
] as const)('refuses %s for HTTP %i without inferring absence', async (reason, code, status, body, retained) => {
  answers[fixture.owner] = new AdtApiError('x', code, fixture.owner, body);
  await expect(absent()).rejects.toMatchObject({ reason, evidence: { status } });
  expect(rows.some((row) => row.typed404)).toBe(false);
  expect(rows[0].sha256).toBe(sha(body));
  expect(rows[0].body).toBe(retained ? body : undefined);
});
it('refuses absence when the owner is present and retains what SAP returned', async () => {
  answers[fixture.owner] = { body: metadata() };
  await expect(absent()).rejects.toMatchObject({ reason: 'absence-owner-present' });
  expect(rows[0].body).toBe(metadata());
});
it('refuses absence after a transport failure', async () => {
  answers[fixture.owner] = new AdtNetworkError(SECRET);
  await expect(absent()).rejects.toMatchObject({ reason: 'absence-read-failed' });
  expect(JSON.stringify(rows)).not.toContain(SECRET);
});

const inventoryPath = '/sap/bc/adt/activation/inactiveobjects';
const inventory = (body: string) =>
  `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects">${body}</i:inactiveObjects>`;
const clean = () => declarativeInventoryClean(reader, fixtures, (row) => rows.push(row), options);
const OTHER_DRAFT = 'ZOTHER_USERS_DRAFT';
it('keeps the inventory hash-only when valid', async () => {
  const body = inventory(OTHER_DRAFT);
  answers[inventoryPath] = { body, media: 'application/xml' };
  await expect(clean()).resolves.toBeUndefined();
  expect(rows).toEqual([
    { read: inventoryPath, status: 200, media: 'application/xml', bytes: Buffer.byteLength(body), sha256: sha(body) },
    { inactiveInventory: { bytes: Buffer.byteLength(body), sha256: sha(body), containsFixture: false } },
  ]);
});
it.each([
  ['inventory-status', { statusCode: 202, body: inventory(OTHER_DRAFT), media: 'application/xml' }],
  ['inventory-media', { body: inventory(OTHER_DRAFT), media: 'text/html' }],
  ['inventory-contains-fixture', { body: inventory(`${OTHER_DRAFT}${fixture.name}`), media: 'application/xml' }],
  ['inventory-malformed', { body: `<other>${OTHER_DRAFT}</other>`, media: 'application/xml' }],
] as const)('stays hash-only when refusing with %s', async (reason, answer) => {
  answers[inventoryPath] = answer;
  await expect(clean()).rejects.toMatchObject({ reason });
  expect(JSON.stringify(rows)).not.toContain(OTHER_DRAFT);
  expect(rows[0].sha256).toBe(sha(answer.body));
});
it('stays hash-only for a typed inventory error', async () => {
  const body = typed('ExceptionNotAuthorized');
  answers[inventoryPath] = new AdtApiError('x', 403, inventoryPath, body);
  await expect(clean()).rejects.toMatchObject({ reason: 'inventory-read-failed', evidence: { status: 403 } });
  expect(rows).toEqual([
    { read: inventoryPath, failure: 'http-error', status: 403, bytes: Buffer.byteLength(body), sha256: sha(body) },
  ]);
});
