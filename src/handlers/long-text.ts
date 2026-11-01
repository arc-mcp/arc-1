/** Model-facing projection of the qualified classic store; binary and codec details stay internal. */
import type { AdtClient } from '../adt/client.js';
import { DataSourcePolicyError } from '../adt/data-source-policy.js';
import { AdtApiError } from '../adt/errors.js';
import { internalOperationDenial } from '../adt/internal-data-operations.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import {
  type ClassicTextBatchItem,
  findTextMatches,
  readClassicTextBatch,
  type TextKey,
  TextReadError,
  type TextReadErrorCode,
  withStoredTextSession,
} from '../adt/stored-text/index.js';
import { isBtpSystem } from './feature-cache.js';
import { LongTextInputSchema, type LongTextKey } from './long-text-input.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

const scope = 'classic-stored-itf';
const keyForSap = (key: LongTextKey): TextKey => ({
  TDOBJECT: key.object,
  TDNAME: key.name,
  TDID: key.id,
  TDSPRAS: key.language,
});
const publicKey = (key: TextKey): LongTextKey => ({
  object: key.TDOBJECT,
  name: key.TDNAME,
  id: key.TDID,
  language: key.TDSPRAS,
});
const HINTS: Record<TextReadErrorCode, string> = {
  INVALID_KEY: 'Use configured object/ID and a one-character SAP language. Discover exact keys; preserve name spaces.',
  NOT_FOUND:
    'No header for this exact key in classic storage. Discover IDs/languages; do not infer absence from memory or archives.',
  UNSUPPORTED_PROFILE:
    'This storage/container profile is unsupported. Do not install helpers or fall back to RFC/free SQL.',
  UNSUPPORTED_PERSISTENCE: 'The configured persistence is unsupported; a storage-specific released API is needed.',
  NON_ITF_TEXT: 'This text is not ITF/STXL. Use a suitable application API; do not report it as missing.',
  REFERENCE_ERROR:
    'Stored reference target is missing or invalid. Report the reference problem; do not change language.',
  REFERENCE_CYCLE: 'Stored references form a cycle. Report it; do not repeatedly retry.',
  REFERENCE_LIMIT: 'Reference chain exceeds eight hops. Report the limit.',
  INCONSISTENT_READ: 'Content changed during reading. Retry the same exact key once; no snapshot is guaranteed.',
  CORRUPT_CLUSTER:
    'Stored bytes/metadata do not match the supported profile. Report a decoding failure, not empty text.',
  LIMIT_EXCEEDED: 'Narrow discovery or request fewer/smaller texts. Do not bypass data limits with raw SQL.',
};
function failure(error: { code: TextReadErrorCode; message: string }) {
  return { ...error, hint: HINTS[error.code] };
}
function publicItem(item: ClassicTextBatchItem) {
  if (item.status === 'error') return { ...item, key: item.key && publicKey(item.key), error: failure(item.error) };
  const text = item.text;
  return {
    index: item.index,
    status: item.status,
    key: publicKey(text.requestedKey),
    resolvedKey: publicKey(text.resolvedKey),
    referenceChain: text.referenceChain.map(publicKey),
    header: { title: text.header.title.replace(/ +$/u, ''), storedLineCount: text.header.storedLineCount },
    lines: text.lines,
    lineCount: text.lineCount,
    warnings: text.warnings,
    snapshotGuaranteed: false,
  };
}

export async function handleLongText(client: AdtClient, raw: unknown, minimalErrors: boolean): Promise<ToolResult> {
  checkOperation(client.safety, OperationType.Query, 'ReadLongText');
  if (isBtpSystem())
    return errorResult(
      toolJson({
        code: 'UNSUPPORTED_PLATFORM',
        message: 'Classic stored text is not qualified for BTP ABAP.',
        hint: 'Use an application-specific released API.',
      }),
    );
  const input = LongTextInputSchema.parse(raw);
  try {
    return await withStoredTextSession(client, client.sapClient, async (source) => {
      if (input.mode === 'discover') {
        const result = await source.discover({
          object: input.object!,
          namePrefix: input.namePrefix!,
          id: input.id,
          language: input.language,
          limit: input.limit,
        });
        return textResult(
          toolJson({
            mode: input.mode,
            scope,
            candidates: result.headers.map((header) => ({
              key: publicKey(header.key),
              title: header.title.replace(/ +$/u, ''),
              storedLineCount: header.storedLineCount,
              textType: header.textType.replace(/ +$/u, '') || 'ITF',
              reference: header.reference && publicKey(header.reference),
            })),
            more: result.more,
            nextStep: result.more
              ? 'Narrow namePrefix; this is a bounded subset, not pagination.'
              : 'Pass selected candidate.key objects unchanged as longText.keys with mode=read or search. Ask which ID/language if ambiguous.',
          }),
        );
      }
      const results = await readClassicTextBatch(source, input.keys!.map(keyForSap));
      if (input.mode === 'read')
        return textResult(toolJson({ mode: input.mode, scope, items: results.map(publicItem) }));
      const matched = findTextMatches(results, input.phrase!);
      return textResult(
        toolJson({
          ...matched,
          mode: input.mode,
          scope,
          matches: matched.matches.map((match) => ({ ...match, key: publicKey(match.key) })),
          requested: results.length,
          succeeded: results.filter((item) => item.status === 'ok').length,
          errors: results.filter((item) => item.status === 'error').map(publicItem),
          coverage: 'Supplied keys only; literal ITF line matches, no rendering or INCLUDE expansion.',
        }),
      );
    });
  } catch (error) {
    if (error instanceof DataSourcePolicyError)
      return errorResult(internalOperationDenial('stored_text', error, minimalErrors));
    if (error instanceof TextReadError)
      return errorResult(toolJson(failure({ code: error.code, message: error.message })));
    if (
      error instanceof AdtApiError &&
      error.statusCode === 404 &&
      error.path?.split('?')[0] === '/sap/bc/adt/datapreview/freestyle'
    )
      return errorResult(
        toolJson({
          code: 'UNSUPPORTED_PLATFORM',
          message: "This system's ADT data preview does not support the stored-text query (HTTP 404).",
          hint: 'No RFC/helper fallback is used. Check target capability; do not interpret this as a missing text.',
        }),
      );
    throw error;
  }
}
