# BTP documentation provenance — implementation plan

## Summary

Add visible checkout/status information to eight canonical BTP guides, plus a small task manifest
that generates human navigation and a compact `llms.txt`. Keep Markdown and MkDocs. No runtime,
authorization, deployment, model dependency, chatbot or documentation-platform change.

This is approved PR 03. Merge the operational corrections (#752) first and PP examples (#753) next;
this branch is independently based on main `5c36f2a734870081780a5d4be734f605b1036318` (package 1.2.0).
The index initially covers existing canonical guides, so it never links to unmerged example files.

## Refined decisions

- Use one small local MkDocs hook, with a closed Python-validated manifest schema. Reuse MkDocs'
  existing Markdown/PyYAML dependencies, not a generic CMS, generator or new schema dependency.
- Store review date, reviewed commit and source-evidence paths explicitly. Builds do not refresh
  review dates or claim that existence of a test file means a test ran.
- A matching exact `v<package version>` tag is labeled **exact release-tag checkout**, not a
  cryptographically verified or published release. Untagged main/spec branches are development
  documentation; dirty builds are local/uncommitted; unavailable Git metadata is unverified.
- Pin generated remote source links only for clean, known commits and confirm each file exists at
  that commit. Local/unknown builds show repository paths without claiming remote publication.
  A clean commit does not prove a deployed artifact was built from it.
- Require exact matching source as the initial compatibility rule. No guessed release ranges.
- Generate only into MkDocs output. Exclude proposed, historical and unknown-status entries from
  operational navigation/index. Preserve their metadata for review, never promote by build date.
- Add concise raw-Markdown applicability notes and one AGENTS routing row. Keep existing URLs and
  advanced/single-target guidance reachable.
- Use the same documentation dependency file as PR 01 (identical content, allowing independent
  builds); add a focused credential-free Python test workflow. The strict PR build remains PR 01's
  responsibility, while the Pages build invokes the hook and tracks its source inputs.

## Implementation sequence

1. Add manifest and hook: strict schema, canonical files/anchors, source-evidence paths, provenance,
   deterministic generation and proposal exclusion.
2. Add Python tests for valid/invalid manifests, exact tag/development/dirty/unknown provenance,
   real temporary Git repositories, immutable source-link correspondence and output determinism.
3. Wire MkDocs labels, generated task navigation and `llms.txt`; add maintenance instructions,
   raw-source warnings and a terse AGENTS task route. Do not add old research/specs as setup steps.
4. Wire credential-free CI tests and publication triggers for manifest/hook/source-version inputs.
5. Run tests, strict MkDocs build, negative build checks and rendered browser inspection. Verify
   clean checkout output after committing, then review scope and create a separate PR.

## Acceptance and evidence boundaries

Required: schema errors and dead anchors fail builds; no stale review dates are invented; generated
links resolve to files in the asserted Git tree; local edits never borrow an exact-release label;
current guides remain usable without an LLM. Check the three PRs together for integration conflicts.

Optional: compare wrong-version advice, unnecessary source reads and setup-task correctness with
and without the index. No LLM evaluation service or measured usability improvement is required or
claimed. Live BTP/SAP acceptance remains separate and is not attempted by documentation tooling.

## References checked

- [MkDocs local hooks](https://www.mkdocs.org/user-guide/configuration/#hooks) and
  [page/build events](https://www.mkdocs.org/dev-guide/plugins/): use the existing build lifecycle.
- [llms.txt proposal](https://llmstxt.org/): publish a deliberately small linked index, not an
  assertion that clients discover it automatically or that every convention is implemented.

## Rollback

Remove the hook/generated surfaces, manifest and focused test job. Canonical guides and their
source-applicability notes remain useful. No service migration or customer change is involved.

## Implementation evidence (2026-09-05)

- Sixteen Python tests pass, including real temporary Git repositories and malformed metadata,
  private/symlinked paths, dead anchors, exact tags, main/spec branches and proposal exclusion.
- Full existing unit suite: 192 files / 5,757 tests passed. Typecheck and lint passed; existing
  Biome configuration notices remain. No runtime source or lockfile changed.
- A deliberately broken real manifest anchor aborted `mkdocs build --strict`; restoring it made
  the build pass. The test fixture was not retained in the manifest.
- Local browser review checked the task table, source banner and experimental multi-target page.
  Source validation caught an outdated evidence path; it now references the actual HTTP/OAuth
  recovery implementation on the recorded baseline.
- Remote publication, customer acceptance and human/LLM setup improvement are not established by
  these checks. Clean-checkout and combined-branch verification follow before PR handoff.
