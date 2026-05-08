# Changelog

## [0.9.2](https://github.com/marianfoo/arc-1/compare/v0.9.1...v0.9.2) (2026-05-08)


### Bug Fixes

* **ci:** re-trigger release after [#244](https://github.com/marianfoo/arc-1/issues/244) chore-merge ([6345625](https://github.com/marianfoo/arc-1/commit/6345625b5e402752062706a4ae1abc7cfa1ba5a2))

## [0.9.1](https://github.com/marianfoo/arc-1/compare/v0.9.0...v0.9.1) (2026-05-08)


### Bug Fixes

* **adt:** align DEVC listing descriptions with object names ([#242](https://github.com/marianfoo/arc-1/issues/242)) ([63cfc70](https://github.com/marianfoo/arc-1/commit/63cfc70a00b9dd21f6c786fcdce7a5a8d72a55fd))
* **adt:** decode XML entities in parseSearchResults description ([#243](https://github.com/marianfoo/arc-1/issues/243)) ([c522866](https://github.com/marianfoo/arc-1/commit/c52286699fdd844628d5385f50e8d4ab213b7730))
* **docker:** drop bundled npm CLI from runtime image ([#240](https://github.com/marianfoo/arc-1/issues/240)) ([e480206](https://github.com/marianfoo/arc-1/commit/e480206cf13eb057818045e5765b840577e5bacb))

## [0.9.0](https://github.com/marianfoo/arc-1/compare/v0.8.0...v0.9.0) (2026-05-08)


### ⚠ BREAKING CHANGES

* MSAG read enum + FTG2→FEATURE_TOGGLE rename (audit Plan B) ([#224](https://github.com/marianfoo/arc-1/issues/224))
* callers that passed type='FUNC/FM', 'CLAS/LI', 'VIEW/V', or 'TRAN/O' will now fail Zod schema validation. Migrate to FUGR/FF, CLAS/I (if needed — currently absent), VIEW/DV, TRAN/T respectively, or use the canonical short forms FUNC/CLAS/VIEW/TRAN.
* SAPRead/SAPWrite/SAPActivate no longer accept type='STRU'. Callers must use type='TABL' for both transparent tables and DDIC structures. ARC-1 ships pre-1.0; the slash form 'STRU/DS' is preserved as a back-compat alias inside SLASH_TYPE_MAP only.

### Features

* cookie hot-reload on stale 401 ([#200](https://github.com/marianfoo/arc-1/issues/200)) ([23d4bfe](https://github.com/marianfoo/arc-1/commit/23d4bfe180d1e012926c86f5e547389420ba1139))
* layered lock-conflict detection + MSAG transport guard ([#202](https://github.com/marianfoo/arc-1/issues/202)) ([cf0a126](https://github.com/marianfoo/arc-1/commit/cf0a12605b584be527ee71f17dfd6b8775ff3db8))
* MSAG read enum + FTG2→FEATURE_TOGGLE rename (audit Plan B) ([#224](https://github.com/marianfoo/arc-1/issues/224)) ([d4c0fd3](https://github.com/marianfoo/arc-1/commit/d4c0fd3416944f193b8ed3dad8b578d576954840))
* purge invented ADT slash aliases (issue [#218](https://github.com/marianfoo/arc-1/issues/218) audit, Plan A) ([#223](https://github.com/marianfoo/arc-1/issues/223)) ([e130b87](https://github.com/marianfoo/arc-1/commit/e130b8789408ab8883669d015a8ba8868190d3a2))
* three-file sync (messages + STRU) + universal write guards ([#201](https://github.com/marianfoo/arc-1/issues/201)) ([2afedf1](https://github.com/marianfoo/arc-1/commit/2afedf17534a7e00c31d850310d485339cdd6064))


### Bug Fixes

* **adt:** tighten HTML entity decoder + tag stripper (CodeQL alerts 6, 7, 8) ([#238](https://github.com/marianfoo/arc-1/issues/238)) ([3bd7dac](https://github.com/marianfoo/arc-1/commit/3bd7dac8468dd4653b297b395a1e14a8c9398678))
* collapse STRU type into TABL ([#219](https://github.com/marianfoo/arc-1/issues/219)) ([1a310e9](https://github.com/marianfoo/arc-1/commit/1a310e91e93ddaf30d8acfd297cff2f8f121f679))
* SAPTransport.create works on NW 7.50 (non-breaking, defaults DEVCLASS=$TMP) ([#228](https://github.com/marianfoo/arc-1/issues/228)) ([fc29c41](https://github.com/marianfoo/arc-1/commit/fc29c415bc3cd86a2f2783bdabd7df171972d6d7))


### Tests

* add SAPLint PrettyPrint and revision eval scenarios ([#151](https://github.com/marianfoo/arc-1/issues/151)) ([283b744](https://github.com/marianfoo/arc-1/commit/283b74482ed14461d918d4d660e81eec597667f9))

## [0.8.0](https://github.com/marianfoo/arc-1/compare/v0.7.2...v0.8.0) (2026-05-06)


### ⚠ BREAKING CHANGES

* make OAuth DCR registrations survive container restarts ([#212](https://github.com/marianfoo/arc-1/issues/212))

### Features

* ARC1_PUBLIC_URL env var for reverse-proxy / different-hostname deployments ([#216](https://github.com/marianfoo/arc-1/issues/216)) ([6e219dd](https://github.com/marianfoo/arc-1/commit/6e219dd463c72aac9caa50cd86ab8b824e4b2a95))
* HTTP security headers (helmet) + opt-in CORS for browser MCP clients ([#215](https://github.com/marianfoo/arc-1/issues/215)) ([8929d21](https://github.com/marianfoo/arc-1/commit/8929d21deae26b1fb242d1cbcddecbb5d878a0e8))
* make OAuth DCR registrations survive container restarts ([#212](https://github.com/marianfoo/arc-1/issues/212)) ([0d78a6b](https://github.com/marianfoo/arc-1/commit/0d78a6b0dc3c8857154ee154c41b7ef4a0f2f48a))


### Bug Fixes

* defensive dumpId encoding + endpoint-aware 403 hints ([#206](https://github.com/marianfoo/arc-1/issues/206)) ([9046fa7](https://github.com/marianfoo/arc-1/commit/9046fa7170f7b4f2bd347406e1524da9df57f0dd))

## [0.7.2](https://github.com/marianfoo/arc-1/compare/v0.7.1...v0.7.2) (2026-04-28)


### Features

* ETag-validated source cache + active/inactive SAPRead version parameter ([#186](https://github.com/marianfoo/arc-1/issues/186)) ([70bed22](https://github.com/marianfoo/arc-1/commit/70bed22859663106aba54b0213be57758ad51829))


### Bug Fixes

* detect HANA via S4CORE/HDB components ([#182](https://github.com/marianfoo/arc-1/issues/182)) ([87ec553](https://github.com/marianfoo/arc-1/commit/87ec553fa8011a3ffdddf41f12f252f7184c2057))

## [0.7.1](https://github.com/marianfoo/arc-1/compare/v0.7.0...v0.7.1) (2026-04-27)


### Bug Fixes

* restore npx package execution ([#189](https://github.com/marianfoo/arc-1/issues/189)) ([da05e01](https://github.com/marianfoo/arc-1/commit/da05e01ea30b0702126a9d12000a2b187fca6c9b))

## [0.7.0](https://github.com/marianfoo/arc-1/compare/v0.6.10...v0.7.0) (2026-04-26)


### ⚠ BREAKING CHANGES

* authorization refactor ([#181](https://github.com/marianfoo/arc-1/issues/181))

### Features

* add cds crud dependency guidance for ddls workflows ([#176](https://github.com/marianfoo/arc-1/issues/176)) ([f597486](https://github.com/marianfoo/arc-1/commit/f597486e71948356137e7d0111f5c3956a350c9c))
* authorization refactor ([#181](https://github.com/marianfoo/arc-1/issues/181)) ([7be4ff0](https://github.com/marianfoo/arc-1/commit/7be4ff0af8029c32a4fc7e8949905922bb7320f4))
* close RAP on-prem authoring gaps with preflight and handler scaffolding ([#173](https://github.com/marianfoo/arc-1/issues/173)) ([29ee0b5](https://github.com/marianfoo/arc-1/commit/29ee0b58f2224646a22a711cb68af03f70750233))
* detect sibling DDLS DDLX coverage mismatches in SAPContext impact ([#177](https://github.com/marianfoo/arc-1/issues/177)) ([4f6e822](https://github.com/marianfoo/arc-1/commit/4f6e82242b4e0b439401a4f2daf9398d3638a06f))
* harden SAPDiagnose dump and gateway diagnostics ([#174](https://github.com/marianfoo/arc-1/issues/174)) ([9383891](https://github.com/marianfoo/arc-1/commit/9383891055c009e9390988e1ff4553ad10917697))


### Bug Fixes

* harden SAP data preview diagnostics and SAPManage scope behavior ([#171](https://github.com/marianfoo/arc-1/issues/171)) ([6697d3e](https://github.com/marianfoo/arc-1/commit/6697d3ef17f9b490805dc2ae5bcc435611e15ab4))
* SAPActivate phantom success + CLI/server alignment gaps (NW 7.50) ([#179](https://github.com/marianfoo/arc-1/issues/179)) ([4f2028e](https://github.com/marianfoo/arc-1/commit/4f2028e048b611b1ba106aeb3042ce99202388f9))

## [Unreleased] — v0.7 — Authorization Refactor (**breaking change**)

Complete rewrite of the authorization model. Introduces a single `ACTION_POLICY` matrix as the source of truth for `(tool, action) → (scope, opType)`; replaces negated safety flags with positive opt-ins; adds per-user `transports` and `git` scopes; makes `admin` imply all scopes; and makes `allowWrites=false` truly block every mutation.

See [`docs_page/updating.md`](https://github.com/marianfoo/arc-1/blob/main/docs_page/updating.md#v07-authorization-refactor-breaking-change) for the full migration guide.

### Breaking — removed

- **Env vars**: `SAP_READ_ONLY`, `SAP_BLOCK_DATA`, `SAP_BLOCK_FREE_SQL`, `SAP_ENABLE_TRANSPORTS`, `SAP_ENABLE_GIT`, `SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`, `ARC1_PROFILE`, `ARC1_API_KEY` (single-key mode).
- **CLI flags**: `--read-only`, `--block-data`, `--block-free-sql`, `--enable-transports`, `--enable-git`, `--allowed-ops`, `--disallowed-ops`, `--profile`, `--api-key`.
- **Server config fields**: `readOnly`, `blockData`, `blockFreeSQL`, `enableTransports`, `enableGit`, `allowedOps`, `disallowedOps`, `dryRun`, `transportReadOnly`.
- Server-side profile system (`PROFILES`, `PROFILE_SCOPES` tables).

Startup aborts with a specific migration error pointing to `docs_page/updating.md` if any of these are set.

### Breaking — added

- **New env vars**: `SAP_ALLOW_WRITES`, `SAP_ALLOW_DATA_PREVIEW`, `SAP_ALLOW_FREE_SQL`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES`, `SAP_DENY_ACTIONS`. All positive opt-ins; all defaults are restrictive.
- **New scopes** (xs-security.json + `API_KEY_PROFILES`): `transports`, `git`. `admin` now implies all 7 scopes at extraction time.
- **New role templates**: `MCPDeveloper` bundles `[read, write, transports, git]`; `MCPAdmin` lists all 7 scopes explicitly.
- **New API-key profile `admin`** in addition to existing `viewer`/`viewer-data`/`viewer-sql`/`developer`/`developer-data`/`developer-sql`.

### Fixed — six scope/safety classification bugs

1. `SAPLint.set_formatter_settings` — was scope `read` at tool level, but the implementation called `OperationType.Update`. Now correctly classified as `write`.
2. `SAPManage.flp_list_catalogs` / `flp_list_groups` / `flp_list_tiles` — were scope `write`, but the implementation called `OperationType.Read`. Now correctly classified as `read`.
3. `SAPTransport.check` — was scope `write`, but is a read operation. Now correctly `read`.
4. `SAPTransport.history` — was scope `write`, but is a read operation. Now correctly `read`.
5. `checkTransport` did not consult `readOnly` (silent security gap). Transport mutations now require `allowWrites=true && allowTransportWrites=true`.
6. `checkGit` did not consult `readOnly`. Git mutations now require `allowWrites=true && allowGitWrites=true`.

### Added — observability

- Startup `effective safety` log line with per-field source attribution (env / flag / file / default).
- Contradiction warnings for useless combos (e.g., `allowTransportWrites=true` with `allowWrites=false`).
- New `arc-1 config show` CLI subcommand (`--format=json|table`) that dumps the resolved effective policy without starting the server. Exits non-zero on config error.
- CI validator (`npm run validate:policy`) asserts `ACTION_POLICY` matches `src/handlers/schemas.ts` action/type enums.

## [0.6.10](https://github.com/marianfoo/arc-1/compare/v0.6.9...v0.6.10) (2026-04-20)


### Features

* add SAPGit tool with gCTS and abapGit integration ([#159](https://github.com/marianfoo/arc-1/issues/159)) ([196b8a0](https://github.com/marianfoo/arc-1/commit/196b8a02a20410466d7f8b0d6c640638e800fe9f))
* diagnostic ADT type-availability probe ([#163](https://github.com/marianfoo/arc-1/issues/163)) ([6bf4365](https://github.com/marianfoo/arc-1/commit/6bf43655370a7e13aeb0234fbf4c9a52b816272c))


### Bug Fixes

* DTEL v2→v1 content-type fallback + SICF-aware error hints ([#169](https://github.com/marianfoo/arc-1/issues/169)) ([1b6760f](https://github.com/marianfoo/arc-1/commit/1b6760f173cd106c66c7f2e1d247d5b74917de5b))
* **e2e:** make E2E suite pass cleanly on NetWeaver 7.50 ([#168](https://github.com/marianfoo/arc-1/issues/168)) ([750be05](https://github.com/marianfoo/arc-1/commit/750be05e583c4feac672da808b82d12af7d66c4d))
* filter empty SAP_ALLOWED_PACKAGES entries and clarify docker docs ([#156](https://github.com/marianfoo/arc-1/issues/156)) ([81001da](https://github.com/marianfoo/arc-1/commit/81001dac40805bf5d2ac68947c1a6280cd864427))
* integration suite passes cleanly on NW 7.50 ([#167](https://github.com/marianfoo/arc-1/issues/167)) ([1bc2984](https://github.com/marianfoo/arc-1/commit/1bc298453a1767dd156b41be0f62f4a31e5ac4f1))
* make extract-sap-cookies work on Windows + Edge (fix [#149](https://github.com/marianfoo/arc-1/issues/149)) ([#154](https://github.com/marianfoo/arc-1/issues/154)) ([8e87600](https://github.com/marianfoo/arc-1/commit/8e876006b233c46681b526a996b93a96cdba6d2e))

## [0.6.9](https://github.com/marianfoo/arc-1/compare/v0.6.8...v0.6.9) (2026-04-17)


### Features

* Add CDS-specific impact analysis ([#143](https://github.com/marianfoo/arc-1/issues/143)) ([0dab061](https://github.com/marianfoo/arc-1/commit/0dab061bbb0ef97bf4ae36d622499b48fdd7cd3b))
* FEAT-43 SAPRead for AUTH, FTG2, ENHO (on-prem) ([#142](https://github.com/marianfoo/arc-1/issues/142)) ([2a827a1](https://github.com/marianfoo/arc-1/commit/2a827a15276e92f1edd35e3094018ca4510aaadf))
* fix cookie→PP leak, gate saml2=disabled, wire cookies & verbose CLI ([#149](https://github.com/marianfoo/arc-1/issues/149)) ([74111ff](https://github.com/marianfoo/arc-1/commit/74111ff80f783f8212aa1100416ed10d389a397b))
* SAPLint PrettyPrint (ADT code formatter) ([#145](https://github.com/marianfoo/arc-1/issues/145)) ([af6da11](https://github.com/marianfoo/arc-1/commit/af6da115c709f5da08e6c87da7420e96c5e3539f))
* SAPTransport history action (object transport reverse lookup) ([#146](https://github.com/marianfoo/arc-1/issues/146)) ([8cae8f2](https://github.com/marianfoo/arc-1/commit/8cae8f26997f647f8bf093361516a0b98f218ea9))
* Source Version / Revision History (on-prem) ([#144](https://github.com/marianfoo/arc-1/issues/144)) ([92f6ef2](https://github.com/marianfoo/arc-1/commit/92f6ef225433ca219bab9430fad9d43e7914260e))


### Bug Fixes

* modificationSupport guard + CSRF HEAD→GET fallback for S/4HANA Public Cloud ([#140](https://github.com/marianfoo/arc-1/issues/140)) ([9fcd4aa](https://github.com/marianfoo/arc-1/commit/9fcd4aae43d3e1268baecd0a73a4f47c6bf2debf))


### Tests

* restructure LLM evals by feature bucket + live MCP backend ([#147](https://github.com/marianfoo/arc-1/issues/147)) ([27f4f51](https://github.com/marianfoo/arc-1/commit/27f4f513d44273c22eb6d2a29f72939045746198))

## [0.6.8](https://github.com/marianfoo/arc-1/compare/v0.6.7...v0.6.8) (2026-04-16)


### Features

* add change_package action for moving objects between packages ([#133](https://github.com/marianfoo/arc-1/issues/133)) ([de2bc1a](https://github.com/marianfoo/arc-1/commit/de2bc1ab6d5fe286aa2942b18ff90260566a25fc))
* implementation for creationg sktd objects ([#134](https://github.com/marianfoo/arc-1/issues/134)) ([1e8f59c](https://github.com/marianfoo/arc-1/commit/1e8f59cef66a3265b3c8b4105d5111016ff2c15d))


### Bug Fixes

* retry all HTTP methods on 503 and add CSRF token retry ([#135](https://github.com/marianfoo/arc-1/issues/135)) ([39e3529](https://github.com/marianfoo/arc-1/commit/39e35293cd369244f6f2d98df8a6a33ab15c2847))

## [0.6.7](https://github.com/marianfoo/arc-1/compare/v0.6.6...v0.6.7) (2026-04-15)


### Features

* add concurrency limiter and 503 retry ([#132](https://github.com/marianfoo/arc-1/issues/132)) ([ab18e25](https://github.com/marianfoo/arc-1/commit/ab18e25b8fef23f2d985f69a5bbb9a8ad6d0e1dd))
* add DCLS read/write support (FEAT-37) ([#129](https://github.com/marianfoo/arc-1/issues/129)) ([b4424e2](https://github.com/marianfoo/arc-1/commit/b4424e28507b8d5ff261141dd7ad30429c52ddce))
* add proactive ADT discovery MIME negotiation ([#127](https://github.com/marianfoo/arc-1/issues/127)) ([418b3d1](https://github.com/marianfoo/arc-1/commit/418b3d1f055c5891bdb46ec7a9bbad1d4f8bcd82))
* implement FEAT-16 SAP-domain error intelligence hints ([#128](https://github.com/marianfoo/arc-1/issues/128)) ([ce80aea](https://github.com/marianfoo/arc-1/commit/ce80aead717bb6ec00f8c229650f99ab1421d2b9))


### Bug Fixes

* route SRVB publish/unpublish to correct OData version endpoint ([#130](https://github.com/marianfoo/arc-1/issues/130)) ([9b0601c](https://github.com/marianfoo/arc-1/commit/9b0601c6883e34a7c8aa0b75919a00918bf6f91d))

## [0.6.6](https://github.com/marianfoo/arc-1/compare/v0.6.5...v0.6.6) (2026-04-14)


### Bug Fixes

* wait for Docker image before publishing to MCP Registry ([#125](https://github.com/marianfoo/arc-1/issues/125)) ([cab65bc](https://github.com/marianfoo/arc-1/commit/cab65bce68940ba2a6b335fed84674cb79a43098))

## [0.6.5](https://github.com/marianfoo/arc-1/compare/v0.6.4...v0.6.5) (2026-04-14)


### Features

* add quickfix proposals and auto-fix from ATC findings ([#123](https://github.com/marianfoo/arc-1/issues/123)) ([e3c4233](https://github.com/marianfoo/arc-1/commit/e3c4233ee7b00c1b2717a337d96f61dfffc53074))
* add SAP object type auto-normalization ([#122](https://github.com/marianfoo/arc-1/issues/122)) ([750c835](https://github.com/marianfoo/arc-1/commit/750c8353961530773d2bf5389e8f3cb5b9a7ab50))
* extend abaplint CDS lint support for DDLS pre-write validation ([#121](https://github.com/marianfoo/arc-1/issues/121)) ([b2324cc](https://github.com/marianfoo/arc-1/commit/b2324cc90e9a56ee4ae22c1784fdc693ea1d2f37))


### Bug Fixes

* add structured DDIC diagnostics, inactive syntax check, and BDEF package handling ([#119](https://github.com/marianfoo/arc-1/issues/119)) ([20c7ddb](https://github.com/marianfoo/arc-1/commit/20c7ddb92d2c6fe35123bf48ffef688877cec3d3))
* CF buildpack deployment fixes and BTP write tool support ([#107](https://github.com/marianfoo/arc-1/issues/107)) ([5fb05e0](https://github.com/marianfoo/arc-1/commit/5fb05e05b2c227e5a725bbc417fbdb699915f25e))
* normalize SRVB bindingType and support OData V4 bindings ([#120](https://github.com/marianfoo/arc-1/issues/120)) ([6e1735c](https://github.com/marianfoo/arc-1/commit/6e1735c099b9c5c39144a6024bffeeb2ae9d5b93))
* skip abaplint for non-ABAP types and add per-call lintBeforeWrite ([#117](https://github.com/marianfoo/arc-1/issues/117)) ([362e429](https://github.com/marianfoo/arc-1/commit/362e42966b22c77649b93f266d85f5d5a9c82013))

## [0.6.4](https://github.com/marianfoo/arc-1/compare/v0.6.3...v0.6.4) (2026-04-14)


### Bug Fixes

* add MCP Registry OCI annotation to Dockerfile ([#115](https://github.com/marianfoo/arc-1/issues/115)) ([15c4354](https://github.com/marianfoo/arc-1/commit/15c43542fc2780c30ee6969a4f29f11978a213b1))

## [0.6.3](https://github.com/marianfoo/arc-1/compare/v0.6.2...v0.6.3) (2026-04-14)


### Bug Fixes

* add mcpName for MCP Registry publishing ([#113](https://github.com/marianfoo/arc-1/issues/113)) ([bd346c5](https://github.com/marianfoo/arc-1/commit/bd346c50dcad7ae52e27cf1af7236d1b9fb114a4))

## [0.6.2](https://github.com/marianfoo/arc-1/compare/v0.6.1...v0.6.2) (2026-04-14)


### Features

* add 401 session timeout auto-retry and XML attribute escaping ([#85](https://github.com/marianfoo/arc-1/issues/85)) ([37f8839](https://github.com/marianfoo/arc-1/commit/37f8839297e6ea7ebbac36015e33793ed211140b))
* Add DOMA/DTEL write support to SAPWrite ([#86](https://github.com/marianfoo/arc-1/issues/86)) ([252d048](https://github.com/marianfoo/arc-1/commit/252d0489b8f417134b5b167972022f5c99d86c09))
* add FLP launchpad management via SAPManage ([#87](https://github.com/marianfoo/arc-1/issues/87)) ([8026a84](https://github.com/marianfoo/arc-1/commit/8026a84adbbcd84b9a342a491f2285cd1bfd1890))
* BTP Cloud Foundry deployment with SAP Cloud SDK and MTA support ([#97](https://github.com/marianfoo/arc-1/issues/97)) ([29e6685](https://github.com/marianfoo/arc-1/commit/29e6685749a2325833b55e802b9aea1f81a9b536))
* CDS write robustness and error handling improvements ([#101](https://github.com/marianfoo/arc-1/issues/101)) ([c06d884](https://github.com/marianfoo/arc-1/commit/c06d884707726bd150fda56fa94beaca9aec2464))
* DEVC package create/delete via SAPManage ([#110](https://github.com/marianfoo/arc-1/issues/110)) ([72478d3](https://github.com/marianfoo/arc-1/commit/72478d38e2f9a43dac9a1e7d891f3314f3696169))
* improve activation structured responses, inactive objects, preaudit ([#90](https://github.com/marianfoo/arc-1/issues/90)) ([b8d5db0](https://github.com/marianfoo/arc-1/commit/b8d5db09bb63aa8e120cb80efd98516b18c36631))
* MSAG (message class) read/write support ([#109](https://github.com/marianfoo/arc-1/issues/109)) ([9a80416](https://github.com/marianfoo/arc-1/commit/9a8041608aadaad0ba72ae152e6f79146ebc20ec))
* safe by default — read-only, no SQL, no data preview out of the box ([#89](https://github.com/marianfoo/arc-1/issues/89)) ([5a46c9c](https://github.com/marianfoo/arc-1/commit/5a46c9c7aae08ae2ff885a0b1865b063c696f301))
* SRVB (Service Binding) create/update/delete via SAPWrite ([#111](https://github.com/marianfoo/arc-1/issues/111)) ([3e135a8](https://github.com/marianfoo/arc-1/commit/3e135a84d2aee385e823a7bdb59f2a689cfff6f7))
* TABL create/update/delete support ([#104](https://github.com/marianfoo/arc-1/issues/104)) ([03f1ece](https://github.com/marianfoo/arc-1/commit/03f1ecea4eb365d94b53c97901a01dc9131dc993))
* transport enhancements — delete, reassign, types, recursive release (FEAT-39) ([#88](https://github.com/marianfoo/arc-1/issues/88)) ([0f7ac83](https://github.com/marianfoo/arc-1/commit/0f7ac8345a4914d05935f8ced359378c4840093c))
* transport pre-flight check for non-$TMP package writes ([#99](https://github.com/marianfoo/arc-1/issues/99)) ([36d7787](https://github.com/marianfoo/arc-1/commit/36d7787213b2c1e715b05f273efe32e4b7b9cc9f))


### Bug Fixes

* align ADT API patterns with reference abap-adt-api implementation ([#98](https://github.com/marianfoo/arc-1/issues/98)) ([9607510](https://github.com/marianfoo/arc-1/commit/9607510d0bb886d46e70bf2c620e014c37420dd9))
* enforce allowedPackages on all SAPWrite operations ([#81](https://github.com/marianfoo/arc-1/issues/81)) ([5de8b44](https://github.com/marianfoo/arc-1/commit/5de8b4443b4d090a6920cdee7c917d41bb282ab6))
* feature probe only treats 404 as unavailable, not all HTTP errors ([#95](https://github.com/marianfoo/arc-1/issues/95)) ([5119615](https://github.com/marianfoo/arc-1/commit/51196153b9a1889a5d572e31d6e15438e2bd09ca))
* RAP write guard, block CDS writes when RAP unavailable ([#93](https://github.com/marianfoo/arc-1/issues/93)) ([dea0099](https://github.com/marianfoo/arc-1/commit/dea009926d93f76301e1824bc46ee164db9bb23b))
* remove RAP write guard that blocked all CDS/DDLS writes ([#96](https://github.com/marianfoo/arc-1/issues/96)) ([5ffef19](https://github.com/marianfoo/arc-1/commit/5ffef19b3586d0c0cd9bfb3134d34d0303430398))
* transport hint false positive when corrNr present in URL path ([#100](https://github.com/marianfoo/arc-1/issues/100)) ([2026702](https://github.com/marianfoo/arc-1/commit/202670259e7e379548eb29f6a05bc360c055f4fb))
* use HEAD instead of GET for feature probing ([#94](https://github.com/marianfoo/arc-1/issues/94)) ([4a8a156](https://github.com/marianfoo/arc-1/commit/4a8a1565ecb9a56c7137003153b7f1359deef491))

## [0.6.1](https://github.com/marianfoo/arc-1/compare/v0.6.0...v0.6.1) (2026-04-10)


### Features

* add API release state tool for clean core compliance (FEAT-02) ([#77](https://github.com/marianfoo/arc-1/issues/77)) ([57e5eaf](https://github.com/marianfoo/arc-1/commit/57e5eafdc05067e7acf4052da4087f1ea0e2b3c6))
* add BSP types and Atom XML parsers for UI5 filestore ([#61](https://github.com/marianfoo/arc-1/issues/61)) ([264af14](https://github.com/marianfoo/arc-1/commit/264af14d1dcfde49a64965cdf94baba6db8b3731))
* add BSP_DEPLOY type for ABAP Repository OData queries ([#66](https://github.com/marianfoo/arc-1/issues/66)) ([90a2fc6](https://github.com/marianfoo/arc-1/commit/90a2fc6b419720b3844480f3fe943a55bd2e9ac1))
* add class hierarchy to SAPNavigate and fix doc inaccuracies ([#70](https://github.com/marianfoo/arc-1/issues/70)) ([1831808](https://github.com/marianfoo/arc-1/commit/183180828a44b7fcc3dd7db7a9944785364f6050))
* add publishServiceBinding and unpublishServiceBinding to devtools ([#62](https://github.com/marianfoo/arc-1/issues/62)) ([ced5639](https://github.com/marianfoo/arc-1/commit/ced56393c8d396f999ecba7c673abef45dbe9dc0))
* add transliteration, field hints, cache indicators ([#64](https://github.com/marianfoo/arc-1/issues/64)) ([0ce3347](https://github.com/marianfoo/arc-1/commit/0ce334712e2a40b0571b86c2ee5e3b40a13b2329))
* transport/write compatibility — CTS media types, 406/415 retry, corrNr auto-propagation ([#78](https://github.com/marianfoo/arc-1/issues/78)) ([42f0786](https://github.com/marianfoo/arc-1/commit/42f078658fe3b98143a2344e276d6d663c64f78c))


### Bug Fixes

* add pre-cleanup for stale E2E write object ([#76](https://github.com/marianfoo/arc-1/issues/76)) ([a5aa26f](https://github.com/marianfoo/arc-1/commit/a5aa26f07ee7dbde7c58b8e2f0e0a13bcdd1eb76))
* correct Accept headers and entity expansion limit for ADT APIs ([#69](https://github.com/marianfoo/arc-1/issues/69)) ([ff96ea8](https://github.com/marianfoo/arc-1/commit/ff96ea852ccb9d3136cffa3b0e8205d6cb466799))
* implement comprehensive ADT API audit reports ([#65](https://github.com/marianfoo/arc-1/issues/65)) ([9f210ab](https://github.com/marianfoo/arc-1/commit/9f210ab0f0365ea65dd9cfa261436678af299c26))
* improve LLM guidance for SAPSearch empty results and SAPContext CDS usage ([#59](https://github.com/marianfoo/arc-1/issues/59)) ([1df565a](https://github.com/marianfoo/arc-1/commit/1df565a6d68a89fec9565fa865cded82fc8f426e))


### Tests

* reliability hardening, fixtures, skip policy, coverage, try/catch, CRUD lifecycle, telemetry ([#72](https://github.com/marianfoo/arc-1/issues/72)) ([be42998](https://github.com/marianfoo/arc-1/commit/be42998f19f731939ddffad59f76e89cf8c26f55))

## [0.6.0](https://github.com/marianfoo/arc-1/compare/v0.5.0...v0.6.0) (2026-04-08)


### ⚠ BREAKING CHANGES

* simplify write safety — default $TMP, remove allowTransportableEdits, enforce package allowlist ([#56](https://github.com/marianfoo/arc-1/issues/56))

### Features

* add class metadata types and ADT metadata parser ([#55](https://github.com/marianfoo/arc-1/issues/55)) ([0b44fb7](https://github.com/marianfoo/arc-1/commit/0b44fb7e32cb5fbca389edda77b6d1ef1b7c818b))
* simplify write safety — default $TMP, remove allowTransportableEdits, enforce package allowlist ([#56](https://github.com/marianfoo/arc-1/issues/56)) ([1f6ac1d](https://github.com/marianfoo/arc-1/commit/1f6ac1da03f61d42099dccedd3e6b1f824aec091))

## [0.5.0](https://github.com/marianfoo/arc-1/compare/v0.4.4...v0.5.0) (2026-04-08)


### ⚠ BREAKING CHANGES

* SAPQuery now requires 'data' scope (was 'read'), SAPTransport requires 'write' (was 'admin')

### Features

* add J4D skills parity plan ([#47](https://github.com/marianfoo/arc-1/issues/47)) ([df7ef1f](https://github.com/marianfoo/arc-1/commit/df7ef1f98e8bcf4fa51f40af53b75d9fdd8e9672))
* add textSearch smoketest at startup and other improvments ([#45](https://github.com/marianfoo/arc-1/issues/45)) ([792ff5b](https://github.com/marianfoo/arc-1/commit/792ff5ba605ba00e1dce869768903eeb99adcc94))
* add Zod v4 runtime input validation for all MCP tools ([#52](https://github.com/marianfoo/arc-1/issues/52)) ([9eea32a](https://github.com/marianfoo/arc-1/commit/9eea32a3eec4d6a7e1276483c4aa73cc215efe52))
* two-dimensional authorization model (scopes, roles, safety) ([#48](https://github.com/marianfoo/arc-1/issues/48)) ([8ce07d1](https://github.com/marianfoo/arc-1/commit/8ce07d11389928709de01da5073d0165cbc605b7))


### Bug Fixes

* implement OAuth security review verification report(RFC 9700) ([#51](https://github.com/marianfoo/arc-1/issues/51)) ([3ef81e1](https://github.com/marianfoo/arc-1/commit/3ef81e1cd3b094a4f6645add6c866dbe2c71bf1e))
* use standard HTTP proxy for BTP connectivity ([#43](https://github.com/marianfoo/arc-1/issues/43)) ([a60dd1b](https://github.com/marianfoo/arc-1/commit/a60dd1b60145c40c02fb1be93b33c39aa3d9af54))

## [0.4.4](https://github.com/marianfoo/arc-1/compare/v0.4.3...v0.4.4) (2026-04-07)


### Bug Fixes

* use native arm64 runners instead of QEMU for Docker builds ([b65fba4](https://github.com/marianfoo/arc-1/commit/b65fba41851b0d5ae1f2d15601c4afc78b0608ae))

## [0.4.3](https://github.com/marianfoo/arc-1/compare/v0.4.2...v0.4.3) (2026-04-07)


### Bug Fixes

* use separate deps stage to avoid QEMU arm64 crash in Docker build ([cab08fa](https://github.com/marianfoo/arc-1/commit/cab08fa2085fbafb63d61e1954ae88af136d87b7))

## [0.4.2](https://github.com/marianfoo/arc-1/compare/v0.4.1...v0.4.2) (2026-04-07)


### Bug Fixes

* avoid QEMU emulation crash in arm64 Docker build ([7ea7883](https://github.com/marianfoo/arc-1/commit/7ea78838ea8bd121f6b823c0754f64ae2b69b673))

## [0.4.1](https://github.com/marianfoo/arc-1/compare/v0.4.0...v0.4.1) (2026-04-07)


### Bug Fixes

* fix npm self-upgrade in release workflow (Node 22.22.x bug) ([17b6bf3](https://github.com/marianfoo/arc-1/commit/17b6bf3bb1ffcd83684d0c9d8f37b34bc0f37aa5))

## [0.4.0](https://github.com/marianfoo/arc-1/compare/v0.3.0...v0.4.0) (2026-04-07)


### Features

* add DDIC completeness — structures, domains, data elements, transactions ([#21](https://github.com/marianfoo/arc-1/issues/21)) ([9e0fa2a](https://github.com/marianfoo/arc-1/commit/9e0fa2ad756a3a10f937531216707c8ac56c8aae))
* add DDLS support to SAPContext and include=elements to SAPRead ([#30](https://github.com/marianfoo/arc-1/issues/30)) ([6a2883e](https://github.com/marianfoo/arc-1/commit/6a2883e086bd9c44d578245a61fad1a50693f60f))
* add LLM eval harness for testing tool-call accuracy ([#33](https://github.com/marianfoo/arc-1/issues/33)) ([e8c8a65](https://github.com/marianfoo/arc-1/commit/e8c8a6511ad69bb9b95222450e0095fde391edda))
* add object caching with on-demand + pre-warmer support ([#31](https://github.com/marianfoo/arc-1/issues/31)) ([8ba2f0d](https://github.com/marianfoo/arc-1/commit/8ba2f0d1624039be03cfb39d916ee11b53f94dc8))
* add runtime diagnostics (short dumps + ABAP traces) to SAPDiagnose ([#24](https://github.com/marianfoo/arc-1/issues/24)) ([ab177fc](https://github.com/marianfoo/arc-1/commit/ab177fc0a77f34da5c3cd2c83fbf3de64b3ee928))
* DDLX, SRVB read support and batch activation for RAP completeness ([#22](https://github.com/marianfoo/arc-1/issues/22)) ([402c57b](https://github.com/marianfoo/arc-1/commit/402c57bb3b43b908a3df4e9494e0cfbd08cc436f))
* enhanced abaplint integration with system-aware presets and pre-write validation ([#37](https://github.com/marianfoo/arc-1/issues/37)) ([f17d4fa](https://github.com/marianfoo/arc-1/commit/f17d4fa03cf725dcc45918f050b2c1cd8fd2eff4))
* method-level surgery and hyperfocused mode ([#23](https://github.com/marianfoo/arc-1/issues/23)) ([dbd27b9](https://github.com/marianfoo/arc-1/commit/dbd27b9be52ee32ed8de0691e033e73ffa7c2314))
* scope-based Where-Used analysis for SAPNavigate ([#38](https://github.com/marianfoo/arc-1/issues/38)) ([f805441](https://github.com/marianfoo/arc-1/commit/f805441d03f2f1190b461d923e7e176e4f4af1bc))


### Bug Fixes

* post-merge consistency — SAPLint schema cleanup and objectUrlForType completeness ([#26](https://github.com/marianfoo/arc-1/issues/26)) ([214ebec](https://github.com/marianfoo/arc-1/commit/214ebec730b717acb483665e8af0f4bde5f0ed08))

## [0.3.0](https://github.com/marianfoo/arc-1/compare/v0.2.0...v0.3.0) (2026-04-01)


### Features

* direct BTP ABAP Environment connectivity via OAuth 2.0 ([#18](https://github.com/marianfoo/arc-1/issues/18)) ([b1cf86c](https://github.com/marianfoo/arc-1/commit/b1cf86c3755294f1873be80f67e480d54b1427b3))

## [0.2.0](https://github.com/marianfoo/arc-1/compare/v0.1.4...v0.2.0) (2026-03-31)


### Features

* E2E testing infrastructure, XML error cleanup, and CI hardening ([#13](https://github.com/marianfoo/arc-1/issues/13)) ([3830ff9](https://github.com/marianfoo/arc-1/commit/3830ff9))
* improve tooling based on real-world LLM feedback ([#14](https://github.com/marianfoo/arc-1/issues/14)) ([3bcb59e](https://github.com/marianfoo/arc-1/commit/3bcb59e))


### Bug Fixes

* correct Docker image name to arc-1 and fix GHCR link ([ae58467](https://github.com/marianfoo/arc-1/commit/ae58467))

## [0.1.4](https://github.com/marianfoo/arc-1/compare/v0.1.3...v0.1.4) (2026-03-31)


### Bug Fixes

* add repository field for npm OIDC provenance verification ([b3a55aa](https://github.com/marianfoo/arc-1/commit/b3a55aa))

## [0.1.3](https://github.com/marianfoo/arc-1/compare/v0.1.2...v0.1.3) (2026-03-31)


### Bug Fixes

* install npm 11.5+ for OIDC trusted publishing support ([300f846](https://github.com/marianfoo/arc-1/commit/300f846))

## [0.1.2](https://github.com/marianfoo/arc-1/compare/v0.1.1...v0.1.2) (2026-03-31)


### Bug Fixes

* restore NPM_TOKEN for publish and reorganize docs navigation ([6d76b4b](https://github.com/marianfoo/arc-1/commit/6d76b4b))
* use npm OIDC trusted publishing instead of NPM_TOKEN ([ab9f50c](https://github.com/marianfoo/arc-1/commit/ab9f50c))

## [0.1.1](https://github.com/marianfoo/arc-1/compare/v0.1.0...v0.1.1) (2026-03-31)

Initial release. Ported from [oisee/vibing-steampunk](https://github.com/oisee/vibing-steampunk).
