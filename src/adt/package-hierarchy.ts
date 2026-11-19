/**
 * DEVCLASS hierarchy resolver for `allowedPackages` subtree rules (`ZFOO/**`).
 *
 * Pattern semantics:
 *   - `ZFOO/**` means "package `ZFOO` and every transitive sub-package whose
 *     DEVCLASS chain leads back to `ZFOO`".
 *   - SAP stores the relationship in `TDEVC.PARENTCL`. ADT exposes it as the
 *     `pak:superPackage` of `GET /sap/bc/adt/packages/{name}`
 *     (`fetchSuperPackage`) and, top-down, as the direct children of
 *     `POST /sap/bc/adt/repository/nodestructure` (`AdtClient.getSubpackages`).
 *
 * Resolution walks the super-package chain of the package being checked, one
 * request per level, instead of expanding the rule's subtree top-down. One
 * chain answers every subtree rule, so the cost depends on the package's depth,
 * not on the size of the allowed subtrees (a broad rule such as `ZTIER1/**`
 * over hundreds of packages would otherwise cost one request per package).
 *
 * Fallback: when the checked package itself is not found (404), the resolver
 * cannot tell an unknown package from a system without the packages resource
 * (absent before 7.52, where every package read 404s). It then expands the
 * rule's subtree top-down, as before the chain walk existed, so subtree rules
 * keep working on those releases.
 *
 * Security invariants:
 *   - Resolution failure (network, permission) is
 *     fail-closed: the resolver throws and the caller (checkPackage) MUST treat
 *     the throw as "package denied". Never silently allow.
 *   - A super-package SAP does not know (404) or a top-level package ends the
 *     chain. Ending early can only lose membership, never grant it.
 *   - A cycle or a chain deeper than `maxDepth` throws (fail-closed); the
 *     top-down fallback is capped by `maxDepth` and `maxPackages`.
 *   - Caches are keyed by uppercased name; lookups are case-insensitive.
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
   * Drop every cached chain and subtree. A chain depends on every package
   * above the checked one, so a change anywhere clears all of them; `root` is
   * accepted for callers that name the changed package.
   */
  invalidate(root?: string): void;
}

/** Result of one package read: not found (404), or found with its super-package (absent when top-level). */
export type SuperPackageLookup = { found: false } | { found: true; superPackage?: string };

/** Reads the direct super-package of `pkg`. Throws on any failure other than "not found". */
export type SuperPackageFetcher = (pkg: string) => Promise<SuperPackageLookup>;

/** Returns the direct sub-packages of `root` (uppercase names, no duplicates). */
export type DirectSubpackageFetcher = (root: string) => Promise<string[]>;

export interface AdtPackageHierarchyResolverOptions {
  /** Cache lifetime in milliseconds. Default 10 minutes. */
  ttlMs?: number;
  /**
   * Safety cap on the chain length and on the depth of the top-down fallback.
   * Prevents an endless walk in the presence of a corrupted hierarchy. Default 50.
   */
  maxDepth?: number;
  /** Safety cap on the size of a subtree expanded by the top-down fallback. Default 10000. */
  maxPackages?: number;
  /**
   * Top-down fallback for a checked package the packages resource does not
   * find. Without it such a package matches no subtree rule.
   */
  fetchSubpackages?: DirectSubpackageFetcher;
}

interface CacheEntry<T> {
  expires: number;
  value: Promise<T>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_DEPTH = 50;
const DEFAULT_MAX_PACKAGES = 10_000;

export class AdtPackageHierarchyResolver implements PackageHierarchyResolver {
  private readonly fetchSuperPackage: SuperPackageFetcher;
  private readonly fetchSubpackages?: DirectSubpackageFetcher;
  private readonly ttlMs: number;
  private readonly maxDepth: number;
  private readonly maxPackages: number;
  /** Chain per checked package, nearest first; undefined when the package itself was not found. */
  private readonly chains = new Map<string, CacheEntry<string[] | undefined>>();
  /** Top-down subtree per root, filled only by the fallback. */
  private readonly subtrees = new Map<string, CacheEntry<Set<string>>>();

  constructor(fetchSuperPackage: SuperPackageFetcher, opts: AdtPackageHierarchyResolverOptions = {}) {
    this.fetchSuperPackage = fetchSuperPackage;
    this.fetchSubpackages = opts.fetchSubpackages;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxPackages = opts.maxPackages ?? DEFAULT_MAX_PACKAGES;
  }

  async isDescendantOrSelf(root: string, pkg: string): Promise<boolean> {
    const upperRoot = root.trim().toUpperCase();
    const upperPkg = pkg.trim().toUpperCase();
    if (upperRoot === upperPkg) return true;
    const chain = await this.cached(this.chains, upperPkg, () => this.computeChain(upperPkg), 'super-packages of');
    if (chain) return chain.includes(upperRoot);
    if (!this.fetchSubpackages) return false;
    const subtree = await this.cached(this.subtrees, upperRoot, () => this.computeSubtree(upperRoot), 'subtree under');
    return subtree.has(upperPkg);
  }

  invalidate(_root?: string): void {
    this.chains.clear();
    this.subtrees.clear();
  }

  private cached<T>(cache: Map<string, CacheEntry<T>>, key: string, compute: () => Promise<T>, what: string) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;

    const value = compute().catch((err: unknown) => {
      // Fail-closed: purge so a retry can succeed; rethrow as AdtSafetyError
      // so callers see a stable error type at the safety boundary.
      cache.delete(key);
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdtSafetyError(
        `Failed to resolve the DEVCLASS ${what} '${key}' for an allowedPackages subtree rule (denying for safety): ${msg}`,
      );
    });
    cache.set(key, { expires: now + this.ttlMs, value });
    return value;
  }

  private async computeChain(upperPkg: string): Promise<string[] | undefined> {
    const chain = [upperPkg];
    let lookup = await this.fetchSuperPackage(upperPkg);
    if (!lookup.found) return undefined;
    for (;;) {
      if (!lookup.found || !lookup.superPackage?.trim()) return chain;
      const parent = lookup.superPackage.trim().toUpperCase();
      if (chain.includes(parent)) {
        throw new Error(`DEVCLASS hierarchy above '${upperPkg}' contains a cycle at '${parent}' (TDEVC.PARENTCL)`);
      }
      chain.push(parent);
      if (chain.length > this.maxDepth) {
        throw new Error(`DEVCLASS hierarchy above '${upperPkg}' exceeds maxDepth=${this.maxDepth}`);
      }
      lookup = await this.fetchSuperPackage(parent);
    }
  }

  private async computeSubtree(upperRoot: string): Promise<Set<string>> {
    const fetchSubpackages = this.fetchSubpackages as DirectSubpackageFetcher;
    const result = new Set<string>([upperRoot]);
    let frontier: string[] = [upperRoot];
    for (let depth = 0; frontier.length > 0; depth++) {
      if (depth >= this.maxDepth) {
        throw new Error(
          `DEVCLASS hierarchy under '${upperRoot}' exceeds maxDepth=${this.maxDepth} (possible cycle in TDEVC.PARENTCL)`,
        );
      }
      const next: string[] = [];
      for (const current of frontier) {
        for (const child of await fetchSubpackages(current)) {
          const upper = child.toUpperCase();
          if (result.has(upper)) continue;
          result.add(upper);
          if (result.size > this.maxPackages) {
            throw new Error(
              `DEVCLASS subtree under '${upperRoot}' exceeds maxPackages=${this.maxPackages}; refusing for safety`,
            );
          }
          next.push(upper);
        }
      }
      frontier = next;
    }
    return result;
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
 * Direct super-package of a package. `found: false` when SAP answers 404 (unknown package, or no
 * packages resource before 7.52); every other failure throws, so the allowedPackages subtree check
 * stays fail-closed.
 */
export async function fetchSuperPackage(
  http: AdtHttpClient,
  safety: SafetyConfig,
  packageName: string,
): Promise<SuperPackageLookup> {
  checkOperation(safety, OperationType.Read, 'GetSuperPackage');
  try {
    const resp = await http.get(`/sap/bc/adt/packages/${encodeURIComponent(packageName)}`, undefined, {
      suppressNotFoundLog: true,
    });
    return { found: true, superPackage: parseSuperPackage(resp.body) };
  } catch (err) {
    if (err instanceof AdtApiError && err.statusCode === 404) return { found: false };
    throw err;
  }
}
