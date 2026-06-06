import { describe, expect, it } from 'vitest';
import { classifyToolErrorSkip } from '../../e2e/helpers.js';

describe('E2E helper skip classification', () => {
  it.each([
    [
      'DDIC table UNLOCK',
      'ADT API error: status 400 at /sap/bc/adt/ddic/tables/ZTABINFPWSSEOCBK?_action=UNLOCK&lockHandle=ABC123: Service cannot be reached',
    ],
    [
      'package LOCK',
      'ADT API error: status 400 at /sap/bc/adt/packages/%24ARC1T_INSMNJCNKZELA?_action=LOCK&accessMode=MODIFY: Service cannot be reached',
    ],
    [
      'message class LOCK',
      'ADT API error: status 400 at /sap/bc/adt/messageclass/ZARC1MCINSMNJJSVBMUT?_action=LOCK&accessMode=MODIFY: Service cannot be reached',
    ],
    [
      'program UNLOCK',
      'ADT API error: status 400 at /sap/bc/adt/programs/programs/ZARC1_E2E_WRITE?_action=UNLOCK&lockHandle=ABC123: Service cannot be reached',
    ],
    [
      'DDLS UNLOCK',
      'ADT API error: status 400 at /sap/bc/adt/ddic/ddl/sources/ZARC1SKTDMQ265IXA171U?_action=UNLOCK&lockHandle=ABC123: Service cannot be reached',
    ],
  ])('classifies %s service-unreachable session flake as skippable', (_label, text) => {
    const result = {
      isError: true,
      content: [
        {
          type: 'text',
          text,
        },
      ],
    };

    const reason = classifyToolErrorSkip(result);
    expect(reason).toContain('ADT lock/unlock endpoint intermittently unreachable');
  });

  it('does not classify unrelated unlock errors as skippable', () => {
    const result = {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'ADT API error: status 400 at /sap/bc/adt/packages/ZPKG?_action=UNLOCK&lockHandle=ABC123: Authorization failed',
        },
      ],
    };

    expect(classifyToolErrorSkip(result)).toBeNull();
  });

  it('does not classify non-session service-unreachable errors as skippable', () => {
    const result = {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'ADT API error: status 400 at /sap/bc/adt/programs/programs/ZFOO/source/main: Service cannot be reached',
        },
      ],
    };

    expect(classifyToolErrorSkip(result)).toBeNull();
  });
});
