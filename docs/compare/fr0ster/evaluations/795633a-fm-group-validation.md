# Function-module group validation against ADT containerRef metadata

> **Priority**: High
> **Source**: fr0ster v6.5.0 — commit `795633a` (2026-04-24)
> **ARC-1 component**: `src/adt/client.ts` (`getFunction`, `resolveFunctionGroup`)

## What fr0ster did

When reading a function module (`Read/GetFunctionModule`), fr0ster discovered that **ADT resolves the FM by name regardless of the group segment in the request URL** — `GET /functions/groups/WRONG_GROUP/fmodules/Z_FM_NAME/source/main` happily returned the source for `Z_FM_NAME` from its real group, and the handler echoed `WRONG_GROUP` back to the caller.

Fix (`795633a`):

1. After fetching FM source, also fetch the FM metadata payload.
2. Parse `<adtcore:containerRef adtcore:name="..." adtcore:type="FUGR/F"/>` to learn the **real** owning group.
3. If caller passed a group: docs/compare it with `containerRef.name` — mismatch → explicit error rather than silently returning unverified source.
4. If `containerRef` is missing: refuse to return source (defensive — would mean ADT layout changed).
5. Echo the metadata-derived group in the response, never the caller's input.

New helper `parseContainerGroup` (in `src/handlers/function_module/shared/`), unit-tested. Also adds two diagnostic CLI scripts (`scripts/read-fm.ts`, `scripts/probe-fm.ts`) for inspecting FM endpoint quirks.

## ARC-1 current state

`src/adt/client.ts:216`:

```typescript
async getFunction(group: string, name: string): Promise<string> {
  checkOperation(this.safety, OperationType.Read, 'GetFunction');
  const resp = await this.http.get(
    `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(name)}/source/main`,
  );
  return resp.body;
}
```

Same construction as fr0ster's pre-fix code — ARC-1 trusts the caller-supplied `group` and never validates it. If a caller passes the wrong group, ARC-1 returns the right FM's source under a wrong-looking URL and the LLM has no way to detect the mismatch.

`resolveFunctionGroup(fmName)` (`client.ts:225`) does a `searchObject` lookup that returns the actual group, so ARC-1's auto-resolve path (when `args.group` is not supplied — `intent.ts:1311`) is correct. The hole is only on the **explicit-group** path.

## Assessment

Real bug class, low-but-non-zero blast radius. Most callers will either:

- omit `group` and let ARC-1 auto-resolve (safe), or
- pass the right group from a prior `SAPSearch` (safe).

The failure mode shows up when:

- The user/LLM picked a group from stale context and the FM has been moved.
- Two function groups in different namespaces happen to contain identically-named FMs — ADT will return one, and the caller assumed the other.

The cost of the fix is one extra HTTP call (FM metadata endpoint) per read. Given how rarely FM reads happen in our typical workflow, this is acceptable. Worth doing if/when we touch the FUNC code path next; not urgent enough to schedule on its own.

## Decision

**consider-future** — small, contained improvement to `getFunction()`:

1. Fetch FM metadata in parallel with `/source/main` (one extra request, parallel = no latency cost).
2. Parse `<adtcore:containerRef adtcore:type="FUGR/F" adtcore:name="..."/>` (already inside `parseFunctionGroup`-style XML).
3. If caller passed `group` and it doesn't match: throw a typed error with the real group name in the message ("FM `Z_X` is in group `Z_REAL`, not `Z_WRONG`").
4. Return the metadata-derived group alongside the source so the caller learns the truth.

Pair this with [`issue-77-fm-update-parameter-loss.md`](issue-77-fm-update-parameter-loss.md) — both are FM-endpoint quirks. If we end up adding proper FUNC CRUD, the metadata fetch becomes a natural part of the lock/update flow anyway.

**Not blocking**. ARC-1's auto-resolve via `searchObject` already covers the common case (no group supplied). File this as a defensive hardening for when we revisit FM support.
