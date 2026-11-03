# Claude Code current-main integration review

Candidate `eec01827088e5108cb30936e94701ca4494ffce0`, base main
`dd18938771dc83dad6367c2d3e4edfd7daa65bf0`. Static immutable snapshot, Claude Code 2.1.308,
account default model, restricted Read/Grep/Glob only, hooks/plugins/MCP disabled. No commands,
network or SAP access. Runtime diff SHA256
`84c41fbcbaeece634bf8e1ea0c39aa8a829e684584316303fedf7263815392af`.
Duration 450.7 seconds, 78 turns.

## Review

**One actionable finding remains, a P3 policy gap, so I wouldn't treat this as a clean pass.** I found no wrong-owner source, guessed child, spliced source or SAPRead deny-rule bypass. This was a static review: I ran nothing, so the test, gate and replay results are still only your local evidence.

## Finding

### P3: `SAPNavigate.relations` deny rule doesn't stop the new class relation POST
**Location:** `src/adt/class-extensions.ts:125`, sent at `src/adt/repository-relations.ts:311`

**Trigger:** set `SAP_DENY_ACTIONS=SAPNavigate.relations`, then run any full `SAPRead` of `CLAS` or `INTF` with `extensions` omitted, or any read with an explicit `summary` or `sources` mode.

**Source evidence:**
- `extensionReadMode` now defaults these full reads to `summary` (`src/handlers/extension-read.ts:24-35`), so the POST to `/sap/bc/adt/objectrelations/network` is on by default.
- The session's only deny check is `SAPRead.<type>` (`src/adt/extension-discovery.ts:91-95`). The provider checks `ENHO` and the root type, but never `SAPNavigate.relations`.
- That rule is only checked when building the tool definition (`src/handlers/relation-tool.ts:17`) and for direct tool calls, so it never reaches this hidden path.
- No test in the class suites or the extension-input test mentions `SAPNavigate.relations`.

**Inference:**
- **Operator intent:** an operator who denies this action probably expects ARC-1 not to use Relation Explorer. The plan and `docs_page/tools.md:189` only promise SAPRead deny rules, so the code matches the written contract. This is a gap in that contract, not a plan violation.
- **Exposure:** it is limited, because the call uses the same user and the same read-level scope, and results are filtered to ENHO identities reachable from the requested root.

**Fix:** check `isActionDenied('SAPNavigate', 'relations', …)` before the native reads and mark only that provider `denied`. Set the status directly rather than throwing `AdtSafetyError` inside `session.read`, because that would set `stopped` and also lose the independent hook provider. Add a test that hooks still return and no POST is sent.

## Integration checks: no defects
- **Shared discovery:** `addNode` differs only by switch enrichment on the same canonical key (`extension-discovery.ts:195-200`). `provider_current` and `active` observations stay separate.
- **Source-plugin discovery:** the only change is the generated-INCL branch (`source-plugin-discovery.ts:184-193`). It counts references, reports `incomplete` and queues no children.
- **Auth/CSRF recovery:** main's logic is intact (`extension-discovery.ts:145-169`).
- **Hook and native providers:**
  - A failure in one provider doesn't block the other unless the phase stops.
  - Rendered hooks only suppress a native source read when the same name already has an active body.
  - All sources stay in separate blocks.
- **Native graph:** the code requires the exact `activeContext` and root, and only walks ENHO-to-owner paths from that root. ENV/WUL callers keep their behavior.
- **Generated source:** every required check is in `enhancement-include.ts:59-85`: deny rules, name shape, REPS type and feed name, a single `00000` entry, and the canonical content URI. Unavailable evidence is release-scoped per target, because `feature-cache.ts` keys by request context. Children come only from real `INCLUDE` statements and must match the same owner's `EMnnn` form.
- **INTF:** it returns before any hook or source read, and positive source stays `unsupported`.

## Candidates I rejected
- **Unvalidated `section` in a URL path:** `extension-read.ts:60-62` casts `args.include` without checking it, but dispatch blocks every bad value first. `schemas.ts:185-194` allowlists non-empty values, and `object-types.ts:225-233` strips blank strings. The handler is registered only through dispatch.
- **Draft mislabelled as `active` on editable reads:** `extension-input.ts:42` rejects `format=editable` with `extensions`, and `extensionReadMode` defaults it to `none`.
- **Fallback skipped after a recovered retry:** at `enhancements.ts:86`, a recovered 401 followed by a qualifying 404 or 500 in the same operation skips the generated fallback. It fails closed and is reported as `incomplete`, which is consistent with the required retry semantics.
- **Scanner cost on many matches:** `upperSource.includes(token)` at `enhancement-include.ts:121` runs once per match, and the 150K regression covers a different input shape. My unmeasured estimate is a block of a second or two at the 256 KB cap. It needs an explicit `sources` read and unusual authored content, so I'm not raising it.

## Still unproven
BTP results apply only to the earlier build, because the fresh rerun was blocked by the 503. Default-on relation POSTs in multi-target mode remain live-unqualified, even though `SAPNavigate relations` isn't exposed there (`relation-tool.ts:14-15`). The positive INTF, BTP generated-source, principal propagation and atomic-snapshot cases remain unclaimed, as you stated.

## Disposition

The P3 describes an additional operator-policy boundary beyond the original SAPRead-only hidden-read
contract. We accept the narrower policy: before any native root/relation read, check the existing
`SAPNavigate.relations` deny matcher and label only the native provider denied. Do not throw a
session-stopping safety error: the independently authorized hook provider remains available.
CLAS/INTF no-send cases and exact/glob/tool-wide denials with summary/sources hook preservation
are regression-tested. The documentation now states this policy explicitly. The independent
follow-up review and final validation are reported in the PR description.

The optional scanner-many-matches concern was an unmeasured hypothesis, not a confirmed finding.
The source byte cap and prior long-nonmatching-token fix remain in place; no additional parser
changes are made in this policy correction. BTP rerun availability and the recorded scope limits
remain explicit.
