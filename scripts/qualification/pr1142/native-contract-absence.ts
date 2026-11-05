/** Shared typed absence evidence for the owned native fixture, including its generated text pool. */
import { createHash } from 'node:crypto';
import { AdtApiError, classifySapDomainError, extractExceptionType } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { contractRequestPolicy, type NativeContractSelection } from './native-contract-transport.js';

export async function confirmNativeFunctionAbsence(
  http: AdtHttpClient,
  selection: NativeContractSelection,
  record: (value: unknown) => void,
  policy?: AdtRequestOptions,
): Promise<void> {
  const budget = contractRequestPolicy(policy);
  for (const path of [
    selection.groupUrl,
    selection.moduleUrl,
    `/sap/bc/adt/textelements/functiongroups/${selection.group}`,
  ]) {
    let absent = false;
    try {
      await http.get(path, { Accept: 'application/*', 'Cache-Control': 'no-cache' }, contractRequestPolicy(budget));
    } catch (error) {
      absent =
        error instanceof AdtApiError &&
        error.statusCode === 404 &&
        extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
        !classifySapDomainError(error.statusCode, error.responseBody, error.path);
    }
    if (!absent) throw new Error('Native typed absence was not confirmed.');
    record({ recoveryAbsence: path, typed404: true });
  }
  const inactive = await http.get(
    '/sap/bc/adt/activation/inactiveobjects',
    {
      Accept: 'application/vnd.sap.adt.inactivectsobjects.v1+xml',
      'Cache-Control': 'no-cache',
    },
    contractRequestPolicy(budget),
  );
  const media = inactive.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (
    inactive.statusCode !== 200 ||
    Buffer.byteLength(inactive.body) > 1024 * 1024 ||
    inactive.body.toUpperCase().includes(selection.group.slice(-16)) ||
    !(media === 'application/xml' || media === 'text/xml' || media?.endsWith('+xml'))
  )
    throw new Error('The bounded inactive-list response still contains the fixture or is incomplete.');
  nativeXmlRoot(inactive.body, 'inactiveObjects', 'http://www.sap.com/abapxml/inactiveCtsObjects');
  record({ recoveryInactiveHash: createHash('sha256').update(inactive.body).digest('hex'), containsFixture: false });
}
