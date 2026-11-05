import { logger } from '../server/logger.js';
import { hasExplicitUnrestrictedRequestPolicy } from './allowlist-policy.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext, singleTargetMutationContext } from './mutation-context.js';
import { getMutationContext } from './mutation-http.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import { pinnedNativeText } from './pinned-managed-resources.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, parseXml } from './xml-parser.js';

/** Result of a publish/unpublish operation */
export interface PublishResult {
  severity: string;
  shortText: string;
  longText: string;
}

function findDeepValue(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeepValue(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  for (const val of Object.values(record)) {
    const found = findDeepValue(val, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parsePublishResponse(xml: string): PublishResult {
  if (!xml.trim()) return { severity: 'OK', shortText: '', longText: '' };
  const parsed = parseXml(xml);
  const severity = findDeepValue(parsed, 'SEVERITY');
  const shortText = findDeepValue(parsed, 'SHORT_TEXT');
  const longText = findDeepValue(parsed, 'LONG_TEXT');
  return {
    severity: severity != null ? String(severity) : 'UNKNOWN',
    shortText: shortText != null ? String(shortText) : '',
    longText: longText != null ? String(longText) : '',
  };
}

function publishBody(name: string): string {
  return `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:name="${escapeXmlAttr(name)}"/></adtcore:objectReferences>`;
}

// On-prem releases (live-verified on S/4HANA 2023, SAP_BASIS 758) render the publish/unpublish
// job status ONLY as application/vnd.sap.as+xml: any Accept that does not cover it is rejected
// with 406 SADT_RESOURCE 044 ("The message content is not acceptable. Accepted content types:
// application/vnd.sap.as+xml") — e.g. the newer-release media type
// application/vnd.sap.adt.businessservices.odatav4.v1+xml. Naming as+xml first keeps 758
// deterministic; the wildcard keeps backends with other renderers working.
const PUBLISH_JOB_ACCEPT = 'application/vnd.sap.as+xml, application/*;q=0.8';

/**
 * Fully-qualified AS-XML media type for a publish/unpublish job, as Eclipse ADT sends it.
 * All four serviceType × job combinations live-verified against S/4HANA 2023 (SAP_BASIS 758).
 */
function publishJobAsXmlType(serviceType: 'odatav2' | 'odatav4', job: 'publishjob' | 'unpublishjob'): string {
  return `application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.businessservices.${serviceType}.${job}`;
}

/**
 * True when the backend rejected content negotiation and named application/vnd.sap.as+xml as
 * the only type it supports. Self-scoping: only ever fires on backends that emit exactly this
 * complaint, so the as+xml retry cannot affect systems that accept the primary headers.
 */
function isAsXmlOnlyNegotiationError(err: unknown): boolean {
  if (!(err instanceof AdtApiError)) return false;
  if (err.statusCode !== 406 && err.statusCode !== 415) return false;
  return `${err.message} ${err.responseBody ?? ''}`.includes('application/vnd.sap.as+xml');
}

async function postPublishJob(
  http: AdtHttpClient,
  serviceType: 'odatav2' | 'odatav4',
  job: 'publishjob' | 'unpublishjob',
  name: string,
  version: string,
  options?: AdtRequestOptions,
): Promise<PublishResult> {
  const path = `/sap/bc/adt/businessservices/${serviceType}/${job}s?servicename=${encodeURIComponent(name)}&serviceversion=${encodeURIComponent(version)}`;
  try {
    const resp = await http.post(path, publishBody(name), 'application/xml', { Accept: PUBLISH_JOB_ACCEPT }, options);
    return parsePublishResponse(resp.body);
  } catch (err) {
    if (!isAsXmlOnlyNegotiationError(err)) throw err;
    const asXmlType = publishJobAsXmlType(serviceType, job);
    logger.debug(`Publish job content negotiation rejected — retrying with ${asXmlType}`, { path });
    const resp = await http.post(path, publishBody(name), asXmlType, { Accept: asXmlType }, options);
    return parsePublishResponse(resp.body);
  }
}

/** Publish an OData service binding (makes the service available for consumption) */
export async function publishServiceBinding(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  version = '0001',
  serviceType: 'odatav2' | 'odatav4' = 'odatav2',
  profile?: PublicationProfile,
): Promise<PublishResult> {
  checkOperation(safety, OperationType.Activate, 'PublishServiceBinding');
  if (profile)
    return submitQualifiedPublication(
      http,
      safety,
      profile,
      'publishjob',
      name,
      version,
      serviceType,
      publishBody(name),
      publishJobAsXmlType(serviceType, 'publishjob'),
    );
  singleTargetMutationContext(safety);
  // A lost/replaced response does not prove that SAP rejected the publish job.
  return postPublishJob(http, serviceType, 'publishjob', name, version, {
    retryTransientErrors: false,
  });
}

/** Unpublish an OData service binding (removes the service from consumption) */
export async function unpublishServiceBinding(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  version = '0001',
  serviceType: 'odatav2' | 'odatav4' = 'odatav2',
  profile?: PublicationProfile,
): Promise<PublishResult> {
  checkOperation(safety, OperationType.Activate, 'UnpublishServiceBinding');
  if (profile)
    return submitQualifiedPublication(
      http,
      safety,
      profile,
      'unpublishjob',
      name,
      version,
      serviceType,
      publishBody(name),
      publishJobAsXmlType(serviceType, 'unpublishjob'),
    );
  singleTargetMutationContext(safety);
  return postPublishJob(http, serviceType, 'unpublishjob', name, version);
}

export interface PublicationProfile {
  readonly mode: 'pinned-pp';
}

type Job = 'publishjob' | 'unpublishjob';

interface Grant {
  http: AdtHttpClient;
  safety: SafetyConfig;
  context: PinnedMutationContext;
  job: Job;
  name: string;
  version: string;
  /** Absolute expiry of freshly verified configuration or native membership; never renewed by transport waits. */
  beforeSubmit: () => Promise<number>;
  onSubmit: () => void;
}

const grants = new WeakMap<PublicationProfile, Grant>();

/** Only the private executor registers a request-owned grant after complete preauthorization. */
export function publicationProfile(grant: Grant): PublicationProfile {
  assertMutationContext(grant.safety, grant.context);
  if (getMutationContext(grant.http, grant.safety) !== grant.context)
    throw new AdtSafetyError('Publication authority requires the owning mutation transport.');
  const profile = Object.freeze({ mode: 'pinned-pp' as const });
  grants.set(profile, { ...grant });
  return profile;
}

/** Unlike the legacy parser, HTTP success/empty bodies/unknown status cannot acknowledge a pinned job. */
export function parseQualifiedPublicationStatus(xml: string): PublishResult {
  if (Buffer.byteLength(xml) > 64 * 1024) throw new AdtSafetyError('Publication status exceeds 64 KiB.');
  const root = nativeXmlRoot(xml, 'abap', 'http://www.sap.com/abapxml', true);
  const data = root.child('values', 'http://www.sap.com/abapxml')?.child('DATA', '');
  if (!data) throw new AdtSafetyError('Publication did not return the qualified native status.');
  const severity = pinnedNativeText(data, 'SEVERITY', '');
  if (severity !== 'OK' && severity !== 'ERROR')
    throw new AdtSafetyError('Publication returned an unqualified native severity.');
  return {
    severity,
    shortText: pinnedNativeText(data, 'SHORT_TEXT', ''),
    longText: pinnedNativeText(data, 'LONG_TEXT', ''),
  };
}

export async function submitQualifiedPublication(
  http: AdtHttpClient,
  safety: SafetyConfig,
  profile: PublicationProfile,
  job: Job,
  name: string,
  version: string,
  serviceType: string,
  body: string,
  contentType: string,
): Promise<PublishResult> {
  const grant = grants.get(profile);
  if (
    !grant ||
    grant.http !== http ||
    grant.safety !== safety ||
    grant.job !== job ||
    grant.name !== name ||
    grant.version !== version ||
    serviceType !== 'odatav4'
  )
    throw new AdtSafetyError('Missing or mismatched private publication authority.');
  // Consume before asynchronous validation: neither concurrent submission nor a failed attempt can replay.
  grants.delete(profile);
  assertMutationContext(safety, grant.context);
  // Resolve asynchronous CSRF preparation before the final native scope/configuration reads.
  await http.fetchCsrfToken(grant.context.requestPolicy);
  const expiresAt = await grant.beforeSubmit();
  if (!Number.isFinite(expiresAt))
    throw new AdtSafetyError('Publication authority requires a finite native evidence expiry.');
  const requestPolicy = {
    ...grant.context.requestPolicy,
    deadline: Math.min(grant.context.requestPolicy.deadline, expiresAt),
  };
  assertMutationContext(safety, grant.context);
  checkOperation(safety, OperationType.Activate, 'PinnedPublication');
  throwIfRequestCancelled(requestPolicy);
  grant.onSubmit();
  const response = await http.post(
    `/sap/bc/adt/businessservices/odatav4/${job}s?servicename=${encodeURIComponent(name)}&serviceversion=${encodeURIComponent(version)}`,
    body,
    contentType,
    { Accept: 'application/vnd.sap.as+xml' },
    requestPolicy,
  );
  return parseQualifiedPublicationStatus(response.body);
}

export interface PublicationRecordingProfile {
  readonly kind: 'native-governed-unverified';
  readonly context: PinnedMutationContext;
  readonly assert: () => void;
}

const profiles = new WeakSet<PublicationRecordingProfile>();

export function nativeGovernedPublicationRecording(
  safety: SafetyConfig,
  context: PinnedMutationContext,
  coverage: { systemType: string; abapRelease?: string },
  validateInvocation: () => void,
): PublicationRecordingProfile {
  const assert = () => {
    assertMutationContext(safety, context);
    throwIfRequestCancelled(context.requestPolicy);
    if (
      context.mode !== 'pinned-pp' ||
      !safety.allowWrites ||
      !hasExplicitUnrestrictedRequestPolicy(context.recordingPolicy.allowedTransports) ||
      !hasExplicitUnrestrictedRequestPolicy(context.recordingPolicy.serverAllowedTransports)
    )
      throw new AdtSafetyError(
        'Native-governed publication requires explicit unrestricted "*" on both request policies.',
      );
    // Source coverage only: neither release nor discovery substitutes for native/PP qualification.
    if (coverage.systemType !== 'onprem' || coverage.abapRelease !== '758')
      throw new AdtSafetyError(
        'The private native-governed publication profile covers the reviewed on-premise 758 V4 route only.',
      );
    validateInvocation();
  };
  assert();
  const profile = Object.freeze({ kind: 'native-governed-unverified' as const, context, assert });
  profiles.add(profile);
  return profile;
}

export function assertPublicationRecording(
  safety: SafetyConfig,
  context: PinnedMutationContext,
  profile: PublicationRecordingProfile,
): void {
  if (!profiles.has(profile) || profile.context !== context)
    throw new AdtSafetyError('Missing or mismatched private publication recording profile.');
  assertMutationContext(safety, context);
  profile.assert();
}
