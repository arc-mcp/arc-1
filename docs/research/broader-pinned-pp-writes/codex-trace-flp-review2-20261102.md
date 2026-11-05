# Trace/FLP follow-up independent review

Revision: `35242656dd64f3ffcb00c46e9f6146516b2ef2f2`; follow-up base: `fcb78914eb0df38a601d14692cd7c63f3eb9abcf`.

**Private integration verdict: changes requested for three additional P2 correctness findings.** The seven prior Claude findings are addressed in the reviewed follow-up. The three findings below are in the existing private adapters, rather than regressions introduced by the follow-up. None establishes a public admission bypass. No whole-PR or native qualification verdict is given.

The first and last source actions ran `review-input/verify-snapshot.py`. Both returned revision `35242656dd64f3ffcb00c46e9f6146516b2ef2f2`, 4,558 verified files, `status: unchanged`. This report was written outside the source only after the final verification. No source edits, native operations, external service access, credential access, dependency installation or Git mutation occurred.

## New findings

### P2 — Bind tile membership evidence to the requested page

Locations: `src/adt/pinned-flp.ts:365–373`, backed by `src/adt/pinned-flp.ts:200–207` and `src/adt/pinned-flp-read.ts:71–75`.

The assignment preflight identifies a source tile by `instanceId` alone and an existing target membership by `chipId` alone. The collection mapper does not establish that each row's `pageId` equals the page requested. Consequently an unexpected or mixed association response can prove membership in a different page and cause a false successful no-op for the requested group. The post-write membership check already verifies `pageId`, but the preflight paths do not.

Reproduced with an in-memory fake transport: valid catalog and group metadata, a valid source tile, and a target group collection containing this sole row:

```json
{"pageId":"ZOTHER_GROUP","instanceId":"FOREIGN","chipId":"X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:ZCAT:SOURCE"}
```

Calling `flp_add_tile_to_group` for catalog `ZCAT`, group `ZGROUP` and source tile `SOURCE` returns `ok: true`, `state: unchanged`, `alreadyMember: true`, and the foreign-page row. Four GETs and zero writes occur. This is a false membership result, not a native observation.

Validate raw tile rows against the exact requested page before mapping or using them as membership evidence; reject missing, foreign, malformed or ambiguous identities rather than silently filtering them into apparent absence. Require exact page ownership for both the source and existing target member. Add wrong-page, missing-page and ambiguous-row regressions. This is especially relevant because the native group association contract remains unqualified.

### P2 — Do not classify every OData-shaped keyed 404 as entity absence

Locations: `src/adt/pinned-flp.ts:177–195`; affected consumers include create preflight at `:268`/`:296` and deletion readback at `:410–412`.

`isODataAbsent` accepts any HTTP 404 body containing a JSON `"error":` or an XML error element. It does not distinguish resource absence from an unavailable service, missing route, or other service-level OData error. `readEntity` then returns `undefined`, and deletion readback reports `ok: true, state: deleted`. Create preflight similarly treats that response as authoritative absence.

Reproduced with an in-memory fake transport: a valid keyed catalog GET, an accepted DELETE, and a keyed readback throwing an `AdtApiError` with status 404 and a synthetic OData error body saying the Page Builder service is unavailable. The outcome is `ok: true, state: deleted, phase: readback` after two GETs and one DELETE. The synthetic error code/message is test input, not evidence of a qualified native SAP error contract.

Restrict absence handling to a positively identified and qualified entity-not-found contract. Propagate unknown, service-level and gateway 404s; if no native discriminator is established, leave them ambiguous and preserve an unconfirmed outcome. Add JSON/XML service errors and malformed/unknown-error regressions. The corrected collection reader already avoids treating generic collection 404s as empty; keyed reads need equivalent caution.

### P2 — ST05 malformed readback must not say no request was submitted

Locations: `src/adt/pinned-trace.ts:421–440`, called after PUT at `:555`, with the error text preserved by `:570–575`.

The shared ST05 document validator throws `Unknown native ST05 state XML; nothing was submitted.` during both preflight and readback. After an accepted PUT, the catch preserves that safety-error text even though the outcome is correctly `update-unconfirmed`. This gives contradictory operator/model guidance after tracing may already be armed and can obscure the need to inspect or disarm it.

Reproduced with the existing `st05-trace-state.xml` fixture and a fake transport: first GET returns the valid v1 representation, PUT succeeds, second GET returns malformed XML with the v1 content type. Result:

```json
{"ok":false,"state":"update-unconfirmed","phase":"readback","retryable":false,"message":"Unknown native ST05 state XML; nothing was submitted."}
```

Two GETs and one PUT occur. Make the shared validator message phase-neutral and let the caller append truthful phase-specific guidance. Regress malformed XML and unknown shapes after a successful PUT, asserting an unconfirmed state and an instruction to inspect current ST05 state, without claiming that nothing was submitted. This is the ST05 counterpart of the prior FLP outcome-wording issue.

## Prior Claude findings: closure assessment

The committed Claude report was read directly. Its SHA-256 is `3449357860f4166dc5f5f3f42ea5ccc8dabc84effaef5ecc63635143b8c8c9dc`; no raw thinking log was used.

| Finding | Assessment at reviewed revision |
| --- | --- |
| M1 — FLP recording/request selection | Closed as a specification/public-admission correction. ADR-0011 and the qualification recipe require recording and allowed request/task selection before mutation, or proven native selection constrained to both allowlists. Post-write evidence or refusal of unrecorded changes alone is insufficient. The independent public recording lock remains closed. Native proof remains pending. |
| M2 — FLP readback wording | Closed for the reported FLP cases. The shared tile reader now gives phase-neutral failures; create/assignment regression tests retain unconfirmed outcomes. The distinct ST05 case is reported above. |
| L3 — Single-target empty username | Closed. `requireExplicitTraceUser` gates the PP-only refusal, while legacy empty `client.username` still produces the prior empty `user=` selection. A real-client test covers it. |
| L4 — Aggregate user-selection wording | Closed. The description makes explicit-user selection conditional on PP targets and preserves Basic defaults. Basic-only and mixed aggregate configuration tests exercise the actual builder. |
| L5 — Descriptions advertise pruned actions | Closed. Descriptions refer to the action schema rather than enumerating potentially removed actions; reader and deny-policy tests cover pruning. |
| L6 — Positive FLP ownership metadata | Closed for catalog/group entity metadata. Missing or unknown ownership flags refuse, and group ownership requires exact identity/container and `CUSTOMIZING` scope. Supported native flag domains still require qualification. Tile-row membership ownership is a separate remaining issue above. |
| L7 — Bounded/truthful pinned lists | Closed for the reported collection limits and errors. The reader bounds bodies at 8 MiB, caps at 500 rows, exposes continuation/count/full-page truncation, rejects malformed markers and propagates collection 404s. Legacy list behavior is unchanged. Keyed 404 classification is separately reported above. |

The synthetic profiler role-bearing feed is now accurately labeled, and TRC-4 records the need to qualify `server=*` across application-server instances. Public capabilities still exclude these mutation candidates; candidate scaffolding/private entry points are not qualification evidence. No fallback into legacy mutation adapters was found in the reviewed public path.

## Checks and limits

All checks passed:

- Focused trace/FLP, legacy FLP, candidate/admission and aggregate compatibility suites: **9 files, 341 tests**.
- Full unit suite: **507 files, 13,701 tests**.
- Typecheck: source, scripts and tests.
- Policy validation: **135 entries / 14 schemas**.
- Source/test size ratchet: **1,000 tracked files**; all tool-schema budget scenarios passed.
- Lint: **1,271 files**, three informational findings, no fixes applied.
- Three additional fake-transport reproductions described above.

Logs are siblings of this report: `codex-focused.log`, `codex-full-unit.log`, `codex-typecheck-sequential.log`, `codex-policy.log`, `codex-sizes.log`, and `codex-lint.log`. An initial typecheck inadvertently overlapped the tail of the full suite; typecheck was then rerun sequentially after both completed. Subsequent checks were sequential.

The roadmap was checked at the start and before completion. FEAT-93 correctly retains the private/public/native distinction. This review did not change its content.

Fixing these offline findings would address this private integration review only. The named TRC/ST5/FLP native scenarios, actual profiler ownership roles, ST05 multi-instance behavior, FLP flag/association contracts, pre-mutation recording and allowed request selection, full PP authorization/audit behavior, fresh two-writer qualification and public admission remain outstanding. No result here authorizes native execution or establishes readiness to merge the whole PR.
