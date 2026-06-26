import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDataElementXml,
  buildDomainXml,
  buildMessageClassXml,
  buildPackageXml,
  buildServiceBindingXml,
  buildTableTypeXml,
  decodeKtdText,
  normalizeAdtResponsible,
  normalizeSrvbBindingType,
  parseTableType,
  rewriteKtdText,
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
  // responsible" must name a real user on the target system. The legacy hard-coded
  // "DEVELOPER" only exists on SAP demo systems — on a real system the create fails
  // with HTTP 400 [?/049] "Enter a valid user, not DEVELOPER, as the person
  // responsible". ARC-1 threads the connection's logon user (config.username) instead.
  describe('person responsible (adtcore:responsible)', () => {
    it('buildPackageXml emits the configured responsible', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd', responsible: 'SRAHEMI' });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('buildPackageXml defaults responsible to DEVELOPER when unset', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd' });
      expect(xml).toContain('adtcore:responsible="DEVELOPER"');
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

    it('defaults responsible to DEVELOPER across DDIC builders when unset', () => {
      expect(buildDomainXml({ name: 'ZD', description: 'd', package: '$TMP', dataType: 'CHAR', length: 1 })).toContain(
        'adtcore:responsible="DEVELOPER"',
      );
      expect(buildDataElementXml({ name: 'ZE', description: 'd', package: '$TMP' })).toContain(
        'adtcore:responsible="DEVELOPER"',
      );
      expect(
        buildServiceBindingXml({ name: 'ZSB', description: 'd', package: '$TMP', serviceDefinition: 'ZSD' }),
      ).toContain('adtcore:responsible="DEVELOPER"');
    });

    it('upper-cases a lower-case responsible', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd', responsible: 'srahemi' });
      expect(xml).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('treats a blank responsible as the DEVELOPER default', () => {
      const xml = buildPackageXml({ name: 'ZTEST', description: 'd', responsible: '   ' });
      expect(xml).toContain('adtcore:responsible="DEVELOPER"');
    });

    it('normalizeAdtResponsible trims + upper-cases and defaults to DEVELOPER', () => {
      expect(normalizeAdtResponsible('  srahemi ')).toBe('SRAHEMI');
      expect(normalizeAdtResponsible()).toBe('DEVELOPER');
      expect(normalizeAdtResponsible('   ')).toBe('DEVELOPER');
    });

    it('normalizeAdtResponsible keeps email-style cloud users case-sensitive (BTP)', () => {
      // Classic SAP users are upper-case; cloud (BTP) users are case-sensitive emails — never upper-case them.
      expect(normalizeAdtResponsible('marian@zeis.de')).toBe('marian@zeis.de');
      expect(normalizeAdtResponsible('  Marian@Zeis.de ')).toBe('Marian@Zeis.de');
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

      it('Markdown body is encoded, not interpolated as raw text (prevents XML injection via user input)', () => {
        const malicious = '</sktd:text><evil/>not-encoded';
        const rewritten = rewriteKtdText(buildEnvelope(''), malicious);
        expect(rewritten).not.toContain('<evil/>');
        expect(rewritten).not.toContain('not-encoded');
        // And the round-trip still gives the exact input back
        expect(decodeKtdText(rewritten)).toBe(malicious);
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
