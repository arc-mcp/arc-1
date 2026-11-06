import type { AdtClient } from '../adt/client.js';
import type { FmParameter } from '../adt/fm-signature.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import { parseXml } from '../adt/xml-parser.js';
import { functionGroupObjectUrl } from './object-types.js';

/** SAP requires the parent's original language to synchronize native parameter short texts. */
export async function resolveFmDescriptionLanguage(
  client: AdtClient,
  group: string,
  parameters?: FmParameter[],
): Promise<string | undefined> {
  if (!parameters?.some((parameter) => parameter.description !== undefined)) return undefined;
  if (!group) throw new Error('FUNC parameter descriptions require the parent function group.');
  checkOperation(client.safety, OperationType.Read, 'GetFunctionGroup');
  const response = await client.http.get(functionGroupObjectUrl(group));
  const metadata = parseXml(response.body).abapFunctionGroup as Record<string, unknown> | undefined;
  const language = metadata?.['@_masterLanguage'];
  if (typeof language !== 'string' || !/^[A-Za-z]{2}$/.test(language)) {
    throw new Error('Cannot determine the function group original language; parameter descriptions were not written.');
  }
  return language.toLowerCase();
}
