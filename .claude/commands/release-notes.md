# Release Notes — annotate a release for the docs

Turn a raw release-please changelog entry into an **annotated release entry** in
[`docs_page/release-notes.md`](../../docs_page/release-notes.md) — the page users and LLMs read to
understand what a release actually changed for them.

`CHANGELOG.md` is machine-generated and stays that way: one line per merged PR, no context. This
command adds the context next to it, never inside it.

---

## When to run

**While the release-please PR is open**, before merging it. The PR body already contains the exact
changelog entry for the upcoming version, so the notes can land first and `main` never goes red.

Also run it whenever a released version is missing from the page — `tests/unit/server/release-notes.test.ts`
fails with the list.

## Input

A version (`1.0.1`), a release-please PR number, or nothing (then annotate every version present in
`CHANGELOG.md` but missing from `docs_page/release-notes.md`).

---

## Method

1. **Get the raw entry** — from the open release-please PR body (`gh pr view <n> --json body`) or from
   `CHANGELOG.md` for an already-released version.
2. **Read what actually changed** — for each line: `git show <sha> --stat`, then the diff of the parts
   that matter. The PR title is a hint, not evidence. `gh pr view <n>` for the description where useful.
3. **Find the user-visible surface** — for each change, answer concretely:
   - New or changed env var / CLI flag? (`src/server/types.ts`, `docs_page/configuration-reference.md`)
   - New or changed tool, action, object type, or parameter? (`src/handlers/tools.ts`, and the
     `tests/fixtures/tool-definitions/*.json` diff — that file *is* the LLM-visible surface)
   - Behavior change an existing setup would notice? Breaking? Security-relevant?
   - Which `docs_page/*.md` page documents it now?
4. **Write the entry** using the template below, newest-first, above the previous version.
5. **Verify** — `npx vitest run tests/unit/server/release-notes.test.ts`, and check every relative doc
   link resolves to a file that exists. The guard counts a version as annotated only when it has its own
   `##`/`###` heading or is the first cell of a table row — a mention in prose does not satisfy it.

**Accuracy beats completeness.** Every claim must trace to a diff you read. If you cannot determine
the impact, write `(unverified)` — never guess what a change does for a user.

---

## Template

```markdown
## 1.0.1 — <short theme> (YYYY-MM-DD)

<2–4 sentences: what this release is about as a whole.>

| Change | What it means | Action |
|---|---|---|
| <short title> ([#NNN](https://github.com/arc-mcp/arc-1/pull/NNN)) | plain-English impact for an operator or an LLM using the tools | `none` / `opt-in: SAP_X=true` / `re-read <page>` |

**Upgrade notes** — only when something breaks or needs a config change.
**New configuration** — one bullet per new flag, with its default.
**Tool-surface changes** — one bullet per change an MCP client or LLM sees.
```

Rules: terse and factual, no marketing. `Action` is `none` for the majority — say so plainly, that is
the useful signal. Group trivial dependency bumps into one row. A release that only touches CI or
release plumbing gets one line saying exactly that.

---

## Ship it

`docs:` commit (deliberately no release — see AGENTS.md "Releasing"), e.g.
`docs: annotate the 1.0.1 release notes`.
