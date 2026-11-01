import { describe, expect, it } from 'vitest';
import { formatKtdShortTexts, KTD_SHORT_TEXT_MAX_LENGTH, rewriteKtdDocument } from '../../../src/adt/ddic-xml.js';

const ROOT_ID = 'ZTR_C_PAYMENT_VALUE_DATE';
const FIELD_ID = '/sap/bc/adt/ddic/ddl/sources/ztr_c_payment_value_date/source/main#type=DDLS/DF;name=PaymentValueDate';
const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');

function envelope(fieldShortText = '', fieldObligation = 'optional', includeFieldShortText = true): string {
  const fieldShort = includeFieldShortText
    ? `<sktd:shortText sktd:obligation="${fieldObligation}" sktd:text="${b64(fieldShortText)}"/>`
    : '';
  return (
    '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
    `adtcore:name="${ROOT_ID}" adtcore:type="SKTD/TYP">` +
    '<adtcore:packageRef adtcore:name="$TMP"/>' +
    `<sktd:element><sktd:id>${ROOT_ID}</sktd:id><sktd:text>${b64('root body')}</sktd:text>` +
    '<adtcore:objectReference/><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>' +
    `<sktd:element><sktd:id>${FIELD_ID}</sktd:id><sktd:text>${b64('field body')}</sktd:text>` +
    `<adtcore:objectReference/>${fieldShort}</sktd:element></sktd:docu>`
  );
}

describe('KTD short-text XML contract', () => {
  it('updates an existing Base64 short-text attribute by exact id and preserves both long texts', () => {
    const original = envelope('Old label');
    const rewritten = rewriteKtdDocument(original, undefined, [{ node: FIELD_ID, text: 'Payment value date' }]);

    expect(rewritten).toContain(`sktd:text="${b64('Payment value date')}"`);
    expect(rewritten).not.toContain(b64('Old label'));
    expect(rewritten).toContain(`<sktd:text>${b64('root body')}</sktd:text>`);
    expect(rewritten).toContain(`<sktd:text>${b64('field body')}</sktd:text>`);
    expect(rewritten).toContain('sktd:obligation="optional"');
  });

  it('clears with an empty string and supports mandatory short texts', () => {
    const rewritten = rewriteKtdDocument(envelope('Required', 'mandatory'), undefined, [{ node: FIELD_ID, text: '' }]);
    expect(rewritten).toContain('<sktd:shortText sktd:obligation="mandatory" sktd:text=""/>');
  });

  it('splices multiple assignments by envelope position regardless of caller order', () => {
    const original = envelope('Old field').replace(
      '<sktd:shortText sktd:text="" sktd:obligation="forbidden"/>',
      '<sktd:shortText sktd:text="" sktd:obligation="optional"/>',
    );
    const rewritten = rewriteKtdDocument(original, undefined, [
      { node: FIELD_ID, text: 'New field label' },
      { node: ROOT_ID, text: 'New root label with a different encoded length' },
    ]);

    expect(rewritten).toContain(`sktd:text="${b64('New root label with a different encoded length')}"`);
    expect(rewritten).toContain(`sktd:text="${b64('New field label')}"`);
    expect(rewritten.match(/<sktd:element>/g)).toHaveLength(2);
    expect(rewritten).toContain(`<sktd:text>${b64('field body')}</sktd:text>`);
  });

  // Node names are resolved by the SAME resolver the "## " section headings use — one shorthand
  // for the whole tool, not a second one. A reference that matches nothing still fails closed.
  it('resolves the node name the index prints, and still refuses one that matches nothing', () => {
    const byName = rewriteKtdDocument(envelope(), undefined, [{ node: 'PaymentValueDate', text: 'Label' }]);
    expect(byName).toBe(rewriteKtdDocument(envelope(), undefined, [{ node: FIELD_ID, text: 'Label' }]));
    expect(() => rewriteKtdDocument(envelope(), undefined, [{ node: 'PaymentValueDates', text: 'Label' }])).toThrow(
      /does not exist[\s\S]*Known node ids/,
    );
  });

  it('refuses forbidden, missing, duplicate, and over-limit assignments before a PUT can occur', () => {
    expect(() => rewriteKtdDocument(envelope(), undefined, [{ node: ROOT_ID, text: 'Root label' }])).toThrow(
      /obligation="forbidden"[\s\S]*expected "mandatory" or "optional"/,
    );
    expect(() =>
      rewriteKtdDocument(envelope('', 'optional', false), undefined, [{ node: FIELD_ID, text: 'Label' }]),
    ).toThrow(/will not synthesize/);
    expect(() =>
      rewriteKtdDocument(envelope(), undefined, [
        { node: FIELD_ID, text: 'One' },
        { node: FIELD_ID.toUpperCase(), text: 'Two' },
      ]),
    ).toThrow(/appears twice/);
    expect(() =>
      rewriteKtdDocument(envelope(), undefined, [{ node: FIELD_ID, text: 'x'.repeat(KTD_SHORT_TEXT_MAX_LENGTH + 1) }]),
    ).toThrow(/allows 60/);
  });

  it('accepts obligation spelling case-insensitively and refuses missing or unknown obligations', () => {
    expect(rewriteKtdDocument(envelope('', 'OPTIONAL'), undefined, [{ node: FIELD_ID, text: 'Allowed' }])).toContain(
      `sktd:text="${b64('Allowed')}"`,
    );
    expect(() =>
      rewriteKtdDocument(envelope().replace(' sktd:obligation="optional"', ''), undefined, [
        { node: FIELD_ID, text: 'No contract' },
      ]),
    ).toThrow(/obligation="missing"/);
    expect(() =>
      rewriteKtdDocument(envelope('', 'recommended'), undefined, [{ node: FIELD_ID, text: 'Unknown' }]),
    ).toThrow(/obligation="recommended"/);
  });

  it('accepts 60 UTF-16 units, normalizes whitespace, and can combine body and short-text writes', () => {
    const first = '🚀'.repeat(10);
    const second = `${'🚀'.repeat(19)}x`;
    const normalized = `${first} ${second}`;
    expect(normalized.length).toBe(KTD_SHORT_TEXT_MAX_LENGTH);
    const rewritten = rewriteKtdDocument(envelope(), `## ${FIELD_ID}\n\nnew field body`, [
      { node: FIELD_ID, text: `  ${first}\n${second}  ` },
    ]);
    expect(rewritten).toContain(`<sktd:text>${b64('new field body')}</sktd:text>`);
    expect(rewritten).toContain(`sktd:text="${b64(normalized)}"`);
  });

  it('formats only populated short texts, labelled with a reference that resolves back', () => {
    const text = formatKtdShortTexts(envelope('Payment value date'));
    expect(text).toContain('Short texts (read-only');
    // The label is the node name, and that exact string is accepted as shortTexts[].node.
    expect(text).toContain('PaymentValueDate [optional]: Payment value date');
    expect(text).not.toContain(`${ROOT_ID} [forbidden]`);
    expect(formatKtdShortTexts(envelope())).toBe('');
  });

  it('refuses a bodyless and assignment-free call', () => {
    expect(() => rewriteKtdDocument(envelope(), undefined, [])).toThrow(/nothing to write/);
  });
});

describe('shortTexts node resolution', () => {
  it('accepts the node name the SAPRead index prints, not only the full id', () => {
    const base = '/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main';
    const action = `${base}#type=BDEF/BAC;name=ZBDEF.SetPhoto`;
    const envelope =
      '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
      '<sktd:element><sktd:id>ZBDEF</sktd:id><sktd:text/></sktd:element>' +
      `<sktd:element><sktd:id>${action}</sktd:id><sktd:text/>` +
      '<sktd:shortText sktd:text="" sktd:obligation="optional"/></sktd:element>' +
      '</sktd:docu>';

    const byName = rewriteKtdDocument(envelope, undefined, [{ node: 'ZBDEF.SetPhoto', text: 'Upload a photo' }]);
    const byId = rewriteKtdDocument(envelope, undefined, [{ node: action, text: 'Upload a photo' }]);

    expect(byName).toBe(byId);
    expect(byName).toContain(`sktd:text="${Buffer.from('Upload a photo', 'utf-8').toString('base64')}"`);
    // And the read-back label is the very spelling that was accepted.
    expect(formatKtdShortTexts(byName)).toContain('  ZBDEF.SetPhoto [optional]: Upload a photo');
  });

  it('refuses a name several nodes share and labels such a node by its full id', () => {
    const base = '/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main';
    const asEntity = `${base}#type=BDEF/BAE;name=ZBDEF.Booking`;
    const asAction = `${base}#type=BDEF/BAC;name=ZBDEF.Booking`;
    const enc = (t: string) => Buffer.from(t, 'utf-8').toString('base64');
    const shared =
      '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
      `<sktd:element><sktd:id>${asEntity}</sktd:id><sktd:text/><sktd:shortText sktd:text="" sktd:obligation="optional"/></sktd:element>` +
      `<sktd:element><sktd:id>${asAction}</sktd:id><sktd:text/><sktd:shortText sktd:text="${enc('Book it')}" sktd:obligation="optional"/></sktd:element>` +
      '</sktd:docu>';

    expect(() => rewriteKtdDocument(shared, undefined, [{ node: 'ZBDEF.Booking', text: 'x' }])).toThrow(
      /"ZBDEF\.Booking" is ambiguous[\s\S]*BDEF\/BAE[\s\S]*BDEF\/BAC/,
    );
    // The label falls back to the full id, which is the only spelling that resolves.
    expect(formatKtdShortTexts(shared)).toContain(`  ${asAction} [optional]: Book it`);
    expect(rewriteKtdDocument(shared, undefined, [{ node: asAction, text: 'Book it now' }])).toContain(
      `sktd:text="${enc('Book it now')}"`,
    );
  });

  it('every printed short-text label is accepted back as shortTexts[].node', () => {
    const text = formatKtdShortTexts(envelope('Payment value date'));
    const labels = text
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' [')[0]);
    expect(labels).toEqual(['PaymentValueDate']);
    for (const label of labels) {
      expect(() =>
        rewriteKtdDocument(envelope('Payment value date'), undefined, [{ node: label, text: 'ok' }]),
      ).not.toThrow();
    }
  });
});
