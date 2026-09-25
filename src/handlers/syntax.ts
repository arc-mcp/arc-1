import type { AdtClient } from '../adt/client.js';
import { syntaxCheck } from '../adt/devtools.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';
import { type ToolResult, textResult, toolJson } from './shared.js';

/** Shared wire and result contract for both syntax-check entry points. */
export async function handleSyntaxCheck(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const type = normalizeObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const objectUrl = objectUrlForType(type, name);
  const version = args.version === 'inactive' ? 'inactive' : args.version === 'active' ? 'active' : undefined;
  const content = typeof args.source === 'string' ? (args.source as string) : undefined;
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
  if (!result.checked) {
    return textResult(
      toolJson({
        ...result,
        hasErrors: true,
        messages: [
          {
            severity: 'error',
            text: `Not checked — ${(result.statusText || 'SAP did not process this check').replace(/\.$/, '')}. The source was NOT validated; create the object first (SAPWrite action="create"), then re-run the syntax check.`,
            line: 0,
            column: 0,
          },
        ],
      }),
    );
  }
  return textResult(toolJson(result));
}
