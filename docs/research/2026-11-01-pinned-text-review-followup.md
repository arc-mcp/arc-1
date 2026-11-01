# Pinned text and activation: sixth review follow-up

Status: implementation checkpoint in draft PR #1142, not merge acceptance or a live artifact freeze.
FEAT-93 remains open. The last mutation qualification is still `77e41fdcd`; it does not cover this code.

## Independent review and reproduction

The sixth actual Claude Code review examined immutable `5344e989e7ebde1e87fad03fe11ac8becc55e1c5`.
Its [verbatim report](broader-pinned-pp-writes/claude-text-pool-review-20261101.md) has SHA-256
`8a3207c1f3f1e295b101fff57e51c83c4af5d04478eeb6491e7dcd3c2f3bd702`.
The system-init record names `claude-opus-5-5`; the saved launcher contains `--effort max`, independently
checked by the author as an adjacent argument pair. The reviewer's inability to introspect effort
does not change that launcher evidence. The 4,331-file snapshot verified unchanged before and after
review; the author also reran its verifier afterward.

The reviewer reported no High, three Medium and seven Low findings. All allowed checks passed,
including 441 files / 12,136 unit tests, three TypeScript projects and 59 historical harness simulations.
The report discloses parallel execution of three checks despite the requested sequential Bash rule;
their results stand, but benchmark timing was not isolated. There was no live qualification, mutation,
network access or delegation. The reviewer executed no reproducer; the author subsequently reproduced
all three Medium findings in ten failing unit rows before fixing them.

## Disposition

| Finding | Change and remaining evidence boundary |
|---|---|
| M1: class-include activation identity | Exact owner-relative include URIs accept the observed `CLAS/I` type, with empty or composite native names; owner/pool names remain strict. Native padding is trimmed. No invented `CLAS/OCN/<include>` type is admitted. Foreign URI/type, deletion, duplicate, query and fragment cases still refuse. Raw preaudit capture remains required during live qualification. |
| M2: optional pool inspection | Unselected program pools are best-effort observations. A missing service/read failure preserves confirmed owner activation with unknown state and a warning. A selected pool still requires successful verification. |
| M3: unchanged or incomplete text readback | Before activation, compare the requested replacement with saved entries: keys, values, DDIC-reference markers and explicit lengths. Reject duplicate keys/annotations, unsafe numeric lengths and unknown syntax; allow explicitly modeled key/line/trailing padding and resolved DDIC labels. Unchanged, dropped-key and failed-clear PUT-200 cases remain `text-saved-unverified` and send no activation. This conservative semantic model is offline-tested, not a complete native format qualification. |
| L4: implicit activation denial | A pinned `SAPActivate`, exact activation or matching glob denial suppresses text writes in both admission and advertised schemas. Direct tests assert zero SAP calls. Legacy behavior is unchanged. |
| L5: activation recovery | Preserve bounded native activation messages; empty/non-checklist execution evidence produces an explicit unconfirmed diagnostic. After a submitted unconfirmed activation, perform bounded read-only pool and active-part checks, retaining native failure even when the observed content matches. No retry/confirmation is added. Preflight refusals do not enter recovery reads. |
| L6: recovery/scope/cleanup | Recovery names SAPRead and ADT; pool-only confirmation reports pool-only scope. Failed include activation retains its native consumer warning evidence. Verified empty no-ops skip post-unlock work while still reporting cleanup failure. Owner-source activation is described as not requested. A class's own pool reference in whole-owner preaudit remains unqualified: do not widen that allowlist without native evidence. |
| L7: removed-resource cleanup | Explicit `sap-contextid=0` confirms an already-closed session. Resolved typed UNLOCK-404 receipts survive as `removedLocksAfterDelete`, only after verified deletion/absence and confirmed owning-session closure. A removed-lock candidate blocks post-unlock work until closure. Real UNLOCK status capture is still required in the next live harness. |
| L8: masked fixture failures | The listed include-method, shared-method, formatter, CSRF and pinned-write fixtures collect unexpected requests and assert them outside fetch. Pool/owner refusal tests assert phases, state and status/reason. The earlier claim about all affected mocks is narrowed in the source-adapter note. |
| L9: missing rows | Added matching PUT Content-Type/Accept, missing/mismatched CTS, lost LOCK, post-unlock pool identity drift, legacy-wrapper multi-target refusal, and known-missing deletion-service tests. Program activation resets its include-consumer flag between tests. |
| L10: profile/report consistency | Dedicated text profiles reject delete receipts and caller-supplied post-unlock hooks/predicates. Text uncertainty is documented at its own state branch. |

The source change also carries a private function-family candidate, described in the
[native owner investigation](2026-11-01-pinned-function-resources.md). It is not in the public capability
table and does not make FUNC/FUGR/group-INCL writes available to MCP callers.

Author validation: **446 files / 12,240 unit tests passed**, including the owner-error/optional-pool-error
regression found during the author review. All three TypeScript projects, build, lint (four existing
informational diagnostics), the 135-entry action-policy check, strict docs, the 907-file size ratchet
and all 12 schema-budget scenarios passed. All 59 historical harness simulations passed; they do
not qualify these new text/function profiles. A new independent review must assess these fixes
before freezing live bytes. Other built-in families and current-byte two-writer PP qualification
remain required by the plan.
