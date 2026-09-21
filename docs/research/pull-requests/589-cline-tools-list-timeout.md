# `tools/list` blocked on startup discovery — review of PR #589 and the shipped fix

**Reported by:** @DimiDR in https://github.com/arc-mcp/arc-1/pull/589 (cross-repo fork)
**Reviewed + reimplemented:** 2026-07-29/30 against `origin/main` @ `3811587a`

@DimiDR's diagnosis was correct and their root-cause capture (a raw stdio MITM between Cline and the
server) is what made this findable. Their patch is not what shipped: it dropped a tool, and it
predated #579/#606 so it no longer merged. This documents both.

---

## The defect (independently reproduced)

`tools/list` awaited the startup feature probe behind a 10s cap. Clients cancel on their own
schedule — Cline at ~5s — so against a slow system the client got nothing and showed "Tools (0)".

Reproduced on `main` with a blackholed SAP host:

```
+0.30s ==> tools/list
+10.44s <== tools/list (11 tools)     ← the cap, exactly
```

---

## Why PR #589's patch was not merged as-is

It answered `tools/list` immediately and emitted `tools/list_changed`. Right shape, two problems.

**1. The immediate answer silently dropped SAPGit.** The PR's comment claimed the unprobed path
yields the "on-prem-superset tool set". It did not — `SAPGit` was registered *only* when the probe
had already reported a backend, so the first list was a **subset**. Measured on a4h (758):

| | first `tools/list` | tools | SAPGit |
|---|---|---|---|
| `main` | 1.89s | 12 | ✅ |
| PR #589 | 0.33s | **11** | ❌ |

Recovery depended entirely on `tools/list_changed`, which major clients do not implement
([Claude Code](https://github.com/anthropics/claude-code/issues/13646),
[Codex](https://github.com/openai/codex/issues/10105),
[Gemini CLI](https://github.com/google-gemini/gemini-cli/issues/13850)). For those users the tool
would simply never appear — trading 1.5s of latency for a permanently missing capability.

An exhaustive surface diff (tool names + every enum value, on-prem and BTP, standard and
hyperfocused) showed `SAPGit` plus its 17 action/backend enum values were the *only* loss — and that
hyperfocused mode was already correct, because it had its own copy of the visibility rule that
handled the unknown case. Standard mode's copy did not. **The bug was two copies of one rule.**

**2. Stale.** Branched before #579 (multi-target) and #606 (server name); `createServer()` had since
moved to an options object. Real conflict in `server.ts`, and its three tests used the old
positional signature.

Gates on the PR's own base did pass as claimed: typecheck ✅, lint ✅, 4345 tests ✅.

---

## What shipped instead

Design principle: **the tool surface must be complete without the network.** Discovery may only ever
*narrow* it. A tool wrongly shown costs one failed call with a typed hint; a tool wrongly hidden is
unreachable for the whole session.

1. **`tools/list` never awaits the probe** (`src/server/server.ts`) — removes the race against every
   client's timeout, not just Cline's.
2. **Unknown features ⇒ superset, by construction.** The duplicated git-visibility rule is now one
   function, `isGitToolVisible()` in `src/handlers/tool-registry.ts`, used by both standard and
   hyperfocused mode. Unknown resolves to visible unless the admin set the feature `off`.
3. **`capabilities.tools.listChanged` + `notifications/tools/list_changed`** on probe completion, so
   clients that support it converge to the narrowed list. **stdio only** — the HTTP transport builds
   a fresh `Server` per request (`serveMcpRequest`), so no instance outlives a request to deliver
   one, and none needs to: by then the probe is cached and every request's first `tools/list` is
   already narrowed.
4. **A superset invariant test** — `tests/unit/handlers/tool-surface-superset.test.ts`. This is the
   guard #589 lacked; it is why the regression was invisible to CI.

`docs_page/architecture.md`'s tool-listing sequence diagram documented the 10s wait and was updated.

### Why not the alternatives

- *Lower the cap to ~2s* (the author's rejected option — agreed): still a race against unknown client
  timeouts, and it silently loses the adjusted list on any slow system.
- *Drop probe-dependence entirely and always list everything*: simplest, but throws away real
  adaptation — hiding `source_code` search where text search 404s saves tokens and a failing call.
- *Wait only for the 3 probe results the tool list consumes*: the probe already runs all 13 checks in
  parallel, so latency is the slowest single request, not the count. No meaningful gain.

---

## Verification

**Gates** (`origin/main` + this change): `typecheck` ✅ · `lint` ✅ · `npm test` ✅ **4762 passed /
164 files** · `build` ✅ · `validate:policy` ✅ 125 entries / 14 schemas · `check:sizes` ✅ within
budget.

**Guard proves itself:** reverting `isGitToolVisible` to the pre-fix expression fails 6 of the 7
superset tests with `discovery "all available" adds entries absent before it finished: expected
[ 'SAPGit', …(18) ] to deeply equal []`. Reverting `server.ts` fails 3 of the 4 new server tests
(`tools/list blocked`; `expected {} to deeply equal { listChanged: true }`).

**Live, via raw stdio JSON-RPC** (`initialize` then immediate `tools/list`, as Cline does):

| Scenario | first `tools/list` | tools | notification | late re-fetch |
|---|---|---|---|---|
| a4h · S/4HANA 2023 · 758 | **0.39s** | 12 (SAPGit ✅) | +1.57s | 12 |
| **NPL · NetWeaver 7.50** (no git backend) | **0.44s** | 12 (SAPGit ✅) | +1.99s | **11 — SAPGit correctly dropped** |
| unreachable SAP host | **0.41s** (was 10.44s) | 12 | — | — |

The NPL row is the whole design in one line: superset first, discovery narrows, notification tells
the client. On-prem HTTP re-checked separately — 200s, 12 tools per request, zero notification
attempts (the stdio guard holds).

---

## Invariants (AGENTS.md · Security & Architectural Invariants)

No ADT endpoint, scope, package gate, schema, or auth path is touched. Tool *listing* is not an
authorization boundary: `filterToolsByAuthScope` still runs after the list is built, `SAPGit`'s write
actions are still gated on `allowWrites && allowGitWrites`, and every action still passes
`ACTION_POLICY` and `checkOperation` at dispatch. Showing an unsupported tool therefore cannot widen
what a caller may do — it can only produce a typed error.

stdout stays clean (`logger.debug` → stderr, no `console.log`). Type-only imports added to
`tool-registry.ts`, so no runtime cycle.

---

## Credit

Root cause, the MITM diagnostic method, and the notification-based approach are @DimiDR's
(PR #589). The superset fix, the shared visibility rule, the invariant guard, and the rebase are the
delta.
