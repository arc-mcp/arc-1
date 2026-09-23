# Plan: identify direct-connect SAP systems in MCP instructions (#733)

Status: implemented and verified

Companion research: [issue #733 system-identification research](../research/2026-09-01-issue-733-system-identification.md)

## Outcome and invariants

Add an optional `ARC1_SYSTEM_LABEL` / `--system-label` for single-target ARC-1 instances. When set,
the initialize response starts with:

```text
Connected SAP system: ERP production (read-only).

ARC-1 gives this SAP ABAP system ...
```

The implementation must preserve these invariants:

1. Unset or blank label: existing instructions are byte-identical.
2. Label: normalized to one line, at most 160 characters, and emitted before all generic guidance.
3. The complete supported label path stays below the known 2,048-character client ceiling.
4. CLI wins over environment; environment wins over the empty default.
5. `ARC1_SERVER_NAME` and handshake `serverInfo.name` are unchanged.
6. Pinned and aggregate multi-target servers continue using only
   `buildMultiTargetServerInstructions`; the single-target label is ignored there.
7. No SAP request, feature probe, authentication change, tool-schema change, or safety-policy change.

## Implementation

1. Configuration boundary
   - Add `systemLabel: string` to `ServerConfig` and `''` to `DEFAULT_CONFIG`.
   - Register `--system-label <label>` in `CLI_CONFIG_OPTION_SPECS`.
   - Resolve `ARC1_SYSTEM_LABEL` with the existing CLI > env > default precedence.
   - Add a shared normalizer: Unicode NFKC, C0/C1 controls and all whitespace collapsed to spaces,
     trim, then reject values over 160 characters with a configuration-specific error.

2. Initialize instructions
   - Move the existing single-target instructions and the new builder into
     `src/server/server-instructions.ts`; this keeps `server.ts` within its file-size ratchet.
   - Normalize defensively in the builder as well so directly constructed `ServerConfig` values do
     not bypass the one-line/length invariant.
   - Return the existing constant unchanged for an empty label.
   - Prepend the label line only in the non-multi-target branch of `createServer`.

3. Tests
   - Config: empty default, environment parsing, flag-over-environment precedence, whitespace/control
     normalization, blank normalization, and overlength rejection.
   - SDK handshake: default instructions contain no label; a configured label is the exact first
     line and the original body follows after one blank line; a maximum-length label remains below
     2,048 characters; custom `serverInfo.name` remains intact.
   - Multi-target handshake: a sentinel single-target label never appears and the existing aggregate
     instructions remain authoritative.
   - Prefer the real in-memory SDK initialize exchange already used by `server.test.ts`; do not rely
     only on a pure helper test.

4. Operator documentation
   - Add the variable to `.env.example`, the compact `AGENTS.md` table, and the canonical
     `docs_page/configuration-reference.md` runtime table.
   - Extend `mta-overrides.mtaext.example` and the direct-connect deployment guidance so BTP
     operators know to set both a unique server name and a model-facing label when needed.
   - Document one-line normalization, the 160-character cap, the empty default, and multi-target
     non-applicability.

5. Verification and delivery
   - Run focused config/server/multi-target tests, typecheck, lint, build, policy validation, size
     checks, and the full unit suite.
   - Review the diff for unrelated changes, public-surface drift, config/documentation consistency,
     and attribution.
   - Commit with `Co-authored-by: Marvin Kloth <marvin.kloth@armacell.com>` because PR #734 supplied
     the original issue, naming, and patch direction.
   - Push the `codex/feat-733-system-label` branch, open a replacement PR that fixes #733 and
     explicitly credits/supersedes #734, then comment on and close #734 in favor of the new PR.

## Plan review

| Risk / omission check | Resolution |
|---|---|
| Fix only changes a helper, not the wire response | Handshake tests use SDK `Client.getInstructions()` |
| Label becomes arbitrary extra prompt instructions | Normalize controls/newlines/whitespace to one line; cap at 160 |
| Label causes silent tail truncation | Maximum label path is explicitly asserted below 2,048 characters |
| Existing deployments change behavior | Empty default returns the existing constant without reconstruction |
| Multi-target identity contract regresses | Preserve current conditional precedence and add a sentinel handshake test |
| `serverInfo.name` regression from #606 | Keep the existing constructor identity and retain its handshake tests |
| BTP users cannot discover where to configure it | Update the tracked `.mtaext` template and deployment guidance |
| Unnecessary SAP/integration testing | None: all changed behavior is deterministic startup/handshake behavior |
| Contributor work is obscured by replacement PR | Co-author the commit and credit/supersede PR #734 in the new PR and close comment |

Review result: the plan addressed every reproduced failure and edge case without widening the
feature into SAP discovery or multi-target configuration. Implementation followed the plan, with the
instruction module extraction added in response to the file-size ratchet review.
