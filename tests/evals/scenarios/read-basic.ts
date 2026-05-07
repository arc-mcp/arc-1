/**
 * Read scenarios — SAPRead type selection for common ABAP object types.
 *
 * Covers: PROG, CLAS (+ method + testclasses), INTF, FUNC, DDLS, TABL (covers
 * both transparent tables AND DDIC structures), DOMA, TABLE_CONTENTS. These are
 * the single-step "read X" cases where the LLM must pick the right `type` enum
 * and supply the name.
 */

import type { EvalScenario } from '../types.js';

export const SCENARIOS: EvalScenario[] = [
  {
    id: 'read-program',
    description: 'Read an ABAP program by name',
    prompt: 'Read the source code of ABAP program ZHELLO_WORLD',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'PROG', name: 'ZHELLO_WORLD' } }],
    acceptable: [{ tool: 'SAPSearch', requiredArgs: { query: 'ZHELLO_WORLD' } }],
    mockResponses: {
      SAPRead: "REPORT zhello_world.\nWRITE: / 'Hello World'.",
      SAPSearch: JSON.stringify([
        { objectType: 'PROG/P', objectName: 'ZHELLO_WORLD', packageName: '$TMP', description: 'Hello World' },
      ]),
    },
  },

  {
    id: 'read-class',
    description: 'Read a class source code',
    prompt: 'Show me the source code of class ZCL_ORDER_SERVICE',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'CLAS', name: 'ZCL_ORDER_SERVICE' } }],
    forbidden: ['SAPWrite', 'SAPActivate'],
    mockResponses: {
      SAPRead:
        'CLASS zcl_order_service DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS get_order IMPORTING iv_id TYPE string.\nENDCLASS.',
    },
  },

  {
    id: 'read-interface',
    description: 'Read an interface definition',
    prompt: 'Read the interface ZIF_ORDER_REPOSITORY',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'INTF', name: 'ZIF_ORDER_REPOSITORY' } }],
    mockResponses: {
      SAPRead:
        'INTERFACE zif_order_repository PUBLIC.\n  METHODS find_by_id IMPORTING iv_id TYPE string RETURNING VALUE(rs_order) TYPE zorder.\nENDINTERFACE.',
    },
  },

  {
    id: 'read-function-module',
    description: 'Read a function module',
    prompt: 'Read the function module Z_GET_CUSTOMER_DATA',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'FUNC', name: 'Z_GET_CUSTOMER_DATA' } }],
    mockResponses: {
      SAPRead:
        'FUNCTION z_get_customer_data.\n*" IMPORTING iv_customer_id TYPE kunnr\n*" EXPORTING es_customer TYPE kna1\n  SELECT SINGLE * FROM kna1 INTO es_customer WHERE kunnr = iv_customer_id.\nENDFUNCTION.',
    },
  },

  {
    id: 'read-cds-view',
    description: 'Read a CDS view definition',
    prompt: 'Show me the CDS view ZI_SALESORDER',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'DDLS', name: 'ZI_SALESORDER' } }],
    mockResponses: {
      SAPRead:
        "@AbapCatalog.sqlViewName: 'ZISALESORDER'\ndefine view ZI_SALESORDER as select from vbak {\n  key vbeln,\n  erdat,\n  erzet,\n  ernam\n}",
    },
  },

  {
    id: 'read-table-structure',
    description: 'Read a DDIC structure definition',
    prompt: 'What are the fields of structure BAPIRET2?',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'TABL', name: 'BAPIRET2' } }],
    mockResponses: {
      SAPRead:
        'define structure bapiret2 {\n  type : symsgty;\n  id : symsgid;\n  number : symsgno;\n  message : bapi_msg;\n}',
    },
  },

  {
    id: 'read-domain',
    description: 'Read a DDIC domain definition',
    prompt: 'Show me the domain BUKRS and its properties',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'DOMA', name: 'BUKRS' } }],
    mockResponses: {
      SAPRead: JSON.stringify({
        name: 'BUKRS',
        dataType: 'CHAR',
        length: 4,
        description: 'Company Code',
        valueTable: 'T001',
      }),
    },
  },

  {
    id: 'read-table-contents',
    description: 'Read data from an SAP table',
    prompt: 'Show me the contents of table T001 with a maximum of 10 rows',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [
      { tool: 'SAPRead', requiredArgs: { type: 'TABLE_CONTENTS', name: 'T001' }, requiredArgKeys: ['maxRows'] },
    ],
    acceptable: [{ tool: 'SAPQuery', requiredArgKeys: ['sql'] }],
    mockResponses: {
      SAPRead: JSON.stringify({
        columns: ['MANDT', 'BUKRS', 'BUTXT'],
        rows: [{ MANDT: '100', BUKRS: '1000', BUTXT: 'Company 1000' }],
      }),
      SAPQuery: JSON.stringify({
        columns: ['MANDT', 'BUKRS', 'BUTXT'],
        rows: [{ MANDT: '100', BUKRS: '1000', BUTXT: 'Company 1000' }],
      }),
    },
  },

  {
    id: 'read-class-method',
    description: 'Read a single method from a class (efficient)',
    prompt: 'Read just the method get_name from class ZCL_CUSTOMER',
    category: 'read',
    tags: ['single-step', 'efficiency'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'CLAS', name: 'ZCL_CUSTOMER', method: 'get_name' } }],
    acceptable: [{ tool: 'SAPRead', requiredArgs: { type: 'CLAS', name: 'ZCL_CUSTOMER' } }],
    mockResponses: {
      SAPRead: 'METHOD get_name.\n  rv_name = me->name.\nENDMETHOD.',
    },
  },

  {
    id: 'read-class-unit-tests',
    description: 'Read the unit test classes of an ABAP class',
    prompt: 'Show me the ABAP unit test code for class ZCL_ORDER',
    category: 'read',
    tags: ['single-step', 'basic'],
    optimal: [{ tool: 'SAPRead', requiredArgs: { type: 'CLAS', name: 'ZCL_ORDER', include: 'testclasses' } }],
    acceptable: [{ tool: 'SAPRead', requiredArgs: { type: 'CLAS', name: 'ZCL_ORDER' } }],
    mockResponses: {
      SAPRead:
        'CLASS ltcl_order DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.\n  PRIVATE SECTION.\n    METHODS test_create FOR TESTING.\nENDCLASS.',
    },
  },
];
