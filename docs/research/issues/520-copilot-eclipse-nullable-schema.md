# Issue #520 — write-mode `tools/list` fails to load in Copilot-for-Eclipse

**Status:** RESOLVED. Root cause validated live (2026-06-27) and fixed in **PR #526** (shipped in the
following patch release). The earlier *size/enum* explanation (PR #523, 2026-06-26) was a **confound
and is disproven** — see "Disproven theories" below; it is retained only as an investigation record.

## TL;DR

- **Symptom:** With `SAP_ALLOW_WRITES=true`, GitHub Copilot-for-Eclipse shows the `arc1` MCP server but
  **none of its tools** (dead, unexpandable checkbox). The Error Log even prints
  `[CopilotMCP] Refreshed N tools` and `[mcpGateway] registered mount` — but the agent has zero tools.
  Read-only mode and `0.9.11` work.
- **Root cause:** `SAPWrite`'s input schema emitted **nullable JSON-Schema type unions**
  (`"type": ["string","null"]`) for its optional fields. Copilot-for-Eclipse's MCP→function-schema
  converter **rejects type-array/nullable unions and silently drops the entire server's tool set.**
  All 95 unions were in `SAPWrite`; every other tool had 0 — which is exactly why read-only worked and
  enabling writes broke it.
- **Origin:** the unions were introduced in **#363 (0.9.12)** by `makeOptionalPropertiesNullable`, a
  workaround for **#360** (OpenAI/GPT strict mode forcing fabricated enum values on optional fields).
  Version correlation: `0.9.11` nullableTypes=0 (works) → `0.9.12` first release with nullableTypes →
  `0.9.21` nullableTypes=95 (fails).
- **Fix (#526):** stop emitting nullable unions in the default visible schema; gate them behind
  `ARC1_SCHEMA_NULLABLE_OPTIONALS=auto|on|off` (default `auto` → portable **off**, logs MCP client
  info; `on` = explicit OpenAI/Azure strict-mode opt-in). Applied only to `SAPWrite`. Runtime
  `stripLlmEmptyValues` is retained so clients that still send `null` keep working (#360).
- **Not size.** The default `tools/list` is unchanged in shape; this was never a payload-size limit.

## Live validation (decisive A/B, 2026-06-27)

Parallel Codex investigation isolated the single causal variable with a debug flag
(`ARC1_SAPWRITE_NO_NULLABLE`) that removes **only** the nullable unions, keeping the full schema:

| Build | Schema | Result in Copilot-Eclipse |
|---|---|---|
| `0.9.21` full | 95 nullable unions, ~82–86 KB, all enums | ❌ no tools register |
| `0.9.21` + `ARC1_SAPWRITE_NO_NULLABLE` | **same size, same 253 enums, 0 nullable unions** | ✅ all 12 tools register and the SAPWrite create/read/activate/update/delete lifecycle works |
| toggle the flag off again | unions back | ❌ fails again |

Same payload size and enum count in both the working and failing builds → **size/enum count are not
causal; the nullable union is.** Confirmed end-to-end by the maintainer in a clean Eclipse install.

## Disproven theories (so nobody re-runs them)

All tested live; each failed to explain the data once the nullable variable was isolated:

- **Total tools/list size (~80 KB ceiling).** Fit the 0.9.11(ok)/0.9.21(fail) data by coincidence —
  size *and* nullable-union count both jumped together. A clean 74 KB build (descriptions shaved, unions
  kept) still failed; an ~82 KB build with unions removed worked. **PR #523's size-trim + token/size
  guard were built on this theory** — harmless, but they guard the wrong dimension (token estimate, not
  schema portability). The real guard is the "no `type:[]` arrays" test added in #526.
- **Schema depth (9→10).** Removing SAPWrite's deep `batch_create` subtree (depth→7) still failed.
- **`batch_create` subtree.** Removing it still failed.
- **Slash enum values (`TABL/DT`, `TABL/DS`).** De-slashing all enums still failed.
- **Enum-value count.** A 74 KB build with full enums but no unions worked; the failing build's
  enum count was irrelevant.
- **SAP_CLIENT / startup crash.** An early hypothesis; the server starts and `Refreshed N tools`
  is logged — it never crashed.

## Affected clients (not just Eclipse)

Nullable `type:[…,"null"]` unions are valid JSON Schema and the OpenAI-structured-outputs nullable
form, but many MCP clients convert schemas to a stricter function-calling subset that rejects them:

- GitHub Copilot **Eclipse** — confirmed here.
- GitHub Copilot **IntelliJ** — `type:["boolean","null"]` prevents tool loading (microsoft/copilot-intellij-feedback#691).
- **Gemini CLI** — nullable-array MCP validation failure (google-gemini/gemini-cli#21094).
- **Azure AI Foundry** — docs reject nullable unions and `anyOf`.
- **Cursor / JetBrains AI** — reported union-type handling issues.
- **OpenAI / Azure OpenAI strict mode** — the one place that *needs* the union form (#360).

Upstream report filed: **microsoft/copilot-for-eclipse#325** (asks them to accept the unions, and to
surface an error instead of silently dropping the whole server).

## The fix (#526)

- `ARC1_SCHEMA_NULLABLE_OPTIONALS` (`auto`|`on`|`off`), default `auto` → resolves to `off` and logs
  `clientInfo` at debug. `on` forces the #360 nullable form (OpenAI/Azure strict mode); `off` forces
  portable plain schema.
- `makeOptionalPropertiesNullable` retained but only applied to `SAPWrite`, and only when enabled.
- Runtime `stripLlmEmptyValues` unchanged → `null`-valued optionals from strict clients still cleaned
  before Zod, so #360 callers keep working even on `off`.
- Regression guard: a test asserts the default tool schemas contain **zero** `type:[]` arrays.

## Affected files (for reference)

`src/handlers/tools.ts` (conditional nullable, SAPWrite-scoped), `src/server/server.ts`
(`resolveNullableOptionals` + `getClientVersion`), `src/server/config.ts` / `types.ts` (the new
config), tool-definition snapshot fixtures, config docs.

## Follow-ups / out of scope

- **#523's size guard** measures token estimate, not client wire portability — it did not (and could
  not) catch this. The portability guard that matters is the "no `type:[]` arrays" assertion (#526).
- Rotate the SAP credential that appears in the issue thread / screenshots.

---

## Paste-able #520 reply (review before posting; origin = `marianfoo`)

```markdown
Root cause found and fixed. Thanks @lorandmatyas — and apologies for the runaround; the cause was
non-obvious.

**It wasn't write mode, version, or size — it's nullable JSON-Schema unions.** With writes enabled,
ARC-1's `SAPWrite` tool emitted `"type": ["string","null"]` unions for its optional fields (added in
0.9.12 for OpenAI strict-mode compatibility, #360). **Copilot-for-Eclipse's MCP→function-schema
converter rejects type-array/nullable unions and silently drops the *entire* server's tools** — which
is why the log says `Refreshed N tools` but the picker is empty, and why read-only mode worked (those
tools had no such unions).

Isolated with a clean A/B: same full schema with only the nullable unions removed → all tools register
and the write lifecycle works; add them back → fails again.

**Fixed in #526** (in the latest release): the default schema is now portable (no nullable unions), with
an opt-in `ARC1_SCHEMA_NULLABLE_OPTIONALS=on` for OpenAI/Azure strict-mode clients that need them.
Please update to the latest `arc-1` — write mode should now load all tools in Eclipse. (Interim
workaround on older versions: `ARC1_TOOL_MODE=hyperfocused`, or pin `arc-1@0.9.11`.)

Also filed upstream with Copilot-for-Eclipse (microsoft/copilot-for-eclipse#325) — both to accept the
valid schema and to stop failing silently. Thanks again for the detailed reports; they made this
possible. 🙏
```
