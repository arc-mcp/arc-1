import type { AdtClient } from '../adt/client.js';
import { syntaxCheck } from '../adt/devtools.js';
import { AdtApiError } from '../adt/errors.js';
import type { SyntaxCheckResult } from '../adt/types.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';
import { type ToolResult, textResult, toolJson } from './shared.js';

/** Shared wire and result contract for both syntax-check entry points. */
export async function handleSyntaxCheck(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const type = normalizeObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const objectUrl = objectUrlForType(type, name);
  const version = args.version === 'inactive' ? 'inactive' : args.version === 'active' ? 'active' : undefined;
  const content = typeof args.source === 'string' ? (args.source as string) : undefined;
  // SAP does not refuse unsaved text for every absent object: for a PROG it checks the text as a
  // standalone include (`/programs/includes/<name>?context=/programs/programs/<name>`) with default
  // program attributes — fixed-point arithmetic off — and reports `processed`. Every `@` host
  // variable then fails, and the result reads like a real verdict. Confirm the object exists first
  // (version-less metadata = SAP's developer view, so an inactive-only object still counts).
  if (content !== undefined && (await isConfirmedAbsent(client, objectUrl))) {
    return notChecked(
      { hasErrors: false, messages: [], checked: false },
      `${type} ${name} was not found at ${objectUrl}`,
    );
  }
  const opts: { version?: 'active' | 'inactive'; content?: string } = {};
  if (version) opts.version = version;
  if (content !== undefined) opts.content = content;
  const result = await syntaxCheck(
    client.http,
    client.safety,
    objectUrl,
    Object.keys(opts).length > 0 ? opts : undefined,
  );
  // Fail closed: SAP checked nothing (object does not exist yet) → never report "clean", or
  // callers read hasErrors:false as "SAP will accept this source".
  if (!result.checked) return notChecked(result, result.statusText);
  return textResult(toolJson(result));
}

/** Only a 404 establishes absence; any other probe failure leaves the verdict to SAP's own check report. */
async function isConfirmedAbsent(client: AdtClient, objectUrl: string): Promise<boolean> {
  try {
    await client.getObjectMetadata(objectUrl);
    return false;
  } catch (err) {
    return err instanceof AdtApiError && err.isNotFound;
  }
}

function notChecked(result: SyntaxCheckResult, statusText: string | undefined): ToolResult {
  return textResult(
    toolJson({
      ...result,
      ...(statusText ? { statusText } : {}),
      hasErrors: true,
      messages: [
        {
          severity: 'error',
          text: `Not checked — ${(statusText || 'SAP did not process this check').replace(/\.$/, '')}. The source was NOT validated; create the object first (SAPWrite action="create"), then re-run the syntax check.`,
          line: 0,
          column: 0,
        },
      ],
    }),
  );
}
