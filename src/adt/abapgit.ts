/**
 * abapGit ADT bridge client helpers.
 *
 * Bridge endpoints live under /sap/bc/adt/abapgit/* and use XML payloads.
 */

import { isIP } from 'node:net';
import { AdtApiError, AdtSafetyError, classifyAbapgitError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { PackageHierarchyResolver } from './package-hierarchy.js';
import { assertCanonicalHostRelativeAdtPath } from './path-safety.js';
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
const ABAPGIT_REDACTION_MAX_STRING_LENGTH = 4_096;
const ABAPGIT_REDACTION_STRING_PREFIX_LENGTH = 2_000;
const GIT_SECRET_QUERY_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'auth',
  'credential',
  'accesskey',
  'access_key',
  'privatekey',
  'private_key',
  'sshkey',
  'ssh_key',
  'signature',
  'cookie',
  'session',
  'sessionid',
  'jsessionid',
  'sapsessionid',
];

function isCredentialQueryKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return GIT_SECRET_QUERY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function redactCredentialAssignments(value: string): string {
  return value
    .replace(
      /\bauthorization\s*([:=])\s*(?:bearer|basic)\s+(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      'authorization$1[REDACTED]',
    )
    .replace(
      /\b(bearer|basic)\s+(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      '$1 [REDACTED]',
    )
    .replace(
      /\b(password|passwd|passphrase|pwd|token|secret|api[_-]?key|authorization|credential|access[_-]?key|private[_-]?key|ssh[_-]?key|signature|cookie|jsessionid|sap[_-]?sessionid|sessionid|session|(?:client[_-]?vcs[_-]?)?auth[_-]?(?:pwd|user|token)|remote[_-]?(?:password|user|token))(?:(?:\\{1,64})?["'])?\s*([:=])\s*(?:(?:bearer|basic)\s+)?(?:\\{1,64}"[^"]*\\{1,64}"|\\{1,64}'[^']*\\{1,64}'|"[^"]*"|'[^']*'|[^\s,;&<>"']+)/gi,
      '$1$2[REDACTED]',
    );
}

function normalizeEscapedUrlSlashes(value: string): string {
  return value.replace(/\\{1,8}\//g, '/').replace(/\\{1,8}u([0-9a-f]{4})/gi, (encoded, hex: string) => {
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9_.-]$/i.test(decoded) ? decoded : encoded;
  });
}

function boundAbapGitString(value: string, originalLength = value.length): string {
  if (value.length <= ABAPGIT_REDACTION_MAX_STRING_LENGTH && originalLength <= ABAPGIT_REDACTION_MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, ABAPGIT_REDACTION_STRING_PREFIX_LENGTH)}... [truncated ${originalLength} chars]`;
}

function abapGitStringInput(value: string): string {
  return value.length <= ABAPGIT_REDACTION_MAX_STRING_LENGTH
    ? value
    : value.slice(0, ABAPGIT_REDACTION_MAX_STRING_LENGTH);
}

function redactUrlAssignments(value: string): string {
  return redactCredentialAssignments(value).replace(
    /(^|[&;])([^=&;]+)(?:=([^&;]*))?/g,
    (part, separator: string, rawKey: string) => {
      let decodedKey = rawKey;
      try {
        decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Keep the raw key for the sensitivity check.
      }
      return isCredentialQueryKey(decodedKey) ? `${separator}[REDACTED]=[REDACTED]` : part;
    },
  );
}

export function redactGitUrl(value: string): string {
  const normalizedValue = normalizeEscapedUrlSlashes(abapGitStringInput(value));
  try {
    const parsed = new URL(normalizedValue);
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = redactCredentialAssignments(parsed.pathname);
    if (parsed.search) parsed.search = `?${redactUrlAssignments(parsed.search.slice(1))}`;
    if (parsed.hash) parsed.hash = `#${redactUrlAssignments(parsed.hash.slice(1))}`;
    return parsed.toString();
  } catch {
    return '[INVALID URL]';
  }
}

function redactGitText(value: string): string {
  const withoutXmlCredentials = redactCredentialAssignments(normalizeEscapedUrlSlashes(abapGitStringInput(value)))
    .replace(/(<(?:[\w.-]+:)?remotePassword\b[^>]*>)[\s\S]*?(<\/(?:[\w.-]+:)?remotePassword>)/gi, '$1[REDACTED]$2')
    .replace(/(<(?:[\w.-]+:)?remoteUser\b[^>]*>)[\s\S]*?(<\/(?:[\w.-]+:)?remoteUser>)/gi, '$1[REDACTED]$2');
  const redacted = withoutXmlCredentials.replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;]+$/)?.[0] ?? '';
    const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${redactGitUrl(core)}${trailing}`;
  });
  return boundAbapGitString(redacted, value.length);
}

function sanitizedAbapGitApiError(err: AdtApiError, path: string): AdtApiError {
  const parsed = classifyAbapgitError(err.responseBody ?? '');
  const detail = [parsed.namespace ? `[${parsed.namespace}]` : undefined, parsed.message].filter(Boolean).join(' ');
  return new AdtApiError(
    redactGitText(detail || err.message),
    err.statusCode,
    redactGitText(err.path || path),
    redactGitText(err.responseBody ?? ''),
  );
}

function literalHostIsPrivate(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    const [a = 0, b = 0] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (ipVersion === 6) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    const mappedV4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedV4) return literalHostIsPrivate(mappedV4);
    // WHATWG URL canonicalizes dotted IPv4-mapped literals to two hexadecimal
    // hextets (for example ::ffff:127.0.0.1 -> ::ffff:7f00:1).
    const mappedHex = host.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1] ?? '0', 16);
      const low = Number.parseInt(mappedHex[2] ?? '0', 16);
      return literalHostIsPrivate(`${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`);
    }
    return false;
  }
  return false;
}

/** Validate caller-controlled Git URLs before SAP is allowed to contact them. */
export function validateGitRemoteUrl(value: string, options: { rejectPrivateLiteral?: boolean } = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AdtSafetyError('Git remote URL is invalid. Use an absolute HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new AdtSafetyError('Git remote URL is blocked: only HTTPS URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new AdtSafetyError('Git remote URL is blocked: URL userinfo is not allowed; use explicit credential fields.');
  }
  if (options.rejectPrivateLiteral && literalHostIsPrivate(parsed.hostname)) {
    throw new AdtSafetyError(
      'Git remote URL is blocked: localhost and literal private/link-local addresses are not allowed.',
    );
  }
  return parsed;
}

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
function childNodes(
  node: Record<string, unknown> | undefined,
  key: string,
  allowEmptyElement = false,
): Array<Record<string, unknown>> {
  const val = node?.[key];
  const isNode = (entry: unknown): entry is Record<string, unknown> =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry);
  if (Array.isArray(val)) {
    if (val.every(isNode)) return val;
    throw new Error(`abapGit bridge returned an invalid <${key}> element shape.`);
  }
  if (isNode(val)) return [val];
  if (val === undefined) return [];
  if (allowEmptyElement && typeof val === 'string' && val.trim() === '') return [];
  throw new Error(`abapGit bridge returned an invalid <${key}> element shape.`);
}

function singleChildNode(
  node: Record<string, unknown> | undefined,
  key: string,
  allowEmptyElement = false,
): Record<string, unknown> | undefined {
  const nodes = childNodes(node, key, allowEmptyElement);
  if (nodes.length > 1) throw new Error(`abapGit bridge returned duplicate <${key}> elements.`);
  return nodes[0];
}

function assertKnownChildren(node: Record<string, unknown>, operation: string, allowed: readonly string[]): void {
  const unknown = Object.keys(node).some((key) => !key.startsWith('@_') && !allowed.includes(key));
  if (unknown) throw new Error(`abapGit bridge returned unexpected child elements in ${operation}.`);
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
    throw new Error(redactGitText(`abapGit repository ${repo.key} does not expose a ${type} HATEOAS link.`));
  }

  return {
    ...link,
    href: assertCanonicalHostRelativeAdtPath(absolutizeLink(link.href), `${ABAPGIT_BASE}/`),
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

function parseAbapGitXml(xml: string, operation: string): Record<string, unknown> {
  try {
    return parseXml(xml);
  } catch {
    // fast-xml-parser includes response prefixes in some syntax errors. SAP may echo remote
    // credentials in that response, so expose only a fixed diagnostic across MCP/CLI boundaries.
    throw new Error(`abapGit bridge returned invalid XML for ${operation}. Check the installed ADT backend version.`);
  }
}

export function parseAbapGitRepos(xml: string): AbapGitRepo[] {
  const parsed = parseAbapGitXml(xml, 'repository-list');
  const root = rootNode(parsed, 'repositories');
  if (!root) throw unexpectedShape('repository-list', 'repositories');
  assertKnownChildren(root, 'repository-list', ['repository']);
  const repositories = childNodes(root, 'repository');

  return repositories.map((repo) => {
    const links = parseAbapGitLinks(repo);
    const writeProtected = boolish(field(repo, 'writeProtected', 'write_protected'));
    const key = field(repo, 'key', 'repoKey', 'id') ?? '';
    const packageName = field(repo, 'package', 'packageName') ?? '';
    const url = field(repo, 'url') ?? '';
    if (!key || !packageName || !url) {
      throw new Error('abapGit bridge returned an incomplete <repository> row; key, package, and url are required.');
    }

    return {
      key,
      package: packageName,
      url,
      branchName: field(repo, 'branchName', 'branch_name', 'branch') ?? '',
      selectedBranch: field(repo, 'selectedBranch', 'selected_branch'),
      deserializedBy: field(repo, 'deserializedBy', 'deserialized_by'),
      ...(writeProtected !== undefined ? { writeProtected } : {}),
      createdBy: field(repo, 'createdBy', 'created_by'),
      createdAt: field(repo, 'createdAt', 'created_at'),
      dotAbapGit: field(repo, 'dotAbapGit', 'dot_abapgit'),
      links,
    } as AbapGitRepo;
  });
}

export function parseAbapGitExternalInfo(xml: string): AbapGitExternalInfo {
  const parsed = parseAbapGitXml(xml, 'external-info');
  const infoNode = rootNode(parsed, 'externalRepoInfo');
  if (!infoNode) throw unexpectedShape('external-info', 'externalRepoInfo');
  assertKnownChildren(infoNode, 'external-info', [
    'accessMode',
    'access_mode',
    'defaultBranch',
    'default_branch',
    'selectedBranch',
    'selected_branch',
    'branch',
    'user',
  ]);

  const branches = childNodes(infoNode, 'branch').map((branch): AbapGitBranch => {
    const name = field(branch, 'name', 'branchName', 'displayName') ?? '';
    if (!name) throw new Error('abapGit bridge returned an incomplete external branch row.');
    return {
      name,
      isHead: boolish(field(branch, 'head', 'isHead')),
      sha1: field(branch, 'sha1', 'hash'),
    };
  });

  const userNode = singleChildNode(infoNode, 'user');
  const user: AbapGitUser | undefined = userNode
    ? {
        name: field(userNode, 'name', 'user'),
        email: field(userNode, 'email', 'mail'),
      }
    : undefined;

  const accessMode = field(infoNode as Record<string, unknown>, 'accessMode', 'access_mode');
  const defaultBranch = field(infoNode as Record<string, unknown>, 'defaultBranch', 'default_branch');
  const selectedBranch = field(infoNode as Record<string, unknown>, 'selectedBranch', 'selected_branch');
  if (!accessMode && !defaultBranch && !selectedBranch && branches.length === 0) {
    throw new Error('abapGit bridge returned an incomplete <externalRepoInfo> response.');
  }

  return {
    accessMode,
    defaultBranch,
    selectedBranch,
    branches,
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
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === 'string' && value.trim() === '') return {};
    return undefined;
  }
  return undefined;
}

/** An unrecognised 200 body must fail loudly — a silent empty parse is what hid the old wire bugs. */
function unexpectedShape(what: string, expected: string): Error {
  return new Error(
    `abapGit bridge returned an unexpected ${what} response: no <${expected}> root. ` +
      'Check the installed abapGit ADT backend version.',
  );
}

/**
 * Parse a clone/pull response (ZABAPGIT_ST_REPO_POST_RES): `abapObjects:abapObjects` → `abapObject`,
 * or the pre-ffb914a1 (2020-08) `objects` → `object` with `obj_*` field names. Each entry reports what
 * the bridge deserialized into the package, with abapGit's own status message.
 */
export function parseAbapGitObjects(xml: string): AbapGitObject[] {
  const parsed = parseAbapGitXml(xml, 'clone/pull');
  const root = rootNode(parsed, 'abapObjects', 'objects');
  if (!root) throw unexpectedShape('clone/pull', 'abapObjects');
  assertKnownChildren(root, 'clone/pull', ['abapObject', 'object']);

  return [...childNodes(root, 'abapObject'), ...childNodes(root, 'object')].map((node) => {
    const type = field(node, 'type', 'obj_type');
    const name = field(node, 'name', 'obj_name');
    if (!type || !name) {
      throw new Error('abapGit bridge returned an incomplete object row; type and name are required.');
    }
    return {
      type,
      name,
      package: field(node, 'package'),
      status: field(node, 'status', 'obj_status'),
      msgType: field(node, 'msgType', 'msg_type'),
      msgText: field(node, 'msgText', 'msg_text'),
    };
  });
}

function assertSuccessfulObjectMessages(objects: AbapGitObject[], path: string, responseBody: string): void {
  const rejected = objects.filter((object) => /^[EAX]$/i.test(String(object.msgType ?? '').trim()));
  if (rejected.length === 0) return;
  const details = rejected
    .slice(0, 5)
    .map((object) => {
      const identity = [object.type, object.name].filter(Boolean).join(' ');
      return `${object.msgType}${identity ? ` ${identity}` : ''}${object.msgText ? `: ${object.msgText}` : ''}`;
    })
    .join('; ');
  throw new AdtApiError(
    redactGitText(`abapGit reported rejecting object messages: ${details}`),
    500,
    path,
    redactGitText(responseBody),
  );
}

function parseStagingObjects(root: Record<string, unknown>, wrapper: string): AbapGitStagingObject[] {
  const wrapperNode = singleChildNode(root, wrapper, true);
  if (wrapperNode) assertKnownChildren(wrapperNode, `<${wrapper}>`, ['abapgitobject']);
  return childNodes(wrapperNode, 'abapgitobject').map((node) => {
    const name = field(node, 'name');
    const type = field(node, 'type');
    if (!name || (wrapper !== 'ignored_objects' && !type)) {
      throw new Error('abapGit bridge returned an incomplete staging object row.');
    }
    const files = childNodes(node, 'abapgitfile').map((file) => {
      const fileName = field(file, 'name');
      const path = field(file, 'path');
      if (!fileName || !path) throw new Error('abapGit bridge returned an incomplete staging file row.');
      return {
        name: fileName,
        path,
        localState: field(file, 'localState'),
        remoteState: field(file, 'remoteState'),
      };
    });
    return { name, type, uri: field(node, 'uri'), wbkey: field(node, 'wbkey'), files };
  });
}

/**
 * Parse a staging response (`abapgitstaging:abapgitstaging`, ZABAPGIT_ST_REPO_STAGE).
 *
 * Locally changed objects arrive under `unstaged_objects`; the client decides which of them to send
 * back as `staged_objects` on push. The bridge pre-fills author/committer from abapGit's stored git
 * user, so a push can round-trip them instead of asking the caller for an identity.
 */
export function parseAbapGitStaging(xml: string): Pick<AbapGitStaging, 'objects' | 'ignored' | 'comment'> {
  const parsed = parseAbapGitXml(xml, 'staging');
  const root = rootNode(parsed, 'abapgitstaging');
  if (!root) throw unexpectedShape('staging', 'abapgitstaging');
  assertKnownChildren(root, 'staging', ['unstaged_objects', 'staged_objects', 'ignored_objects', 'abapgit_comment']);
  const commentNode = singleChildNode(root, 'abapgit_comment', true);
  const user = (key: string): AbapGitUser | undefined => {
    const node = singleChildNode(commentNode, key);
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
      throw sanitizedAbapGitApiError(err, path);
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
  checkOperation(safety, OperationType.Update, 'AbapGitExternalInfo');
  checkGit(safety, 'external_info');
  validateGitRemoteUrl(url, { rejectPrivateLiteral: true });

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
  validateGitRemoteUrl(params.url);
  await enforceRepoPackageAllowed(safety, params.package, resolver, 'AbapGitCreateRepo');

  const path = `${ABAPGIT_BASE}/repos`;
  const body = buildRepoPayloadXml(params);
  const resp = await requestAbapGit(path, () =>
    http.post(path, body, REPO_V3, {
      Accept: REPO_OBJECT_ACCEPT,
      ...authHeaders(params.user, params.password),
    }),
  );

  const objects = parseAbapGitObjects(resp.body);
  assertSuccessfulObjectMessages(objects, path, resp.body);
  return objects;
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
  const subtreeGrants = safety.allowedPackages.filter((entry) => {
    const normalized = entry.trim().toUpperCase();
    return normalized === '*' || normalized.endsWith('/**');
  });
  if (subtreeGrants.length === 0) {
    throw new AdtSafetyError(
      `${label}: abapGit may create or update subpackages below '${repoPackage}'. ` +
        `Require a subtree grant that contains '${repoPackage}' or global '*' (configured: ${JSON.stringify(
          safety.allowedPackages,
        )}); exact-package and prefix-wildcard grants are insufficient.`,
    );
  }
  await checkPackage({ ...safety, allowedPackages: subtreeGrants }, repoPackage, resolver);
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
  resolver?: PackageHierarchyResolver | null,
  repoPackage?: string,
): Promise<AbapGitObject[]> {
  checkOperation(safety, OperationType.Update, 'AbapGitPullRepo');
  checkGit(safety, 'pull');
  await enforceRepoPackageAllowed(safety, repoPackage, resolver, 'AbapGitPullRepo');
  if (params.url) validateGitRemoteUrl(params.url);

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

  const objects = parseAbapGitObjects(resp.body);
  assertSuccessfulObjectMessages(objects, path, resp.body);
  return objects;
}

export async function unlinkRepo(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  resolver?: PackageHierarchyResolver | null,
  repoPackage?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Delete, 'AbapGitUnlinkRepo');
  checkGit(safety, 'unlink');
  await enforceRepoPackageAllowed(safety, repoPackage, resolver, 'AbapGitUnlinkRepo');

  const path = `${ABAPGIT_BASE}/repos/${encodeURIComponent(repoId)}`;
  const response = await requestAbapGit(path, () => http.delete(path, { Accept: REPO_V3 }));
  if (response.body.trim() !== '') {
    throw new Error(
      'abapGit bridge returned an unexpected non-empty unlink response; repository removal was not accepted as verified.',
    );
  }
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
  resolver?: PackageHierarchyResolver | null,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'AbapGitPushRepo');
  checkGit(safety, 'push');
  await enforceRepoPackageAllowed(safety, repo.package, resolver, 'AbapGitPushRepo');

  const link = findRepoLink(repo, 'push_link');
  const body = buildStagingPayloadXml(staging);
  const response = await requestAbapGit(link.href, () =>
    http.post(link.href, body, REPO_STAGE_V1, {
      Accept: REPO_STAGE_V1,
      ...authHeaders(user, password),
    }),
  );
  if (response.body.trim() !== '') {
    throw new Error(
      'abapGit bridge returned an unexpected non-empty push response; remote completion was not accepted as verified.',
    );
  }
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
        return {
          ok: false,
          message: redactGitText(parsed.message ?? AdtApiError.extractCleanMessage(err.responseBody ?? '')),
        };
      }
      throw sanitizedAbapGitApiError(err, link.href);
    }
    throw err;
  }

  if (!resp.body || resp.body.trim().length === 0) {
    return { ok: true, message: null };
  }

  const parsed = classifyAbapgitError(resp.body);
  return {
    ok: false,
    message: redactGitText(parsed.message ?? AdtApiError.extractCleanMessage(resp.body)),
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
  resolver?: PackageHierarchyResolver | null,
  repoPackage?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'AbapGitSwitchBranch');
  checkGit(safety, create ? 'create_branch' : 'switch_branch');
  await enforceRepoPackageAllowed(safety, repoPackage, resolver, 'AbapGitSwitchBranch');

  const path = `${ABAPGIT_BASE}/repos/${encodeURIComponent(repoId)}/branches/${encodeURIComponent(branch)}?create=${create ? 'true' : 'false'}`;
  // Switching fetches from the remote, so a private repo needs the bridge credentials here too.
  const response = await requestAbapGit(path, () =>
    http.post(path, '', undefined, { Accept: REPO_V3, ...authHeaders(user, password) }),
  );
  if (response.body.trim() !== '') {
    throw new Error(
      `abapGit bridge returned an unexpected non-empty ${create ? 'create-branch' : 'switch-branch'} response; branch completion was not accepted as verified.`,
    );
  }
}

export async function createBranch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  repoId: string,
  branch: string,
  user?: string,
  password?: string,
  resolver?: PackageHierarchyResolver | null,
  repoPackage?: string,
): Promise<void> {
  await switchBranch(http, safety, repoId, branch, true, user, password, resolver, repoPackage);
}
