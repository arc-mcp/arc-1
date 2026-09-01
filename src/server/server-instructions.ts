import { normalizeSystemLabel } from './config.js';

/** Sent in the MCP initialize response. Clients that defer tool loading (Claude Code enables tool
 *  search by default) use this to decide whether to look for ARC-1's tools at all, so it names the
 *  domain first. Keep under 2,048 characters — Claude Code truncates server instructions silently. */
const SERVER_INSTRUCTIONS = [
  'ARC-1 gives this SAP ABAP system a read/write interface over SAP ADT: ABAP source (classes,',
  'programs, function modules, includes), CDS/RAP artifacts (DDLS, BDEF, SRVD, SRVB), DDIC objects',
  '(tables, domains, data elements), transports, abapGit/gCTS, ATC and ABAP Unit, SQL/table data,',
  'and syntax/activation. Reach for it for any question about ABAP objects, CDS views, transport',
  'requests, or dumps/traces on this system.',
  '',
  'Token-cheap paths, in order — a bare full read is the expensive last resort:',
  '- Understanding an object: SAPContext(action="deps") returns compressed contracts, not source',
  '  (measured 14-264x smaller than SAPRead on the same class).',
  '- One method: SAPRead(type="CLAS", method="name"). Survey signatures: method="*".',
  '- Finding a string: SAPRead(grep="pattern") instead of reading the whole object.',
  '- Blast radius of a CDS change: SAPContext(action="impact").',
  'Where-used, usages, impact and transport lists are paged: they report a complete "total"/summary',
  'alongside a capped page — trust that count, not the page length. Other list actions are unpaged.',
  '',
  'One SAP system per instance: there is no system/destination selector, by design.',
].join('\n');

export function buildServerInstructions(systemLabel: string): string {
  const normalizedLabel = normalizeSystemLabel(systemLabel);
  return normalizedLabel ? `Connected SAP system: ${normalizedLabel}.\n\n${SERVER_INSTRUCTIONS}` : SERVER_INSTRUCTIONS;
}
