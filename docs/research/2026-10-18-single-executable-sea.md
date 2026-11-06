# Single-file executables (Node.js SEA) — research dossier

Date: 2026-10-18 · Issue: [#957](https://github.com/arc-mcp/arc-1/issues/957) (lighter install / faster cold start)

## Goal

Ship Windows, Linux and macOS executables from GitHub Actions so users do not install ~8,500 npm files
that antivirus scans on first start. No SAP/ADT behavior is touched; this is packaging only, so no live
SAP system was needed.

## Evidence

| Measurement (Windows, Node 22.22.2) | Result |
|---|---|
| npm install of arc-1 (reported in #957 by `kts982`) | 8,517 files, 21–36 s first start |
| esbuild single bundle (#957) | 35 files, ~0.5 s |
| This spike: `node` + CJS bundle | 1.3–1.9 s |
| This spike: SEA executable with code cache | ~1.0 s warm, 5–8 s on the first run of a new file (Defender scan) |
| SEA executable size | ~97 MB (Node runtime included) |

Smoke test (`scripts/ci/smoke-sea.mjs`): `--version`, MCP stdio `initialize` + `tools/list`, and an
`ARC1_CACHE=sqlite` run that must create the cache file (no silent fallback to memory).

## Decisions

- **Node SEA, not Bun/pkg.** Same runtime and `fetch`/`undici` behavior as the npm package; official Node feature.
  Bun was only assessed on paper (different runtime, `better-sqlite3` unsupported, higher AV false-positive risk).
- **CJS bundle via esbuild.** Node 22 SEA runs CommonJS only. `cli.ts` had a top-level `await` and the
  `import.meta.url === argv[1]` self-start guards; the guard no longer uses TLA and `import.meta.url` is
  replaced by a `#bundle`-suffixed URL so the bundled file never starts a second server.
- **SQLite.** `better-sqlite3` is a native addon and cannot be embedded. `src/cache/sqlite-driver.ts` tries it
  first and falls back to the built-in `node:sqlite` (Node ≥ 22.5; ExperimentalWarning on stderr). The npm
  package keeps using `better-sqlite3`.
- **AFF schemas** are embedded as SEA assets (`aff/*.json`) and read via `node:sea` `getAsset` when running as SEA.
- **Native runner matrix**: SEA blob and node binary must match platform/version. Targets: linux x64/arm64,
  macOS arm64/x64 (ad-hoc signed), windows x64.

## Known limits (documented in `docs_page/local-development.md`, tracked as roadmap OPS-07)

- No code signing; first start of a new Windows binary is still scanned once.
- `public/ui` is not embedded; `ARC1_PLUGINS` loading was not verified in the SEA.
- `node:sqlite` is experimental in Node 22.

## Affected files

`scripts/build-sea.mjs`, `scripts/sea/entry.mjs`, `scripts/ci/smoke-sea.mjs`, `src/cache/sqlite-driver.ts`,
`src/cache/sqlite.ts`, `src/aff/validator.ts`, `src/cli.ts`, `src/extract-sap-cookies.ts`,
`.github/workflows/executables.yml`, `.github/workflows/release.yml` (`build-executables`),
`tests/unit/cache/sqlite.test.ts`, `tests/unit/aff/validator-sea.test.ts`,
`tests/unit/workflows/executables-workflow.test.ts`.

## Verification status

- Local Windows x64: build + smoke test pass; unit tests pass except pre-existing Windows-only failures
  (POSIX file modes, shell launchers, real signals, fake-npm shebang).
- Linux/macOS: verified by the `Executables` workflow in the fork before the upstream PR.
