# Automatic live relations and additional object types

## Scope and acceptance

Remove the dedicated `ARC1_LIVE_RELATIONS` / `--live-relations` option. Reuse normal SAP capability
discovery, `read` authorization, `SAP_DENY_ACTIONS`, and existing request/result limits. Retain the
single-target standard-mode boundary, experimental label, no persistent graph and no source/SQL
fallback. No SAP mutations, new infrastructure, dependency additions or merge.

Research the previously identified families individually: DDLS, DCLS, BDEF, SRVD, SRVB, TABL
(table and structure), TTYP, DTEL, DOMA, PROG, INCL, FUNC, FUGR and DEVC. Related metadata families
returned by these tests may be assessed where useful. A documented UI capability is not a
verified REST contract; each supported root needs identity validation and both-direction tests.
The inventory pass also covers TRAN, SOBJ, SHLP, SKTD, ENHS, ENQU, TYPE, AUTH, BSP and all nine
server-driven read families individually; do not infer support from their source-read availability.

## Sequence

1. Preserve the pre-change revision and model baseline. Remove the flag across runtime, CLI,
   documentation and tests. Discovery unknown stays usable for one-shot tool-list clients;
   known absence hides the action; every invocation verifies support. Denied and unsupported-mode
   calls must stop before SAP access. No new discovery I/O in tools/list.
2. Build a per-type live matrix on the existing SAP 2023 trial: actual ADT URI/type, active metadata
   envelope, ENV/WUL contexts, nonempty known links, absent-root behavior, namespace behavior and
   malformed/unsupported response handling. Keep raw responses private and publish safe findings.
3. Add only viable types through one small typed metadata registry. Reuse the current adapter,
   normalization and bounded traversal; do not make caller URLs arbitrary HTTP targets. Keep
   unsupported contexts/types explicit instead of treating empty data as successful coverage.
4. Test every added type with positive and negative root validation, direction, typed collisions,
   boundary/recursive behavior, namespace handling and shared budget/auth/cancellation controls.
   Re-run real MCP reads against the same objects. Verify known edges independently when possible.
5. Run actual model comparisons with identical prompts and pinned revisions, using a hosted model
   and installed Ollama models. Include per-type relationship tasks, source-verification tasks and
   ordinary-workflow controls. Grade facts/provenance/coverage, not just tool choice or completion.
   Retain failures and do not advertise a type from one fortunate answer.
6. Review the implementation for unnecessary abstractions and all relevant security invariants.
   Run full unit/type/lint/policy/build/docs/schema/file-size gates, final read-only live matrix,
   and merged-tree verification against fetched main. Update operator docs, consolidated research
   and PR findings. Push normal follow-up commits; do not merge.

## Research record

Results and per-type dispositions will be recorded in
`docs/research/2026-09-10-live-relations-types.md`. Existing model-quality concerns remain open
until re-evaluated; removal of an exposure flag does not itself resolve them.
