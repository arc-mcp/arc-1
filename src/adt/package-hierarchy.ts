/**
 * DEVCLASS hierarchy resolver for `allowedPackages` subtree rules (`ZFOO/**`).
 *
 * Pattern semantics:
 *   - `ZFOO/**` means "package `ZFOO` and every transitive sub-package whose
 *     DEVCLASS chain leads back to `ZFOO`".
 *   - SAP stores the relationship in TDEVC.PARENTCL. ADT exposes direct children
 *     via the `informationsystem/search?packageName=...&objectType=DEVC/K` endpoint.
 *
 * Security invariants:
 *   - Resolution failure (network, permission, missing root) is fail-closed:
 *     the resolver throws and the caller (checkPackage) MUST treat the throw as
 *     "package denied". Never silently allow.
 *   - The cache is keyed by uppercased root; lookups are case-insensitive.
 *   - A rejected resolution purges its cache entry so a retry can succeed,
 *     but the current request still fails. This avoids cementing a transient
 *     failure for the full TTL.
 *
 * Cache lifetime:
 *   - Default 10 minutes. Override via `ARC1_PACKAGE_TREE_TTL_MS`. The cache
 *     can be invalidated manually via `invalidate(root?)` after admin actions
 *     that change the hierarchy (create_package / change_package / delete_package).
 */

import { AdtSafetyError } from './errors.js';

export interface PackageHierarchyResolver {
  /**
   * Returns true iff `pkg` is `root` itself or a descendant of `root` in the
   * DEVCLASS hierarchy. Names are case-insensitive.
   *
   * Throws on resolution failure. Callers MUST treat thrown errors as
   * fail-closed (deny the package).
   */
  isDescendantOrSelf(root: string, pkg: string): Promise<boolean>;

  /** Drop cached subtrees. With no arg, clears everything. */
  invalidate(root?: string): void;
}

/** Returns the direct sub-packages of `root` (uppercase names, no duplicates). */
export type DirectSubpackageFetcher = (root: string) => Promise<string[]>;

interface CacheEntry {
  expires: number;
  subtree: Promise<Set<string>>;
}

export interface AdtPackageHierarchyResolverOptions {
  /** Cache lifetime in milliseconds. Default 10 minutes. */
  ttlMs?: number;
  /**
   * Safety cap on subtree size. If the BFS exceeds this many packages, the
   * resolution fails-closed rather than producing an unbounded result.
   * Default 10000.
   */
  maxPackages?: number;
  /**
   * Safety cap on BFS depth. Prevents infinite recursion in the presence of
   * a corrupted hierarchy (e.g. a TDEVC cycle). Default 50.
   */
  maxDepth?: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PACKAGES = 10_000;
const DEFAULT_MAX_DEPTH = 50;

export class AdtPackageHierarchyResolver implements PackageHierarchyResolver {
  private readonly fetcher: DirectSubpackageFetcher;
  private readonly ttlMs: number;
  private readonly maxPackages: number;
  private readonly maxDepth: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(fetcher: DirectSubpackageFetcher, opts: AdtPackageHierarchyResolverOptions = {}) {
    this.fetcher = fetcher;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxPackages = opts.maxPackages ?? DEFAULT_MAX_PACKAGES;
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  async isDescendantOrSelf(root: string, pkg: string): Promise<boolean> {
    const upperRoot = root.toUpperCase();
    const upperPkg = pkg.toUpperCase();
    if (upperRoot === upperPkg) return true;
    const subtree = await this.getSubtree(upperRoot);
    return subtree.has(upperPkg);
  }

  invalidate(root?: string): void {
    if (root === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(root.toUpperCase());
  }

  private getSubtree(upperRoot: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.cache.get(upperRoot);
    if (cached && cached.expires > now) return cached.subtree;

    const subtree = this.computeSubtree(upperRoot).catch((err: unknown) => {
      // Fail-closed: purge so a retry can succeed; rethrow as AdtSafetyError
      // so callers see a stable error type at the safety boundary.
      this.cache.delete(upperRoot);
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdtSafetyError(
        `Failed to resolve DEVCLASS subtree under '${upperRoot}' for allowedPackages rule (denying for safety): ${msg}`,
      );
    });
    this.cache.set(upperRoot, { expires: now + this.ttlMs, subtree });
    return subtree;
  }

  private async computeSubtree(upperRoot: string): Promise<Set<string>> {
    const result = new Set<string>([upperRoot]);
    let frontier: string[] = [upperRoot];
    let depth = 0;
    while (frontier.length > 0) {
      if (depth >= this.maxDepth) {
        throw new Error(
          `DEVCLASS hierarchy under '${upperRoot}' exceeds maxDepth=${this.maxDepth} (possible cycle in TDEVC.PARENTCL)`,
        );
      }
      const nextFrontier: string[] = [];
      for (const cur of frontier) {
        const children = await this.fetcher(cur);
        for (const child of children) {
          const upper = child.toUpperCase();
          if (result.has(upper)) continue;
          result.add(upper);
          if (result.size > this.maxPackages) {
            throw new Error(
              `DEVCLASS subtree under '${upperRoot}' exceeds maxPackages=${this.maxPackages}; refusing for safety`,
            );
          }
          nextFrontier.push(upper);
        }
      }
      frontier = nextFrontier;
      depth++;
    }
    return result;
  }
}
