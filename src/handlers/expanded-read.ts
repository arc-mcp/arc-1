/**
 * SAPRead `expand_includes` for PROG and INCL: the object and its nested includes in one bounded
 * response, or `grep` across them. The walk itself lives in `src/adt/include-expansion.ts`.
 */

import type { AdtClient } from '../adt/client.js';
import {
  EXPANSION_SEARCH_LIMITS,
  EXPANSION_TEXT_LIMITS,
  type ExpansionBlock,
  expandsInclude,
  expansionNotes,
  findIncludeStatements,
  readProgramExpanded,
} from '../adt/include-expansion.js';
import { grepSourceBlocks, unsupportedPatternMessage } from '../context/grep.js';
import { isActionDenied } from '../server/deny-actions.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

export interface ExpandedReadVersions {
  /** Version of the requested object. */
  root: 'active' | 'inactive';
  /** The requested object was read from the user's draft. */
  rootDraft: boolean;
  /** Version of one include, and whether it is read from the user's draft. */
  include: (name: string) => { version: 'active' | 'inactive'; draft: boolean };
}

/** Block heading: the name, where it is included, and whether it is the user's draft. */
function heading(block: ExpansionBlock): string {
  const at = block.includedAt ? [`${block.includedAt.parent} line ${block.includedAt.line}`] : [];
  const marks = [...at, ...(block.draft ? ['inactive draft'] : [])];
  return marks.length > 0 ? `${block.name} (${marks.join(', ')})` : block.name;
}

export async function readExpandedSource(
  client: AdtClient,
  type: 'PROG' | 'INCL',
  name: string,
  grep: string | undefined,
  versions: ExpandedReadVersions,
  note?: string,
): Promise<ToolResult> {
  // Each include is read like SAPRead type=INCL; the expansion must not bypass a denial of that read.
  if (isActionDenied('SAPRead', 'INCL', client.safety.denyActions ?? [])) {
    return errorResult(
      'expand_includes reads includes like SAPRead(type="INCL"), which SAP_DENY_ACTIONS denies on this server.',
    );
  }
  // Refuse a pattern grep will not run before reading up to 80 sources for it.
  const unsupported = grep === undefined ? undefined : unsupportedPatternMessage(grep);
  if (unsupported) return errorResult(unsupported);
  const result = await readProgramExpanded(client, type, name, versions, {
    limits: grep ? EXPANSION_SEARCH_LIMITS : EXPANSION_TEXT_LIMITS,
    shorten: !grep,
  });
  const notes = expansionNotes(result, grep !== undefined);
  const blocks = result.blocks.map((block) => ({ ...block, name: heading(block) }));
  if (grep !== undefined) {
    // Each include on its own, so a line number counts within the include it names.
    const g = grepSourceBlocks(blocks, grep);
    const output = notes ? `${g.output}\n\n${notes}` : g.output;
    return g.invalidPattern ? errorResult(output) : textResult(output);
  }
  const parts = blocks.map((block) => `=== ${block.name} ===\n${block.source}`);
  if (notes) parts.push(notes);
  return textResult(`${note ? `${note}\n\n` : ''}${parts.join('\n\n')}`);
}

/**
 * After a PROG/INCL grep of the object alone: name the includes it did not search that the expansion
 * would read (not system includes, not SAP or other-namespace includes of a customer program).
 */
export function includeSearchHint(name: string, source: string): string | undefined {
  const includes = [
    ...new Set(
      findIncludeStatements(source)
        .map((statement) => statement.name.toUpperCase())
        .filter((include) => expandsInclude(include, name)),
    ),
  ];
  if (includes.length === 0) return undefined;
  const shown = includes.slice(0, 5).join(', ') + (includes.length > 5 ? ` and ${includes.length - 5} more` : '');
  return `Searched ${name} only; its INCLUDE statements name ${includes.length} include(s) that expand_includes=true also searches (${shown}).`;
}
