import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adtResponsibleAttr,
  buildDataElementXml,
  buildDomainXml,
  buildMessageClassXml,
  buildPackageXml,
  buildServiceBindingXml,
  buildTableTypeXml,
  decodeKtdText,
  formatKtdUndocumentedIndex,
  KTD_META_MARKER,
  normalizeAdtResponsible,
  normalizeCloudResponsible,
  normalizeSrvbBindingType,
  parseTableType,
  rewriteKtdText,
  stripKtdMetaTrailer,
} from '../../../src/adt/ddic-xml.js';

describe('ddic-xml builders', () => {
  // issue #343: created object master language must follow the configured SAP_LANGUAGE,
  // not a hard-coded EN. Genuinely affects DTEL/DOMA text language on the S/4 v2 handler.
  describe('master language (issue #343)', () => {
    it('buildDomainXml emits the configured language as masterLanguage', () => {
      const xml = buildDomainXml({
        name: 'ZD',
        description: 'd',
        package: '$TMP',
        dataType: 'CHAR',
        length: 1,
        language: 'DE',
      });
      expect(xml).toContain('adtcore:masterLanguage="DE"');
    });

    it('buildDomainXml defaults to EN when no language given', () => {
      const xml = buildDomainXml({ name: 'ZD', description: 'd', package: '$TMP', dataType: 'CHAR', length: 1 });
      expect(xml).toContain('adtcore:masterLanguage="EN"');
    });

    it('buildDataElementXml emits the configured language as masterLanguage', () => {
      const xml = buildDataElementXml({
        name: 'ZE',
        description: 'd',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
        language: 'DE',
      });
      expect(xml).toContain('adtcore:masterLanguage="DE"');
    });

    it('buildDataElementXml defaults to EN when no language given', () => {
      const xml = buildDataElementXml({ name: 'ZE', description: 'd', package: '$TMP' });
      expect(xml).toContain('adtcore:masterLanguage="EN"');
    });

    it('buildServiceBindingXml emits the configured language for both language and masterLanguage', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB',
        description: 'd',
        package: '$TMP',
        serviceDefinition: 'ZSD',
        bindingType: 'ODATA V4 - UI',
        language: 'DE',
      });
      expect(xml).toContain('adtcore:language="DE"');
      expect(xml).toContain('adtcore:masterLanguage="DE"');
    });

    it('buildServiceBindingXml defaults to EN when no language given', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB',
        description: 'd',
        package: '$TMP',
        serviceDefinition: 'ZSD',
        bindingType: 'ODATA V4 - UI',
      });
      expect(xml).toContain('adtcore:language="EN"');
      expect(xml).toContain('adtcore:masterLanguage="EN"');
    });

    it('buildMessageClassXml emits the configured language as BOTH language and masterLanguage', () => {
      // The MSAG handler keys the T100 text rows by the BODY adtcore:language
      // (live-verified on a4h 7.58); masterLanguage matches the server's own
      // serialization and drives the object master language.
      const xml = buildMessageClassXml({
        name: 'ZM',
        description: 'd',
        package: '$TMP',
        language: 'DE',
        messages: [{ number: '001', shortText: 'Probe &1' }],
      });
      expect(xml).toContain('adtcore:language="DE"');
      expect(xml).toContain('adtcore:masterLanguage="DE"');
    });

    it('buildMessageClassXml defaults to EN when no language given (blank-SPRSL bug)', () => {
      // Without adtcore:language the handler stores the T100 rows with
      // SPRSL = space: MESSAGE ... INTO never resolves the texts and ATC/SLIN
      // reports every message number as missing. Verified on a4h 7.58.
      const xml = buildMessageClassXml({ name: 'ZM', description: 'd', package: '$TMP' });
      expect(xml).toContain('adtcore:language="EN"');
      expect(xml).toContain('adtcore:masterLanguage="EN"');
    });

    it('normalizes a lower-case 2-char language to upper case', () => {
      const xml = buildDataElementXml({ name: 'ZE', description: 'd', package: '$TMP', language: 'de' });
      expect(xml).toContain('adtcore:masterLanguage="DE"');
    });

    it('treats a blank language as the EN default', () => {
      const xml = buildDomainXml({
        name: 'ZD',
        description: 'd',
        package: '$TMP',
        dataType: 'CHAR',
        length: 1,
        language: '   ',
      });
      expect(xml).toContain('adtcore:masterLanguage="EN"');
    });
  });

  // Sibling of issue #343, for adtcore:responsible: the created object's "person
  // responsible" must name a real user on the target system. ARC-1 threads the connection's
  // logon user (config.username), and OMITS the attribute when that cannot be an on-prem user
  // name — it deserializes into XUBNAME (CHAR12), so the email-style principal under principal
  // propagation overflows the field and kills the create ST (#636). ADT then assigns the
  // logged-on user, which under PP is the propagated one.
  describe('person responsible (adtcore:responsible)', () => {
    it('buildPackageXml emits the configured responsible', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd', responsible: 'SRAHEMI' });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('buildPackageXml omits responsible when unset (never the DEVELOPER demo literal)', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd' });
      expect(xml).not.toContain('adtcore:responsible');
      expect(xml).not.toContain('DEVELOPER');
    });

    it('buildDomainXml emits the configured responsible', () => {
      const xml = buildDomainXml({
        name: 'ZD',
        description: 'd',
        package: '$TMP',
        dataType: 'CHAR',
        length: 1,
        responsible: 'SRAHEMI',
      });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('buildDataElementXml emits the configured responsible', () => {
      const xml = buildDataElementXml({ name: 'ZE', description: 'd', package: '$TMP', responsible: 'SRAHEMI' });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('buildServiceBindingXml emits the configured responsible', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB',
        description: 'd',
        package: '$TMP',
        serviceDefinition: 'ZSD',
        responsible: 'SRAHEMI',
      });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('omits responsible across DDIC builders when unset', () => {
      expect(
        buildDomainXml({ name: 'ZD', description: 'd', package: '$TMP', dataType: 'CHAR', length: 1 }),
      ).not.toContain('adtcore:responsible');
      expect(buildDataElementXml({ name: 'ZE', description: 'd', package: '$TMP' })).not.toContain(
        'adtcore:responsible',
      );
      expect(
        buildServiceBindingXml({ name: 'ZSB', description: 'd', package: '$TMP', serviceDefinition: 'ZSD' }),
      ).not.toContain('adtcore:responsible');
    });

    it('upper-cases a lower-case responsible', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd', responsible: 'srahemi' });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('omits a blank responsible', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd', responsible: '   ' });
      expect(xml).not.toContain('adtcore:responsible');
    });

    it('normalizeAdtResponsible trims + upper-cases, and returns "" when unusable', () => {
      expect(normalizeAdtResponsible('  srahemi ')).toBe('SRAHEMI');
      expect(normalizeAdtResponsible()).toBe('');
      expect(normalizeAdtResponsible('   ')).toBe('');
    });

    // #636 — on-prem adtcore:responsible deserializes into XUBNAME (CHAR12). Live-verified on
    // 7.50/758/816: 12 chars creates, 13 chars fails the create ST ("Data loss occurred when
    // converting …" on 7.50). Under principal propagation the value is the XSUAA email.
    it('normalizeAdtResponsible drops a value that cannot be an on-prem user name', () => {
      expect(normalizeAdtResponsible('firstname.lastname@example.com')).toBe('');
      expect(normalizeAdtResponsible('marian@zeis.de')).toBe('');
      expect(normalizeAdtResponsible('ABCDEFGHIJKLM')).toBe(''); // 13 chars — over CHAR12
      expect(normalizeAdtResponsible('A@B.DE')).toBe(''); // short, but still not a user name
    });

    it('normalizeAdtResponsible keeps a value exactly at the CHAR12 boundary', () => {
      expect(normalizeAdtResponsible('ABCDEFGHIJKL')).toBe('ABCDEFGHIJKL'); // 12 chars — creates fine
      expect(normalizeAdtResponsible('CB9980000000')).toBe('CB9980000000');
    });

    it('adtResponsibleAttr renders the attribute only when the user is usable', () => {
      // leading space belongs to the attribute, so omitting it leaves no stray whitespace
      expect(adtResponsibleAttr('srahemi')).toBe(' adtcore:responsible="SRAHEMI"');
      expect(adtResponsibleAttr('firstname.lastname@example.com')).toBe('');
      expect(adtResponsibleAttr()).toBe('');
    });
  });

  describe('buildDomainXml', () => {
    it('builds basic domain XML', () => {
      const xml = buildDomainXml({
        name: 'ZSTATUS',
        description: 'Status domain',
        package: '$TMP',
        dataType: 'CHAR',
        length: 1,
      });

      expect(xml).toContain('<doma:domain');
      expect(xml).toContain('adtcore:type="DOMA/DD"');
      expect(xml).toContain('<doma:datatype>CHAR</doma:datatype>');
      expect(xml).toContain('<doma:length>000001</doma:length>');
      expect(xml).toContain('<doma:decimals>000000</doma:decimals>');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    });

    it('builds fix values when provided', () => {
      const xml = buildDomainXml({
        name: 'ZSTATUS',
        description: 'Status domain',
        package: '$TMP',
        dataType: 'CHAR',
        length: 1,
        fixedValues: [
          { low: 'A', description: 'Active' },
          { low: 'I', high: 'Z', description: 'Inactive range' },
        ],
      });

      expect(xml).toContain('<doma:fixValues>');
      expect(xml).toContain('<doma:position>0001</doma:position>');
      expect(xml).toContain('<doma:low>A</doma:low>');
      expect(xml).toContain('<doma:position>0002</doma:position>');
      expect(xml).toContain('<doma:high>Z</doma:high>');
      expect(xml).toContain('<doma:text>Inactive range</doma:text>');
    });

    it('includes value table when provided', () => {
      const xml = buildDomainXml({
        name: 'ZBUKRS',
        description: 'Company code',
        package: '$TMP',
        dataType: 'CHAR',
        length: 4,
        valueTable: 'T001',
      });

      expect(xml).toContain('<doma:valueTableRef adtcore:type="TABL/DT" adtcore:name="T001"/>');
    });

    it('zero pads numeric fields to 6 digits', () => {
      const xml = buildDomainXml({
        name: 'ZAMOUNT',
        description: 'Amount',
        package: '$TMP',
        dataType: 'DEC',
        length: 9,
        decimals: 2,
        outputLength: 11,
      });

      expect(xml).toContain('<doma:length>000009</doma:length>');
      expect(xml).toContain('<doma:decimals>000002</doma:decimals>');
      expect(xml).toContain('<doma:length>000011</doma:length>');
    });
  });

  describe('buildDataElementXml', () => {
    it('builds data element with domain reference', () => {
      const xml = buildDataElementXml({
        name: 'ZSTATUS',
        description: 'Status data element',
        package: '$TMP',
        typeKind: 'domain',
        typeName: 'ZSTATUS',
      });

      expect(xml).toContain('<dtel:typeKind>domain</dtel:typeKind>');
      expect(xml).toContain('<dtel:typeName>ZSTATUS</dtel:typeName>');
      expect(xml).toContain('<blue:wbobj');
      expect(xml).toContain('adtcore:type="DTEL/DE"');
    });

    it('builds data element with predefined ABAP type', () => {
      const xml = buildDataElementXml({
        name: 'ZTEXT20',
        description: 'Text',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 20,
      });

      expect(xml).toContain('<dtel:typeKind>predefinedAbapType</dtel:typeKind>');
      expect(xml).toContain('<dtel:dataType>CHAR</dtel:dataType>');
      expect(xml).toContain('<dtel:dataTypeLength>000020</dtel:dataTypeLength>');
    });

    it('emits fields in strict ADT order', () => {
      const xml = buildDataElementXml({
        name: 'ZORDER',
        description: 'Order',
        package: '$TMP',
      });

      const orderedTags = [
        '<dtel:typeKind>',
        '<dtel:typeName>',
        '<dtel:dataType>',
        '<dtel:dataTypeLength>',
        '<dtel:dataTypeDecimals>',
        '<dtel:shortFieldLabel>',
        '<dtel:shortFieldLength>',
        '<dtel:shortFieldMaxLength>',
        '<dtel:mediumFieldLabel>',
        '<dtel:mediumFieldLength>',
        '<dtel:mediumFieldMaxLength>',
        '<dtel:longFieldLabel>',
        '<dtel:longFieldLength>',
        '<dtel:longFieldMaxLength>',
        '<dtel:headingFieldLabel>',
        '<dtel:headingFieldLength>',
        '<dtel:headingFieldMaxLength>',
        '<dtel:searchHelp>',
        '<dtel:searchHelpParameter>',
        '<dtel:setGetParameter>',
        '<dtel:defaultComponentName>',
        '<dtel:deactivateInputHistory>',
        '<dtel:changeDocument>',
        '<dtel:leftToRightDirection>',
        '<dtel:deactivateBIDIFiltering>',
      ];

      let lastIndex = -1;
      for (const tag of orderedTags) {
        const idx = xml.indexOf(tag);
        expect(idx).toBeGreaterThan(lastIndex);
        lastIndex = idx;
      }
    });

    it('writes all optional fields when provided', () => {
      const xml = buildDataElementXml({
        name: 'ZSTATUS',
        description: 'Status',
        package: '$TMP',
        typeKind: 'domain',
        domainName: 'ZSTATUS',
        dataType: 'CHAR',
        length: 1,
        decimals: 0,
        shortLabel: 'St',
        mediumLabel: 'Status',
        longLabel: 'Order Status',
        headingLabel: 'Status',
        searchHelp: 'ZSH_STATUS',
        searchHelpParameter: 'STATUS',
        setGetParameter: 'ZST',
        defaultComponentName: 'STATUS',
        changeDocument: true,
      });

      expect(xml).toContain('<dtel:searchHelp>ZSH_STATUS</dtel:searchHelp>');
      expect(xml).toContain('<dtel:searchHelpParameter>STATUS</dtel:searchHelpParameter>');
      expect(xml).toContain('<dtel:setGetParameter>ZST</dtel:setGetParameter>');
      expect(xml).toContain('<dtel:defaultComponentName>STATUS</dtel:defaultComponentName>');
      expect(xml).toContain('<dtel:changeDocument>true</dtel:changeDocument>');
    });

    it('uses defaults for omitted values', () => {
      const xml = buildDataElementXml({
        name: 'ZDEFAULT',
        description: 'Defaults',
        package: '$TMP',
      });

      expect(xml).toContain('<dtel:dataTypeLength>000000</dtel:dataTypeLength>');
      expect(xml).toContain('<dtel:dataTypeDecimals>000000</dtel:dataTypeDecimals>');
      expect(xml).toContain('<dtel:shortFieldLength>10</dtel:shortFieldLength>');
      expect(xml).toContain('<dtel:mediumFieldLength>20</dtel:mediumFieldLength>');
      expect(xml).toContain('<dtel:longFieldLength>40</dtel:longFieldLength>');
      expect(xml).toContain('<dtel:headingFieldLength>55</dtel:headingFieldLength>');
      expect(xml).toContain('<dtel:changeDocument>false</dtel:changeDocument>');
    });
  });

  describe('buildMessageClassXml', () => {
    it('builds empty message class XML', () => {
      const xml = buildMessageClassXml({
        name: 'ZCM_TRAVEL',
        description: 'Travel messages',
        package: '$TMP',
      });

      expect(xml).toContain('<mc:messageClass');
      expect(xml).toContain('xmlns:mc="http://www.sap.com/adt/MessageClass"');
      expect(xml).toContain('adtcore:name="ZCM_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel messages"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
      expect(xml).not.toContain('<mc:messages');
    });

    it('builds message class with messages', () => {
      const xml = buildMessageClassXml({
        name: 'ZCM_TRAVEL',
        description: 'Travel messages',
        package: '$TMP',
        messages: [
          { number: '001', shortText: 'Booking &1 created' },
          { number: '002', shortText: 'Flight not found' },
        ],
      });

      expect(xml).toContain('mc:msgno="001"');
      expect(xml).toContain('mc:msgtext="Booking &amp;1 created"');
      expect(xml).toContain('mc:msgno="002"');
      expect(xml).toContain('mc:msgtext="Flight not found"');
      expect(xml).toContain('mc:selfexplainatory="true"');
      expect(xml).toContain('mc:documented="false"');
    });

    it('escapes special characters in message text', () => {
      const xml = buildMessageClassXml({
        name: 'ZTEST',
        description: 'Test "class" <msgs>',
        package: '$TMP',
        messages: [{ number: '001', shortText: 'Error: &1 < &2 "quoted"' }],
      });

      expect(xml).toContain('adtcore:description="Test &quot;class&quot; &lt;msgs&gt;"');
      expect(xml).toContain('mc:msgtext="Error: &amp;1 &lt; &amp;2 &quot;quoted&quot;"');
    });
  });

  describe('buildPackageXml', () => {
    it('builds basic package XML with name and description', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_TEST',
        description: 'Test package',
      });

      expect(xml).toContain('<pak:package');
      expect(xml).toContain('adtcore:type="DEVC/K"');
      expect(xml).toContain('adtcore:name="ZPKG_TEST"');
      expect(xml).toContain('adtcore:description="Test package"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPKG_TEST"/>');
    });

    it('includes superPackage when provided', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_CHILD',
        description: 'Child package',
        superPackage: 'ZPKG_PARENT',
      });

      expect(xml).toContain('<pak:superPackage adtcore:name="ZPKG_PARENT"/>');
    });

    it('includes softwareComponent and transportLayer when provided', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_TR',
        description: 'Transport package',
        softwareComponent: 'HOME',
        transportLayer: 'HOME',
      });

      expect(xml).toContain('<pak:attributes pak:packageType="development" pak:recordChanges="true"/>');
      expect(xml).toContain('<pak:softwareComponent pak:name="HOME"/>');
      expect(xml).toContain('<pak:transportLayer pak:name="HOME"/>');
    });

    it('supports packageType structure', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_STR',
        description: 'Structure package',
        packageType: 'structure',
      });

      expect(xml).toContain('<pak:attributes pak:packageType="structure" pak:recordChanges="false"/>');
    });

    it('uses defaults for packageType and superPackage', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_DEFAULT',
        description: 'Defaults',
      });

      expect(xml).toContain('<pak:attributes pak:packageType="development" pak:recordChanges="false"/>');
      expect(xml).toContain('<pak:superPackage adtcore:name=""/>');
    });

    it('keeps recordChanges=false only for the literal LOCAL software component', () => {
      const local = buildPackageXml({
        name: 'ZPKG_LOCAL',
        description: 'Local package',
        softwareComponent: 'LOCAL',
      });
      const zlocal = buildPackageXml({
        name: 'ZPKG_ZLOCAL',
        description: 'ZLOCAL package',
        softwareComponent: 'ZLOCAL',
      });

      expect(local).toContain('pak:recordChanges="false"');
      expect(zlocal).toContain('pak:recordChanges="true"');
    });

    it('sets recordChanges=true when a transport layer is provided', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_LAYER',
        description: 'Layered package',
        softwareComponent: 'LOCAL',
        transportLayer: 'ZDEV',
      });

      expect(xml).toContain('pak:recordChanges="true"');
    });

    it('honors explicit recordChanges overrides', () => {
      const forcedOff = buildPackageXml({
        name: 'ZPKG_OFF',
        description: 'No recording',
        softwareComponent: 'HOME',
        recordChanges: false,
      });
      const forcedOn = buildPackageXml({
        name: 'ZPKG_ON',
        description: 'Force recording',
        softwareComponent: 'LOCAL',
        recordChanges: true,
      });

      expect(forcedOff).toContain('pak:recordChanges="false"');
      expect(forcedOn).toContain('pak:recordChanges="true"');
    });

    it('escapes XML special characters', () => {
      const xml = buildPackageXml({
        name: 'ZPKG_ESC',
        description: 'Package "A&B" <test> \'quote\'',
        superPackage: 'ZPARENT&A',
      });

      expect(xml).toContain('Package &quot;A&amp;B&quot; &lt;test&gt; &apos;quote&apos;');
      expect(xml).toContain('<pak:superPackage adtcore:name="ZPARENT&amp;A"/>');
    });

    // --- BTP cloud package create (live-verified 2026-06-27, SAP_BASIS 919; see
    // docs/research/2026-06-27-btp-package-create-solved.md) ---
    it('cloud=true builds a BTP-correct body (verbatim responsible, ZLOCAL default SC, recordChanges false, nested)', () => {
      const xml = buildPackageXml({
        name: 'ZARC1_SUB',
        description: 'Cloud sub-package',
        superPackage: 'ZLOCAL',
        responsible: 'CB9980000000',
        cloud: true,
      });
      expect(xml).toContain('adtcore:responsible="CB9980000000"');
      expect(xml).toContain('<pak:superPackage adtcore:name="ZLOCAL"/>');
      expect(xml).toContain('<pak:softwareComponent pak:name="ZLOCAL"/>');
      expect(xml).toContain('pak:recordChanges="false"');
    });

    it('cloud=true defaults the software component to ZLOCAL', () => {
      const xml = buildPackageXml({ name: 'ZARC1_X', description: 'd', responsible: 'CB9980000000', cloud: true });
      expect(xml).toContain('<pak:softwareComponent pak:name="ZLOCAL"/>');
    });

    it('normalizeCloudResponsible passes an internal user verbatim (no DEVELOPER, no upper-case mangle)', () => {
      expect(normalizeCloudResponsible('CB9980000000')).toBe('CB9980000000');
      expect(normalizeCloudResponsible('  CB9980000000  ')).toBe('CB9980000000');
      expect(normalizeCloudResponsible()).toBe('');
      expect(normalizeCloudResponsible('')).toBe('');
      // shared on-prem helper is untouched (regression guard): it omits rather than inventing a user
      expect(normalizeAdtResponsible()).toBe('');
    });

    it('on-prem body (cloud unset) keeps the legacy LOCAL default + recordChanges heuristic', () => {
      const onprem = buildPackageXml({ name: 'ZPKG_OP', description: 'd', responsible: 'SRAHEMI' });
      expect(onprem).toContain('adtcore:responsible="SRAHEMI"');
      expect(onprem).toContain('<pak:softwareComponent pak:name="LOCAL"/>');
      expect(onprem).toContain('pak:recordChanges="false"');
    });
  });

  describe('normalizeSrvbBindingType', () => {
    it('defaults to ODATA V2 when no input', () => {
      expect(normalizeSrvbBindingType()).toEqual({ type: 'ODATA', odataVersion: 'V2' });
      expect(normalizeSrvbBindingType('')).toEqual({ type: 'ODATA', odataVersion: 'V2' });
      expect(normalizeSrvbBindingType(undefined)).toEqual({ type: 'ODATA', odataVersion: 'V2' });
    });

    it('normalizes "ODataV4-UI" to ODATA V4 category 0', () => {
      expect(normalizeSrvbBindingType('ODataV4-UI')).toEqual({ type: 'ODATA', odataVersion: 'V4', category: '0' });
    });

    it('normalizes "OData V4 - UI" to ODATA V4 category 0', () => {
      expect(normalizeSrvbBindingType('OData V4 - UI')).toEqual({ type: 'ODATA', odataVersion: 'V4', category: '0' });
    });

    it('normalizes "OData V2 - Web API" to ODATA V2 category 1', () => {
      expect(normalizeSrvbBindingType('OData V2 - Web API')).toEqual({
        type: 'ODATA',
        odataVersion: 'V2',
        category: '1',
      });
    });

    it('normalizes "ODATA_V4" to ODATA V4', () => {
      expect(normalizeSrvbBindingType('ODATA_V4')).toEqual({ type: 'ODATA', odataVersion: 'V4' });
    });

    it('normalizes "ODATA_V4_WEB_API" to ODATA V4 category 1', () => {
      expect(normalizeSrvbBindingType('ODATA_V4_WEB_API')).toEqual({
        type: 'ODATA',
        odataVersion: 'V4',
        category: '1',
      });
    });

    it('normalizes plain "ODATA" to V2', () => {
      expect(normalizeSrvbBindingType('ODATA')).toEqual({ type: 'ODATA', odataVersion: 'V2' });
    });

    it('is case insensitive', () => {
      expect(normalizeSrvbBindingType('odatav4-ui')).toEqual({ type: 'ODATA', odataVersion: 'V4', category: '0' });
    });
  });

  describe('buildServiceBindingXml', () => {
    it('builds basic service binding XML with SRVB/SVB type', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_TRAVEL_O4',
        description: 'Travel service binding',
        package: '$TMP',
        serviceDefinition: 'ZSD_TRAVEL',
      });

      expect(xml).toContain('<srvb:serviceBinding');
      expect(xml).toContain('xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"');
      expect(xml).toContain('adtcore:type="SRVB/SVB"');
      expect(xml).toContain('adtcore:name="ZSB_TRAVEL_O4"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    });

    it('includes nested service definition reference', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_TRAVEL_O4',
        description: 'Travel service binding',
        package: '$TMP',
        serviceDefinition: 'ZSD_TRAVEL',
      });

      expect(xml).toContain('<srvb:services srvb:name="ZSB_TRAVEL_O4">');
      expect(xml).toContain('<srvb:content srvb:version="0001">');
      expect(xml).toContain('<srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>');
    });

    it('uses default category=0, bindingType=ODATA, odataVersion=V2', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_DEFAULTS',
        description: 'Defaults',
        package: '$TMP',
        serviceDefinition: 'ZSD_DEFAULTS',
      });

      expect(xml).toContain('<srvb:binding srvb:category="0" srvb:type="ODATA" srvb:version="V2">');
    });

    it('supports category=1 for Web API binding', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_UI',
        description: 'UI binding',
        package: '$TMP',
        serviceDefinition: 'ZSD_UI',
        category: '1',
      });

      expect(xml).toContain('<srvb:binding srvb:category="1" srvb:type="ODATA" srvb:version="V2">');
    });

    it('normalizes "ODataV4-UI" bindingType to ODATA V4 category 0', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_V4',
        description: 'V4 UI binding',
        package: '$TMP',
        serviceDefinition: 'ZSD_V4',
        bindingType: 'ODataV4-UI',
      });

      expect(xml).toContain('<srvb:binding srvb:category="0" srvb:type="ODATA" srvb:version="V4">');
    });

    it('normalizes "OData V4 - Web API" bindingType', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_V4_API',
        description: 'V4 Web API binding',
        package: '$TMP',
        serviceDefinition: 'ZSD_V4_API',
        bindingType: 'OData V4 - Web API',
      });

      expect(xml).toContain('<srvb:binding srvb:category="1" srvb:type="ODATA" srvb:version="V4">');
    });

    it('explicit category overrides bindingType hint', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_OVERRIDE',
        description: 'Override test',
        package: '$TMP',
        serviceDefinition: 'ZSD_OVERRIDE',
        bindingType: 'ODataV4-UI', // hints category=0
        category: '1', // explicit override to Web API
      });

      expect(xml).toContain('<srvb:binding srvb:category="1" srvb:type="ODATA" srvb:version="V4">');
    });

    it('explicit odataVersion overrides bindingType hint', () => {
      const xml = buildServiceBindingXml({
        name: 'ZSB_OVER_VER',
        description: 'Override version test',
        package: '$TMP',
        serviceDefinition: 'ZSD_OVER_VER',
        bindingType: 'ODataV4-UI', // hints V4
        odataVersion: 'V2', // explicit override to V2
      });

      expect(xml).toContain('<srvb:binding srvb:category="0" srvb:type="ODATA" srvb:version="V2">');
    });
  });

  it('escapes XML special characters', () => {
    const domainXml = buildDomainXml({
      name: 'ZDOMA',
      description: 'Domain "A&B" <test> \'apostrophe\'',
      package: '$TMP',
      dataType: 'CHAR',
      length: 1,
      fixedValues: [{ low: 'A&B', description: 'A < B' }],
    });
    const dtelXml = buildDataElementXml({
      name: 'ZDTEL',
      description: 'Data "element"',
      package: '$TMP',
      shortLabel: 'A&B',
    });
    const srvbXml = buildServiceBindingXml({
      name: 'ZSB_XML',
      description: 'Service "A&B" <binding>',
      package: '$TMP',
      serviceDefinition: 'ZSD_<TEST>&',
    });

    expect(domainXml).toContain('&quot;A&amp;B&quot; &lt;test&gt; &apos;apostrophe&apos;');
    expect(domainXml).toContain('<doma:low>A&amp;B</doma:low>');
    expect(domainXml).toContain('<doma:text>A &lt; B</doma:text>');
    expect(dtelXml).toContain('Data &quot;element&quot;');
    expect(dtelXml).toContain('<dtel:shortFieldLabel>A&amp;B</dtel:shortFieldLabel>');
    expect(srvbXml).toContain('Service &quot;A&amp;B&quot; &lt;binding&gt;');
    expect(srvbXml).toContain('<srvb:serviceDefinition adtcore:name="ZSD_&lt;TEST&gt;&amp;"/>');
    // bindingType is normalized — srvb:type is always "ODATA"
    expect(srvbXml).toContain('srvb:type="ODATA"');
  });

  describe('SKTD helpers', () => {
    // Realistic envelope shape mirroring the Eclipse ADT capture.
    const buildEnvelope = (textBody: string) =>
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
      'adtcore:responsible="LEMAIWO" adtcore:masterLanguage="EN" adtcore:name="ZTR_I_PAYMENT_VALUE_DATE" ' +
      'adtcore:type="SKTD/TYP">' +
      '<adtcore:packageRef adtcore:name="ZE_TR"/>' +
      '<sktd:refObject adtcore:name="ZTR_I_PAYMENT_VALUE_DATE" adtcore:type="DDLS/DF"/>' +
      '<sktd:element>' +
      `<sktd:text>${textBody}</sktd:text>` +
      '</sktd:element>' +
      '</sktd:docu>';

    describe('decodeKtdText', () => {
      it('decodes base64 Markdown from <sktd:text>', () => {
        const markdown = '# Heading\n\nBody text.';
        const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
        expect(decodeKtdText(buildEnvelope(base64))).toBe(markdown);
      });

      it('round-trips the exact Eclipse-capture payload', () => {
        // "dGVzdCB0byBzZWUgaXQgaHRoaXMgd29ya3M=" → "test to see it hthis works"
        const capture =
          '<?xml version="1.0" encoding="UTF-8"?><sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd">' +
          '<sktd:element><sktd:text>dGVzdCB0byBzZWUgaXQgaHRoaXMgd29ya3M=</sktd:text></sktd:element></sktd:docu>';
        expect(decodeKtdText(capture)).toBe('test to see it hthis works');
      });

      it('returns empty string when <sktd:text> is empty', () => {
        expect(decodeKtdText(buildEnvelope(''))).toBe('');
      });

      it('returns empty string when <sktd:text> is missing', () => {
        const xml = '<?xml version="1.0"?><sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"></sktd:docu>';
        expect(decodeKtdText(xml)).toBe('');
      });

      it('handles UTF-8 content (multi-byte characters round-trip correctly)', () => {
        const markdown = '# Überblick — résumé 日本語 🚀';
        const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
        expect(decodeKtdText(buildEnvelope(base64))).toBe(markdown);
      });
    });

    describe('rewriteKtdText', () => {
      it('replaces only <sktd:text> with base64(markdown) and preserves all other metadata', () => {
        const original = buildEnvelope('b2xkIGNvbnRlbnQ='); // "old content"
        const newMarkdown = '# New title\n\nNew body.';
        const rewritten = rewriteKtdText(original, newMarkdown);
        const newBase64 = Buffer.from(newMarkdown, 'utf-8').toString('base64');

        expect(rewritten).toContain(`<sktd:text>${newBase64}</sktd:text>`);
        expect(rewritten).not.toContain('b2xkIGNvbnRlbnQ=');
        // Metadata preserved
        expect(rewritten).toContain('adtcore:responsible="LEMAIWO"');
        expect(rewritten).toContain('adtcore:masterLanguage="EN"');
        expect(rewritten).toContain('<adtcore:packageRef adtcore:name="ZE_TR"/>');
        expect(rewritten).toContain('<sktd:refObject');
        expect(rewritten).toContain('adtcore:type="DDLS/DF"');
      });

      it('round-trips: rewrite then decode yields original Markdown', () => {
        const markdown = '# Heading\n\n- bullet 1\n- bullet 2';
        const rewritten = rewriteKtdText(buildEnvelope(''), markdown);
        expect(decodeKtdText(rewritten)).toBe(markdown);
      });

      it('handles self-closing <sktd:text/> in the source envelope', () => {
        const envelope =
          '<?xml version="1.0"?><sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd">' +
          '<sktd:element><sktd:text/></sktd:element></sktd:docu>';
        const markdown = 'hello';
        const rewritten = rewriteKtdText(envelope, markdown);
        const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
        expect(rewritten).toContain(`<sktd:text>${base64}</sktd:text>`);
      });

      it('throws when the envelope has no <sktd:text> element', () => {
        const xml = '<?xml version="1.0"?><sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"/>';
        expect(() => rewriteKtdText(xml, 'x')).toThrow(/missing <sktd:text>/);
      });

      // -- Multi-element envelopes (one <sktd:element> per documented node) --
      //
      // Shape mirrors the live ZI_TravelTP KTD read back from S/4HANA PCE
      // 2025.1: the root node's <sktd:id> is the object name, every other node
      // carries the ADT fragment URI of the element it documents.
      const ROOT_ID = 'ZI_TRAVELTP';
      const BAT_ID = '/sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main#type=BDEF/BAT;name=%25_OWN';
      const BAF_ID =
        '/sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main#type=BDEF/BAF;name=ZI_TravelTP.ReadTravelSummary';

      const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');

      const buildMultiEnvelope = (bodies: Record<string, string>) =>
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
        'adtcore:responsible="DEVELOPER" adtcore:masterLanguage="EN" adtcore:name="ZI_TRAVELTP" ' +
        'adtcore:type="SKTD/TYP">' +
        '<adtcore:packageRef adtcore:name="ZTRAVEL"/>' +
        '<sktd:refObject adtcore:name="ZI_TravelTP" adtcore:type="BDEF/BDO"/>' +
        Object.entries(bodies)
          .map(
            ([id, text]) => `<sktd:element><sktd:id>${id}</sktd:id><sktd:text>${b64(text)}</sktd:text></sktd:element>`,
          )
          .join('') +
        '</sktd:docu>';

      it('updates every addressed node, not just the first (regression: multi-node write hit root only)', () => {
        const envelope = buildMultiEnvelope({
          [ROOT_ID]: 'old root',
          [BAT_ID]: 'old bat',
          [BAF_ID]: 'old baf',
        });
        const markdown = `## ${ROOT_ID}\n\nnew root\n\n## ${BAT_ID}\n\nnew bat\n\n## ${BAF_ID}\n\nnew baf`;

        const rewritten = rewriteKtdText(envelope, markdown);

        expect(rewritten).toContain(`<sktd:text>${b64('new root')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('new bat')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('new baf')}</sktd:text>`);
        // No stale bodies survive, and the whole document did NOT land in node #1.
        expect(rewritten).not.toContain(b64('old bat'));
        expect(rewritten).not.toContain(b64('old baf'));
        expect(rewritten).not.toContain(b64(markdown));
        // Each body must land in ITS node: a mutant rotating bodies among the three
        // addressed elements passes every assertion above and only fails this one.
        expect(decodeKtdText(rewritten)).toBe(markdown);
      });

      it('leaves unaddressed nodes byte-identical (partial update of one node)', () => {
        const envelope = buildMultiEnvelope({
          [ROOT_ID]: 'root stays',
          [BAT_ID]: 'bat stays',
          [BAF_ID]: 'baf changes',
        });
        const rewritten = rewriteKtdText(envelope, `## ${BAF_ID}\n\nbaf updated`);

        expect(rewritten).toContain(`<sktd:text>${b64('root stays')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('bat stays')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('baf updated')}</sktd:text>`);
        expect(rewritten).not.toContain(b64('baf changes'));
      });

      it('round-trips a multi-node envelope through decode -> rewrite unchanged', () => {
        const envelope = buildMultiEnvelope({
          [ROOT_ID]: 'root body',
          [BAT_ID]: 'bat body',
        });
        const rewritten = rewriteKtdText(envelope, decodeKtdText(envelope));
        expect(rewritten).toBe(envelope);
      });

      it('escapes a stored body heading equal to its own node id and round-trips it exactly', () => {
        const rootBody = `## ${ROOT_ID}\n\nThe travel BO.`;
        const envelope = buildMultiEnvelope({ [ROOT_ID]: rootBody, [BAT_ID]: 'bat body' });
        const read = decodeKtdText(envelope);

        expect(read).toContain(`## ${ROOT_ID}\n\n\\## ${ROOT_ID}\n\nThe travel BO.`);
        expect(rewriteKtdText(envelope, read)).toBe(envelope);
        expect(decodeKtdText(envelope, { routeSafe: false })).toContain(
          `## ${ROOT_ID}\n\n## ${ROOT_ID}\n\nThe travel BO.`,
        );
      });

      it('escapes a body heading equal to another node id without moving either body', () => {
        const rootBody = `References this route literally:\n\n## ${BAT_ID}\n\nStill root text.`;
        const envelope = buildMultiEnvelope({ [ROOT_ID]: rootBody, [BAT_ID]: 'actual bat body' });
        const read = decodeKtdText(envelope);

        expect(read).toContain(`\\## ${BAT_ID}\n\nStill root text.`);
        expect(rewriteKtdText(envelope, read)).toBe(envelope);
      });

      it('preserves an existing backslash when escaping a route-shaped body heading', () => {
        const rootBody = `\\## ${ROOT_ID}\n\nliteral escaped heading`;
        const envelope = buildMultiEnvelope({ [ROOT_ID]: rootBody, [BAT_ID]: 'bat body' });
        const read = decodeKtdText(envelope);

        expect(read).toContain(`\\\\## ${ROOT_ID}\n\nliteral escaped heading`);
        expect(rewriteKtdText(envelope, read)).toBe(envelope);
      });

      it('ignores the exact read-only SAPRead trailer when a complete result is written back', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root body', [BAT_ID]: 'bat body' });
        const completeRead = `${decodeKtdText(envelope)}\n\n${KTD_META_MARKER}\n[cached:revalidated]\n\nUndocumented nodes: 0`;
        expect(rewriteKtdText(envelope, completeRead)).toBe(envelope);
      });

      it('reserves only the exact metadata marker line and refuses a section appended below it', () => {
        const bodyMention = `body\n<!-- arc1:ktd-meta is discussed here -->`;
        expect(stripKtdMetaTrailer(bodyMention)).toBe(bodyMention);
        expect(() =>
          rewriteKtdText(
            buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' }),
            `## ${ROOT_ID}\n\nroot\n\n${KTD_META_MARKER}\ncontext\n\n## ${BAT_ID}\n\nbat`,
          ),
        ).toThrow(/below the read-only SAPRead marker/);
      });

      it('keeps "## ..." lines that are not node ids as body content', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'old', [BAT_ID]: 'bat' });
        const body = '## Overview\n\nSome prose.\n\n## Details\n\nMore prose.';
        const rewritten = rewriteKtdText(envelope, `## ${ROOT_ID}\n\n${body}`);
        expect(rewritten).toContain(`<sktd:text>${b64(body)}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('bat')}</sktd:text>`);
      });

      it('refuses a lone root-name H2 instead of silently deleting a plausible title', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: '', [BAT_ID]: '' });
        const markdown = `## ${ROOT_ID}\n\nThe travel business object.\n\n## Purpose\n\nExplain its purpose.`;

        expect(() => rewriteKtdText(envelope, markdown)).toThrow(/ambiguous[\s\S]*silently remove/i);
        const visibleTitle = `# ${ROOT_ID}\n\nThe travel business object.`;
        const rewritten = rewriteKtdText(envelope, visibleTitle);
        expect(rewritten).toContain(`<sktd:id>${ROOT_ID}</sktd:id><sktd:text>${b64(visibleTitle)}</sktd:text>`);
      });

      it('heads a lone documented node when writable empty siblings exist, so the index instruction round-trips', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root body', [BAT_ID]: '' });
        const read = decodeKtdText(envelope);
        const index = formatKtdUndocumentedIndex(envelope);

        expect(read).toBe(`## ${ROOT_ID}\n\nroot body`);
        expect(index).toContain(BAT_ID.split(';name=')[1]);
        const edited = `${read}\n\n## ${BAT_ID}\n\nbat body\n\n${KTD_META_MARKER}\n${index}`;
        const rewritten = rewriteKtdText(envelope, edited);
        expect(decodeKtdText(rewritten)).toBe(`## ${ROOT_ID}\n\nroot body\n\n## ${BAT_ID}\n\nbat body`);
      });

      it('refuses an unaddressed blob on a multi-node KTD instead of silently overwriting the root', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        expect(() => rewriteKtdText(envelope, 'just some text')).toThrow(/addresses no node/i);
      });

      it('names the unknown node and lists the valid ids when a heading does not match', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        expect(() => rewriteKtdText(envelope, `## ${BAF_ID}\n\nbody`)).toThrow(
          /ReadTravelSummary[\s\S]*does not exist[\s\S]*Known node ids:[\s\S]*I_TRAVELTP/i,
        );
      });

      it('still writes the single-element body with no heading (back-compat)', () => {
        const rewritten = rewriteKtdText(buildEnvelope('b2xk'), '# Plain\n\nBody');
        expect(rewritten).toContain(`<sktd:text>${b64('# Plain\n\nBody')}</sktd:text>`);
      });

      it('treats a path-shaped prose heading as body content, not as an unknown node', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'old', [BAT_ID]: 'bat' });
        const body = '## /notes/package layout\n\nProse, not a node id.';
        const rewritten = rewriteKtdText(envelope, `## ${ROOT_ID}\n\n${body}`);
        expect(rewritten).toContain(`<sktd:text>${b64(body)}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('bat')}</sktd:text>`);
      });

      it('writes an unaddressed body to the only documented node, leaving empty siblings alone', () => {
        // An explicitly unaddressed body still targets the sole documented node.
        // BAT_ID first, so the documented node is NOT elements[0]: the test tells the
        // "single documented node" selection apart from the old first-match write.
        const envelope = buildMultiEnvelope({ [BAT_ID]: '', [ROOT_ID]: 'only root documented', [BAF_ID]: '' });
        const rewritten = rewriteKtdText(envelope, 'root rewritten');

        expect(decodeKtdText(rewritten)).toBe(`## ${ROOT_ID}\n\nroot rewritten`);
        expect(rewritten).toContain(`<sktd:id>${BAT_ID}</sktd:id><sktd:text></sktd:text>`);
        expect(rewritten).toContain(`<sktd:id>${BAF_ID}</sktd:id><sktd:text></sktd:text>`);
      });

      it('writes an unaddressed body to the root node when nothing is documented yet (fresh create)', () => {
        const envelope = buildMultiEnvelope({ [BAT_ID]: '', [ROOT_ID]: '', [BAF_ID]: '' });
        const rewritten = rewriteKtdText(envelope, 'first ever body');

        // Root is matched by id, not by document order — BAT_ID comes first here.
        expect(rewritten).toContain(`<sktd:id>${ROOT_ID}</sktd:id><sktd:text>${b64('first ever body')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:id>${BAT_ID}</sktd:id><sktd:text></sktd:text>`);
      });

      it('matches node ids case-insensitively and resolves to the envelope spelling (root is upper-cased on the wire)', () => {
        // Live shape: the root id is `ZI_TRAVELTP` while the object is spelled
        // `ZI_TravelTP` in every other id of the same envelope. A heading in the
        // second spelling used to be folded into the previous node's text — silently.
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'old root', [BAT_ID]: 'old bat' });
        const rewritten = rewriteKtdText(envelope, `## ${BAT_ID}\n\nnew bat\n\n## ZI_TravelTP\n\nnew root`);

        expect(rewritten).toContain(`<sktd:id>${ROOT_ID}</sktd:id><sktd:text>${b64('new root')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:id>${BAT_ID}</sktd:id><sktd:text>${b64('new bat')}</sktd:text>`);
        expect(rewritten).not.toContain(b64('new bat\n\n## ZI_TravelTP\n\nnew root'));
      });

      it('refuses a node addressed twice in one body', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        expect(() => rewriteKtdText(envelope, `## ${ROOT_ID}\n\nx\n\n## ${ROOT_ID}\n\ny`)).toThrow(/appears twice/);
      });

      it('refuses stray text before the first heading and names the node it would have joined', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        expect(() => rewriteKtdText(envelope, `stray\n\n## ${BAT_ID}\n\nx`)).toThrow(
          new RegExp(
            `before its first "## <node id>" heading[\\s\\S]*${BAT_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          ),
        );
      });

      it('refuses one unknown ADT-shaped heading even when another heading is valid (no partial write)', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        expect(() => rewriteKtdText(envelope, `## ${ROOT_ID}\n\nok\n\n## ${BAF_ID}\n\nnope`)).toThrow(
          /ReadTravelSummary[\s\S]*does not exist/,
        );
      });

      it('lists every unknown heading, not just the first', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root' });
        const other = BAF_ID.replace('ReadTravelSummary', 'GetPhoto');
        expect(() => rewriteKtdText(envelope, `## ${BAF_ID}\n\na\n\n## ${other}\n\nb`)).toThrow(
          /nodes[\s\S]*ReadTravelSummary[\s\S]*GetPhoto[\s\S]*do not exist/,
        );
      });

      it('refuses to write into an element that carries no <sktd:text> instead of inventing one', () => {
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZX">' +
          `<sktd:element><sktd:id>${ROOT_ID}</sktd:id><sktd:parent/></sktd:element>` +
          '</sktd:docu>';
        expect(() => rewriteKtdText(envelope, `## ${ROOT_ID}\n\nx`)).toThrow(/does not synthesize one/);
      });

      it('preserves a documented non-writable section on read-edit-write but refuses changing it', () => {
        const lockedId = `${BAT_ID}.LOCKED`;
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZI_TRAVELTP">' +
          `<sktd:element sktd:longTextObligation="optional"><sktd:id>${ROOT_ID}</sktd:id>` +
          `<sktd:text>${b64('root body')}</sktd:text></sktd:element>` +
          `<sktd:element sktd:longTextObligation="none" sktd:canHaveDocumentation="false">` +
          `<sktd:id>${lockedId}</sktd:id><sktd:text>${b64('server-owned body')}</sktd:text></sktd:element>` +
          '</sktd:docu>';
        const read = decodeKtdText(envelope);
        const editedRoot = read.replace('root body', 'updated root');

        const rewritten = rewriteKtdText(envelope, editedRoot);
        expect(rewritten).toContain(`<sktd:text>${b64('updated root')}</sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('server-owned body')}</sktd:text>`);
        expect(() => rewriteKtdText(envelope, read.replace('server-owned body', 'changed locked body'))).toThrow(
          /does not accept long-text/,
        );
      });

      it('heads a lone documented non-writable node when a different writable target is empty', () => {
        const lockedId = `${BAT_ID}.LOCKED`;
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZI_TRAVELTP">' +
          `<sktd:element sktd:longTextObligation="none"><sktd:id>${lockedId}</sktd:id>` +
          `<sktd:text>${b64('server-owned body')}</sktd:text></sktd:element>` +
          `<sktd:element sktd:longTextObligation="optional"><sktd:id>${ROOT_ID}</sktd:id><sktd:text/></sktd:element>` +
          '</sktd:docu>';

        expect(decodeKtdText(envelope)).toBe(`## ${lockedId}\n\nserver-owned body`);
        expect(formatKtdUndocumentedIndex(envelope)).toContain(`root: ${ROOT_ID}`);
      });

      it('refuses an empty body even on a single-node KTD (a bodyless update must not erase docs)', () => {
        expect(() => rewriteKtdText(buildEnvelope(b64('precious')), '')).toThrow(/empty body/);
        expect(() => rewriteKtdText(buildEnvelope(b64('precious')), '   \n\n')).toThrow(/empty body/);
      });

      it('clears one node when it is addressed explicitly with an empty section', () => {
        const envelope = buildMultiEnvelope({ [ROOT_ID]: 'root', [BAT_ID]: 'bat' });
        const rewritten = rewriteKtdText(envelope, `## ${BAT_ID}\n\n`);
        expect(rewritten).toContain(`<sktd:id>${BAT_ID}</sktd:id><sktd:text></sktd:text>`);
        expect(rewritten).toContain(`<sktd:text>${b64('root')}</sktd:text>`);
      });

      it('Markdown body is encoded, not interpolated as raw text (prevents XML injection via user input)', () => {
        const malicious = '</sktd:text><evil/>not-encoded';
        const rewritten = rewriteKtdText(buildEnvelope(''), malicious);
        expect(rewritten).not.toContain('<evil/>');
        expect(rewritten).not.toContain('not-encoded');
        // And the round-trip still gives the exact input back
        expect(decodeKtdText(rewritten)).toBe(malicious);
      });
    });

    describe('live envelope shape (S/4HANA PCE 2025.1 capture of ZI_TravelTP)', () => {
      // Three <sktd:element> blocks copied verbatim from the wire, exercising every
      // structural feature the simplified fixtures above do not have: element
      // attributes, line-wrapped Base64, <adtcore:objectReference>, <sktd:parent>,
      // the <sktd:shortText> ATTRIBUTE form, <atom:link>, and — for a node SAP has
      // created but nobody has documented — a self-closing <sktd:text/>.
      const HTML_FN_ID =
        '/sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main#type=BDEF/BAF;name=ZI_TravelTP.ReadTravelSummaryHTML';
      const FINALIZE_ID =
        '/sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main#type=BDEF/BSO;name=ZI_TRAVELTP.finalize';

      const liveEnvelope = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<sktd:docu adtcore:responsible="DEVELOPER" adtcore:masterLanguage="EN" adtcore:name="ZI_TRAVELTP" adtcore:type="SKTD/TYP" xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core">',
        '    <adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/ztravel" adtcore:type="DEVC/K" adtcore:name="ZTRAVEL" adtcore:description="Travel"/>',
        '    <sktd:refObject adtcore:uri="/sap/bc/adt/bo/behaviordefinitions/zi_traveltp" adtcore:type="BDEF/BDO" adtcore:name="ZI_TRAVELTP" adtcore:description="Interface for Travel"/>',
        '    <sktd:element sktd:canHaveDocumentation="true" sktd:notAssigned="false" sktd:longTextObligation="optional" sktd:displayName="finalize" sktd:collapseNode="false">',
        `        <sktd:id>${FINALIZE_ID}</sktd:id>`,
        '        <sktd:text>UkFQIHNhdmVyIGBGSU5BTElaRWAgc3RlcC4gRGV0ZXJtaW5hdGlvbnMtb24tc2F2ZSBydW4gaGVy',
        'ZSwgYmVmb3JlIHRoZSBjb25zaXN0ZW5jeSBjaGVjay4gVGhlIEJPIGlzIGV4dGVuc2libGUgZm9y',
        'IGRldGVybWluYXRpb25zIG9uIHNhdmUu</sktd:text>',
        '        <adtcore:objectReference adtcore:type="BDEF/BSO" adtcore:name="finalize" adtcore:description="Saver: FINALIZE — last determinations before save"/>',
        '        <sktd:parent>ZI_TRAVELTP</sktd:parent>',
        '        <sktd:shortText sktd:text="U2F2ZXI6IEZJTkFMSVpFIOKAlCBsYXN0IGRldGVybWluYXRpb25zIGJlZm9yZSBzYXZl" sktd:obligation="optional"/>',
        '        <atom:link href="/sap/bc/adt/repository/informationsystem/elementinfo?path=zi_traveltp.finalize&amp;type=bdef/bso" rel="http://www.sap.com/adt/relations/elementinfo" title="Show Element Information" xmlns:atom="http://www.w3.org/2005/Atom"/>',
        '    </sktd:element>',
        '    <sktd:element sktd:canHaveDocumentation="true" sktd:notAssigned="false" sktd:longTextObligation="mandatory" sktd:displayName="ReadTravelSummaryHTML" sktd:collapseNode="false">',
        `        <sktd:id>${HTML_FN_ID}</sktd:id>`,
        '        <sktd:text/>',
        '        <adtcore:objectReference adtcore:type="BDEF/BAF" adtcore:name="ReadTravelSummaryHTML"/>',
        '        <sktd:parent>/sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main#type=BDEF/BAE;name=ZI_TravelTP</sktd:parent>',
        '        <sktd:shortText sktd:text="" sktd:obligation="optional"/>',
        '        <atom:link href="/sap/bc/adt/repository/informationsystem/elementinfo?path=zi_traveltp.zi_traveltp.readtravelsummaryhtml&amp;type=bdef/baf" rel="http://www.sap.com/adt/relations/elementinfo" title="Show Element Information" xmlns:atom="http://www.w3.org/2005/Atom"/>',
        '    </sktd:element>',
        '    <sktd:instruction sktd:instructionId="shorttext" sktd:instructionText="Provide a meaningful short text with 60 characters max."/>',
        '</sktd:docu>',
      ].join('\n');

      it('decodes line-wrapped Base64 and hides nodes SAP created but nobody documented', () => {
        const decoded = decodeKtdText(liveEnvelope);
        expect(decoded).toContain('RAP saver `FINALIZE` step. Determinations-on-save run here');
        // One sibling is writable but empty, so the documented node keeps a routing heading.
        expect(decoded).toContain(`## ${FINALIZE_ID}`);
        expect(decoded).not.toContain('ReadTravelSummaryHTML');
      });

      it('fills a self-closing <sktd:text/> and leaves the rest of the document byte-identical', () => {
        const body = 'Function, `result [0..1] ZD_Base64`, `authorization : instance`.';
        const rewritten = rewriteKtdText(
          liveEnvelope,
          `## ${FINALIZE_ID}\n\nRAP saver \`FINALIZE\` step. Determinations-on-save run here, before the consistency check. The BO is extensible for determinations on save.\n\n## ${HTML_FN_ID}\n\n${body}`,
        );

        const encoded = Buffer.from(body, 'utf-8').toString('base64');
        expect(rewritten).toContain(`<sktd:text>${encoded}</sktd:text>`);
        expect(rewritten).not.toContain('<sktd:text/>');
        // The <sktd:shortText> ATTRIBUTE form must never be mistaken for the body.
        expect(rewritten).toContain('<sktd:shortText sktd:text="" sktd:obligation="optional"/>');
        expect(rewritten).toContain(
          '<sktd:shortText sktd:text="U2F2ZXI6IEZJTkFMSVpFIOKAlCBsYXN0IGRldGVybWluYXRpb25zIGJlZm9yZSBzYXZl" sktd:obligation="optional"/>',
        );
        // Element attributes, objectReference, parent, atom:link and the instruction all survive.
        expect(rewritten).toContain('sktd:longTextObligation="mandatory"');
        expect(rewritten).toContain('<sktd:parent>ZI_TRAVELTP</sktd:parent>');
        expect(rewritten).toContain('<sktd:instruction sktd:instructionId="shorttext"');
        expect(rewritten).toContain('adtcore:responsible="DEVELOPER"');
      });

      it('indexes the nodes SAP pre-created but nobody documented, grouped by base and type', () => {
        const index = formatKtdUndocumentedIndex(liveEnvelope);
        expect(index).toContain('Undocumented nodes: 1');
        expect(index).toContain('base: /sap/bc/adt/bo/behaviordefinitions/zi_traveltp/source/main');
        expect(index).toContain('BDEF/BAF (1): ZI_TravelTP.ReadTravelSummaryHTML');
        // The documented sibling is not an undocumented node.
        expect(index).not.toContain('finalize');
      });

      it('lists an undocumented root by its bare name and groups several types under one base', () => {
        const base = '/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main';
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
          '<sktd:element><sktd:id>ZBDEF</sktd:id><sktd:text/></sktd:element>' +
          `<sktd:element><sktd:id>${base}#type=BDEF/BAC;name=ZBDEF.SetPhoto</sktd:id><sktd:text/></sktd:element>` +
          `<sktd:element><sktd:id>${base}#type=BDEF/BAC;name=ZBDEF.DeletePhoto</sktd:id><sktd:text/></sktd:element>` +
          `<sktd:element><sktd:id>${base}#type=BDEF/BAF;name=ZBDEF.GetPhoto</sktd:id><sktd:text/></sktd:element>` +
          '</sktd:docu>';
        const index = formatKtdUndocumentedIndex(envelope);
        expect(index).toContain('Undocumented nodes: 4');
        expect(index).toContain('root: ZBDEF');
        expect(index).toContain(`base: ${base}`);
        expect(index).toContain('BDEF/BAC (2): ZBDEF.SetPhoto, ZBDEF.DeletePhoto');
        expect(index).toContain('BDEF/BAF (1): ZBDEF.GetPhoto');
      });

      it('indexes and writes only nodes Eclipse considers long-text-capable', () => {
        const base = '/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main';
        const blockedId = `${base}#type=BDEF/BSO;name=ZBDEF.blocked`;
        const obligationWinsId = `${base}#type=BDEF/BSO;name=ZBDEF.optional`;
        const forbiddenId = `${base}#type=BDEF/BSO;name=ZBDEF.forbidden`;
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
          `<sktd:element sktd:canHaveDocumentation="false"><sktd:id>${blockedId}</sktd:id><sktd:text/></sktd:element>` +
          `<sktd:element sktd:canHaveDocumentation="false" sktd:longTextObligation="optional"><sktd:id>${obligationWinsId}</sktd:id><sktd:text/></sktd:element>` +
          `<sktd:element sktd:canHaveDocumentation="true" sktd:longTextObligation="forbidden"><sktd:id>${forbiddenId}</sktd:id><sktd:text/></sktd:element>` +
          '</sktd:docu>';

        const index = formatKtdUndocumentedIndex(envelope);
        expect(index).toContain('Undocumented nodes: 1');
        expect(index).toContain('ZBDEF.optional');
        expect(index).not.toContain('ZBDEF.blocked');
        expect(index).not.toContain('ZBDEF.forbidden');
        expect(() => rewriteKtdText(envelope, `## ${blockedId}\n\nblocked`)).toThrow(/does not accept long-text/);
        expect(() => rewriteKtdText(envelope, `## ${forbiddenId}\n\nblocked`)).toThrow(/does not accept long-text/);
        expect(rewriteKtdText(envelope, `## ${obligationWinsId}\n\nallowed`)).toContain(
          `<sktd:text>${Buffer.from('allowed').toString('base64')}</sktd:text>`,
        );
      });

      it('returns an empty index when every node carries text', () => {
        const envelope =
          '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd">' +
          `<sktd:element><sktd:id>ZX</sktd:id><sktd:text>${Buffer.from('docs').toString('base64')}</sktd:text></sktd:element>` +
          '</sktd:docu>';
        expect(formatKtdUndocumentedIndex(envelope)).toBe('');
      });

      it('writes one undocumented node without touching the documented sibling', () => {
        const rewritten = rewriteKtdText(liveEnvelope, `## ${HTML_FN_ID}\n\nHTML variant.`);

        // The finalize body keeps SAP's original line-wrapped Base64, untouched.
        expect(rewritten).toContain('UkFQIHNhdmVyIGBGSU5BTElaRWAgc3RlcC4gRGV0ZXJtaW5hdGlvbnMtb24tc2F2ZSBydW4gaGVy');
        expect(rewritten).toContain(
          `<sktd:text>${Buffer.from('HTML variant.', 'utf-8').toString('base64')}</sktd:text>`,
        );
        // And both nodes now read back as addressable sections.
        const decoded = decodeKtdText(rewritten);
        expect(decoded).toContain(`## ${FINALIZE_ID}`);
        expect(decoded).toContain(`## ${HTML_FN_ID}`);
        expect(decoded).toContain('HTML variant.');
      });
    });
  });
});

describe('buildTableTypeXml / parseTableType (FEAT-65)', () => {
  it('built-in row → predefinedAbapType + builtInType.dataType, children in XSD order', () => {
    const xml = buildTableTypeXml({ name: 'ZARC1_TT', description: 'x', package: '$TMP', rowType: 'string' });
    expect(xml).toContain('adtcore:type="TTYP/DA"');
    expect(xml).toContain('<ttyp:typeKind>predefinedAbapType</ttyp:typeKind>');
    expect(xml).toContain('<ttyp:dataType>STRING</ttyp:dataType>'); // upper-cased
    // typeKind → typeName → builtInType → rangeType order (XSD-required, live-verified)
    expect(xml.indexOf('typeKind')).toBeLessThan(xml.indexOf('typeName'));
    expect(xml.indexOf('typeName')).toBeLessThan(xml.indexOf('builtInType'));
    expect(xml.indexOf('builtInType')).toBeLessThan(xml.indexOf('rangeType'));
    expect(xml).toContain('<ttyp:accessType>standard</ttyp:accessType>');
  });

  it('structure row → dictionaryType + typeName + dataType=STRU', () => {
    const xml = buildTableTypeXml({ name: 'ZARC1_TT', description: 'x', package: '$TMP', rowType: 'BAPIRET2' });
    expect(xml).toContain('<ttyp:typeKind>dictionaryType</ttyp:typeKind>');
    expect(xml).toContain('<ttyp:typeName>BAPIRET2</ttyp:typeName>');
    expect(xml).toContain('<ttyp:dataType>STRU</ttyp:dataType>');
  });

  it('explicit rowTypeKind overrides the auto-detect', () => {
    // "STRING" is a known built-in, but forcing structure mode emits dictionaryType.
    const xml = buildTableTypeXml({
      name: 'ZARC1_TT',
      description: 'x',
      package: '$TMP',
      rowType: 'ZMY_STRUCT',
      rowTypeKind: 'structure',
    });
    expect(xml).toContain('dictionaryType');
    expect(xml).toContain('<ttyp:typeName>ZMY_STRUCT</ttyp:typeName>');
  });

  it('responsible is upper-cased; package/description flow through', () => {
    const xml = buildTableTypeXml({
      name: 'ZARC1_TT',
      description: 'My desc',
      package: 'ZPKG',
      rowType: 'I',
      responsible: 'marian',
    });
    expect(xml).toContain('adtcore:responsible="MARIAN"');
    expect(xml).toContain('adtcore:name="ZPKG"'); // packageRef
    expect(xml).toContain('adtcore:description="My desc"');
  });

  it('uses the configured SAP language as the TTYP master language', () => {
    const xml = buildTableTypeXml({
      name: 'ZARC1_TT',
      description: 'My desc',
      package: '$TMP',
      rowType: 'STRING',
      language: 'de',
    });
    expect(xml).toContain('adtcore:masterLanguage="DE"');
  });

  it('rejects garbage rowType before emitting TTYP XML', () => {
    expect(() =>
      buildTableTypeXml({ name: 'ZARC1_TT', description: 'x', package: '$TMP', rowType: 'not a type!' }),
    ).toThrow(/Invalid TTYP rowType/);
  });

  it('auto-detects UTCLONG as a built-in row type (list kept current)', () => {
    const xml = buildTableTypeXml({ name: 'ZARC1_TT', description: 'x', package: '$TMP', rowType: 'UTCLONG' });
    expect(xml).toContain('<ttyp:typeKind>predefinedAbapType</ttyp:typeKind>');
    expect(xml).toContain('<ttyp:dataType>UTCLONG</ttyp:dataType>');
  });

  it('trusts an explicit rowTypeKind="builtin" even for a type not in the heuristic list', () => {
    // SAP adds built-ins over releases (UTCLONG in 7.54, more later); an incomplete allow-list must
    // NOT reject a valid explicit built-in (regression: UTCLONG+builtin used to throw). SAP validates.
    const xml = buildTableTypeXml({
      name: 'ZARC1_TT',
      description: 'x',
      package: '$TMP',
      rowType: 'SOMEFUTURETYPE',
      rowTypeKind: 'builtin',
    });
    expect(xml).toContain('<ttyp:typeKind>predefinedAbapType</ttyp:typeKind>');
    expect(xml).toContain('<ttyp:dataType>SOMEFUTURETYPE</ttyp:dataType>');
  });

  it('still rejects rowTypeKind="structure" for a built-in row type name', () => {
    expect(() =>
      buildTableTypeXml({
        name: 'ZARC1_TT',
        description: 'x',
        package: '$TMP',
        rowType: 'STRING',
        rowTypeKind: 'structure',
      }),
    ).toThrow(/is a built-in ABAP row type/);
  });

  it('parseTableType extracts row type + access from the REAL captured STRINGTAB response', () => {
    const fixture = readFileSync(join(import.meta.dirname, '../../fixtures/xml/tabletype-stringtab.xml'), 'utf-8');
    const info = parseTableType(fixture);
    expect(info.name).toBe('STRINGTAB');
    expect(info.rowTypeKind).toBe('predefinedAbapType');
    expect(info.rowType).toBe('STRING'); // built-in dataType (no typeName)
    expect(info.accessType).toBe('standard');
  });

  it('parseTableType throws cleanly for non-table-type XML', () => {
    expect(() => parseTableType('<html><body>not a table type</body></html>')).toThrow(
      /Invalid TTYP response: expected <ttyp:tableType>/,
    );
  });

  it('parseTableType throws cleanly when the rowType node is missing', () => {
    expect(() =>
      parseTableType(
        '<ttyp:tableType xmlns:ttyp="http://www.sap.com/dictionary/tabletype" adtcore:name="ZBAD" xmlns:adtcore="http://www.sap.com/adt/core"/>',
      ),
    ).toThrow(/Invalid TTYP response: missing <ttyp:rowType>/);
  });

  it('parseTableType returns an unlisted row type kind verbatim (reads stay permissive)', () => {
    // A read must NOT hard-fail on a typeKind ARC-1 hasn't enumerated — only on structurally broken
    // XML. 264 real table types across a4h 758+816 used 4 kinds; newer releases may add more.
    const xml =
      '<ttyp:tableType xmlns:ttyp="http://www.sap.com/dictionary/tabletype" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZWEIRD" adtcore:type="TTYP/DA">' +
      '<ttyp:rowType><ttyp:typeKind>someFutureKind</ttyp:typeKind><ttyp:typeName>ZSOMETHING</ttyp:typeName></ttyp:rowType>' +
      '</ttyp:tableType>';
    const info = parseTableType(xml);
    expect(info.rowTypeKind).toBe('someFutureKind');
    expect(info.rowType).toBe('ZSOMETHING');
  });
});
