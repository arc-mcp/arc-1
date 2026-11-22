/**
 * Failed TABL activation → DDIC check of the inactive draft on the resolved URL, plus TABL in the
 * opt-in pre-write check. Shapes follow live SAP_BASIS 7.54 responses (2026-11-21): activation names
 * only "Nametab … cannot be generated", while the draft check names the field with line and column.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { tablActivationDiagnostic, TABL_CHECK_BEFORE_WRITE_HINT } = await import(
  '../../../src/handlers/tabl-activation-diagnostics.js'
);

const STRUCT = 'ZSJ_IT_TABL_S2';
const TABLE = 'ZSJ_IT_TABL_T2';
const structUrl = `/sap/bc/adt/ddic/structures/${STRUCT}`;
const tableUrl = `/sap/bc/adt/ddic/tables/${TABLE}`;

function searchXml(name: string, type: 'TABL/DS' | 'TABL/DT'): string {
  const base = type === 'TABL/DS' ? 'structures' : 'tables';
  return `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/${base}/${name.toLowerCase()}" adtcore:type="${type}" adtcore:name="${name}"/></adtcore:objectReferences>`;
}

function activationFailureXml(name: string, url: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg objDescr="${name}" type="E" line="1" shortText="Nametab for table ${name} cannot be generated" uri="${url.toLowerCase()}"/><msg objDescr="${name}" type="E" line="2" shortText="TABL ${name} was not activated" uri="${url.toLowerCase()}"/></chkl:messages>`;
}

function checkReportXml(url: string, extra = ''): string {
  const src = `${url.toLowerCase()}/source/main`;
  return `<?xml version="1.0" encoding="utf-8"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${url.toLowerCase()}" chkrun:status="processed"><chkrun:checkMessageList><chkrun:checkMessage chkrun:uri="${src}#start=5,14;end=5,41" chkrun:type="E" chkrun:shortText="Field BAD_FIELD: Component type or domain used not active or does not exist"/><chkrun:checkMessage chkrun:uri="${src}#start=3,17" chkrun:type="E" chkrun:shortText="Could not determine structure width"/>${extra}</chkrun:checkMessageList></chkrun:checkReport></chkrun:checkRunReports>`;
}

const LOCK_XML =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';

interface RouterOptions {
  searchType?: Record<string, 'TABL/DS' | 'TABL/DT'>;
  activation?: (body: string, search: URLSearchParams) => string;
  check?: (body: string) => ReturnType<typeof mockResponse>;
}

function route({ searchType = {}, activation, check }: RouterOptions): void {
  mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const body = typeof init?.body === 'string' ? init.body : '';
    if (parsed.pathname.endsWith('/repository/informationsystem/search')) {
      const query = parsed.searchParams.get('query') ?? '';
      const type = searchType[query.toUpperCase()];
      return Promise.resolve(
        mockResponse(
          200,
          type
            ? searchXml(query, type)
            : '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>',
          { 'x-csrf-token': 'T' },
        ),
      );
    }
    if (parsed.pathname === '/sap/bc/adt/activation' && activation) {
      return Promise.resolve(mockResponse(200, activation(body, parsed.searchParams), { 'x-csrf-token': 'T' }));
    }
    if (parsed.pathname === '/sap/bc/adt/checkruns' && check) return Promise.resolve(check(body));
    if (parsed.searchParams.get('_action') === 'LOCK')
      return Promise.resolve(mockResponse(200, LOCK_XML, { 'x-csrf-token': 'T' }));
    return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
  });
}

function checkCalls(): string[] {
  return mockFetch.mock.calls
    .filter((call) => new URL(String(call[0])).pathname === '/sap/bc/adt/checkruns')
    .map((call) => String((call[1] as RequestInit | undefined)?.body ?? ''));
}

describe('TABL activation diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
  });

  describe('SAPActivate single object', () => {
    it('checks a structure draft at /ddic/structures/ even when activation returned errors', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain(`Nametab for table ${STRUCT} cannot be generated`);
      expect(text).toContain('DDIC check of the inactive draft:');
      expect(text).toContain(
        '[line 5, column 14] Field BAD_FIELD: Component type or domain used not active or does not exist',
      );
      expect(text).toContain(TABL_CHECK_BEFORE_WRITE_HINT);
      const [checkBody] = checkCalls();
      expect(checkBody).toContain(`adtcore:uri="${structUrl}"`);
      expect(checkBody).toContain('chkrun:version="inactive"');
      expect(checkBody).not.toContain('/ddic/tables/');
    });

    it('checks a transparent table draft at /ddic/tables/', async () => {
      route({
        searchType: { [TABLE]: 'TABL/DT' },
        activation: () => activationFailureXml(TABLE, tableUrl),
        check: () => mockResponse(200, checkReportXml(tableUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', { type: 'TABL', name: TABLE });
      expect(result.content[0]?.text).toContain('[line 5, column 14] Field BAD_FIELD');
      const [checkBody] = checkCalls();
      expect(checkBody).toContain(`adtcore:uri="${tableUrl}"`);
      expect(checkBody).not.toContain('/ddic/structures/');
    });

    it('drops check messages the activation already reported', async () => {
      const duplicate = `<chkrun:checkMessage chkrun:uri="${structUrl.toLowerCase()}/source/main#start=1,1" chkrun:type="E" chkrun:shortText="Nametab  for table ${STRUCT} cannot be generated"/>`;
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, checkReportXml(structUrl, duplicate), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      const text = result.content[0]?.text ?? '';
      expect(text.match(/Nametab\s+for table/g)).toHaveLength(1);
      expect(text).toContain('Field BAD_FIELD');
    });

    it('keeps the activation error and adds a short note when the check fails', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(500, 'Error while importing object', { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain(`Activation failed for TABL ${STRUCT}.`);
      expect(text).toContain(`TABL ${STRUCT} was not activated`);
      expect(text).toContain('Note: the DDIC check of the inactive draft could not run');
    });

    it('treats an unprocessed check report as unavailable, not clean', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () =>
          mockResponse(
            200,
            `<?xml version="1.0"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${structUrl}" chkrun:status="notProcessed" chkrun:statusText="Error while importing object"/></chkrun:checkRunReports>`,
            { 'x-csrf-token': 'T' },
          ),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      expect(result.content[0]?.text).toContain('Note: the DDIC check of the inactive draft could not run');
    });

    it('does not run the TABL check after a successful activation', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () =>
          '<?xml version="1.0"?><iac:inactiveCTSObjects xmlns:iac="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      expect(result.isError).toBeUndefined();
      expect(checkCalls()).toHaveLength(0);
    });
  });

  it('SAPActivate objects[] checks a failed structure at its resolved URL', async () => {
    route({
      searchType: { [STRUCT]: 'TABL/DS' },
      activation: () => activationFailureXml(STRUCT, structUrl),
      check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
      objects: [{ type: 'TABL', name: STRUCT }],
    });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(text).toContain(`[${STRUCT}]\nDDIC check of the inactive draft:`);
    expect(text).toContain('[line 5, column 14] Field BAD_FIELD');
    expect(text).toContain(TABL_CHECK_BEFORE_WRITE_HINT);
    expect(checkCalls()[0]).toContain(`adtcore:uri="${structUrl}"`);
  });

  describe('SAPWrite batch_create activation', () => {
    const source = `@EndUserText.label : 'Test'\n@AbapCatalog.enhancementCategory : #NOT_EXTENSIBLE\ndefine structure zsj_it_tabl_s2 {\n  bad_field : zsj_missing;\n}`;
    const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };

    it('appends the draft check to a failed inline TABL/DS activation', async () => {
      route({
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'TABL/DS', name: STRUCT, source }],
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('activation failed: Nametab for table');
      // Batch summaries join entries with commas, so the diagnostic stays on the entry's line.
      expect(text).toMatch(
        /was not activated — DDIC check of the inactive draft: \[line 5, column 14\] Field BAD_FIELD[^\n]*; \[line 3, column 17\]/,
      );
      expect(text).toContain(TABL_CHECK_BEFORE_WRITE_HINT);
      expect(checkCalls()[0]).toContain(`adtcore:uri="${structUrl}"`);
    });

    it('appends the draft check to a TABL that fails a terminal activateAtEnd batch', async () => {
      route({
        activation: () => activationFailureXml(TABLE, tableUrl),
        check: () => mockResponse(200, checkReportXml(tableUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        activateAtEnd: true,
        objects: [
          { type: 'TABL', name: TABLE, source: source.replace('structure zsj_it_tabl_s2', 'table zsj_it_tabl_t2') },
          { type: 'PROG', name: 'ZSJ_IT_PROG', source: 'REPORT zsj_it_prog.' },
        ],
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('[line 5, column 14] Field BAD_FIELD');
      expect(checkCalls()).toHaveLength(1);
      expect(checkCalls()[0]).toContain(`adtcore:uri="${tableUrl}"`);
    });

    it('skips the draft check under ARC1_MINIMAL_ERRORS', async () => {
      route({
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), { ...config, minimalErrors: true }, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'TABL/DS', name: STRUCT, source }],
      });
      expect(result.content[0]?.text).not.toContain('BAD_FIELD');
      expect(checkCalls()).toHaveLength(0);
    });
  });

  describe('ARC1_MINIMAL_ERRORS in SAPActivate', () => {
    const minimal = { ...DEFAULT_CONFIG, minimalErrors: true };

    it('skips the TABL draft check for a single object but still reports the failure', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), minimal, 'SAPActivate', { type: 'TABL', name: STRUCT });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain(`Activation failed for TABL ${STRUCT}.`);
      expect(text).not.toContain('BAD_FIELD');
      expect(text).not.toContain('DDIC check of the inactive draft');
      expect(checkCalls()).toHaveLength(0);
    });

    it('skips the TABL draft check for objects[] but still reports the failure', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), minimal, 'SAPActivate', {
        objects: [{ type: 'TABL', name: STRUCT }],
      });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain(`Batch activation failed for: ${STRUCT}.`);
      expect(text).not.toContain('BAD_FIELD');
      expect(checkCalls()).toHaveLength(0);
    });
  });

  describe('per-object de-duplication', () => {
    const OTHER = 'ZSJ_IT_TABL_S9';
    const otherUrl = `/sap/bc/adt/ddic/structures/${OTHER}`;
    const fieldError = 'Field BAD_FIELD: Component type or domain used not active or does not exist';
    // SAP attributes the field error to the first structure only; the second fails with a bare Nametab.
    const batchFailure = () =>
      `<?xml version="1.0" encoding="UTF-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg objDescr="${STRUCT}" type="E" shortText="${fieldError}" uri="${structUrl.toLowerCase()}"/><msg objDescr="${OTHER}" type="E" shortText="Nametab for table ${OTHER} cannot be generated" uri="${otherUrl.toLowerCase()}"/></chkl:messages>`;
    const checkByObject = (body: string) =>
      mockResponse(200, checkReportXml(body.includes(OTHER) ? otherUrl : structUrl), { 'x-csrf-token': 'T' });

    it("SAPActivate objects[] keeps an error in B's draft that only A's activation reported", async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS', [OTHER]: 'TABL/DS' },
        activation: batchFailure,
        check: checkByObject,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'TABL', name: STRUCT },
          { type: 'TABL', name: OTHER },
        ],
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain(`[${OTHER}]\nDDIC check of the inactive draft:\n- [line 5, column 14] ${fieldError}`);
      // A's own activation already named the field error, so only the new message remains for A.
      expect(text).toContain(
        `[${STRUCT}]\nDDIC check of the inactive draft:\n- [line 3, column 17] Could not determine structure width`,
      );
    });

    it("batch_create activateAtEnd keeps an error in B's draft that only A's activation reported", async () => {
      route({ activation: batchFailure, check: checkByObject });
      const source = (name: string) => `define structure ${name.toLowerCase()} {\n  bad_field : zsj_missing;\n}`;
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, lintBeforeWrite: false }, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        activateAtEnd: true,
        objects: [
          { type: 'TABL/DS', name: STRUCT, source: source(STRUCT) },
          { type: 'TABL/DS', name: OTHER, source: source(OTHER) },
        ],
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain(
        `Nametab for table ${OTHER} cannot be generated — DDIC check of the inactive draft: [line 5, column 14] ${fieldError}`,
      );
      expect(text).toContain(
        `${fieldError} — DDIC check of the inactive draft: [line 3, column 17] Could not determine structure width`,
      );
    });

    it('keeps the same text at two positions and drops exact repeats', async () => {
      const src = `${structUrl.toLowerCase()}/source/main`;
      const at = (line: number) =>
        `<chkrun:checkMessage chkrun:uri="${src}#start=${line},14" chkrun:type="E" chkrun:shortText="Field X: Component type or domain used not active or does not exist"/>`;
      route({
        check: () =>
          mockResponse(
            200,
            `<?xml version="1.0"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${structUrl}" chkrun:status="processed"><chkrun:checkMessageList>${at(6)}${at(10)}${at(6)}</chkrun:checkMessageList></chkrun:checkReport></chkrun:checkRunReports>`,
            { 'x-csrf-token': 'T' },
          ),
      });
      const text = await tablActivationDiagnostic(createClient(), structUrl, []);
      expect(text.match(/\[line 6, column 14\]/g)).toHaveLength(1);
      expect(text.match(/\[line 10, column 14\]/g)).toHaveLength(1);
    });
  });

  describe('messages that may suppress a diagnostic', () => {
    const OTHER = 'ZSJ_IT_TABL_S9';
    const otherUrl = `/sap/bc/adt/ddic/structures/${OTHER}`;
    const fieldError = 'Field BAD_FIELD: Component type or domain used not active or does not exist';
    const ref = (name: string, url: string) =>
      `<ioc:entry><ioc:object ioc:user="" ioc:deleted="false"><ioc:ref adtcore:uri="${url.toLowerCase()}" adtcore:type="TABL/DS" adtcore:name="${name}" xmlns:adtcore="http://www.sap.com/adt/core"/></ioc:object><ioc:transport/></ioc:entry>`;
    // SAP pulls B into A's activation; the confirmation reports the field error for B only.
    const preauditActivation = (_body: string, search: URLSearchParams) =>
      search.get('preauditRequested') === 'true'
        ? `<?xml version="1.0" encoding="utf-8"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">${ref(STRUCT, structUrl)}${ref(OTHER, otherUrl)}</ioc:inactiveObjects>`
        : `<?xml version="1.0" encoding="UTF-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg objDescr="${STRUCT}" type="E" shortText="Nametab for table ${STRUCT} cannot be generated" uri="${structUrl.toLowerCase()}"/><msg objDescr="${OTHER}" type="E" shortText="${fieldError}" uri="${otherUrl.toLowerCase()}"/></chkl:messages>`;
    const checkA = () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' });
    const preauditConfirmations = () =>
      mockFetch.mock.calls.filter((call) => String(call[0]).includes('preauditRequested=false'));

    it("SAPActivate keeps A's draft position when preaudit adds B's same error", async () => {
      route({ searchType: { [STRUCT]: 'TABL/DS' }, activation: preauditActivation, check: checkA });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      const text = result.content[0]?.text ?? '';
      expect(preauditConfirmations()).toHaveLength(1);
      expect(text).toContain(`${fieldError} (${otherUrl.toLowerCase()})`);
      expect(text).toContain(`DDIC check of the inactive draft:\n- [line 5, column 14] ${fieldError}`);
    });

    it("batch_create inline activation keeps A's draft position when preaudit adds B's same error", async () => {
      route({ activation: preauditActivation, check: checkA });
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, lintBeforeWrite: false }, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'TABL/DS', name: STRUCT, source: 'define structure zsj_it_tabl_s2 {\n  bad_field : zsj_x;\n}' },
        ],
      });
      const text = result.content[0]?.text ?? '';
      expect(preauditConfirmations()).toHaveLength(1);
      expect(text).toContain(
        `cannot be generated; ${fieldError} — DDIC check of the inactive draft: [line 5, column 14] ${fieldError}`,
      );
    });

    it('batch_create activateAtEnd ignores a hidden warning when de-duplicating', async () => {
      route({
        activation: () =>
          `<?xml version="1.0" encoding="UTF-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg objDescr="${STRUCT}" type="E" shortText="Nametab for table ${STRUCT} cannot be generated" uri="${structUrl.toLowerCase()}"/><msg objDescr="${STRUCT}" type="W" shortText="${fieldError}" uri="${structUrl.toLowerCase()}"/></chkl:messages>`,
        check: checkA,
      });
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, lintBeforeWrite: false }, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        activateAtEnd: true,
        objects: [
          { type: 'TABL/DS', name: STRUCT, source: 'define structure zsj_it_tabl_s2 {\n  bad_field : zsj_x;\n}' },
        ],
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain(
        `Nametab for table ${STRUCT} cannot be generated — DDIC check of the inactive draft: [line 5, column 14] ${fieldError}`,
      );
      const manifest = result.content.map((item) => item.text ?? '').join('\n');
      expect(manifest).toContain('"activation":"failed"');
    });
  });

  describe('check response evidence', () => {
    it('treats an empty 200 body as unavailable', async () => {
      route({ check: () => mockResponse(200, '', { 'x-csrf-token': 'T' }) });
      await expect(tablActivationDiagnostic(createClient(), structUrl, [])).resolves.toContain(
        'Note: the DDIC check of the inactive draft could not run',
      );
    });

    it('returns nothing new for a processed report with zero messages', async () => {
      route({
        check: () =>
          mockResponse(
            200,
            `<?xml version="1.0"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${structUrl}" chkrun:status="processed"/></chkrun:checkRunReports>`,
            { 'x-csrf-token': 'T' },
          ),
      });
      await expect(tablActivationDiagnostic(createClient(), structUrl, [])).resolves.toBe('');
    });

    it('accepts legacy <msg> messages without the modern envelope', async () => {
      route({
        check: () =>
          mockResponse(200, '<messages><msg type="E" line="7" col="3" shortText="Legacy field error"/></messages>', {
            'x-csrf-token': 'T',
          }),
      });
      await expect(tablActivationDiagnostic(createClient(), structUrl, [])).resolves.toBe(
        '\nDDIC check of the inactive draft:\n- [line 7, column 3] Legacy field error',
      );
    });

    it('SAPActivate keeps the activation error and adds the note for an empty check body', async () => {
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        activation: () => activationFailureXml(STRUCT, structUrl),
        check: () => mockResponse(200, '', { 'x-csrf-token': 'T' }),
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: STRUCT,
      });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain(`TABL ${STRUCT} was not activated`);
      expect(text).toContain('Note: the DDIC check of the inactive draft could not run');
    });
  });

  describe('SAPWrite update checkBeforeWrite for TABL', () => {
    const source = 'define structure zsj_it_tabl_s2 {\n  bad_field : zsj_missing;\n}';
    const update = (config: typeof DEFAULT_CONFIG) =>
      handleToolCall(createClient(), { ...config, lintBeforeWrite: false }, 'SAPWrite', {
        action: 'update',
        type: 'TABL',
        name: STRUCT,
        source,
        checkBeforeWrite: true,
      });
    const sourcePuts = () =>
      mockFetch.mock.calls.filter(
        (call) =>
          (call[1] as RequestInit | undefined)?.method === 'PUT' &&
          new URL(String(call[0])).pathname.toLowerCase() === `${structUrl}/source/main`.toLowerCase(),
      );
    const routeUpdate = () =>
      route({
        searchType: { [STRUCT]: 'TABL/DS' },
        check: () => mockResponse(200, checkReportXml(structUrl), { 'x-csrf-token': 'T' }),
      });

    it('checks proposed source at the resolved URL on a configured on-premise system', async () => {
      routeUpdate();
      const result = await update({ ...DEFAULT_CONFIG, systemType: 'onprem' });
      const text = result.content[0]?.text ?? '';
      expect(text).toContain(`Successfully updated TABL ${STRUCT}`);
      expect(text).toContain('Server syntax check errors');
      expect(text).toContain('Line 5:14: Field BAD_FIELD');
      const [checkBody] = checkCalls();
      expect(checkBody).toContain(`adtcore:uri="${structUrl}"`);
      expect(checkBody).toContain(`chkrun:uri="${structUrl}/source/main"`);
      expect(checkBody).toContain(Buffer.from(source, 'utf-8').toString('base64'));
      expect(sourcePuts()).toHaveLength(1);
    });

    it('checks when detection confirmed on-premise under systemType=auto', async () => {
      routeUpdate();
      setCachedFeatures({ systemType: 'onprem' });
      const result = await update({ ...DEFAULT_CONFIG, systemType: 'auto' });
      expect(result.content[0]?.text).toContain('Line 5:14: Field BAD_FIELD');
      expect(checkCalls()).toHaveLength(1);
      expect(sourcePuts()).toHaveLength(1);
    });

    it.each([
      ['BTP', { systemType: 'btp' }],
      ['inconclusive auto', { systemType: 'auto' }],
    ] as const)('skips only the check on %s and still writes', async (_label, overrides) => {
      routeUpdate();
      const result = await update({ ...DEFAULT_CONFIG, ...overrides });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBeUndefined();
      expect(text).toContain(`Successfully updated TABL ${STRUCT}`);
      expect(text).toContain('checkBeforeWrite was skipped for TABL');
      expect(text).not.toContain('BAD_FIELD');
      expect(checkCalls()).toHaveLength(0);
      expect(sourcePuts()).toHaveLength(1);
    });
  });
});
