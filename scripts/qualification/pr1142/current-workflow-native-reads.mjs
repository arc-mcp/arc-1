import { AdtApiError, classifySapDomainError } from '../../../src/adt/errors.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { currentOwner, requireEvidence, sha, verifyCurrentRecording } from './current-workflow-contract.mjs';

const core = 'http://www.sap.com/adt/core';
const profile = {
  CLAS: ['abapClass', 'http://www.sap.com/adt/oo/classes', 'CLAS/OC'],
  PROG: ['abapProgram', 'http://www.sap.com/adt/programs/programs', 'PROG/P'],
  INCL: ['abapInclude', 'http://www.sap.com/adt/programs/includes', 'PROG/I'],
};

function isCurrentNativeAbsence(body) {
  try {
    const root = nativeXmlRoot(
      body,
      'exception',
      'http://www.sap.com/abapxml/types/communicationframework',
      true,
    );
    return (
      root.child('namespace', '')?.attribute('id', '') === 'com.sap.adt' &&
      root.child('type', '')?.attribute('id', '') === 'ExceptionResourceNotFound'
    );
  } catch {
    return false;
  }
}

/** Fixed read-only native evidence. No cleanup, locks, check POST, or caller-supplied URL.
 * @param {{manifest:any,mode:string,name:string,http:any,readTransport:any,proveCreatedOwner?:(fixture:any)=>Promise<any>}} options
 */
export async function observeCurrentNative({
  manifest,
  mode,
  name,
  http,
  readTransport,
  proveCreatedOwner = undefined,
}) {
  requireEvidence(['preflight', 'identity', 'absence'].includes(mode), 'UNKNOWN_CURRENT_NATIVE_MODE');
  const selected =
    mode === 'preflight' ? manifest.fixtures : manifest.fixtures.filter((f) => f.name === name);
  requireEvidence(selected.length === (mode === 'preflight' ? 4 : 1), 'UNKNOWN_CURRENT_NATIVE_OWNER');
  const result = { mode, fixtures: [], recording: undefined };
  for (const f of selected) {
    const owner = currentOwner(f);
    let response;
    try {
      response = await http.get(owner, { Accept: 'application/*', 'Cache-Control': 'no-cache' });
    } catch (error) {
      if (
        error instanceof AdtApiError &&
        error.statusCode === 404 &&
        isCurrentNativeAbsence(error.responseBody ?? '') &&
        !classifySapDomainError(error.statusCode, error.responseBody, error.path)
      ) {
        requireEvidence(mode !== 'identity', 'CURRENT_OWNER_MISSING');
        result.fixtures.push({
          name: f.name,
          type: f.type,
          absent: true,
          absence: 'ExceptionResourceNotFound',
        });
        continue;
      }
      throw error;
    }
    requireEvidence(mode === 'identity', 'CURRENT_OWNER_ALREADY_EXISTS');
    const [element, namespace, type] = profile[f.type];
    const root = nativeXmlRoot(response.body, element, namespace);
    const actor = manifest.actors.find((a) => a.label === f.actor);
    const identity = {
      name: root.attribute('name', core),
      type: root.attribute('type', core),
      package: root.child('packageRef', core)?.attribute('name', core),
      version: root.attribute('version', core),
      createdBy: root.attribute('createdBy', core),
      changedBy: root.attribute('changedBy', core),
      createdAt: root.attribute('createdAt', core),
      masterSystem: root.attribute('masterSystem', core),
    };
    requireEvidence(
      identity.name === f.name &&
        identity.type === type &&
        identity.package === f.package &&
        identity.version === 'active' &&
        (identity.createdBy === actor.sapUser ||
          (['INCL', 'PROG'].includes(f.type) && identity.createdBy === undefined)) &&
        identity.changedBy === actor.sapUser &&
        !!identity.createdAt &&
        identity.masterSystem === 'A4H',
      'CURRENT_NATIVE_IDENTITY_MISMATCH',
    );
    let ownedCreate;
    if (identity.createdBy === undefined) {
      requireEvidence(typeof proveCreatedOwner === 'function', 'CURRENT_OWNED_CREATE_PROOF_REQUIRED');
      ownedCreate = await proveCreatedOwner(f);
      requireEvidence(
        ownedCreate?.kind === 'verified-pp-create' &&
          ownedCreate.name === f.name &&
          ownedCreate.type === f.type &&
          ownedCreate.actor === actor.label &&
          /^[a-f0-9]{40}$/.test(ownedCreate.sourceRevision) &&
          /^[a-f0-9]{64}$/.test(ownedCreate.createReceiptHash),
        'CURRENT_OWNED_CREATE_PROOF_MISMATCH',
      );
      // Do not replace absent native creator metadata with the mutable responsible field.
      identity.createdBy = null;
    }
    const source = (
      await http.get(`${owner}/source/main`, { Accept: 'text/plain', 'Cache-Control': 'no-cache' })
    ).body;
    const active = (
      await http.get(`${owner}/source/main?version=active`, {
        Accept: 'text/plain',
        'Cache-Control': 'no-cache',
      })
    ).body;
    requireEvidence(
      source.includes(manifest.marker) && source === active,
      'CURRENT_NATIVE_SOURCE_NOT_ACTIVE',
    );
    const entry = {
      name: f.name,
      type: f.type,
      identity,
      sourceHash: sha(source),
      metadataHash: sha(response.body),
      ...(ownedCreate ? { nativeCreatorEvidence: 'unavailable', ownedCreate } : {}),
    };
    if (f.type === 'CLAS' && f.actor === 'writerA') {
      const source = (
        await http.get(`${owner}/includes/testclasses`, { Accept: 'text/plain', 'Cache-Control': 'no-cache' })
      ).body;
      const active = (
        await http.get(`${owner}/includes/testclasses?version=active`, {
          Accept: 'text/plain',
          'Cache-Control': 'no-cache',
        })
      ).body;
      const includes = root
        .children('include', namespace)
        .filter((i) => i.attribute('includeType', namespace) === 'testclasses');
      requireEvidence(
        includes.length === 1 &&
          includes[0].attribute('version', core) === 'active' &&
          includes[0].attribute('changedBy', core) === actor.sapUser &&
          source === active &&
          source.includes(manifest.marker),
        'CURRENT_TEST_INCLUDE_NOT_ACTIVE',
      );
      entry.testSourceHash = sha(source);
    }
    if (f.type === 'PROG') {
      const poolPath = `/sap/bc/adt/textelements/programs/${f.name.toLowerCase()}`;
      const pool = await http.get(`${poolPath}?version=inactive`, {
        Accept: 'application/vnd.sap.adt.textelements.v1+xml',
        'Cache-Control': 'no-cache',
      });
      const metadata = nativeXmlRoot(pool.body, 'textElement', 'http://www.sap.com/adt/textelements');
      requireEvidence(
        metadata.attribute('name', core) === f.name &&
          metadata.attribute('type', core) === 'PROG/PX' &&
          metadata.attribute('version', core) === 'active',
        'CURRENT_TEXT_POOL_NOT_ACTIVE',
      );
      entry.textPool = { metadataHash: sha(pool.body), parts: {} };
      for (const part of ['symbols', 'selections', 'headings']) {
        const value = (
          await http.get(`${poolPath}/source/${part}`, {
            'Cache-Control': 'no-cache',
            Accept: `application/vnd.sap.adt.textelements.${part}.v1`,
          })
        ).body;
        const active = (
          await http.get(`${poolPath}/source/${part}?version=active`, {
            'Cache-Control': 'no-cache',
            Accept: `application/vnd.sap.adt.textelements.${part}.v1`,
          })
        ).body;
        requireEvidence(value === active, 'CURRENT_TEXT_PART_NOT_ACTIVE');
        entry.textPool.parts[part] = sha(value);
      }
      const after = await http.get(`${poolPath}?version=inactive`, {
        Accept: 'application/vnd.sap.adt.textelements.v1+xml',
        'Cache-Control': 'no-cache',
      });
      requireEvidence(
        sha(after.body) === entry.textPool.metadataHash,
        'CURRENT_TEXT_POOL_CHANGED_DURING_READ',
      );
    }
    const after = await http.get(owner, { Accept: 'application/*', 'Cache-Control': 'no-cache' });
    requireEvidence(sha(after.body) === entry.metadataHash, 'CURRENT_NATIVE_METADATA_CHANGED_DURING_READ');
    result.fixtures.push(entry);
  }
  if (mode !== 'absence')
    result.recording = verifyCurrentRecording(
      await readTransport(manifest.bindings.recording.request),
      manifest,
      mode === 'identity' ? selected.filter((f) => f.actor === 'writerA') : [],
    );
  return result;
}
