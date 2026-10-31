import type { AdtClient } from '../adt/client.js';
import { readSearchHelpMetadata } from '../adt/search-help.js';
import { isBtpSystem } from './feature-cache.js';
import { searchHelpInputIssue } from './search-help-input.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

export async function handleSearchHelp(
  client: AdtClient,
  args: Record<string, unknown>,
  context = false,
): Promise<ToolResult> {
  if (isBtpSystem()) return errorResult('SHLP metadata is not qualified for BTP ABAP.');
  const issue = searchHelpInputIssue(args, context);
  if (issue) return errorResult(issue.message);
  const result = await readSearchHelpMetadata(client.http, client.safety, String(args.name));
  return result.availability === 'available' ? textResult(toolJson(result)) : errorResult(toolJson(result));
}
