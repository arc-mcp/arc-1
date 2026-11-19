/**
 * DEVCLASS hierarchy resolver for `allowedPackages` subtree rules (`ZFOO/**`).
 *
 * Pattern semantics:
 *   - `ZFOO/**` means "package `ZFOO` and every transitive sub-package whose
 *     DEVCLASS chain leads back to `ZFOO`".
 *   - SAP stores the relationship in `TDEVC.PARENTCL`. ADT exposes it as the
 *     `pak:superPackage` of `GET /sap/bc/adt/packages/{name}`
 *     (`fetchSuperPackage`).
 *
 * Resolution walks the super-package chain of the package being checked, one
 * request per level, instead of expanding the rule's subtree top-down. One
 * chain answers every subtree rule, so the cost depends on the package's depth,
 * not on the size of the allowed subtrees (a broad rule such as `ZTIER1/**`
 * over hundreds of packages would otherwise cost one request per package).
 *
 * Security invariants:
 *   - Resolution failure (network, permission) is fail-closed: the resolver
 *     throws and the caller (checkPackage) MUST treat the throw as "package
 *     denied". Never silently allow.
 *   - A package SAP does not know (404) or a top-level package ends the chain.
 *     Ending early can only lose membership, never grant it.
 *   - A cycle or a chain deeper than `maxDepth` throws (fail-closed).
 *   - The cache is keyed by uppercased package; lookups are case-insensitive.
 *   - A rejected resolution purges its cache entry so a retry can succeed,
 *     but the current request still fails. This avoids cementing a transient
 *     failure for the full TTL.
 *
 * Cache lifetime:
 *   - Default 10 minutes (see `DEFAULT_TTL_MS`); overridable per-instance via
 *     `AdtPackageHierarchyResolverOptions.ttlMs`. The cache can be invalidated
 *     via `invalidate()` after admin actions that change the hierarchy
 *     (create_package / change_package / delete_package).
 */

import { AdtApiError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { findDeepNodes, parseXml } from './xml-parser.js';

export interface PackageHierarchyResolver {
  /**
   * Returns true iff `pkg` is `root` itself or a descendant of `root` in the
   * DEVCLASS hierarchy. Names are case-insensitive.
   *
   * Throws on resolution failure. Callers MUST treat thrown errors as
   * fail-closed (deny the package).
   */
  isDescendantOrSelf(root: string, pkg: string): Promise<boolean>;

  /**
   * Drop cached chains. A chain depends on every package above the checked
   * one, so a change anywhere clears all of them; `root` is accepted for
   * callers that name the changed package.
   */
  invalidate(root?: string): void;
}

/**
 * Returns the direct super-package of `pkg`, or undefined when `pkg` is
 * top-level or unknown to SAP. Throws on any other failure.
 */
export type SuperPackageFetcher = (pkg: string) => Promise<string | undefined>;

interface CacheEntry {
  expires: number;
  /** The package itself followed by its super-packages, uppercased, nearest first. */
  chain: Promise<string[]>;
}

export interface AdtPackageHierarchyResolverOptions {
  /** Cache lifetime in milliseconds. Default 10 minutes. */
  ttlMs?: number;
  /**
   * Safety cap on the chain length. Prevents an endless walk in the presence
   * of a corrupted hierarchy. Default 50.
   */
  maxDepth?: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_DEPTH = 50;

export class AdtPackageHierarchyResolver implements PackageHierarchyResolver {
  private readonly fetchSuperPackage: SuperPackageFetcher;
  private readonly ttlMs: number;
  private readonly maxDepth: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(fetchSuperPackage: SuperPackageFetcher, opts: AdtPackageHierarchyResolverOptions = {}) {
    this.fetchSuperPackage = fetchSuperPackage;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  async isDescendantOrSelf(root: string, pkg: string): Promise<boolean> {
    const upperRoot = root.toUpperCase();
    const upperPkg = pkg.toUpperCase();
    if (upperRoot === upperPkg) return true;
    const chain = await this.getChain(upperPkg);
    return chain.includes(upperRoot);
  }

  invalidate(_root?: string): void {
    this.cache.clear();
  }

  private getChain(upperPkg: string): Promise<string[]> {
    const now = Date.now();
    const cached = this.cache.get(upperPkg);
    if (cached && cached.expires > now) return cached.chain;

    const chain = this.computeChain(upperPkg).catch((err: unknown) => {
      // Fail-closed: purge so a retry can succeed; rethrow as AdtSafetyError
      // so callers see a stable error type at the safety boundary.
      this.cache.delete(upperPkg);
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdtSafetyError(
        `Failed to resolve the DEVCLASS super-packages of '${upperPkg}' for an allowedPackages subtree rule (denying for safety): ${msg}`,
      );
    });
    this.cache.set(upperPkg, { expires: now + this.ttlMs, chain });
    return chain;
  }

  private async computeChain(upperPkg: string): Promise<string[]> {
    const chain = [upperPkg];
    let current = upperPkg;
    for (;;) {
      const parent = (await this.fetchSuperPackage(current))?.trim().toUpperCase();
      if (!parent) return chain;
      if (chain.includes(parent)) {
        throw new Error(`DEVCLASS hierarchy above '${upperPkg}' contains a cycle at '${parent}' (TDEVC.PARENTCL)`);
      }
      chain.push(parent);
      if (chain.length > this.maxDepth) {
        throw new Error(`DEVCLASS hierarchy above '${upperPkg}' exceeds maxDepth=${this.maxDepth}`);
      }
      current = parent;
    }
  }
}

/**
 * Super-package name from `GET /sap/bc/adt/packages/{name}` (`<pak:superPackage adtcore:name="…"/>`),
 * uppercased; undefined for a top-level package (absent or empty element).
 */
export function parseSuperPackage(xml: string): string | undefined {
  const [node] = findDeepNodes(parseXml(xml), 'superPackage');
  const name = String(node?.['@_name'] ?? '').trim();
  return name ? name.toUpperCase() : undefined;
}

/**
 * Direct super-package of a package. Undefined when the package is top-level or SAP does not know
 * it (404); every other failure throws, so the allowedPackages subtree check stays fail-closed.
 */
export async function fetchSuperPackage(
  http: AdtHttpClient,
  safety: SafetyConfig,
  packageName: string,
): Promise<string | undefined> {
  checkOperation(safety, OperationType.Read, 'GetSuperPackage');
  try {
    const resp = await http.get(`/sap/bc/adt/packages/${encodeURIComponent(packageName)}`, undefined, {
      suppressNotFoundLog: true,
    });
    return parseSuperPackage(resp.body);
  } catch (err) {
    if (err instanceof AdtApiError && err.statusCode === 404) return undefined;
    throw err;
  }
}
