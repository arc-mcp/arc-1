import { describe, expect, it } from 'vitest';
import { parseTransportLocks } from '../../../src/adt/transport-locks.js';
import { parseXml } from '../../../src/adt/xml-parser.js';

describe('CTS lock holder evidence', () => {
  it('preserves the first displayed request and task document order while flagging ambiguity', () => {
    const holder = (request: string, task: string, user: string) =>
      `<CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>${request}</TRKORR><AS4USER>${user}</AS4USER></REQ_HEADER><TASK_HEADERS><CTS_TASK_HEADER><TRKORR>${task}</TRKORR></CTS_TASK_HEADER></TASK_HEADERS></LOCK_HOLDER></CTS_OBJECT_LOCK>`;
    const result = parseTransportLocks(
      parseXml(
        `<DATA><LOCKS>${holder('A4HK900001', 'A4HK900002', 'FIRST')}${holder('A4HK900003', 'A4HK900004', 'SECOND')}</LOCKS></DATA>`,
      ),
    );
    expect(result).toEqual({
      lockedTransport: 'A4HK900001',
      lockedTransportOwner: 'FIRST',
      lockedTasks: ['A4HK900002', 'A4HK900004'],
      lockedTransportAmbiguous: true,
    });
  });
});
