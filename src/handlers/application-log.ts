/** SAP-native business log output, retaining native authorization and errors. */
import { readApplicationLog } from '../adt/application-log.js';
import type { AdtClient } from '../adt/client.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import { ApplicationLogInputSchema } from './application-log-input.js';
import { isBtpSystem } from './feature-cache.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

export async function handleApplicationLog(client: AdtClient, raw: unknown): Promise<ToolResult> {
  checkOperation(client.safety, OperationType.Query, 'ReadApplicationLog');
  if (isBtpSystem()) return errorResult('Application log reads are not qualified for BTP ABAP.');
  const input = ApplicationLogInputSchema.parse(raw);
  return textResult(toolJson(await readApplicationLog(client, input)));
}
