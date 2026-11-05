import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  documentStableValue,
  parsePinnedDocument,
  pinnedDocumentSelection,
} from '../../../src/adt/pinned-document-owner.js';

describe.each(['SKTD', 'ENHO'] as const)('%s exact native state alternatives', (type) => {
  const selected = pinnedDocumentSelection(type, 'ZTEST');
  function document(href: string, name = selected.name, version = 'inactive') {
    if (type === 'ENHO')
      return readFileSync(new URL('../../fixtures/xml/enhancement-implementation.xml', import.meta.url), 'utf8')
        .replaceAll('SFW_BCF_TCD', name)
        .replace('adtcore:version="active"', `adtcore:version="${version}"`)
        .replace(
          '</enho:objectData>',
          `<a:link xmlns:a="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${href.replaceAll('&', '&amp;')}"/><x:opaque xmlns:x="urn:test">unchanged</x:opaque></enho:objectData>`,
        );
    return `<s:docu xmlns:s="http://www.sap.com/wbobj/texts/sktd" xmlns:c="http://www.sap.com/adt/core" xmlns:a="http://www.w3.org/2005/Atom" c:name="${name}" c:type="SKTD/TYP" c:version="${version}"><c:packageRef c:name="$TMP" c:type="DEVC/K"/><s:refObject c:name="${name}" c:type="BDEF/BDO" c:uri="/sap/bc/adt/bo/behaviordefinitions/${encodeURIComponent(name.toLowerCase())}"/><a:link rel="http://www.sap.com/adt/relations/objectstates" href="${href.replaceAll('&', '&amp;')}"/><x:opaque xmlns:x="urn:test">unchanged</x:opaque></s:docu>`;
  }

  it.each(['active', 'inactive'] as const)('recognizes the literal owned %s alternative', (alternative) => {
    const version = alternative === 'active' ? 'inactive' : 'active';
    const parsed = parsePinnedDocument(document(`./ztest?version=${alternative}`, selected.name, version), selected);
    expect(parsed.version).toBe(version);
    expect(parsed.inactiveAlternative).toBe(alternative === 'inactive');
  });
  it('matches the exact encoded namespace owner without decoding the response', () => {
    const selected = pinnedDocumentSelection(type, '/NS/ZTEST');
    const body = document('./%2Fns%2Fztest?version=active', selected.name);
    expect(parsePinnedDocument(body, selected).version).toBe('inactive');
    expect(() => parsePinnedDocument(body.replace('./%2Fns%2Fztest?', './%2Fns%2Fforeign?'), selected)).toThrow();
  });
  it.each([
    './foreign?version=active',
    './ZTEST?version=active',
    '../ztest?version=active',
    './child/../ztest?version=active',
    './%2eztest?version=active',
    '.%2Fztest?version=active',
    '//sktd.invalid/ztest?version=active',
    'https://sktd.invalid/ztest?version=active',
    './ztest?version=active&version=inactive',
    './ztest?version=active&other=x',
    './ztest?version=active#fragment',
    './ztest?VERSION=active',
    './ztest?version=ACTIVE',
    './ztest?version=new',
    './ztest?version=%61ctive',
    './ztest?version=active ',
    ' ./ztest?version=active',
  ])('refuses unqualified state link %s', (href) => {
    expect(() => parsePinnedDocument(document(href), selected)).toThrow('Unverified native document state alternative');
  });
  it('preserves complete metadata hashes and opaque fields across link serialization', () => {
    const absolute = document(`${selected.objectUrl}?version=active`);
    const relative = document('./ztest?version=active');
    expect(parsePinnedDocument(absolute, selected).hash).not.toBe(parsePinnedDocument(relative, selected).hash);
    expect(documentStableValue(absolute, selected)).toBe(documentStableValue(relative, selected));
    const changed = relative.replace('>unchanged<', '>changed<');
    expect(parsePinnedDocument(changed, selected).hash).not.toBe(parsePinnedDocument(relative, selected).hash);
    expect(documentStableValue(changed, selected)).not.toBe(documentStableValue(relative, selected));
  });
  it('refuses duplicate state alternatives', () => {
    const body = document('./ztest?version=active');
    const link = body.match(/<a:link[^>]*\/>/)![0];
    const close = type === 'SKTD' ? '</s:docu>' : '</enho:objectData>';
    expect(() => parsePinnedDocument(body.replace(close, `${link}${close}`), selected)).toThrow();
  });
});
it('requires native ENHO technology even with a literal owned relative link', () => {
  const enho = pinnedDocumentSelection('ENHO', 'ZTEST');
  const body = `<e:objectData xmlns:e="http://www.sap.com/adt/enhancements/enho" xmlns:c="http://www.sap.com/adt/core" c:name="ZTEST" c:type="ENHO/XHB" c:version="inactive"><c:packageRef c:name="$TMP" c:type="DEVC/K"/><a:link xmlns:a="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./ztest?version=active"/></e:objectData>`;
  expect(() => parsePinnedDocument(body, enho)).toThrow('Only verified ENHO BADI_IMPL technology');
});
