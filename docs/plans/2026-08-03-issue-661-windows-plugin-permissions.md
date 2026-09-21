# Fix Windows plugin permission false positive (issue #661)

**Status:** Implemented and verified on `codex/fix-windows-plugin-permissions` (2026-08-03).

## Goal

Allow admin-configured code and manifest plugins to load on Windows without weakening the existing POSIX
owner/world-writable checks, and lock the distinction down with platform-independent unit tests and accurate
operator documentation.

Research and spike evidence: [`../research/issues/661-windows-plugin-permission-check.md`](../research/issues/661-windows-plugin-permission-check.md).

## Scope

| File | Change |
|---|---|
| `src/server/plugin-loader.ts` | Gate the POSIX ownership and `S_IWOTH` checks together on `process.getuid` availability; update the contract comment. |
| `tests/unit/server/plugin-loader.test.ts` | Keep a deterministic POSIX world-writable rejection test and add a simulated-Windows code-plugin-plus-manifest regression using the real loader. |
| `docs_page/extensions.md`, `docs_page/configuration-reference.md` | State that owner/mode validation is POSIX-only and Windows relies on host ACLs plus the admin-controlled plugin path. |
| `docs/security-model.md` | Make residual-risk R18's mitigation wording platform-accurate. |
| `docs/research/*extension*.md` | Qualify the design/spec permission guarantees as POSIX-only so future work does not reintroduce the assumption. |
| `docs/research/issues/661-windows-plugin-permission-check.md` | Preserve the root cause, spike result, decision, and security reasoning. |

## Implementation steps

1. Add a test helper that temporarily installs or removes `process.getuid` and always restores the original
   property descriptor.
2. Make the existing world-writable rejection test explicitly simulate a POSIX identity API. This keeps the
   assertion active on Windows CI instead of silently becoming a platform-specific skip.
3. Add the issue #661 regression: a valid `0666` code plugin that references a valid `0666` manifest, with
   no `process.getuid`, must load and register the manifest tool. This exercises both call sites of the shared
   guard and the reporter's actual `.js` entry form.
4. Refactor `assertLoadablePath()` so both checks that consume POSIX ownership/mode semantics live inside one
   `typeof process.getuid === 'function'` branch. Keep absolute-path and `statSync` validation unchanged.
5. Update the configuration reference, extension deployment guide, R18 security text, and extension design
   documents. POSIX operators still need correct ownership and must avoid `chmod 777`; Windows operators must
   protect the plugin with Windows ACLs.
6. Run the focused test, full plugin-loader test file, typecheck, lint, unit suite, policy validation, build,
   and file-size ratchet. Review the final diff for unintended tool-surface or security changes.

## Acceptance criteria

- A valid `.js` plugin and referenced `.json` manifest whose stat modes include `0o002` load when
  `process.getuid` is unavailable.
- The code plugin appears in `LoadedPlugin[]` and its manifest tool is registered in `ToolRegistry`.
- A world-writable plugin is still refused when POSIX identity APIs are available.
- Non-absolute and missing paths remain refused.
- Both `.js` and `.json` paths inherit the fix from the shared guard; no duplicate platform branch is added.
- Documentation no longer implies that ARC-1 interprets Windows ACLs through POSIX mode bits.
- All repository verification gates available in the local environment pass, with any environment limitation
  reported explicitly.

## Non-goals

- Implementing Windows ACL inspection or adding a native dependency.
- Changing fail-fast plugin startup behavior.
- Relaxing absolute-path, existence, plugin-shape, namespace, policy, or API-version validation.
- Changing the trusted in-process plugin model or any SAP operation gate.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Accidentally disable POSIX tamper checks | One explicit simulated-POSIX rejection test plus unchanged error assertions. |
| Test mutates global `process` state | Save/restore the exact property descriptor in `finally`; keep the mutation scoped to the awaited loader call. |
| Windows test passes without proving registration | Assert both `LoadedPlugin[]` metadata and the `ToolRegistry` entry. |
| Documentation overstates Windows protection | Name Windows ACLs as the OS control and describe owner/mode checks as POSIX-only. |
| Broader plugin-loading regression | Run the complete plugin-loader suite and full unit/build gates. |

## Plan review

**Verdict:** proceed after two corrections to the first draft.

1. **Exercise the reported code-plugin path.** The initial spike used a standalone manifest, which correctly
   proved the shared guard was faulty but did not cross the `import()` boundary from the report. The final
   regression will load a CommonJS `.js` plugin with a relative manifest. That proves code-plugin loading,
   relative manifest resolution, the second guard call, and tool registration without needing SAP.
2. **Eliminate stale platform claims.** A grep found the same unqualified owner/world-writable promise in the
   configuration reference and extension research/spec documents. Leaving those unchanged could cause the
   invalid Windows assumption to be restored later. The implementation will qualify those sentences without
   otherwise rewriting historical design material.

The reviewed plan intentionally rejects three larger alternatives: checking `process.platform` duplicates a
capability Node already exposes; disabling mode checks everywhere weakens POSIX defense-in-depth; implementing
Windows ACL inspection adds native/platform complexity disproportionate to an admin-controlled trusted-plugin
loader. The capability-gated change is the smallest behaviorally correct fix.

## Verification results

| Gate | Result |
|---|---|
| Pre-fix regression spike | Failed at `assertLoadablePath()` with the reported world-writable error, as expected. |
| Plugin-loader suite | 13/13 passed, including simulated Windows `.js` + manifest loading and simulated POSIX refusal. |
| Full unit suite | 168 files, 4,868 tests passed. |
| Typecheck | All source, script, and test TypeScript configs passed. |
| Lint | Passed; two pre-existing Biome configuration migration notices only. |
| Policy validation | 125 policy entries cover all 14 tool schemas. |
| Build | Passed. |
| File/tool-schema budgets | Passed. |
| Diff hygiene | `git diff --check` passed; no tool-definition fixture changed. |

Local npm emitted an engine warning because the available Node is 22.18.0 while the package requires at least
22.19.0. Installation and every gate above nevertheless completed successfully. The cross-platform regression
simulates Node's documented Windows API surface; no Windows host was available in this workspace.
