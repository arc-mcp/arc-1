/**
 * IDE deep links appended to tool results (`ARC1_IDE_LINKS`).
 *
 * A tool result that names an ABAP object is far more useful when the user can click through to it.
 * Which link is right depends on where ARC-1 is running, so `auto` derives it from the calling
 * client — VS Code gets a link into the ARC-1 ABAP Bridge extension, Eclipse gets an `adt://` link
 * (a scheme ADT registers with the operating system).
 *
 * SECURITY: the client identity comes from `clientInfo`/`User-Agent`, which the client controls.
 * That is acceptable here because the only consequence of a wrong guess is a link that does not
 * resolve. It must never be used for anything security-relevant.
 *
 * Measured client identities (2026-08-03, MCP protocol 2025-11-25):
 *   VS Code 1.131      → `Visual Studio Code`
 *   Claude Desktop     → `claude-ai`
 *   Claude Code        → `local-agent-mode-<server-name>`  (derived from the SERVER name — match by prefix)
 */

/** Link into the ARC-1 ABAP Bridge VS Code extension. */
export const VSCODE_TEMPLATE = 'vscode://marianfoo.arc1-abap-bridge/open?name={name}&package={package}';

/**
 * ADT link. `adt` is registered with the OS by `org.eclipse.urischeme.uriSchemeHandlers`
 * (handler `com.sap.adt.tools.core.ui.internal.openurl.AdtLinkHandler`), so this opens in Eclipse
 * from anywhere — including a chat client that has no IDE of its own. Shape derived from
 * `com.sap.adt.tools.abapsource.urimapping.ExternalUriUtil`.
 */
export const ECLIPSE_TEMPLATE = 'adt://{sid}{uri}?sap-client={client}';

export interface IdeLinkFields {
  type?: string;
  name?: string;
  package?: string;
  /** ADT object URI, e.g. `/sap/bc/adt/oo/classes/zcl_x`. */
  uri?: string;
  /** System id / ADT destination name. */
  sid?: string;
  client?: string;
}

/**
 * Pick the link template for this call, or undefined to emit nothing.
 *
 * `auto` deliberately emits nothing for an unrecognised client: a chat client with no IDE has
 * nothing to open, and a wrong guess is worse than no link.
 */
export function resolveTemplate(mode: string | undefined, clientAgent: string | undefined): string | undefined {
  const configured = (mode ?? 'auto').trim();
  if (!configured || configured === 'off') return undefined;
  if (configured === 'vscode') return VSCODE_TEMPLATE;
  if (configured === 'eclipse') return ECLIPSE_TEMPLATE;
  if (configured !== 'auto') return configured; // explicit template wins, always

  const agent = (clientAgent ?? '').toLowerCase();
  if (!agent) return undefined;
  // Forks (Cursor, Windsurf, …) usually keep the upstream name, hence a substring match.
  if (agent.includes('visual studio code') || agent.includes('vscode')) return VSCODE_TEMPLATE;
  return undefined;
}

/**
 * Placeholders that land in a URI *path* — their slashes must survive. `encodeURIComponent`
 * would turn `/sap/bc/adt/oo/classes/zcl_x` into `%2Fsap%2Fbc%2F…` and the link would not resolve.
 */
const PATH_PLACEHOLDERS = new Set(['uri']);

/**
 * Fill a template. Returns undefined when a placeholder the template needs has no value —
 * a half-built link is worse than none.
 */
export function buildIdeLink(template: string, fields: IdeLinkFields): string | undefined {
  const values: Record<string, string | undefined> = {
    type: fields.type,
    name: fields.name,
    package: fields.package,
    uri: fields.uri,
    sid: fields.sid,
    client: fields.client,
  };
  let missing = false;
  const link = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === '') {
      // `package` is genuinely optional — the bridge resolves it itself when absent.
      if (key === 'package') return '';
      missing = true;
      return '';
    }
    // Encode per position: path segments keep their separators, query values do not.
    return PATH_PLACEHOLDERS.has(key) ? value.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(value);
  });
  if (missing) return undefined;
  // Drop an empty trailing `&package=` so the link stays tidy.
  return link.replace(/&package=(?=&|$)/, '');
}

/**
 * The object a tool call is about, or undefined when it is not about one object.
 * Deliberately conservative: only `type` + `name` together count as an identity.
 */
export function objectIdentity(args: Record<string, unknown>): { type: string; name: string } | undefined {
  const type = typeof args.type === 'string' ? args.type.trim() : '';
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!type || !name) return undefined;
  // Wildcards and comma lists are searches, not a single object.
  if (/[*,\s]/.test(name)) return undefined;
  return { type: type.toUpperCase(), name: name.toUpperCase() };
}

/**
 * The link line. Emitted as its OWN MCP content block, never concatenated onto the payload:
 * most tool results are JSON, and appending prose to them makes the JSON unparseable.
 * Kept to one short line — it rides along on every single-object call.
 */
export function formatIdeLink(link: string, name: string): string {
  return `Open ${name} in your IDE: ${link}`;
}
