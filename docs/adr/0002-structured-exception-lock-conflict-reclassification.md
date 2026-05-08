# ADR 0002 — Lock-conflict reclassification by SAP error structure, not HTML markers

**Status:** Proposed
**Date:** 2026-04-28
**Related PR:** [#196](https://github.com/marianfoo/arc-1/pull/196) (NW 7.50 compatibility fixes)
**Supersedes:** N/A
**Superseded by:** N/A

## Context

[PR #196](https://github.com/marianfoo/arc-1/pull/196) introduced `rethrowIfNw750LockConflict` in [src/adt/crud.ts](../../src/adt/crud.ts) to reclassify NW 7.50 lock conflicts that the SAP ICM transforms into HTML `401 Logon Error Message` responses. The heuristic checks `responseBody?.includes('Logon Error Message')` and, if matched, throws a synthetic `409 locked by another session` instead of the misleading 401.

The PR comment claims the body marker self-scopes to NW 7.50 because *"S/4 returns Anmeldung fehlgeschlagen, NW 7.50 returns Logon Error Message"*. Live probe of both test systems on 2026-04-28 disproves this:

| System | `<title>` element | Body `<h1>` element |
|---|---|---|
| **A4H 758 SP02** (wrong creds → 401) | `Anmeldung fehlgeschlagen` | `Anmeldung fehlgeschlagen` (no "Logon Error Message" anywhere) |
| **NPL 750 SP02** (wrong creds → 401) | `Logon Error Message` | `Anmeldung fehlgeschlagen` |

The marker happens to fire only on NPL — not because NPL is NW 7.50, but because NPL's ICM uses an English error-page template while A4H's ICM uses a German template. Re-localizing either system breaks the heuristic in a different direction:

- A4H reconfigured with English ICM templates → all auth 401s now match `"Logon Error Message"` and get misreclassified as lock conflicts.
- NPL reconfigured with non-English ICM templates → real lock conflicts on 7.50 stop matching the heuristic and surface as auth errors again.

The structured-exception variant is more reliable. SAP's ADT error path emits `<exc:exception><type id="…">` for protocol-level failures (already extracted by `extractExceptionType` in [src/adt/errors.ts](../../src/adt/errors.ts)). The known type for the lock-conflict-via-CX_ADT_RES_NO_ACCESS path is `ExceptionResourceNoAccess`. When SAP returns a structured exception, the type ID is the right signal; only when the response is HTML (i.e. the ICM intercepted the response before the ADT handler completed) do we fall back to a body heuristic.

## Decision

Replace the body-marker heuristic with a layered detection strategy:

1. **Primary: structured exception type.** When the response includes `<exc:exception><type id="ExceptionResourceNoAccess"/>` (or known equivalents for lock-conflict semantics), reclassify regardless of HTTP status. This works on every SAP release that emits ADT structured errors.
2. **Secondary: HTML-based fallback, scoped by feature signal.** When the response is `text/html`, status is 4xx, and `cachedFeatures.abapRelease` parses to `< 751`, treat the response as a likely ICM-level intercept of a real conflict. Use neutral phrasing — *"Operation conflicted on `{name}` — object may be locked or already exist"* — because the ICM intercept does not preserve the original SAP exception type, so we cannot distinguish lock-conflict from already-exists.
3. **Tertiary: when `cachedFeatures` is undefined**, run the secondary check defensively (the same way the PR's current heuristic would). This preserves CLI/test paths where the startup probe didn't populate features.

Naming and surface changes:

- Rename `rethrowIfNw750LockConflict` → `convertHtmlConflictToProperError`. Caller-side becomes `const conv = convertHtmlConflictToProperError(err, objectUrl); if (conv) throw conv; throw err;` so the control flow is explicit.
- Reuse this same helper in `createObject` (currently the only other call site in PR #196) — and any future write helper that needs the same reclassification.
- The synthesized `AdtApiError` carries status `409`, which keeps the existing `classifySapDomainError` `lock-conflict` branch in [src/adt/errors.ts](../../src/adt/errors.ts) firing.

## Consequences

**Positive:**

- Robust against UI-language changes on the SAP server.
- Works on every SAP release that emits structured ADT exceptions (i.e. all currently-supported releases).
- The secondary HTML fallback is dormant on modern systems where structured errors are reliable, removing a fragile branch from the hot path.
- Reuses existing `extractExceptionType` machinery — no new error parsing.

**Negative:**

- Slightly more code than the body-string check (one structured-exception probe + the gated HTML fallback).
- The HTML-fallback message must be neutral because the ICM intercept loses the original exception type. *"Object locked by another session"* becomes *"Operation conflicted on `{name}` — object may be locked or already exist"*.
- Requires a small `cachedFeatures.abapRelease`-aware guard. This guard is read-only — it never expands routing, only narrows the fragile heuristic — so it doesn't reintroduce the gating problems in ADR-0001.

## Migration path

- PR-γ (the refined NW 7.50 quirks PR) ships this ADR's behavior immediately, replacing the PR #196 heuristic. The 4 unit tests cherry-picked from PR #196 are extended:
  - One asserts structured-exception path fires on a `<exc:exception><type id="ExceptionResourceNoAccess"/>` body regardless of status code.
  - One asserts the HTML-fallback path fires on a 401 HTML body when `cachedFeatures.abapRelease` is `<751`.
  - One asserts the HTML-fallback path is *skipped* when `cachedFeatures.abapRelease >= 751` (modern system safety).
  - One asserts a real auth 401 (non-HTML, structured plain-text body, no marker) is not reclassified.

## Alternatives considered

**Keep PR #196's body-marker heuristic.** Rejected — fragile against UI-language reconfiguration; both A4H reconfig (false positives) and NPL reconfig (false negatives) break it.

**Probe SM12 enqueue table on every conflict.** Authoritative, but adds an HTTP roundtrip per failure and requires extra authorization; rejected as too expensive for a hint.

**Always route 4xx + HTML responses through the heuristic.** Catches more cases but produces false positives on non-7.50 systems for normal auth failures.

## References

- Live probe data captured 2026-04-28 against A4H 758 SP02 and NPL 750 SP02.
- `extractExceptionType` and `classifySapDomainError` in [src/adt/errors.ts](../../src/adt/errors.ts).
- [src/adt/crud.ts](../../src/adt/crud.ts) `lockObject` and `createObject` (call sites).
- PR [#202](https://github.com/marianfoo/arc-1/pull/202) — PR-γ ships the layered detection helper, `cachedFeatures?.abapRelease` threading, classifier extension, and MSAG transport guard. The plan file `docs/plans/pr-gamma-nw750-quirks-refined.md` lives on the PR-γ branch and lands in main alongside the implementation when PR #202 merges.
