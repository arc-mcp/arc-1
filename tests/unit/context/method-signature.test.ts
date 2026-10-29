import { Version } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import { extractOwnMethodSignature } from '../../../src/context/method-signature.js';

const definition = (body: string) => `CLASS zcl_demo DEFINITION PUBLIC ABSTRACT.
PUBLIC SECTION.
${body}
ENDCLASS.`;

describe('own MAIN method declarations', () => {
  it.each([Version.Cloud, Version.v750, Version.v758])(
    'keeps multiline parameters and exceptions with %s',
    (version) => {
      const signature = `CLASS-METHODS create
  IMPORTING url TYPE string DEFAULT 'a.b'
  RETURNING VALUE(result) TYPE REF TO zcl_demo
  RAISING cx_root.`;
      const result = extractOwnMethodSignature(definition(signature), 'ZCL_DEMO', 'CREATE', version);
      expect(result).toMatchObject({
        success: true,
        methodName: 'create',
        visibility: 'public',
        signature,
        startLine: 3,
        endLine: 6,
      });
    },
  );

  it('does not mistake a parameter name for the REDEFINITION addition', () => {
    expect(
      extractOwnMethodSignature(definition('METHODS execute IMPORTING redefinition TYPE i.'), 'ZCL_DEMO', 'execute'),
    ).toMatchObject({ success: true, signature: 'METHODS execute IMPORTING redefinition TYPE i.' });
  });

  it('reads an abstract declaration without an implementation', () => {
    expect(
      extractOwnMethodSignature(
        definition('METHODS execute ABSTRACT RETURNING VALUE(result) TYPE i.'),
        'ZCL_DEMO',
        'execute',
      ),
    ).toMatchObject({ success: true, signature: 'METHODS execute ABSTRACT RETURNING VALUE(result) TYPE i.' });
  });

  it('keeps protected/private visibility and ignores same-named local declarations', () => {
    const local = 'CLASS lcl_helper DEFINITION. PUBLIC SECTION. METHODS execute IMPORTING wrong TYPE i. ENDCLASS.';
    const source = `${local}\n${definition('PROTECTED SECTION. METHODS execute IMPORTING correct TYPE string.\nPRIVATE SECTION. METHODS hidden.')}\n${local}`;
    expect(extractOwnMethodSignature(source, 'ZCL_DEMO', 'execute')).toMatchObject({
      success: true,
      visibility: 'protected',
      signature: 'METHODS execute IMPORTING correct TYPE string.',
    });
    expect(extractOwnMethodSignature(source, 'ZCL_DEMO', 'hidden')).toMatchObject({
      success: true,
      visibility: 'private',
    });
  });

  it.each(['METHODS', 'CLASS-METHODS'])('extracts just one chained %s declaration', (keyword) => {
    const source = definition(`${keyword}: first IMPORTING x TYPE i,
 second IMPORTING text TYPE string " keep this comment
 DEFAULT 'a,b.c', third.`);
    const result = extractOwnMethodSignature(source, 'ZCL_DEMO', 'second');
    expect(result).toMatchObject({
      success: true,
      signature: `${keyword} second IMPORTING text TYPE string " keep this comment
 DEFAULT 'a,b.c'.`,
    });
    if (result.success) expect(result.signature).not.toMatch(/first|third/);
  });

  it('supports CRLF and declarations sharing a line', () => {
    const source = definition('METHODS first. METHODS second IMPORTING val TYPE string.').replace(/\n/g, '\r\n');
    expect(extractOwnMethodSignature(source, 'ZCL_DEMO', 'second')).toMatchObject({
      success: true,
      signature: 'METHODS second IMPORTING val TYPE string.',
    });
  });

  it('accepts a forward declaration but refuses duplicate actual global definitions', () => {
    const source = definition('METHODS execute.');
    expect(
      extractOwnMethodSignature(`CLASS zcl_demo DEFINITION DEFERRED.\n${source}`, 'ZCL_DEMO', 'execute').success,
    ).toBe(true);
    expect(extractOwnMethodSignature(`${source}\n${source}`, 'ZCL_DEMO', 'execute').success).toBe(false);
  });

  it('does not infer an interface declaration from an implementation or alias', () => {
    const source = `${definition('INTERFACES if_http_client. ALIASES transmit FOR if_http_client~send.')}
CLASS zcl_demo IMPLEMENTATION. METHOD if_http_client~send. ENDMETHOD. ENDCLASS.`;
    for (const method of ['send', 'if_http_client~send', 'transmit']) {
      const result = extractOwnMethodSignature(source, 'ZCL_DEMO', method);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('type=INTF for interface declarations: if_http_client');
    }
  });

  it('refuses REDEFINITION and directs the caller to the superclass', () => {
    const source =
      'CLASS zcl_demo DEFINITION INHERITING FROM cl_base. PUBLIC SECTION. METHODS execute REDEFINITION. ENDCLASS.';
    const result = extractOwnMethodSignature(source, 'ZCL_DEMO', 'execute');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Read superclass cl_base');
  });

  it.each([
    'CLASS zcl_demo IMPLEMENTATION. METHOD execute. ENDMETHOD. ENDCLASS.',
    definition('METHODS execute. UNKNOWN FUTURE SYNTAX.'),
    definition('METHODS execute.').replace('ENDCLASS.', ''),
    definition('METHODS execute. METHODS execute.'),
    definition('METHODS execute.').replace('zcl_demo', 'lcl_other'),
    definition('METHODS execute.').replace('METHODS execute.', 'METHODS execute NEW_UNKNOWN_ADDITION.'),
    '" CLASS zcl_demo DEFINITION. METHODS execute. ENDCLASS.',
  ])('fails closed for missing/ambiguous/unparseable declarations: %s', (source) => {
    expect(extractOwnMethodSignature(source, 'ZCL_DEMO', 'execute').success).toBe(false);
  });

  it('does not depend on parsing unsupported implementation syntax', () => {
    const source = `${definition('METHODS execute.')}\nCLASS zcl_demo IMPLEMENTATION. METHOD execute. NEW_SYNTAX foo. ENDMETHOD. ENDCLASS.`;
    expect(extractOwnMethodSignature(source, 'ZCL_DEMO', 'execute').success).toBe(true);
  });
});
