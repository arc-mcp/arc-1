---
name: arc1-cursor-regression
description: Use when user asks to generate Cursor MCP config + regression prompts for ARC-1. Adaptive: derive tests from PR diff or chat findings and build targeted setup/prompts for changed features/fixes.
---

# ARC-1 Cursor Regression Skill (Generic + Adaptive)

This skill creates **tailored** Cursor setup and prompts based on:
1. PR scope (preferred)
2. Current chat findings
3. Changed files in the local branch

It must not output a hardcoded one-scenario checklist unless the user explicitly asks for that.

## Trigger conditions

Use this skill when user asks for:
- Cursor MCP setup for ARC-1
- Regression prompts
- “verify this PR/fix/feature” prompts
- “create config + prompts so I can run quickly”
- “run the env prep for me”

### Composite request shortcut (must support)

If the user asks in one message to:
- use this skill
- derive tests from chat + current branch diff
- generate config + env prep + one execution prompt
- and says “run the env prep for me”

then treat it as a single composite workflow:
1. Resolve target root/worktree/branch.
2. Derive module set from diff + chat.
3. Generate config + one copy/paste execution prompt.
4. Execute env prep commands immediately in the resolved root.
5. Report env prep execution status (success/failure + minimal fix if failed).

## Required discovery workflow

### 0) Resolve active ARC-1 root + branch/worktree (mandatory)

Always bind generated config/scripts/prompts to the **actual target repo root** (not a remembered path).

Run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git worktree list --porcelain
```

Rules:
- If user gave a PR/branch, ensure the resolved root/branch matches that target.
- If multiple ARC-1 clones/worktrees exist, explicitly choose the one containing the target branch/commit.
- Never hardcode `/Users/.../DEV/arc-1` unless user explicitly requests that exact path.

### 0.5) Confirm active Cursor project/workspace matches target root (mandatory for runtime runs)

Before generating runtime prompts, ensure the Cursor chat session is attached to the same project/workspace that will host MCP servers and tool cache for the resolved root.

Rules:
- If the active Cursor project path differs from the resolved ARC-1 root, classify immediately as `Environment/session setup issue (not code regression)` and provide a fix: open the correct workspace and reconnect MCP.
- Do not mix artifacts from different Cursor projects when evaluating server availability/schema.

### 1) Determine target scope

Use one of:
- PR URL/number from user
- explicit branch from user
- current branch diff

Preferred commands:

```bash
gh pr view <PR> --json number,title,body,headRefName,baseRefName,url
gh pr diff <PR> --name-only
```

Fallback:

```bash
git diff --name-only origin/main...HEAD
```

### 2) Capture chat-derived constraints

Extract blockers from chat and turn them into guardrails (examples):
- MCP server not connected
- missing env file
- wrong SAPQuery arg key (`query` vs `sql`)
- backend SQL grammar caveats
- safety/profile mismatch
- stale MCP tool descriptor / wrong runtime root

### 3) Build module set from file changes

Map changed files to test modules:

- `src/server/server.ts`, auth/preflight, startup behavior
  - `module_auth_preflight`
- `src/handlers/schemas.ts`, `TABLE_CONTENTS`, validation
  - `module_schema_validation`
- `src/handlers/dispatch.ts` + per-tool handlers, hints/scope/routing/diagnose actions
  - `module_handler_behavior`
- `src/adt/diagnostics.ts`, dump/gateway/system message parsing
  - `module_diagnostics_runtime`
- `src/adt/http.ts` login/html detection changes
  - `module_http_html_detection`
- `src/handlers/hyperfocused.ts`, `src/handlers/tools.ts`
  - `module_tool_visibility`
- test/docs-only changes
  - `module_static_verification`

Always include `module_connectivity_precheck` unless user requests static-only.

## Cursor setup strategy

Default: **command-mode MCP servers** (most reliable in Cursor).
Use URL mode only if user explicitly asks.

Generate only needed profiles for selected modules:
- `arc1-good` for positive behavior
- `arc1-bad` for auth-negative checks (only if auth/preflight module selected)
- optional profiles like `arc1-good-blockdata`, `arc1-good-readonly`, `arc1-good-hyperfocused` depending on module set

Path/worktree requirements for generated config:
- MCP command/script must resolve to the **same root** used for PR diff analysis.
- If scripts are generated under `<root>/.cursor/scripts`, they must compute root relative to script location, with `ARC1_ROOT` override.
- Mention the resolved root in output so user can quickly verify it before running tests.

### Readable snapshot workflow for filtered worktrees

Use this when Cursor cannot read the hidden PR worktree because the active workspace
or `.cursorignore` filters paths such as `.claude/worktrees/...`.

Rules:
- Create a readable static snapshot under the active Cursor workspace, for example
  `<cursor-workspace>/arc1-pr<nr>-visible`, while keeping the MCP runtime pointed
  at the real PR worktree.
- Do not copy secrets, `.env`, caches, cookies, `node_modules`, or runtime folders
  into the static snapshot.
- Write `.arc1-pr<nr>-snapshot.json` in the snapshot with `source`, `visibleRoot`,
  `head`, and `createdAt` so Cursor can report exactly what it reviewed.
- Generated prompts must distinguish `staticRoot` from `runtimeRoot`. Do not treat
  a different active Cursor workspace as a regression when the prompt explicitly
  uses a readable snapshot plus a separate runtime root.
- If the MCP config lives inside the snapshot, say that directly; do not claim it
  is at the active workspace root.
- Treat generated `.cursor/` configs, prompts, scripts, and runtime files as local
  operator artifacts. Do not commit them to ARC-1 unless the user explicitly asks
  for a reusable repository template with scrubbed, portable paths.

## Env prep rules

- Build first (`npm run build`) unless user says skip.
- Build in the resolved target root (from discovery step 0).
- Never print secrets.
- Do not `source` full infra files blindly.
- Never ask users to paste a raw script body directly into an interactive shell.
- Default env file for generated scripts must be `${ARC1_ROOT}/.env` (or `${ROOT}/.env` after root resolution).
- Allow user override via `ARC1_ENV_FILE`.
- Generated scripts must fail fast if root/env/build artifacts are missing or required keys are empty.
- Generated scripts may accept `ARC1_EXPECT_DIST_TEXT`; when set, fail startup if
  the expected text is missing from `dist/handlers/dispatch.js`. This catches stale
  MCP server builds before Cursor runs a long live regression.
- Include an `ARC1_RUNTIME_FINGERPRINT` env value in generated MCP profiles for
  branch-specific runs, and tell the tester to restart/toggle MCP servers after
  changing config or rebuilding.
- When the target branch uses positive safety flags (`SAP_ALLOW_*`) instead of
  older block flags, generated profiles must set the positive flags explicitly
  and unset legacy `SAP_READ_ONLY` / `SAP_BLOCK_*` / `ARC1_PROFILE` values so a
  root `.env` cannot silently override the intended test profile.
- Generated script examples must be executed as files (`bash /path/to/script.sh` or executable path), not sourced.
- Parse only required keys (and strip surrounding quotes / CRLF):

```bash
grep '^KEY=' <file> | head -n1 | cut -d= -f2-
```

### Canonical Cursor script pattern

When generating `arc1-good.sh` / `arc1-good-btp-sim.sh`, use this pattern:

```bash
#!/usr/bin/env bash
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "Do not source this script. Execute it: bash ${BASH_SOURCE[0]}"
  return 1 2>/dev/null || exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ARC1_ROOT:-}"

if [[ -z "$ROOT" ]]; then
  if [[ -f "$SCRIPT_DIR/../../package.json" ]]; then
    ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  else
    ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  fi
fi

[[ -n "$ROOT" ]] || { echo "Unable to resolve ARC-1 root. Set ARC1_ROOT=/absolute/path/to/arc-1"; exit 1; }
[[ -f "$ROOT/package.json" ]] || { echo "Invalid ARC1_ROOT: $ROOT (package.json missing)"; exit 1; }
[[ -f "$ROOT/dist/index.js" ]] || { echo "Missing build artifact: $ROOT/dist/index.js. Run: (cd \"$ROOT\" && npm run build)"; exit 1; }
if [[ -n "${ARC1_EXPECT_DIST_TEXT:-}" ]] && ! grep -Fq "$ARC1_EXPECT_DIST_TEXT" "$ROOT/dist/handlers/dispatch.js"; then
  echo "Built dist is stale: expected text not found in dist/handlers/dispatch.js. Run: (cd \"$ROOT\" && npm run build)" >&2
  exit 1
fi

ENV_FILE="${ARC1_ENV_FILE:-$ROOT/.env}"
[[ -f "$ENV_FILE" ]] || { echo "Missing env file: $ENV_FILE"; exit 1; }

getv() {
  local key="$1"
  local raw
  raw="$(grep "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
  printf '%s' "$raw" | tr -d '\r' | sed -E "s/^[[:space:]]+|[[:space:]]+$//g; s/^['\"]//; s/['\"]$//"
}

export SAP_URL="${SAP_URL:-$(getv SAP_URL)}"
export SAP_USER="${SAP_USER:-$(getv SAP_USER)}"
export SAP_PASSWORD="${SAP_PASSWORD:-$(getv SAP_PASSWORD)}"
export SAP_CLIENT="${SAP_CLIENT:-$(getv SAP_CLIENT)}"
export SAP_LANGUAGE="${SAP_LANGUAGE:-EN}"
# Safe defaults — no writes, no data preview, no SQL. Uncomment the SAP_ALLOW_* lines
# below for developer-level access. See docs_page/authorization.md#recipes.
# export SAP_ALLOW_WRITES=true
# export SAP_ALLOW_DATA_PREVIEW=true
# export SAP_ALLOW_FREE_SQL=true
export SAP_TRANSPORT=stdio

[[ -n "${SAP_URL}" ]] || { echo "Missing SAP_URL in $ENV_FILE"; exit 1; }
[[ -n "${SAP_USER}" ]] || { echo "Missing SAP_USER in $ENV_FILE"; exit 1; }
[[ -n "${SAP_PASSWORD}" ]] || { echo "Missing SAP_PASSWORD in $ENV_FILE"; exit 1; }
node -e 'new URL(process.argv[1])' "$SAP_URL" >/dev/null || { echo "Invalid SAP_URL: [$SAP_URL]"; exit 1; }

unset SAP_READ_ONLY SAP_BLOCK_DATA SAP_BLOCK_FREE_SQL SAP_ENABLE_TRANSPORTS SAP_ENABLE_GIT
unset SAP_ALLOWED_OPS SAP_DISALLOWED_OPS ARC1_PROFILE ARC1_API_KEY

exec node "$ROOT/dist/index.js"
```

For `arc1-good-btp-sim.sh`, add:

```bash
export SAP_SYSTEM_TYPE=btp
```

## Execution modes (must support both)

When generating runnable instructions, always provide both:

1) Shell mode (user-run):
- Safe one-time setup should be emitted as full commands (including heredoc wrappers), not raw script body fragments.
- If shell options like `set -u` are used in setup snippets, wrap setup in a subshell:
  - `( set -euo pipefail; ... )`
- Instruct users to run generated scripts as executables or via `bash`, never `source`.

2) Codex mode (agent-run):
- Provide a compact command block Codex can run directly (`cd <resolved-root> && ...`).
- Keep the same root/worktree guarantees as shell mode.
- Never assume Codex is running in a specific clone unless discovery confirmed it.

### Execution decision rule

- If user explicitly says “run the env prep for me” (or equivalent), execute env prep now.
- Otherwise, provide env prep commands only (do not execute).
- When executed, always:
  - run in resolved target root
  - create/refresh `.cursor/scripts/arc1-good.sh` and `.cursor/scripts/arc1-good-btp-sim.sh`
  - run build unless user explicitly asked to skip
  - run `bash -n` syntax validation on generated scripts
  - return prepared paths + default env file path used

## Prompt generation contract

When asked for runnable output, always return in this order:

1. Why these tests were selected (PR/chat signals)
2. Cursor MCP config snippet (adaptive profiles only)
3. One-time env prep commands
4. One all-in-one test prompt
5. Expected outcomes checklist (PASS/FAIL criteria)

For DDLS runtime checks in generated prompts:
- Use fallback discovery sequence: `Z_*` -> `ZI_*` -> `I_*` with `maxResults=100`.
- Stop at the first query that returns at least one `DDLS/*` candidate.
- Do not fail regression just because `Z_*` has no DDLS.
- Prefer candidates with sibling signal (same stem / numeric variants) so `checkedCandidates` is more likely non-empty.
- If no sibling-rich candidate exists, still validate clamp/toggle behavior and treat missing sibling comparisons as not applicable, not regression.
- Include backend semantic caveats discovered during test design. Example: on
  SAP_BASIS 758, CDS children projecting an amount field such as `sflight-price`
  may also need the currency field, otherwise activation fails before the feature
  under test is reached.

## Runtime prompt guardrails (must include)

- Precheck required MCP servers are connected.
- Server ID resolution priority:
  - If user provides exact server IDs, use those exact IDs first.
  - Use suffix matching (`*-arc1-good`, `*-arc1-good-btp-sim`) only as fallback.
- Connectivity decision rule:
  - Do not fail solely from filesystem `mcps/` scan.
  - If a server ID is callable, treat it as connected even when descriptor cache appears stale.
  - On missing/disconnected result, label it as "possibly stale session cache", wait 5-10 seconds, and retry once before final classification.
- If any required server is still disconnected/missing after retry: stop and report exact server name.
- If a live write test is required, run a small create/delete write-smoke before
  creating multi-object DDLS graphs. On CSRF/core-discovery/unlock/service-routing
  failure, stop the live mutation scenario and classify as environment/session,
  not product regression.
- If a write-smoke create fails during post-save unlock but search/read shows the
  object exists, report `partial-created`, attempt at most one cleanup delete,
  and list leftovers explicitly if cleanup also fails.
- Verify server/tool contract matches expected scope from selected modules.
  - If expected actions/params are absent in advertised tool schema, classify as `Environment/session setup issue (not code regression)` and suggest rebuild/reconnect on the correct root.
  - If descriptor schema says fields are missing but live calls accept/behave correctly, classify as `Environment/session setup issue (descriptor staleness)` rather than code regression.
  - For authorization profiles, action/tool hiding can be the expected pass
    condition. Example: a read-only server may hide `SAPWrite`; a deny-action
    server may hide only the denied action instead of returning an in-band denial.
- Use schema-correct args:
  - `SAPQuery` uses `sql` + `maxRows`.
  - avoid `UP TO ... ROWS` in SQL text unless backend-specific test intentionally checks parser rejection.
- Classify final status as one of:
  - `Implemented fixes confirmed`
  - `Regression found`
  - `Environment/session setup issue (not code regression)`
- For SAP component reporting, copy exact `SAPRead(type="COMPONENTS")` rows.
  Do not conflate separate installed components, for example `S4FND 108` and
  `MDG_FND 808`.
- For where-used evidence, separate container/package rows such as `DEVC $TMP`
  from real DDLS impact rows. Do not count containers as dependent CDS objects.
- Keep evidence snippets tied to the exact tool call under test; do not paste
  static source excerpts unless static behavior failed.
- For multi-phase prompts, specify which tool response owns each evidence block
  (for example update guidance from `SAPWrite(update)`, activation guidance from
  `SAPActivate(ROOT)`, delete guidance from the first pre-cleanup root delete).
- If live sections are skipped because write-smoke failed, keep skipped YAML
  sections compact with empty arrays and one-line raw snippets.

## Diagnostics-specific module guidance (for PRs touching SAPDiagnose)

Include these runtime checks when diagnostics files are touched:
- dumps list (`action="dumps"`, bounded results)
- dump detail by id, including section-aware output if supported
- invalid dump id not-found guidance
- `system_messages` action
- `gateway_errors` list and detail retrieval
- gateway detail by id + errorType normalization behavior if applicable
- BTP guardrail behavior if target system is BTP

## Anti-patterns

- Hardcoding only auth/sqlFilter tests when PR scope is diagnostics
- Hardcoding absolute repo paths in scripts/config (`/Users/.../DEV/arc-1`)
- Mixing PR analysis root and runtime server root
- Committing generated `.cursor/` MCP configs or prompts with absolute local paths
- Mixing static snapshot paths and runtime roots without naming both explicitly
- Emitting script text in a way that encourages pasting raw script bodies into interactive shells
- Recommending `source` for runtime server scripts
- Assuming server IDs without checking connected MCP descriptors
- Leaving Cursor MCP servers running after rebuilding `dist/` or changing MCP env
- Reporting a stale MCP runtime as a product regression when source/dist already contain the expected behavior
- Treating stale tool schema as code regression without classifying env/setup first
- Failing immediately on first missing/disconnected check without one retry window
- Treating descriptor-cache absence as authoritative when live calls are available
- Falling back to custom HTTP client without user permission when prompt says native-only
- Treating post-save `UNLOCK`/CSRF/core-discovery failures as DDIC source-save problems
- Counting package/container where-used rows as CDS dependents
- Leaking secret values in logs/output
