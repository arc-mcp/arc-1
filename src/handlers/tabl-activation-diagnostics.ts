/**
 * Field-level diagnostics for a failed TABL activation.
 *
 * A structure or table whose component uses a missing type fails activation with only
 * "Nametab for table X cannot be generated; TABL X was not activated" — no field, no line.
 * SAP's check of the inactive draft names the field with its line and column, so a failed
 * TABL activation runs that check on the resolved object URL (/ddic/tables/ or
 * /ddic/structures/) even when activation already returned errors. TTYP/DTEL activation
 * already names the cause and the check only repeats it, so they are deliberately excluded.
 * A draft error complements the activation result; it never decides an object's own status.
 */

import type { AdtClient } from '../adt/client.js';
import type { ActivationResult } from '../adt/devtools.js';
import { syntaxCheck } from '../adt/devtools.js';
import type { SyntaxMessage } from '../adt/types.js';
import { activationDetailMatchesObject } from './activation-results.js';

export const TABL_CHECK_BEFORE_WRITE_HINT =
  'Tip: on on-premise systems, SAPWrite action="update" with checkBeforeWrite=true (or SAP_CHECK_BEFORE_WRITE=true) ' +
  "runs SAP's DDIC check on proposed TABL source before it is saved.";

const CHECK_UNAVAILABLE_NOTE =
  'Note: the DDIC check of the inactive draft could not run, so only the activation messages above are available.';

function normalizeMessage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function position(message: SyntaxMessage): string {
  if (!message.line) return '';
  return message.column ? `[line ${message.line}, column ${message.column}] ` : `[line ${message.line}] `;
}

/** Activation texts that may suppress a draft-check message for one object: details whose URI
 *  matches the object and, when `shown` is given, whose text the response actually displays.
 *  Messages without a URI, another object's details (e.g. one pulled in by preaudit) and hidden
 *  severities are never used, so a diagnostic is dropped only when the same entry already shows it. */
export function activationTextsForObject(
  result: Pick<ActivationResult, 'details'>,
  objectUrl: string,
  shown?: readonly string[],
): string[] {
  return result.details
    .filter((detail) => activationDetailMatchesObject(detail.uri, objectUrl))
    .map((detail) => detail.text)
    .filter((text) => !shown || shown.includes(text));
}

/** Check the inactive TABL draft at `objectUrl` after a failed activation. Returns the error
 *  messages this object's activation did not already report (with line and column), a short note
 *  when the check is unavailable, unprocessed or returns no report, or '' when it adds nothing.
 *  The same text at different positions is kept; exact repeats are dropped. Never throws.
 *  `inline` renders one line for batch summaries, which join entries with commas. */
export async function tablActivationDiagnostic(
  client: Pick<AdtClient, 'http' | 'safety'>,
  objectUrl: string,
  activationTexts: readonly string[],
  format: 'block' | 'inline' = 'block',
): Promise<string> {
  const separator = format === 'inline' ? ' — ' : '\n';
  let result: Awaited<ReturnType<typeof syntaxCheck>>;
  try {
    result = await syntaxCheck(client.http, client.safety, objectUrl, { version: 'inactive', requireReport: true });
  } catch {
    return `${separator}${CHECK_UNAVAILABLE_NOTE}`;
  }
  if (!result.checked) return `${separator}${CHECK_UNAVAILABLE_NOTE}`;

  const reportedByActivation = new Set(activationTexts.map(normalizeMessage));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const message of result.messages) {
    if (message.severity !== 'error') continue;
    const text = normalizeMessage(message.text);
    if (!text || reportedByActivation.has(text)) continue;
    const key = JSON.stringify([text, (message.uri ?? '').toLowerCase(), message.line, message.column]);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${position(message)}${message.text}`);
  }
  if (lines.length === 0) return '';
  return format === 'inline'
    ? ` — DDIC check of the inactive draft: ${lines.join('; ')}`
    : `\nDDIC check of the inactive draft:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}
