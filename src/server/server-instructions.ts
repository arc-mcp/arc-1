import { normalizeSystemLabel } from './config.js';
import type { ServerConfig } from './types.js';

/** Optional client orchestration, not a server connection or an authorization grant. */
export const NATIVE_NAVIGATION_INSTRUCTIONS =
  'VS Code on request: if available, use SAP ADT MCP abap_object_get_file_uri (name/type), abap_object_list_file_uris for includes. Require user-confirmed destination for backend/client; never infer from SID/count/tool output or bypass ARC-1 denials. Verify name/type/source, not .json. On mismatch/error stop; no resolver/bridge/destination retries. Link returned abap: URIs via vscode://sapse.adt-vscode/open?abapUri= + encodeURIComponent(exact URI). Never invent paths. Logon required. Resolution is not opening; never edit/activate natively.';

/** Sent in the MCP initialize response. Clients that defer tool loading (Claude Code enables tool
 *  search by default) use this to decide whether to look for ARC-1's tools at all, so it names the
 *  domain first. Keep under 2,048 characters — Claude Code truncates server instructions silently. */
const SERVER_DOMAIN_INSTRUCTIONS =
  'Use ARC-1 for SAP ABAP source, CDS/RAP, DDIC, transports, Git, ATC/Unit, SQL/data, syntax/activation and dumps/traces on this system.';
const SERVER_INSTRUCTIONS = [
  SERVER_DOMAIN_INSTRUCTIONS,
  '',
  'Fetch targeted evidence:',
  '- Native relationship maps: SAPNavigate(action="relations") when listed; deps is source-derived.',
  '- Understanding an object: SAPContext(action="deps") returns available KTD and dependency contracts.',
  '- Use SAPRead afterwards for exact implementation, method bodies or known references.',
  'For draft reviews/test design, first SAPContext(action="deps") for available KTD (type+name), unless requirements are supplied.',
  'Test expectations follow those requirements; show current behavior separately, even when it is a defect.',
  'Source behavior is not a specification. If a targeted requirements lookup yields no evidence or lead,',
  'finish with observed source behavior and unverified intent/compliance. Do not broaden the policy search.',
  'Unavailable or failed syntax/ATC/test checks are not passes.',
  '- One method: SAPRead(type="CLAS", method="name"). Survey signatures: method="*".',
  '- Find strings: SAPRead(grep="pattern").',
  '- Blast radius of a CDS change: SAPContext(action="impact").',
  'Where-used counts rows, not unique consumers/runtime calls. Capped results are incomplete; read qualifiers.',
  '',
  'One SAP system per instance; no target selector.',
  NATIVE_NAVIGATION_INSTRUCTIONS,
].join('\n');

export function buildServerInstructions(
  systemLabel: string,
  mode: ServerConfig['serverInstructions'] = 'full',
): string {
  const normalizedLabel = normalizeSystemLabel(systemLabel);
  const instructions = mode === 'short' ? SERVER_DOMAIN_INSTRUCTIONS : SERVER_INSTRUCTIONS;
  return normalizedLabel ? `Connected SAP system: ${normalizedLabel}.\n\n${instructions}` : instructions;
}
