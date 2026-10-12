import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextElementObjectType, TextElementPart } from '../../../src/adt/text-elements.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const LOCK =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H9</LOCK_HANDLE></DATA></asx:values></asx:abap>';
const metadata = (type = 'CLAS/OCX', state = 'active', name = 'ZTEST') =>
  `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${type}" adtcore:version="${state}"/>`;
const calls = () => mockFetch.mock.calls as [string, RequestInit][];
const changed = () => calls().filter(([url, init]) => init?.method === 'PUT' || String(url).includes('/activation?'));

describe('text-pool writes report observed native state', () => {
  beforeEach(() => vi.resetAllMocks());

  function sap(body: string, before = '', metadataStatus = 200) {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        mockResponse(
          String(url).includes('?version=inactive') ? metadataStatus : 200,
          String(url).includes('_action=LOCK')
            ? LOCK
            : String(url).includes('?version=inactive')
              ? body
              : String(url).includes('/source/')
                ? before
                : '',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
  }
  const write = (type: TextElementObjectType, source: string, textPart: TextElementPart = 'symbols') =>
    handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type,
      name: 'ZTEST',
      source,
      textPart,
    });

  it.each([
    ['CLAS', 'CLAS/OCX'],
    ['FUGR', 'FUGR/PX'],
  ] as const)('skips a proven active, already-empty %s pool under its lock', async (type, nativeType) => {
    sap(metadata(nativeType));
    const result = await write(type, '');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('No changes: symbols');
    expect(changed()).toEqual([]);
    const urls = calls().map(([url]) => String(url));
    const lock = urls.findIndex((url) => url.includes('_action=LOCK'));
    const state = urls.findIndex((url) => url.includes('?version=inactive'));
    const unlock = urls.findIndex((url) => url.includes('_action=UNLOCK'));
    expect(state).toBeGreaterThan(lock);
    expect(unlock).toBeGreaterThan(state);
  });

  it.each(['CLAS', 'FUGR'] as const)('never treats an empty inactive %s draft as a no-op', async (type) => {
    sap(metadata(type === 'CLAS' ? 'CLAS/OCX' : 'FUGR/PX', 'inactive'));
    const result = await write(type, '');
    expect(result.isError).toBe(true);
    expect(changed()).toHaveLength(2);
    expect(result.content[0]?.text).toContain('SAP still reports the text pool inactive');
    expect(result.content[0]?.text).not.toMatch(/No changes|Updated and activated/);
    expect(calls().some(([url]) => String(url).includes('/inactiveobjects'))).toBe(false);
  });

  it.each([
    ['PROG', 'symbols', '', ''],
    ['FUGR', 'headings', '', ''],
    ['CLAS', 'symbols', '\n', ''],
    ['CLAS', 'symbols', '', '@MaxLength:20\n001=Old'],
  ] as const)('keeps ordinary writes for %s %s input %j and body %j', async (type, part, source, before) => {
    sap(metadata(type === 'CLAS' ? 'CLAS/OCX' : `${type}/PX`), before);
    const result = await write(type, source, part);
    expect(result.isError).toBeUndefined();
    expect(changed()).toHaveLength(2);
  });

  it.each(['active', 'inactive'] as const)(
    'checks %s state after activation and keeps removal details',
    async (state) => {
      let saved = false;
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') saved = true;
        return Promise.resolve(
          mockResponse(
            200,
            String(url).includes('_action=LOCK')
              ? LOCK
              : String(url).includes('?version=inactive')
                ? metadata('CLAS/OCX', state)
                : String(url).includes('/source/')
                  ? `@MaxLength:20\n001=Keep${saved ? '' : '\n\n@MaxLength:20\n002=Old'}`
                  : '',
            { 'x-csrf-token': 'T' },
          ),
        );
      });
      const result = await write('CLAS', '@MaxLength:20\n001=Keep');
      expect(result.isError).toBe(state === 'inactive' ? true : undefined);
      expect(result.content[0]?.text).toContain(
        state === 'active' ? 'SAP reports the text pool active' : 'SAP still reports the text pool inactive',
      );
      expect(result.content[0]?.text).toContain('Removed texts: 002');
      const urls = calls().map(([url]) => String(url));
      expect(urls.findIndex((url) => url.includes('?version=inactive'))).toBeGreaterThan(
        urls.findIndex((url) => url.includes('/activation?')),
      );
    },
  );

  it.each([
    '',
    metadata('CLAS/PX'),
    metadata('CLAS/OCX', 'unknown'),
    metadata('CLAS/OCX', 'active', 'OTHER'),
    metadata() + metadata(),
  ])('refuses an empty save on unverified metadata %s and releases the lock', async (body) => {
    sap(body);
    const result = await write('CLAS', '');
    expect(result.isError).toBe(true);
    expect(changed()).toEqual([]);
    expect(calls().some(([url]) => String(url).includes('_action=UNLOCK'))).toBe(true);
  });

  it.each([
    ['CLAS', 200],
    ['CLAS', 404],
    ['CLAS', 500],
    ['FUGR', 500],
    ['PROG', 500],
  ] as const)(
    'returns an error while preserving the known %s save when final state is unverified (%i)',
    async (type, status) => {
      sap('', '', status);
      const result = await write(type, '@MaxLength:20\n001=Text');
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Check the pool in ADT or involve the user');
      expect(result.content[0]?.text).toContain('Updated symbols');
      expect(result.content[0]?.text).toContain('final text-pool state could not be verified');
      expect(result.content[0]?.text).not.toContain('Updated and activated');
      expect(changed()).toHaveLength(2);
    },
  );
});
