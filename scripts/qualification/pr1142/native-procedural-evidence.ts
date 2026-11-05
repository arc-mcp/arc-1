/** Fresh native identity/source receipts, never guessed version selection or group-child authority. */
import type { AdtClient } from '../../../src/adt/client.js';
import { parseFmSignature } from '../../../src/adt/fm-signature.js';
import { functionActivationMetadata } from '../../../src/adt/function-activation-metadata.js';
import { prepareFunctionSourceVerification } from "../../../src/adt/source-precondition.js";
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { readOwnedTextPoolState, readTextElementPart, type TextElementPart } from '../../../src/adt/text-elements.js';
import { parseFunctionModuleProperties } from '../../../src/adt/xml-parser.js';
import { GROUP, MARKER, MODULE, POOL, ProceduralFailure, selected } from './native-procedural-fixed.js';
import { retainedAbsent } from './native-v5-retained-evidence.js';

export type ProceduralRecord = (row: unknown) => void;
export interface ChildReceipt {
  source: string;
  sourceHash: string;
  metadataHash: string;
  version: string;
  inactiveAlternative: boolean;
}
const core = 'http://www.sap.com/adt/core';
export async function absent(client: AdtClient, owner: string, record: ProceduralRecord, policy: AdtRequestOptions) {
  await retainedAbsent(client.http, owner, record, policy);
}
export async function childReceipt(
  client: AdtClient,
  type: 'FUNC' | 'INCL',
  version: 'active' | 'inactive' | undefined,
  record: ProceduralRecord,
  policy: AdtRequestOptions,
): Promise<ChildReceipt> {
  const s = selected[type],
    suffix = version ? `?version=${version}` : '';
  const metadata = await client.http.get(
    s.objectUrl + suffix,
    { Accept: 'application/*', 'Cache-Control': 'no-cache' },
    policy,
  );
  const proof = functionActivationMetadata(metadata.body, s, '$TMP');
  const root = nativeXmlRoot(
    metadata.body,
    type === 'FUNC' ? 'abapFunctionModule' : 'abapFunctionGroupInclude',
    `http://www.sap.com/adt/functions/${type === 'FUNC' ? 'fmodules' : 'fincludes'}`,
  );
  if (
    root.attribute('description', core) !== MARKER ||
    ['createdBy', 'changedBy'].some((key) => {
      const v = root.attribute(key, core);
      return v !== undefined && v !== 'MARIAN';
    })
  )
    throw new ProceduralFailure('child-author-marker');
  if (
    type === 'FUNC' &&
    (root.attribute('processingType', 'http://www.sap.com/adt/functions/fmodules') !== 'normal' ||
      parseFunctionModuleProperties(metadata.body).processingType !== 'normal')
  )
    throw new ProceduralFailure('function-processing');
  const source = await client.http.get(
    `${s.objectUrl}/source/main${suffix}`,
    { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
    policy,
  );
  if (
    source.statusCode !== 200 ||
    !Object.entries(source.headers).some(
      ([k, v]) => k.toLowerCase() === 'content-type' && v.split(';')[0].trim().toLowerCase() === 'text/plain',
    )
  )
    throw new ProceduralFailure('child-source');
  if (type === 'FUNC') prepareFunctionSourceVerification(source.body, MODULE);
  const receipt = {
    source: source.body,
    sourceHash: sourceHash(source.body),
    metadataHash: proof.hash,
    version: proof.version,
    inactiveAlternative: proof.inactiveAlternative,
  };
  record({
    childReceipt: s.objectUrl,
    requestedVersion: version ?? 'default',
    metadata: metadata.body,
    ...receipt,
    ...(type === 'FUNC' ? { signature: parseFmSignature(source.body).params, processingType: 'normal' } : {}),
  });
  return receipt;
}
export function sameChild(a: ChildReceipt, b: ChildReceipt, state = true) {
  if (
    a.sourceHash !== b.sourceHash ||
    a.metadataHash !== b.metadataHash ||
    (state && (a.version !== b.version || a.inactiveAlternative !== b.inactiveAlternative))
  )
    throw new ProceduralFailure('child-drift');
}
export async function poolReceipt(client: AdtClient, record: ProceduralRecord) {
  const state = await readOwnedTextPoolState(client.http, 'FUGR', GROUP, '$TMP');
  const parts = {} as Record<TextElementPart, { active: string; inactive: string }>;
  for (const part of ['symbols', 'selections', 'headings'] as const) {
    parts[part] = {
      active: await readTextElementPart(client.http, client.safety, 'FUGR', GROUP, part, { version: 'active' }),
      inactive: await readTextElementPart(client.http, client.safety, 'FUGR', GROUP, part, { version: 'inactive' }),
    };
  }
  record({ poolReceipt: POOL, nativeState: state, parts });
  return { state, parts };
}
