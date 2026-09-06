# BTP documentation entry points — revised plan

## Summary

Keep one Markdown task map in BTP Start Here, add short source-revision guidance there, and publish
a small static `llms.txt` pointing to it. Remove the YAML manifest, Python generator/tests, custom
MkDocs hook, per-page metadata banners, additional public index page and dedicated source-index CI.
The ordinary MkDocs build and docs checks from #752 remain the verification path.

This supersedes the initial generated-provenance design after the 2026-09-06 usability review.
The extra machinery validated metadata, but duplicated navigation and interrupted setup reading.
MTA/destination configuration and runtime behavior are unchanged.

## Implementation

1. Remove only files and wiring introduced for generated documentation metadata. Preserve the
   existing site and the operational corrections in #752; do not require a documentation migration.
2. Keep topology/task selection in `docs_page/btp-overview.md`, readable directly as Markdown.
   State once that main may be newer than a deployed artifact; do not infer a compatible range.
3. Make `docs_page/llms.txt` a short pointer to Start Here on the documentation site, not another
   catalog. Offer raw Markdown as an alternative, state both follow main, and direct local/release
   readers to the same-revision checkout.
4. Route AGENTS to Start Here; put maintainer and optional evaluation advice in the existing
   developer guide, not another operator page.
5. Integrate #752, #753 and this PR in a temporary worktree to check the combined paths. Keep
   existing published PR history; apply review changes as a new commit with a normal push.

## Verification plan

- Strict MkDocs build, including the integrated three-PR state; check local links and old anchors.
- Inspect Start Here and multi-target setup in a browser: no generated metadata before each task,
  no third task map, and no new public maintenance page.
- Check the built `llms.txt` matches its tracked text and its source link reaches Start Here.
- Walk through single PP and multi PP from HTML and raw Markdown. The runbook selects the file,
  preserves existing settings, prepares single startup connectivity before deploy and separates
  safe-read success from correlated backend identity. #753 adds copy-command regressions.
- Run the relevant unit tests, typecheck/lint and descriptor validation in the integrated tree.
  No live IAM/SAP changes or paid-model calls are needed.
- Optional user/LLM comparisons record task correctness, unsafe suggestions, unresolved inputs and
  backtracking for the same task/revision. A passing build is not proof of usability improvement.

## Scope boundaries

No documentation metadata schema, per-page review-date obligations, custom publisher, wizard,
prebuilt MTAR, Terraform or chatbot. Research/specs remain separate from shipped setup guidance.
New customer deployment, authentication and identity acceptance remain owner-approved live tasks.
