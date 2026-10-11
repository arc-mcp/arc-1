import { AdtApiError, AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { ApiReleaseContract, ApiReleaseStateInfo } from './types.js';
import { parseXml } from './xml-parser.js';

/**
 * Parse API release state XML from /sap/bc/adt/apireleases/{encoded-uri}.
 *
 * Returns structured release info with per-contract states (C0–C4),
 * successor information, and catalog metadata.
 *
 * Expected root: element with releasableObject, c0Release–c4Release, apiCatalogData.
 */
export function parseApiReleaseState(xml: string): ApiReleaseStateInfo {
  const parsed = parseXml(xml);
  // The root element name varies — find the first non-declaration key
  const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?'));
  const root = (rootKey ? parsed[rootKey] : parsed) as Record<string, unknown>;

  // releasableObject attrs
  const relObj = (root.releasableObject ?? {}) as Record<string, unknown>;

  // Parse C0–C4 contract releases
  const contracts: ApiReleaseContract[] = [];
  for (const key of ['c0Release', 'c1Release', 'c2Release', 'c3Release', 'c4Release']) {
    const release = root[key] as Record<string, unknown> | undefined;
    if (!release) continue;
    const status = (release.status ?? {}) as Record<string, unknown>;
    const successorsContainer = release.successors as Record<string, unknown> | undefined;
    const successorArr: Array<{ uri: string; type: string; name: string }> = [];
    if (successorsContainer) {
      const succs = Array.isArray(successorsContainer.successor)
        ? (successorsContainer.successor as Array<Record<string, unknown>>)
        : successorsContainer.successor
          ? [successorsContainer.successor as Record<string, unknown>]
          : [];
      for (const s of succs) {
        successorArr.push({
          uri: String(s['@_uri'] ?? ''),
          type: String(s['@_type'] ?? ''),
          name: String(s['@_name'] ?? ''),
        });
      }
    }
    contracts.push({
      contract: String(release['@_contract'] ?? key.replace('Release', '').toUpperCase()),
      state: String(status['@_state'] ?? ''),
      stateDescription: String(status['@_stateDescription'] ?? ''),
      useInKeyUserApps: String(release['@_useInKeyUserApps'] ?? 'false') === 'true',
      useInSAPCloudPlatform: String(release['@_useInSAPCloudPlatform'] ?? 'false') === 'true',
      successors: successorArr,
    });
  }

  // apiCatalogData attrs
  const catalog = (root.apiCatalogData ?? {}) as Record<string, unknown>;

  return {
    objectUri: String(relObj['@_uri'] ?? ''),
    objectType: String(relObj['@_type'] ?? ''),
    objectName: String(relObj['@_name'] ?? ''),
    contracts,
    isAnyContractReleased: String(catalog['@_isAnyContractReleased'] ?? 'false') === 'true',
    isAnyAssignmentPossible: String(catalog['@_isAnyAssignmentPossible'] ?? 'false') === 'true',
  };
}

export function assertApiReleaseStateConfirmed(
  info: ApiReleaseStateInfo,
  contract: string,
  expectedState: string,
  expectedVisibility?: { useInSAPCloudPlatform: boolean; useInKeyUserApps: boolean },
): void {
  const c = contract.toUpperCase();
  const confirmedContract = info.contracts.find((release) => release.contract.toUpperCase() === c);
  if (!confirmedContract) {
    throw new Error(`API release contract ${c} read-back did not include the contract after PUT.`);
  }
  if (confirmedContract.state !== expectedState) {
    throw new Error(
      `API release contract ${c} read-back state is ${confirmedContract.state || '(missing)'}, expected ${expectedState}.`,
    );
  }
  if (
    expectedState === 'RELEASED' &&
    expectedVisibility &&
    (confirmedContract.useInSAPCloudPlatform !== expectedVisibility.useInSAPCloudPlatform ||
      confirmedContract.useInKeyUserApps !== expectedVisibility.useInKeyUserApps)
  ) {
    throw new Error(`API release contract ${c} read-back visibility does not match the requested visibility.`);
  }
}

/**
 * Build the PUT body that sets an object's API release contract `state` (RELEASED / NOT_RELEASED).
 *
 * The apireleases GET (v10) returns a rich document, but the PUT to `…/apireleases/{uri}/{contract}`
 * accepts only a NARROW, strictly-ordered subset — live reverse-engineered on a4h 758 + 816: the
 * standalone contract block (`ars:contract="C1"`) carrying `status` + the successor scaffold, plus
 * a sibling `apiCatalogData`/`ApiCatalogs` envelope. Response-only nodes (`atom:link`,
 * `stateTransitions`, `transportObject`, `authValueObject`) are rejected with HTTP 400.
 *
 * Omitted visibility uses the contract's native defaults. Explicit selections respect its
 * ReadOnly flags; other requirements remain native SAP validation (C0–C4 differ).
 * NOT_RELEASED retains visibility. No fallback invents exposure.
 */
export const API_RELEASE_VISIBILITIES = ['cloudDevelopment', 'keyUserApps'] as const;
export type ApiReleaseVisibility = (typeof API_RELEASE_VISIBILITIES)[number][];

export function buildApiReleasePutBody(
  getXml: string,
  contract: string,
  state: string,
  visibility?: ApiReleaseVisibility,
): string {
  const c = contract.toUpperCase();
  const targetState = state.toUpperCase();
  if (targetState !== 'RELEASED' && targetState !== 'NOT_RELEASED') {
    throw new Error(`API release state must be RELEASED or NOT_RELEASED, got ${state}.`);
  }
  if (
    visibility !== undefined &&
    (targetState !== 'RELEASED' ||
      !Array.isArray(visibility) ||
      visibility.some((value) => !API_RELEASE_VISIBILITIES.includes(value)) ||
      new Set(visibility).size !== visibility.length)
  ) {
    throw new Error('apiVisibility must contain unique cloudDevelopment/keyUserApps selections and requires RELEASED.');
  }
  const tag = `c${c.slice(1)}Release`; // 'C1' -> 'c1Release'
  // The behaviour block lists the *Default visibility flags (self-closing element with "Default" attrs).
  const behaviour = new RegExp(`<ars:${tag}\\b([^>]*Default[^>]*)/>`).exec(getXml)?.[1] ?? '';
  const cloudDefault = /useInSAPCloudPlatformDefault="true"/.test(behaviour);
  const keyUserDefault = /useInKeyUserAppsDefault="true"/.test(behaviour);
  // The standalone contract block's opening tag (has ars:contract="<C>").
  const openTagMatch = new RegExp(`<ars:${tag}\\b[^>]*\\bars:contract="${c}"[^>]*>`).exec(getXml);
  if (!openTagMatch) {
    // Only the contracts the object type supports appear as settable `ars:contract="Cn"` blocks
    // (e.g. SRVD supports only C0, classic VIEW only C3) — list them so the caller can retry.
    const supported = [...new Set([...getXml.matchAll(/ars:contract="(C\d)"/g)].map((m) => m[1]))];
    const hint = supported.length ? ` This object supports: ${supported.join(', ')}.` : '';
    throw new Error(`API release contract ${c} is not available for this object.${hint}`);
  }
  let openTag = openTagMatch[0];
  if (targetState === 'RELEASED') {
    // Set both visibility flags from the contract's own defaults — both-false stays both-false (no
    // invented exposure); SAP decides whether that's acceptable for this contract.
    const setAttr = (tagText: string, attr: string, value: boolean): string => {
      const rendered = `${attr}="${value}"`;
      return new RegExp(`\\b${attr}="[^"]*"`).test(tagText)
        ? tagText.replace(new RegExp(`\\b${attr}="[^"]*"`), rendered)
        : tagText.replace(/>$/, ` ${rendered}>`);
    };
    const selected = (selection: 'cloudDevelopment' | 'keyUserApps', attribute: string, fallback: boolean): boolean => {
      if (visibility === undefined) return fallback;
      const requested = visibility.includes(selection);
      const readOnly = new RegExp(`\\b${attribute}ReadOnly="(true|false)"`).exec(behaviour)?.[1];
      const current = new RegExp(`\\b${attribute}="(true|false)"`).exec(openTagMatch[0])?.[1];
      const defaultKnown = new RegExp(`\\b${attribute}Default="(?:true|false)"`).test(behaviour);
      if (readOnly === undefined || current === undefined || !defaultKnown) {
        throw new Error(`API release contract ${c} has no complete ${selection} visibility metadata.`);
      }
      if (readOnly === 'true' && requested !== (current === 'true') && requested !== fallback) {
        throw new Error(`API release contract ${c} marks ${selection} visibility read-only.`);
      }
      return requested;
    };
    openTag = setAttr(
      openTag,
      'ars:useInSAPCloudPlatform',
      selected('cloudDevelopment', 'useInSAPCloudPlatform', cloudDefault),
    );
    openTag = setAttr(openTag, 'ars:useInKeyUserApps', selected('keyUserApps', 'useInKeyUserApps', keyUserDefault));
  }
  const contractBlock =
    `${openTag}<ars:status ars:state="${targetState}"/>` +
    '<ars:useConceptAsSuccessor>false</ars:useConceptAsSuccessor><ars:successors/><ars:successorConceptName/>' +
    `</ars:${tag}>`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<ars:apiRelease xmlns:ars="http://www.sap.com/adt/ars" xmlns:adtcore="http://www.sap.com/adt/core">' +
    contractBlock +
    '<ars:apiCatalogData ars:isAnyAssignmentPossible="true" ars:isAnyContractReleased="true"><ars:ApiCatalogs/></ars:apiCatalogData>' +
    '</ars:apiRelease>'
  );
}

export async function setApiReleaseState(
  http: AdtHttpClient,
  objectUri: string,
  opts: { state?: string; contract?: string; transport?: string; visibility?: ApiReleaseVisibility },
): Promise<ApiReleaseStateInfo & { changed: boolean }> {
  const state = (opts.state ?? 'RELEASED').toUpperCase();
  const contract = (opts.contract ?? 'C1').toUpperCase();
  if (state !== 'RELEASED' && state !== 'NOT_RELEASED') {
    throw new Error(`apiState must be RELEASED or NOT_RELEASED, got ${opts.state}.`);
  }
  const accept = 'application/vnd.sap.adt.apirelease.v10+xml';
  const encoded = encodeURIComponent(objectUri);
  const current = await http.get(`/sap/bc/adt/apireleases/${encoded}`, { Accept: accept });
  const body = buildApiReleasePutBody(current.body, contract, state, opts.visibility);
  const path = `/sap/bc/adt/apireleases/${encoded}/${contract.toLowerCase()}`;
  const expectedVisibility = {
    useInSAPCloudPlatform: /ars:useInSAPCloudPlatform="true"/.test(body),
    useInKeyUserApps: /ars:useInKeyUserApps="true"/.test(body),
  };
  let changed = true;
  try {
    await http.put(opts.transport ? `${path}?request=${encodeURIComponent(opts.transport)}` : path, body, accept, {
      Accept: accept,
    });
  } catch (err) {
    // SAP returns 400 "No changes were made" when the contract is already in the requested state.
    // Treat that as an idempotent no-op (the desired state already holds — confirmed via read-back
    // below) rather than surfacing a confusing error for "release something already released".
    if (
      err instanceof AdtApiError &&
      err.statusCode === 400 &&
      /no changes were made/i.test(`${err.message} ${err.responseBody ?? ''}`)
    ) {
      changed = false;
    } else {
      throw err;
    }
  }
  // The PUT outcome stands: a read-back that cannot confirm it must not look like a refused request.
  const unconfirmed =
    `SAP ${changed ? 'accepted' : 'reported no change for'} the ${contract} ${state} request for ${objectUri}, ` +
    'but the read-back did not confirm it, so the resulting state is unconfirmed. ' +
    'Read SAPRead(type="API_STATE") for this object before retrying or deleting it.';
  let confirmed: ApiReleaseStateInfo;
  try {
    confirmed = parseApiReleaseState((await http.get(`/sap/bc/adt/apireleases/${encoded}`, { Accept: accept })).body);
  } catch (error) {
    if (error instanceof AdtError)
      error.extraHint = error.extraHint ? `${unconfirmed}\n${error.extraHint}` : unconfirmed;
    else if (error instanceof Error) error.message = `${unconfirmed} ${error.message}`;
    throw error;
  }
  const result = confirmed.contracts.find((release) => release.contract.toUpperCase() === contract);
  if (!result) throw new Error(`API release contract ${contract} is missing from the read-back. ${unconfirmed}`);
  // On a real write, assert the full target (state + requested visibility). On an idempotent no-op,
  // explicit selections still require exact visibility; omission keeps the existing state-only no-op check.
  try {
    assertApiReleaseStateConfirmed(
      confirmed,
      contract,
      state,
      changed || opts.visibility !== undefined ? expectedVisibility : undefined,
    );
  } catch (error) {
    // A failed postcondition does not undo SAP's PUT. Expose the actual state so callers
    // can reconcile an applied release instead of treating this as a rejected mutation.
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ` +
        `Confirmed SAP result: ${JSON.stringify({ ...confirmed, changed })}.` +
        (result.state === 'RELEASED'
          ? ` If the release is unintended, call SAPManage set_api_state with objectUri="${objectUri}", ` +
            `contract="${contract}" and apiState="NOT_RELEASED"; verify API_STATE before deleting the object.`
          : ''),
    );
  }
  return { ...confirmed, changed };
}
