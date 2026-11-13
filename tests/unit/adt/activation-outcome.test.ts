import { describe, expect, it } from 'vitest';
import { ACTIVATION_NOT_EXECUTED, parseActivationOutcome } from '../../../src/adt/devtools.js';

const xml = (inner: string) =>
  `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">${inner}</chkl:messages>`;
const prompt =
  '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object><ioc:ref adtcore:uri="/sap/bc/adt/programs/programs/ztest" adtcore:name="ZTEST"/></ioc:object></ioc:entry></ioc:inactiveObjects>';

describe('activationExecuted in activation responses', () => {
  it('surfaces an explicit "false" as a non-failing warning', () => {
    expect(parseActivationOutcome(xml('<chkl:properties activationExecuted="false"/>'))).toEqual({
      kind: 'success',
      messages: [ACTIVATION_NOT_EXECUTED],
      details: [{ severity: 'warning', text: ACTIVATION_NOT_EXECUTED }],
      notExecuted: true,
    });
  });

  it('leaves "true", an omitted flag (legacy), preaudit prompts and errors unchanged', () => {
    for (const flag of ['activationExecuted="true"', 'checkExecuted="true"'])
      expect(parseActivationOutcome(xml(`<chkl:properties ${flag}/>`))).toEqual({
        kind: 'success',
        messages: [],
        details: [],
      });
    expect(parseActivationOutcome(prompt).kind).toBe('preaudit');
    const error = parseActivationOutcome(
      xml('<msg type="E" shortText="x"/><chkl:properties activationExecuted="false"/>'),
    );
    expect(error.kind).toBe('error');
    expect(error.messages).not.toContain(ACTIVATION_NOT_EXECUTED);
  });
});
