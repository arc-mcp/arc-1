/**
 * abapGit ADT bridge client helpers.
 *
 * Bridge endpoints live under /sap/bc/adt/abapgit/* and use XML payloads.
 */

import { AdtApiError, AdtSafetyError, classifyAbapgitError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { PackageHierarchyResolver } from './package-hierarchy.js';
import { checkGit, checkOperation, checkPackage, OperationType, type SafetyConfig } from './safety.js';
import type {
  AbapGitBranch,
  AbapGitExternalInfo,
  AbapGitLink,
  AbapGitObject,
  AbapGitRepo,
  AbapGitStaging,
  AbapGitStagingObject,
  AbapGitUser,
} from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

const ABAPGIT_BASE = '/sap/bc/adt/abapgit';
const REPOS_V2 = 'application/abapgit.adt.repos.v2+xml';
const REPO_V3 = 'application/abapgit.adt.repo.v3+xml';
const REPO_OBJECT_V1 = 'application/abapgit.adt.repo.object.v1+xml';
const REPO_OBJECT_V2 = 'application/abapgit.adt.repo.object.v2+xml';
const REPO_STAGE_V1 = 'application/abapgit.adt.repo.stage.v1+xml';
const EXTERNAL_INFO_REQUEST_V2 = 'application/abapgit.adt.repo.info.ext.request.v2+xml';
const EXTERNAL_INFO_RESPONSE_V2 = 'application/abapgit.adt.repo.info.ext.response.v2+xml';
// clone/pull answer with the deserialized object list (ZABAPGIT_ST_REPO_POST_RES). The bridge 406s on
// an Accept it cannot render (live-verified on 758), and ADT_Backend ffb914a1 (2020-08-31) bumped that
// response from repo.object.v1 to .v2 — so name both. repo.v3 is the REQUEST type; it never renders.
const REPO_OBJECT_ACCEPT = `${REPO_OBJECT_V2}, ${REPO_OBJECT_V1}`;

const NS_REPO = 'http://www.sap.com/adt/abapgit/repositories';
const NS_STAGING = 'http://www.sap.com/adt/abapgit/staging';
const NS_ADTCORE = 'http://www.sap.com/adt/core';

function boolish(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  const norm = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!norm) return undefined;
  if (norm === 'true' || norm === 'x' || norm === '1') return true;
  if (norm === 'false' || norm === '0') return false;
  return undefined;
}

function field(node: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const attr = node[`@_${key}`];
    if (attr !== undefined && attr !== null && String(attr).trim() !== '') return String(attr);

    const direct = node[key];
    if (typeof direct === 'string' && direct.trim() !== '') return direct;

    if (typeof direct === 'object' && direct !== null) {
      const text = (direct as Record<string, unknown>)['#text'];
      if (typeof text === 'string' && text.trim() !== '') return text;
    }
  }
  return undefined;
}

function encodePassword(password: string): string {
  return Buffer.from(password, 'utf-8').toString('base64');
}

function authHeaders(user?: string, password?: string): Record<string, string> {
  if (!user || !password) return {};
  return {
    Username: user,
    Password: encodePassword(password),
  };
}

/** Direct children of `node` under `key`, normalised to an array (fast-xml-parser collapses singletons). */
function childNodes(node: Record<string, unknown> | undefined, key: string): Array<Record<string, unknown>> {
  const val = node?.[key];
  if (Array.isArray(val)) return val as Array<Record<string, unknown>>;
  if (val && typeof val === 'object') return [val as Record<string, unknown>];
  return [];
}

function attr(name: string, value: string | undefined): string {
  return value ? ` ${name}="${escapeXmlAttr(value)}"` : '';
}

function absolutizeLink(href: string): string {
  if (/^https?:\/\//i.test(href)) {
    const u = new URL(href);
    return `${u.pathname}${u.search}`;
  }
  if (href.startsWith('/')) return href;
  return `${ABAPGIT_BASE}/${href}`;
}

function findRepoLink(repo: AbapGitRepo, type: 'stage_link' | 'push_link' | 'check_link' | 'pull_link'): AbapGitLink {
  const relNeedle = type.replace('_link', '');
  const link = repo.links.find((candidate) => {
    const rel = candidate.rel.toLowerCase();
    const href = candidate.href.toLowerCase();
    const candidateType = (candidate.type ?? '').toLowerCase();

    if (candidateType === type) return true;
    if (rel.endsWith(`/${relNeedle}`) || rel.includes(`/${relNeedle}/`)) return true;
    if (relNeedle === 'check') {
      if (rel.endsWith('/checks') || rel.includes('/checks/')) return true;
      if (href.endsWith('/checks') || href.includes('/checks/')) return true;
    }
    return href.endsWith(`/${relNeedle}`) || href.includes(`/${relNeedle}/`);
  });

  if (!link) {
    throw new Error(`abapGit repository ${repo.key} does not expose a ${type} HATEOAS link.`);
  }

  return {
    ...link,
    href: absolutizeLink(link.href),
  };
}

function parseAbapGitLinks(node: Record<string, unknown>): AbapGitLink[] {
  const links = findDeepNodes(node, 'link');
  return links
    .map((link) => ({
      rel: field(link, 'rel') ?? '',
      href: field(link, 'href') ?? '',
      type: field(link, 'type'),
      title: field(link, 'title'),
    }))
    .filter((link) => Boolean(link.rel) && Boolean(link.href));
}

export function parseAbapGitRepos(xml: string): AbapGitRepo[] {
  const parsed = parseXml(xml);
  const repositories = findDeepNodes(parsed, 'repository');

  return repositories
    .map((repo) => {
      const links = parseAbapGitLinks(repo);
      const writeProtected = boolish(field(repo, 'writeProtected', 'write_protected'));

      return {
        key: field(repo, 'key', 'repoKey', 'id') ?? '',
        package: field(repo, 'package', 'packageName') ?? '',
        url: field(repo, 'url') ?? '',
        branchName: field(repo, 'branchName', 'branch_name', 'branch') ?? '',
        selectedBranch: field(repo, 'selectedBranch', 'selected_branch'),
        deserializedBy: field(repo, 'deserializedBy', 'deserialized_by'),
        ...(writeProtected !== undefined ? { writeProtected } : {}),
        createdBy: field(repo, 'createdBy', 'created_by'),
        createdAt: field(repo, 'createdAt', 'created_at'),
        dotAbapGit: field(repo, 'dotAbapGit', 'dot_abapgit'),
        links,
      } as AbapGitRepo;
    })
    .filter((repo) => repo.key && repo.package && repo.url);
}

export function parseAbapGitExternalInfo(xml: string): AbapGitExternalInfo {
  const parsed = parseXml(xml);
  const infoNode = findDeepNodes(parsed, 'externalRepoInfo')[0] ?? parsed;

  const branches = findDeepNodes(infoNode, 'branch').map((branch): AbapGitBranch => {
    const name = field(branch, 'name', 'branchName', 'displayName') ?? '';
    return {
      name,
      isHead: boolish(field(branch, 'head', 'isHead')),
      sha1: field(branch, 'sha1', 'hash'),
    };
  });

  const userNode = findDeepNodes(infoNode, 'user')[0];
  const user: AbapGitUser | undefined = userNode
    ? {
        name: field(userNode, 'name', 'user'),
        email: field(userNode, 'email', 'mail'),
      }
    : undefined;

  return {
    accessMode: field(infoNode as Record<string, unknown>, 'accessMode', 'access_mode'),
    defaultBranch: field(infoNode as Record<string, unknown>, 'defaultBranch', 'default_branch'),
    selectedBranch: field(infoNode as Record<string, unknown>, 'selectedBranch', 'selected_branch'),
    branches: branches.filter((branch) => branch.name),
    ...(user ? { user } : {}),
  };
}

/**
 * The first present root among `keys`, or undefined. An empty element (`<abapObjects/>`) parses to `''`,
 * not an object — that is a legitimate "nothing happened" answer, so return an empty node for it.
 */
function rootNode(parsed: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    if (!(key in parsed)) continue;
    const value = parsed[key];
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }
  return undefined;
}

/** An unrecognised 200 body must fail loudly — a silent empty parse is what hid the old wire bugs. */
function unexpectedShape(what: string, expected: string, xml: string): Error {
  return new Error(
    `abapGit bridge returned an unexpected ${what} response: no <${expected}> root. ` +
      `Check the installed abapGit ADT backend version. First 200 chars: ${xml.trim().slice(0, 200)}`,
  );
}

/**
 * Parse a clone/pull response (ZABAPGIT_ST_REPO_POST_RES): `abapObjects:abapObjects` → `abapObject`,
 * or the pre-ffb914a1 (2020-08) `objects` → `object` with `obj_*` field names. Each entry reports what
 * the bridge deserialized into the package, with abapGit's own status message.
 */
export function parseAbapGitObjects(xml: string): AbapGitObject[] {
  const parsed = parseXml(xml);
  const root = rootNode(parsed, 'abapObjects', 'objects');
  if (!root) throw unexpectedShape('clone/pull', 'abapObjects', xml);

  return [...childNodes(root, 'abapObject'), ...childNodes(root, 'object')].map((node) => ({
    type: field(node, 'type', 'obj_type'),
    name: field(node, 'name', 'obj_name'),
    package: field(node, 'package'),
    status: field(node, 'status', 'obj_status'),
    msgType: field(node, 'msgType', 'msg_type'),
    msgText: field(node, 'msgText', 'msg_text'),
  }));
}

function parseStagingObjects(root: Record<string, unknown>, wrapper: string): AbapGitStagingObject[] {
  return childNodes(childNodes(root, wrapper)[0], 'abapgitobject').map((node) => ({
    name: field(node, 'name'),
    type: field(node, 'type'),
    uri: field(node, 'uri'),
    wbkey: field(node, 'wbkey'),
    files: childNodes(node, 'abapgitfile').map((file) => ({
      name: field(file, 'name') ?? '',
      path: field(file, 'path'),
      localState: field(file, 'localState'),
      remoteState: field(file, 'remoteState'),
    })),
  }));
}

/**
 * Parse a staging response (`abapgitstaging:abapgitstaging`, ZABAPGIT_ST_REPO_STAGE).
 *
 * Locally changed objects arrive under `unstaged_objects`; the client decides which of them to send
 * back as `staged_objects` on push. The bridge pre-fills author/committer from abapGit's stored git
 * user, so a push can round-trip them instead of asking the caller for an identity.
 */
export function parseAbapGitStaging(xml: string): Pick<AbapGitStaging, 'objects' | 'ignored' | 'comment'> {
  const parsed = parseXml(xml);
  const root = rootNode(parsed, 'abapgitstaging');
  if (!root) throw unexpectedShape('staging', 'abapgitstaging', xml);
  const commentNode = childNodes(root, 'abapgit_comment')[0];
  const user = (key: string): AbapGitUser | undefined => {
    const node = childNodes(commentNode, key)[0];
    if (!node) return undefined;
    return { name: field(node, 'name'), email: field(node, 'email') };
  };

  return {
    objects: parseStagingObjects(root, 'unstaged_objects'),
    ignored: parseStagingObjects(root, 'ignored_objects'),
    ...(commentNode
      ? { comment: { comment: field(commentNode, 'comment'), author: user('author'), committer: user('committer') } }
      : {}),
  };
}

async function requestAbapGit(
  path: string,
  run: () => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AdtApiError) {
      const parsed = classifyAbapgitError(err.responseBody ?? '');
      if (parsed.message || parsed.namespace) {
        const detail = [parsed.namespace ? `[${parsed.namespace}]` : undefined, parsed.message]
          .filter(Boolean)
          .join(' ');
        throw new AdtApiError(detail, err.statusCode, err.path || path, err.responseBody);
      }
    }
    throw err;
  }
}

function buildRepoPayloadXml(params: {
  package: string;
  url: string;
  branchName?: string;
  transportRequest?: string;
  user?: string;
  password?: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<abapgitrepo:repository xmlns:abapgitrepo="${NS_REPO}">
  <abapgitrepo:package>${escapeXmlAttr(params.package)}</abapgitrepo:package>
  <abapgitrepo:url>${escapeXmlAttr(params.url)}</abapgitrepo:url>
  ${params.branchName ? `<abapgitrepo:branchName>${escapeXmlAttr(params.branchName)}</abapgitrepo:branchName>` : ''}
  ${params.transportRequest ? `<abapgitrepo:transportRequest>${escapeXmlAttr(params.transportRequest)}</abapgitrepo:transportRequest>` : ''}
  ${params.user ? `<abapgitrepo:remoteUser>${escapeXmlAttr(params.user)}</abapgitrepo:remoteUser>` : ''}
  ${params.password ? `<abapgitrepo:remotePassword>${escapeXmlAttr(params.password)}</abapgitrepo:remotePassword>` : ''}
</abapgitrepo:repository>`;
}

function buildExternalInfoRequestXml(url: string, user?: string, password?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<abapgitexternalrepo:externalRepoInfoRequest xmlns:abapgitexternalrepo="http://www.sap.com/adt/abapgit/externalRepo">
  <abapgitexternalrepo:url>${escapeXmlAttr(url)}</abapgitexternalrepo:url>
  ${user ? `<abapgitexternalrepo:remoteUser>${escapeXmlAttr(user)}</abapgitexternalrepo:remoteUser>` : ''}
  ${password ? `<abapgitexternalrepo:remotePassword>${escapeXmlAttr(password)}</abapgitexternalrepo:remotePassword>` : ''}
</abapgitexternalrepo:externalRepoInfoRequest>`;
}

/**
 * Build a push payload (ZABAPGIT_ST_REPO_STAGE, root `abapgitstaging`).
 *
 * The objects to export go under `staged_objects`; the bridge only reads each object's reference and
 * its files' name/path/localState, plus the comment. Element order follows the transformation.
 */
function buildStagingPayloadXml(staging: AbapGitStaging): string {
  const stagedObjects = (staging.objects ?? [])
    .map((object) => {
      const files = object.files
        .map(
          (file) =>
            `      <abapgitstaging:abapgitfile${attr('abapgitstaging:name', file.name)}` +
            `${attr('abapgitstaging:path', file.path)}${attr('abapgitstaging:localState', file.localState)}` +
            `${attr('abapgitstaging:remoteState', file.remoteState)}/>`,
        )
        .join('\n');
      return (
        `    <abapgitstaging:abapgitobject${attr('adtcore:name', object.name)}${attr('adtcore:type', object.type)}` +
        `${attr('adtcore:uri', object.uri)}${attr('abapgitstaging:wbkey', object.wbkey)}>\n${files}\n` +
        `    </abapgitstaging:abapgitobject>`
      );
    })
    .join('\n');

  const staged = stagedObjects
    ? `  <abapgitstaging:staged_objects>\n${stagedObjects}\n  </abapgitstaging:staged_objects>`
    : '  <abapgitstaging:staged_objects/>';
  const comment = staging.comment ?? {};

  return `<?xml version="1.0" encoding="UTF-8"?>
<abapgitstaging:abapgitstaging xmlns:abapgitstaging="${NS_STAGING}" xmlns:adtcore="${NS_ADTCORE}">
  <abapgitstaging:unstaged_objects/>
${staged}
  <abapgitstaging:ignored_objects/>
  <abapgitstaging:abapgit_comment${attr('abapgitstaging:comment', comment.comment)}>
    <abapgitstaging:author${attr('abapgitstaging:name', comment.author?.name)}${attr('abapgitstaging:email', comment.author?.email)}/>
    <abapgitstaging:committer${attr('abapgitstaging:name', comment.committer?.name)}${attr('abapgitstaging:email', comment.committer?.email)}/>
  </abapgitstaging:abapgit_comment>
</abapgitstaging:abapgitstaging>`;
}

export async function listRepos(http: AdtHttpClient, safety: SafetyConfig): Promise<AbapGitRepo[]> {
  checkOperation(safety, OperationType.Read, 'AbapGitListRepos');
  const path = `${ABAPGIT_BASE}/repos`;
  const resp = await requestAbapGit(path, () => http.get(path, { Accept: REPOS_V2 }));
  return parseAbapGitRepos(resp.body);
}

export async function getExternalInfo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  url: string,
  user?: string,
  password?: string,
): Promise<AbapGitExternalInfo> {
  checkOperation(safety, OperationType.Read, 'AbapGitExternalInfo');

  const path = `${ABAPGIT_BASE}/externalrepoinfo`;
  const body = buildExternalInfoRequestXml(url, user, password);
  const resp = await requestAbapGit(path, () =>
    http.post(path, body, EXTERNAL_INFO_REQUEST_V2, {
      Accept: EXTERNAL_INFO_RESPONSE_V2,
      ...authHeaders(user, password),
    }),
  );

  return parseAbapGitExternalInfo(resp.body);
}

export async function createRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  params: {
    package: string;
    url: string;
    branchName?: string;
    transportRequest?: string;
    user?: string;
    password?: string;
  },
  resolver?: PackageHierarchyResolver | null,
): Promise<AbapGitObject[]> {
  checkOperation(safety, OperationType.Create, 'AbapGitCreateRepo');
  checkGit(safety, 'clone');
  await checkPackage(safety, params.package, resolver);

  const path = `${ABAPGIT_BASE}/repos`;
  const body = buildRepoPayloadXml(params);
  const resp = await requestAbapGit(path, () =>
    http.post(path, body, REPO_V3, {
      Accept: REPO_OBJECT_ACCEPT,
      ...authHeaders(params.user, params.password),
    }),
  );

  return parseAbapGitObjects(resp.body);
}

/**
 * Enforce the package allowlist against a repository's server-bound package (R9).
 *
 * `clone` chooses (and gates) the target package up-front, but `pull`/`push` operate on an
 * existing repo whose binding ARC-1 did not choose — abapGit deserializes the remote content
 * into that bound package regardless of any caller-supplied `package` value (which it ignores
 * for an existing repo). Re-validate the real binding here. Fail-closed when an allowlist is
 * configured and the package can't be resolved; no-op when unrestricted.
 */
export async function enforceRepoPackageAllowed(
  safety: SafetyConfig,
  repoPackage: string | undefined,
  resolver: PackageHierarchyResolver | null | undefined,
  label = 'AbapGitRepo',
): Promise<void> {
  if (safety.allowedPackages.length === 0) return;
  if (!repoPackage) {
    throw new AdtSafetyError(
      `${label}: cannot resolve the repository's package to check it against allowedPackages (${JSON.stringify(
        safety.allowedPackages,
      )}); refusing.`,
    );
  }
  await checkPackage(safety, repoPackage, resolver);
}

export async function pullRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  params: {
    package?: string;
    url?: string;
    branchName?: string;
    transportRequest?: string;
    user?: string;
    password?: string;
  } = {},
): Promise<AbapGitObject[]> {
  checkOperation(safety, OperationType.Update, 'AbapGitPullRepo');
  checkGit(safety, 'pull');

  const path = `${ABAPGIT_BASE}/repos/${encodeURIComponent(repoId)}/pull`;
  const body = buildRepoPayloadXml({
    package: params.package ?? '$TMP',
    url: params.url ?? '',
    branchName: params.branchName,
    transportRequest: params.transportRequest,
    user: params.user,
    password: params.password,
  });

  const resp = await requestAbapGit(path, () =>
    http.post(path, body, REPO_V3, {
      Accept: REPO_OBJECT_ACCEPT,
      ...authHeaders(params.user, params.password),
    }),
  );

  return parseAbapGitObjects(resp.body);
}

export async function unlinkRepo(http: AdtHttpClient, safety: SafetyConfig, repoId: string): Promise<void> {
  checkOperation(safety, OperationType.Delete, 'AbapGitUnlinkRepo');
  checkGit(safety, 'unlink');

  const path = `${ABAPGIT_BASE}/repos/${encodeURIComponent(repoId)}`;
  await requestAbapGit(path, () => http.delete(path, { Accept: REPO_V3 }));
}

export async function stageRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repo: AbapGitRepo,
  user?: string,
  password?: string,
): Promise<AbapGitStaging> {
  checkOperation(safety, OperationType.Update, 'AbapGitStageRepo');
  checkGit(safety, 'stage');

  const link = findRepoLink(repo, 'stage_link');
  const resp = await requestAbapGit(link.href, () =>
    http.get(link.href, {
      Accept: REPO_STAGE_V1,
      'Content-Type': REPO_STAGE_V1,
      ...authHeaders(user, password),
    }),
  );

  return {
    repoKey: repo.key,
    branchName: repo.branchName,
    ...parseAbapGitStaging(resp.body),
  };
}

export async function pushRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repo: AbapGitRepo,
  staging: AbapGitStaging,
  user?: string,
  password?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'AbapGitPushRepo');
  checkGit(safety, 'push');

  const link = findRepoLink(repo, 'push_link');
  const body = buildStagingPayloadXml(staging);
  await requestAbapGit(link.href, () =>
    http.post(link.href, body, REPO_STAGE_V1, {
      Accept: REPO_STAGE_V1,
      ...authHeaders(user, password),
    }),
  );
}

export async function checkRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repo: AbapGitRepo,
  user?: string,
  password?: string,
): Promise<{ ok: boolean; message: string | null }> {
  checkOperation(safety, OperationType.Read, 'AbapGitCheckRepo');

  const link = findRepoLink(repo, 'check_link');
  // Live trial returns 5xx with `<namespace id="org.abapgit.adt"/>` + message like
  // "HTTP error 421" when the remote Git registry is unreachable. That's diagnostic
  // info the LLM should see — normalise to {ok:false,message} rather than throwing.
  let resp: Awaited<ReturnType<AdtHttpClient['post']>>;
  try {
    resp = await http.post(link.href, '', undefined, {
      Accept: REPO_V3,
      ...authHeaders(user, password),
    });
  } catch (err) {
    if (err instanceof AdtApiError) {
      const parsed = classifyAbapgitError(err.responseBody ?? '');
      if (parsed.namespace === 'org.abapgit.adt') {
        return { ok: false, message: parsed.message ?? AdtApiError.extractCleanMessage(err.responseBody ?? '') };
      }
    }
    throw err;
  }

  if (!resp.body || resp.body.trim().length === 0) {
    return { ok: true, message: null };
  }

  const parsed = classifyAbapgitError(resp.body);
  return {
    ok: false,
    message: parsed.message ?? AdtApiError.extractCleanMessage(resp.body),
  };
}

export async function switchBranch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  branch: string,
  create = false,
  user?: string,
  password?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'AbapGitSwitchBranch');
  checkGit(safety, create ? 'create_branch' : 'switch_branch');

  const path = `${ABAPGIT_BASE}/repos/${encodeURIComponent(repoId)}/branches/${encodeURIComponent(branch)}?create=${create ? 'true' : 'false'}`;
  // Switching fetches from the remote, so a private repo needs the bridge credentials here too.
  await requestAbapGit(path, () => http.post(path, '', undefined, { Accept: REPO_V3, ...authHeaders(user, password) }));
}

export async function createBranch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  branch: string,
  user?: string,
  password?: string,
): Promise<void> {
  await switchBranch(http, safety, repoId, branch, true, user, password);
}
