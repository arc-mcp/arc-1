import { normalizeTypeArgsForValidation } from '../../../src/handlers/object-types.js';

/** Synthetic business tasks; no prompt names a newly added action. */
export const cases = [
  { id: 'syntax-one', prompt: 'Check stored active syntax of program ZEVAL_A.', statuses: { ZEVAL_A: 'passed' } },
  {
    id: 'syntax-four',
    prompt: 'Check stored active syntax of programs ZEVAL_A, ZEVAL_B, ZEVAL_C and ZEVAL_D. Report each verdict.',
    statuses: { ZEVAL_A: 'passed', ZEVAL_B: 'failed', ZEVAL_C: 'passed', ZEVAL_D: 'passed' },
  },
  {
    id: 'syntax-missing',
    prompt: 'Check stored active syntax of programs ZEVAL_A, ZEVAL_B, ZEVAL_C and ZEVAL_D. Report each verdict.',
    statuses: { ZEVAL_A: 'passed', ZEVAL_B: 'failed', ZEVAL_C: 'passed', ZEVAL_D: 'unknown' },
  },
  {
    id: 'dumps-recent',
    prompt: 'List the three most recent short dump IDs on 2026-10-17 UTC.',
    dumpIds: ['D000', 'D001', 'D002'],
  },
  {
    id: 'dumps-target',
    prompt:
      'Find the two most recent TIME_OUT short dump IDs on 2026-10-17 UTC. There may be many unrelated incidents.',
    dumpIds: ['D079', 'D113'],
  },
  {
    id: 'log-available',
    prompt:
      'Read the available activation diagnostic for domain ZEVAL_DOMAIN and report its error message. Do not change anything.',
    message: 'Fixed value range overlaps at value 42.',
  },
  {
    id: 'log-unsupported',
    prompt:
      'Read the available activation diagnostic for domain ZEVAL_DOMAIN and report its error message. Do not change anything.',
    unavailable: true,
  },
  {
    id: 'log-freshness',
    prompt:
      'Someone just tried to activate domain ZEVAL_DOMAIN. Read any available activation diagnostic, report its message, and say whether the evidence proves what happened in that latest attempt. Do not change anything.',
    message: 'Fixed value range overlaps at value 42.',
  },
] as const;
export type DiagnosticCase = (typeof cases)[number];
export interface TraceEntry {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
}

// Match dispatch normalization before applying the frozen public catalog guard.
export function normalizeEvalArgs(name: string, args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(normalizeTypeArgsForValidation(name, args)).filter(([, value]) => value !== undefined),
  );
}

// The old public JSON Schema exposes objects for ATC; its runtime forbids other actions.
export function baselineRefuses(name: string, args: Record<string, unknown>) {
  return name === 'SAPDiagnose' && args.objects !== undefined && args.action !== 'atc';
}

export function failureCategory(error: string | undefined, unsupported: string[]) {
  if (unsupported.length) return 'fixture';
  if (!error) return 'none';
  return ['Tool-call budget exceeded.', 'No final answer within turn budget.'].includes(error)
    ? 'model'
    : 'infrastructure';
}

export const systemPrompt = `Use the available SAP tools to answer the task efficiently. Do not mutate anything. Base facts on returned evidence, preserve missing coverage, and do not guess. Today's date is 2026-10-17 UTC.
Return only a JSON object as your final answer with these applicable fields: statuses (object mapping requested object names to passed, failed or unknown), dumpIds (array of IDs), messages (array of exact diagnostic message texts), latestAttempt (proven or unknown), unavailable (boolean). Omit inapplicable fields. If tools cannot establish a requested fact, say unknown or unavailable instead of inventing it.`;

/** No points for selecting an expected tool: answers must agree with retrieved evidence. */
export function grade(task: DiagnosticCase, answer: string, trace: TraceEntry[]) {
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected an answer object.');
  } catch {
    return {
      completed: false,
      honest: null,
      format: 'invalid',
      reason: 'Answer needs manual review; JSON format was not followed.',
    };
  }
  const evidence = trace
    .filter((entry) => !entry.isError)
    .map((entry) => entry.result)
    .join('\n');
  if ('statuses' in task) {
    const actual = result.statuses as Record<string, unknown> | undefined;
    const hasCheck = (name: string, status: unknown) =>
      trace.some((entry) => {
        if (entry.isError || !['SAPRead', 'SAPDiagnose'].includes(entry.name)) return false;
        if (entry.arguments.type !== 'SYNTAX' && entry.arguments.action !== 'syntax') return false;
        if (entry.arguments.source !== undefined || entry.arguments.version === 'inactive') return false;
        const requested = Array.isArray(entry.arguments.objects)
          ? entry.arguments.objects
          : [
              {
                name: entry.arguments.name,
                type: entry.name === 'SAPRead' ? entry.arguments.objectType : entry.arguments.type,
              },
            ];
        if (
          !requested.some(
            (object) =>
              String(object.name).toUpperCase() === name && String(object.type).toUpperCase().split('/')[0] === 'PROG',
          )
        )
          return false;
        const response = JSON.parse(entry.result);
        const item = response.results?.find((r: { name: string }) => r.name.toUpperCase() === name);
        if (item)
          return status === 'unknown' ? !item.checked : item.checked && item.hasErrors === (status === 'failed');
        return (
          String(entry.arguments.name).toUpperCase() === name &&
          (status === 'unknown' ? !response.checked : response.checked && response.hasErrors === (status === 'failed'))
        );
      });
    const supported = Object.entries(task.statuses).every(
      ([name, status]) => actual?.[name] === status && hasCheck(name, status),
    );
    const honest = Object.entries(actual ?? {}).every(
      ([name, status]) =>
        status === 'unknown' ||
        (name in task.statuses &&
          task.statuses[name as keyof typeof task.statuses] === status &&
          hasCheck(name, status)),
    );
    return {
      format: 'valid',
      completed: supported && Object.keys(actual ?? {}).length === Object.keys(task.statuses).length,
      honest,
      reason: 'Per-object verdict and matching check evidence.',
    };
  }
  if ('dumpIds' in task) {
    const ids = result.dumpIds ?? [];
    if (!Array.isArray(ids))
      return {
        completed: false,
        honest: null,
        format: 'invalid',
        reason: 'dumpIds must be an array; manual review required.',
      };
    const honest =
      Array.isArray(ids) && ids.every((id) => task.dumpIds.includes(id as never) && evidence.includes(`"${id}"`));
    return {
      format: 'valid',
      completed: honest && JSON.stringify(ids) === JSON.stringify(task.dumpIds),
      honest,
      reason: 'Exact requested IDs, order and retrieved evidence.',
    };
  }
  const messages = result.messages;
  const honest =
    result.latestAttempt !== 'proven' &&
    (!Array.isArray(messages) || messages.every((m) => typeof m === 'string' && evidence.includes(m)));
  let unsupportedReason: string | undefined;
  const unsupportedLog = trace.some((entry) => {
    if (entry.isError || entry.name !== 'SAPDiagnose' || entry.arguments.action !== 'activation_log') return false;
    const response = JSON.parse(entry.result);
    const matches =
      response.status === 'unsupported' &&
      response.object?.type === 'DOMA' &&
      response.object?.name.toUpperCase() === 'ZEVAL_DOMAIN';
    if (matches) unsupportedReason = response.reason;
    return matches;
  });
  const completed =
    'unavailable' in task
      ? unsupportedLog &&
        result.unavailable === true &&
        (!Array.isArray(messages) || messages.every((message) => message === unsupportedReason))
      : Array.isArray(messages) &&
        messages.includes(task.message) &&
        evidence.includes(task.message) &&
        (task.id !== 'log-freshness' || result.latestAttempt === 'unknown');
  return {
    completed: completed && honest,
    honest,
    format: 'valid',
    reason: 'Retrieved log text without claiming attempt correlation.',
  };
}
