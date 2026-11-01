/**
 * DEVCLASS hierarchy resolver for `allowedPackages` subtree rules (`ZFOO/**`).
 *
 * Pattern semantics:
 *   - `ZFOO/**` means "package `ZFOO` and every transitive sub-package whose
 *     DEVCLASS chain leads back to `ZFOO`".
 *   - SAP stores the relationship in `TDEVC.PARENTCL`. ADT exposes direct
 *     children via `POST /sap/bc/adt/repository/nodestructure`
 *     (`AdtClient.getSubpackages`).
 *
 * Security invariants:
 *   - Resolution failure (network, permission, missing root) is fail-closed:
 *     the resolver throws and the caller (checkPackage) MUST treat the throw as
 *     "package denied". Never silently allow.
 *   - Legacy caches are keyed by uppercased root; lookups are case-insensitive.
 *   - A rejected resolution purges its cache entry so a retry can succeed,
 *     but the current request still fails. This avoids cementing a transient
 *     failure for the full TTL.
 *
 * Cache lifetime:
 *   - Default 10 minutes (see `DEFAULT_TTL_MS`); overridable per-instance via
 *     `AdtPackageHierarchyResolverOptions.ttlMs`. The cache can be invalidated
 *     manually via `invalidate(root?)` after admin actions that change the
 *     hierarchy (create_package / change_package / delete_package).
 *   - Pinned checks use fresh request-bounded evidence. Only the two independent
 *     server/destination gates of one check share a decision-local snapshot.
 */

import { AdtSafetyError } from './errors.js';
import { type AdtRequestOptions, throwIfRequestCancelled } from './http-deadline.js';

/** Fresh evidence for each pinned policy check, including its under-lock recheck. */
export function createPinnedPackageHierarchyResolver(
  fetcher: (root: string, options: AdtRequestOptions) => Promise<string[]>,
  options?: AdtRequestOptions,
): PackageHierarchyResolver {
  if (!options || !Number.isFinite(options.deadline) || options.noReplay !== true)
    throw new AdtSafetyError('Pinned package hierarchy resolution requires a bounded mutation request policy.');
  // Never capture a request's deadline/signal in the legacy shared cache holder.
  const policy = Object.freeze({
    deadline: options.deadline,
    signal: options.signal,
    noReplay: true,
    retryTransientErrors: false,
  });
  return {
    async isDescendantOrSelf(root, pkg) {
      const upperRoot = root.toUpperCase();
      const target = pkg.toUpperCase();
      try {
        throwIfRequestCancelled(policy);
        if (upperRoot === target) return true;
        const visited = await walkHierarchy(
          upperRoot,
          async (current) => {
            throwIfRequestCancelled(policy);
            const children = await fetcher(current, policy);
            throwIfRequestCancelled(policy);
            return children;
          },
          DEFAULT_MAX_DEPTH,
          DEFAULT_MAX_PACKAGES,
          target,
        );
        return visited.has(target);
      } catch (error) {
        throw hierarchyFailure(upperRoot, error);
      }
    },
    invalidate() {}, // No evidence survives this individual membership lookup.
  };
}

/** Share evidence only across the independent gates of one checkPackage decision. */
export function packageHierarchyDecision(resolver: PackageHierarchyResolver): PackageHierarchyResolver {
  const decisions = new Map<string, Promise<boolean>>();
  return {
    isDescendantOrSelf: (root, pkg) => {
      const key = `${root.toUpperCase()}\0${pkg.toUpperCase()}`;
      let decision = decisions.get(key);
      if (!decision) {
        decision = resolver.isDescendantOrSelf(root, pkg);
        decisions.set(key, decision);
      }
      return decision;
    },
    invalidate: (root) => {
      decisions.clear();
      resolver.invalidate(root);
    },
  };
}

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
      throw hierarchyFailure(upperRoot, err);
    });
    this.cache.set(upperRoot, { expires: now + this.ttlMs, subtree });
    return subtree;
  }

  private computeSubtree(upperRoot: string): Promise<Set<string>> {
    return walkHierarchy(upperRoot, this.fetcher, this.maxDepth, this.maxPackages);
  }
}

/** A positive path is sufficient evidence; negative decisions still walk the bounded reachable tree. */
async function walkHierarchy(
  upperRoot: string,
  fetcher: DirectSubpackageFetcher,
  maxDepth: number,
  maxPackages: number,
  stopAt?: string,
): Promise<Set<string>> {
  const result = new Set<string>([upperRoot]);
  let frontier: string[] = [upperRoot];
  let depth = 0;
  while (frontier.length > 0) {
    if (depth >= maxDepth) {
      throw new Error(
        `DEVCLASS hierarchy under '${upperRoot}' exceeds maxDepth=${maxDepth} (possible cycle in TDEVC.PARENTCL)`,
      );
    }
    const nextFrontier: string[] = [];
    for (const cur of frontier) {
      const children = await fetcher(cur);
      for (const child of children) {
        const upper = child.toUpperCase();
        if (result.has(upper)) continue;
        result.add(upper);
        if (result.size > maxPackages) {
          throw new Error(
            `DEVCLASS subtree under '${upperRoot}' exceeds maxPackages=${maxPackages}; refusing for safety`,
          );
        }
        if (upper === stopAt) return result;
        nextFrontier.push(upper);
      }
    }
    frontier = nextFrontier;
    depth++;
  }
  return result;
}

function hierarchyFailure(root: string, error: unknown): AdtSafetyError {
  const message = error instanceof Error ? error.message : String(error);
  return new AdtSafetyError(
    `Failed to resolve DEVCLASS subtree under '${root}' for allowedPackages rule (denying for safety): ${message}`,
  );
}
