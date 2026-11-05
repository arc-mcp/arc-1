/** One fixed parent DELETE only. No child recreation, activation or cleanup replay. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { type ProceduralInput, runProceduralWorkflow } from './native-procedural-driver.js';
import { owners, POOL, ProceduralFailure } from './native-procedural-fixed.js';
import { inspectProceduralGroupCleanup } from './native-procedural-group-cleanup-evidence.js';
import { checkProceduralRequest, type ProceduralGrant } from './native-procedural-transport.js';
export function checkGroupCleanupRequest(grant: ProceduralGrant, method: string, path: string, body?: string) {
  if (!['preflight', 'group-delete', 'final'].includes(grant.stage)) throw new ProceduralFailure('cleanup-stage');
  checkProceduralRequest(grant, method, path, body);
  if (['GET', 'HEAD'].includes(method)) return;
  const uri = new URL(path, 'https://procedural.invalid');
  if (method === 'PUT' || (method === 'DELETE' && uri.pathname !== owners[0]))
    throw new ProceduralFailure('cleanup-scope');
  if (method === 'POST' && uri.searchParams.has('_action') && ![owners[0], POOL].includes(uri.pathname))
    throw new ProceduralFailure('cleanup-lock-scope');
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks') {
    const ns = 'http://www.sap.com/abapxml';
    const data = (xml: string) =>
      JSON.stringify(nativeXmlRoot(xml, 'abap', ns).child('values', ns)?.child('DATA', '')?.canonicalValue({}));
    if (
      ![owners[0], POOL].some(
        (owner) =>
          data(body ?? '') ===
          data(
            `<a:abap xmlns:a="${ns}"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${owner}</URI><OPERATION></OPERATION></DATA></a:values></a:abap>`,
          ),
      )
    )
      throw new ProceduralFailure('cleanup-recording-scope');
  }
}
export const runProceduralGroupCleanup = (input: ProceduralInput) =>
  runProceduralWorkflow(input, {
    startAt: 'group-delete',
    inspect: inspectProceduralGroupCleanup,
    checkRequest: checkGroupCleanupRequest,
  });
