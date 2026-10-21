/** Synthetic tool-selection contracts; no SAP connection or model score is implied. */
import type { EvalScenario, ExpectedToolCall } from '../types.js';
import { storedTextFixtureExecutor } from './stored-text.js';

const logNumber = '00000000000000000001';
function readCall(offset?: number): ExpectedToolCall {
  return {
    tool: 'SAPQuery',
    requiredArgs: { action: 'application_log' },
    absentArgPaths: [['sql'], ['maxRows'], ['longText']],
    exactArgs: { applicationLog: { logNumber, ...(offset === undefined ? {} : { maxRows: 1, offset }) } },
  };
}
const denied = JSON.stringify({ error: 'HTTP 403: S_APPL_LOG authorization denied. No fallback is available.' });
const base = { status: 'ok', logNumber, snapshotGuaranteed: false };
const scenarios: Omit<EvalScenario, 'category'>[] = [
  {
    id: 'application-log-exact-number',
    description: 'Read saved SLG1 messages using the exact supplied log number.',
    prompt: `Read saved SLG1 application log ${logNumber} and summarize its messages.`,
    optimal: [readCall()],
    expectedTrace: [[readCall()]],
    mockResponses: {
      SAPQuery: JSON.stringify({ ...base, messages: [{ text: 'Invoice validation failed', type: 'E' }], more: false }),
    },
    finalAnswer: { required: [/Invoice validation failed/i], requireNonEmpty: true },
  },
  {
    id: 'application-log-ask-for-number',
    description: 'Ask for the exact log number instead of inventing a key or using SQL discovery.',
    prompt: 'Show the SLG1 application log for my failed invoice. I do not have its log number.',
    optimal: [],
    noFirstCall: true,
    expectedTrace: [],
    finalAnswer: { required: [/log number|logNumber/i, /provide|share|which|please/i], requireNonEmpty: true },
  },
  {
    id: 'application-log-authorization-no-fallback',
    description: 'Preserve native authorization denial without querying storage or executing helpers.',
    prompt: `Read SLG1 log ${logNumber}. If access fails, explain what is needed.`,
    optimal: [readCall()],
    expectedTrace: [[readCall()]],
    mockResponses: { SAPQuery: denied },
    finalAnswer: {
      required: [/403|denied|authorization/i, /permission|S_APPL_LOG|authorization/i],
      forbidden: [/retrieved|messages show/i],
      requireNonEmpty: true,
    },
  },
  {
    id: 'application-log-next-offset',
    description: 'Continue the exact log using the returned nextOffset and preserve page size.',
    prompt: `Read two pages of SLG1 log ${logNumber}, one message per page, then summarize both messages.`,
    optimal: [readCall(0)],
    expectedTrace: [[readCall(0)], [readCall(1)]],
    maxToolCalls: 3,
    mockToolExecutor: async (tool, args) => {
      if (tool !== 'SAPQuery' || args.action !== 'application_log') return denied;
      const offset = (args.applicationLog as { offset?: number } | undefined)?.offset ?? 0;
      return JSON.stringify({
        ...base,
        offset,
        messages: [{ text: offset === 0 ? 'Validation started' : 'Invoice validation failed' }],
        more: offset === 0,
        ...(offset === 0 ? { nextOffset: 1 } : {}),
      });
    },
    finalAnswer: { required: [/Validation started/i, /Invoice validation failed/i], requireNonEmpty: true },
  },
  {
    id: 'application-log-empty-visible',
    description: 'An accessible saved log with no messages is an empty visible log.',
    prompt: `Read SLG1 log ${logNumber} and explain whether it exists and contains messages.`,
    optimal: [readCall()],
    mockResponses: { SAPQuery: JSON.stringify({ ...base, offset: 0, messages: [], more: false }) },
    finalAnswer: {
      required: [/visible|accessible|exists/i, /no messages|empty/i],
      forbidden: [/does not exist|not_found_or_not_visible/i, /\bnot (?:visible|accessible|found)\b/i],
      requireNonEmpty: true,
    },
  },
  {
    id: 'application-log-not-visible',
    description: 'No visible overview match does not establish that the saved log is absent.',
    prompt: `Read SLG1 log ${logNumber} and explain whether it exists and contains messages.`,
    optimal: [readCall()],
    mockResponses: {
      SAPQuery: JSON.stringify({
        status: 'not_found_or_not_visible',
        logNumber,
        message: 'No visible saved log for this number. This does not prove that the log does not exist.',
      }),
    },
    finalAnswer: {
      required: [/not found or not visible|not_found_or_not_visible/i, /cannot|does not prove|unknown/i],
      forbidden: [
        /log is empty|log contains no messages/i,
        /(?<!prove that (?:the )?)\blog (?:does not|doesn't) exist\b/i,
      ],
      requireNonEmpty: true,
    },
  },
  {
    id: 'application-log-offset-ceiling',
    description: 'At offset 5000, limitReached without nextOffset means an incomplete read and no continuation.',
    prompt: `Read one message from SLG1 log ${logNumber} at offset 5000, continue if supported, and report completeness.`,
    optimal: [readCall(5000)],
    mockResponses: {
      SAPQuery: JSON.stringify({
        ...base,
        offset: 5000,
        messages: [{ number: '005001', text: 'Validation still running', type: 'I' }],
        more: true,
        limitReached: true,
      }),
    },
    finalAnswer: {
      required: [/Validation still running/i, /incomplete|partial/i, /limit|ceiling/i],
      forbidden: [
        /\ball messages (?:have been|were) (?:read|retrieved)|\blog (?:is|was) complete\b/i,
        /\bnot incomplete\b|\ball messages (?:are|were) (?:shown|returned|read)\b/i,
      ],
      requireNonEmpty: true,
    },
  },
  {
    id: 'application-log-detail-flags',
    description: 'Availability flags do not load bodies; a six-digit row number is not a T100 message identity.',
    prompt: `Read SLG1 log ${logNumber}. Include its message, long text and details if available, and explain the message number.`,
    optimal: [readCall()],
    mockResponses: {
      SAPQuery: JSON.stringify({
        ...base,
        offset: 0,
        messages: [
          { number: '000001', text: 'Invoice validation failed', type: 'E', hasLongText: true, hasDetails: true },
        ],
        more: false,
      }),
    },
    finalAnswer: {
      required: [
        /Invoice validation failed/i,
        /long text/i,
        /details/i,
        /not (?:loaded|returned|retrieved)/i,
        /row|sequence/i,
        /T100/i,
      ],
      forbidden: [
        /long text (?:says|reads)|details (?:say|contain)|T100 message (?:ID|number) (?:is )?000001/i,
        /\bis (?:the|its) T100 (?:message )?(?:id|number)\b/i,
      ],
      requireNonEmpty: true,
    },
  },
  {
    id: 'application-log-so10-distinction',
    description: 'A saved SO10 standard text uses long_text rather than the application log action.',
    prompt:
      'Read the SO10 standard text TEXT/Z_PAYMENT_NOTICE/ST/E. This is a stored text, not an SLG1 application log.',
    optimal: [
      {
        tool: 'SAPQuery',
        requiredArgs: { action: 'long_text' },
        exactArgs: {
          longText: { mode: 'read', keys: [{ object: 'TEXT', name: 'Z_PAYMENT_NOTICE', id: 'ST', language: 'E' }] },
        },
      },
    ],
    mockToolExecutor: storedTextFixtureExecutor,
    finalAnswer: { required: [/Payment within 30 days/i], requireNonEmpty: true },
  },
];
export const SCENARIOS: EvalScenario[] = scenarios.map((scenario) => ({
  category: 'application-log',
  tags: ['application-log', 'tool-selection'],
  forbidden: ['SAPWrite', 'SAPActivate', 'SAPManage'],
  requireFullParameters: true,
  maxToolCalls: 2,
  ...scenario,
  expectedTrace: scenario.expectedTrace ?? [scenario.optimal],
  mockOnly: true,
}));
