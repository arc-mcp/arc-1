# Changelog

## [0.9.26](https://github.com/arc-mcp/arc-1/compare/v0.9.25...v0.9.26) (2026-07-13)


### Features

* add authorization trace diagnostics ([#560](https://github.com/arc-mcp/arc-1/issues/560)) ([b3d993f](https://github.com/arc-mcp/arc-1/commit/b3d993fe19c03e9656955b87501d74b30e6d54ad))


### Bug Fixes

* default minimal errors for HTTP ([#552](https://github.com/arc-mcp/arc-1/issues/552)) ([4ed0dcf](https://github.com/arc-mcp/arc-1/commit/4ed0dcf090d745f2469952490118e694159a61ff))
* harden change_package object type matching ([#556](https://github.com/arc-mcp/arc-1/issues/556)) ([940b7c5](https://github.com/arc-mcp/arc-1/commit/940b7c5ff6d675a03ec280bfb1ff8bcdbf6ff885))
* harden principal-propagation identity boundaries ([d458c66](https://github.com/arc-mcp/arc-1/commit/d458c66ba36a3580688f874dea758ed75a1271d5))
* improve SAPQuery Open SQL guidance ([#559](https://github.com/arc-mcp/arc-1/issues/559)) ([636eb6c](https://github.com/arc-mcp/arc-1/commit/636eb6c731466ca39d6b18253cdf8ceab53e216a))
* make sqlite source cache explicit opt-in ([#557](https://github.com/arc-mcp/arc-1/issues/557)) ([7864e89](https://github.com/arc-mcp/arc-1/commit/7864e8925a662c0be1024bbb89652c77cecb69b2))
* open browser via rundll32 on Windows to preserve & in URLs ([#549](https://github.com/arc-mcp/arc-1/issues/549)) ([#555](https://github.com/arc-mcp/arc-1/issues/555)) ([dbf2123](https://github.com/arc-mcp/arc-1/commit/dbf2123cf4b536be63b777fad9a40d41a89ae82d))

## [0.9.25](https://github.com/arc-mcp/arc-1/compare/v0.9.24...v0.9.25) (2026-07-02)


### Features

* read + write class text symbols via ADT textelements service ([#541](https://github.com/arc-mcp/arc-1/issues/541)) ([f7ac732](https://github.com/arc-mcp/arc-1/commit/f7ac732575a357901b854358b7ac2f820f2a8955))


### Bug Fixes

* default DCR client_id TTL to never-expire and warn when the signing secret is missing ([#540](https://github.com/arc-mcp/arc-1/issues/540)) ([dd833b8](https://github.com/arc-mcp/arc-1/commit/dd833b8b343aed20d9f2f2493bdfce6a5571f0e6))

## [0.9.24](https://github.com/arc-mcp/arc-1/compare/v0.9.23...v0.9.24) (2026-06-30)


### Bug Fixes

* foolproof add_method — auto-append missing terminating period ([#536](https://github.com/arc-mcp/arc-1/issues/536)) ([#539](https://github.com/arc-mcp/arc-1/issues/539)) ([c525c04](https://github.com/arc-mcp/arc-1/commit/c525c04c7d19be1eeb0966ae79701c9c4cc894e9))
* **mcpb:** ship the bundle unsigned so strict third-party hosts can install it ([#537](https://github.com/arc-mcp/arc-1/issues/537)) ([50a7948](https://github.com/arc-mcp/arc-1/commit/50a7948bc6f59bce9ba5aec515d6354afe867702))

## [0.9.23](https://github.com/arc-mcp/arc-1/compare/v0.9.22...v0.9.23) (2026-06-29)


### Features

* Add labels to source diffs ([#528](https://github.com/arc-mcp/arc-1/issues/528)) ([bd6e520](https://github.com/arc-mcp/arc-1/commit/bd6e5200609e271f2cb494959a70cdc2b94da923))
* cloud-correct object create on BTP ABAP Environment (G-2..G-5) ([#522](https://github.com/arc-mcp/arc-1/issues/522)) ([515b91f](https://github.com/arc-mcp/arc-1/commit/515b91fdda50dae98253da414472a35ef8dd27cb))
* create packages on the BTP ABAP Environment (cloud-correct DEVC body) ([#534](https://github.com/arc-mcp/arc-1/issues/534)) ([25a017b](https://github.com/arc-mcp/arc-1/commit/25a017bd3039caa6ae7f6e9719451b37f11da1eb))


### Bug Fixes

* serve just-activated source on next read without force_refresh ([#530](https://github.com/arc-mcp/arc-1/issues/530)) ([c7535d3](https://github.com/arc-mcp/arc-1/commit/c7535d3fe92a56040b2bf9a4d1df465e44c06dab))


### Tests

* **btp:** cover SDO create + tool-level dispatch on BTP; fix smoke read-restriction assertion ([#533](https://github.com/arc-mcp/arc-1/issues/533)) ([d124ead](https://github.com/arc-mcp/arc-1/commit/d124ead05059de3804e9ce2de6843c71aa12bae7))
* **btp:** verify + cover SRVB update on the ABAP Environment (B3) ([#532](https://github.com/arc-mcp/arc-1/issues/532)) ([3a0b403](https://github.com/arc-mcp/arc-1/commit/3a0b4031cec65b64bbf3c18378c5988da249f7fc))
* verify RAP-stack (BDEF/SRVD/SRVB) cloud create on BTP ([#529](https://github.com/arc-mcp/arc-1/issues/529)) ([8451372](https://github.com/arc-mcp/arc-1/commit/8451372dac388037c236f78f9e30c1648e9c5c54))

## [0.9.22](https://github.com/arc-mcp/arc-1/compare/v0.9.21...v0.9.22) (2026-06-26)


### Features

* add DDIC structure context ([#515](https://github.com/arc-mcp/arc-1/issues/515)) ([76e24dc](https://github.com/arc-mcp/arc-1/commit/76e24dcfd86d9c6d2b6afbe49dd70e252b0c2bdf))
* **diagnose:** odata_perf client-wait + debug-slow-sql field findings ([#521](https://github.com/arc-mcp/arc-1/issues/521)) ([ddb0ffe](https://github.com/arc-mcp/arc-1/commit/ddb0ffe3190ed4c1c051fc0065652daecd66f08f))
* S/4HANA Public Cloud support ([#524](https://github.com/arc-mcp/arc-1/issues/524)) ([bdcd330](https://github.com/arc-mcp/arc-1/commit/bdcd330f71eee6dfbf4739e30dc6da168a84f029))


### Bug Fixes

* make nullable SAPWrite schemas opt-in ([#526](https://github.com/arc-mcp/arc-1/issues/526)) ([992ce76](https://github.com/arc-mcp/arc-1/commit/992ce76fff43430fdea9dd5835fe729b319bde75))


### Tests

* cover per-user Cloud Connector proxy selection ([#525](https://github.com/arc-mcp/arc-1/issues/525)) ([d755ff9](https://github.com/arc-mcp/arc-1/commit/d755ff96432c4336ccdbc4c7e9454faaeb619aa4))

## [0.9.21](https://github.com/arc-mcp/arc-1/compare/v0.9.20...v0.9.21) (2026-06-25)


### Features

* **ddic:** TTYP (table type) read + create (FEAT-65) ([#504](https://github.com/arc-mcp/arc-1/issues/504)) ([22c49b6](https://github.com/arc-mcp/arc-1/commit/22c49b613b9fcd7de2f763174039dec3371c88da))
* **diagnose:** ABAP Unit test coverage (statement/branch/procedure) for SAPDiagnose ([#503](https://github.com/arc-mcp/arc-1/issues/503)) ([f6ab40e](https://github.com/arc-mcp/arc-1/commit/f6ab40edd0a84648a96d2a922ec6a588e0429ccd))
* **diagnose:** OData sap-statistics perf probe + CDS Show-SQL + ICF-inactive guard ([#509](https://github.com/arc-mcp/arc-1/issues/509)) ([f111216](https://github.com/arc-mcp/arc-1/commit/f11121668795c09baa10f909be9c32335d4d930d))
* **diagnose:** ST05 SQL-trace state control + record-viewer directory ([#510](https://github.com/arc-mcp/arc-1/issues/510)) ([a54a99b](https://github.com/arc-mcp/arc-1/commit/a54a99b7b8ef0475363ec27be559326acdcb05a3))
* **fugr:** write FUGR structural include source ([#505](https://github.com/arc-mcp/arc-1/issues/505)) ([0e4f522](https://github.com/arc-mcp/arc-1/commit/0e4f52299df16108cf95f0c7db70cfe96a040961))
* **manage:** SAPManage set_api_state — write an object's API release contract (clean-core) ([#506](https://github.com/arc-mcp/arc-1/issues/506)) ([30d68fd](https://github.com/arc-mcp/arc-1/commit/30d68fdd4558f50b2f64624d57ffdb50acacad03))
* **query:** self-correcting "unknown column" hint for SAPQuery + TABLE_QUERY (FEAT-64) ([#502](https://github.com/arc-mcp/arc-1/issues/502)) ([39c119b](https://github.com/arc-mcp/arc-1/commit/39c119b4d9c9ee8bcca3c4a7d071ee3f4d6b551d))
* **rap:** create RAP behavior extensions (`extend behavior for`) ([#507](https://github.com/arc-mcp/arc-1/issues/507)) ([209893b](https://github.com/arc-mcp/arc-1/commit/209893b6a370fdb5070066377627305c21255449))
* SAPQuery datapreview metrics + SAPDiagnose ABAP trace requests ([#508](https://github.com/arc-mcp/arc-1/issues/508)) ([b10fab9](https://github.com/arc-mcp/arc-1/commit/b10fab9c0e1f1f677afd10af61260bc20bbbe181))
* **transport:** pre-release inactive-objects check + fix misleading K/W/T create claim ([#501](https://github.com/arc-mcp/arc-1/issues/501)) ([3519b1b](https://github.com/arc-mcp/arc-1/commit/3519b1b49d6c4a101d1b6d4be3c18dce48f8bd9b))
* **transport:** surface release-check report from SAPTransport release ([#514](https://github.com/arc-mcp/arc-1/issues/514)) ([fd7e907](https://github.com/arc-mcp/arc-1/commit/fd7e907b84c1d8f7b2033c180d4f929d8d720146))


### Bug Fixes

* add minimal client-facing SAP errors ([#495](https://github.com/arc-mcp/arc-1/issues/495)) ([f6b7fea](https://github.com/arc-mcp/arc-1/commit/f6b7fea940e0a7115851fcf5c2dcc9e15fab2dfe))
* **cli:** send correct arg shapes from sql/search shortcuts ([#512](https://github.com/arc-mcp/arc-1/issues/512)) ([b7e5325](https://github.com/arc-mcp/arc-1/commit/b7e53258271605ebab04c56428e8a1decc5ac700))
* create audit and cache files privately ([#496](https://github.com/arc-mcp/arc-1/issues/496)) ([b409672](https://github.com/arc-mcp/arc-1/commit/b409672df119042679100f5ce0488b5e1c366b4f))
* default deployment descriptors to verified SAP TLS ([#491](https://github.com/arc-mcp/arc-1/issues/491)) ([e70eaf7](https://github.com/arc-mcp/arc-1/commit/e70eaf75c3b90cd33010818c119a2d0260c02d71))
* **diagnose:** correct odata_perf "app" verdict note ([#513](https://github.com/arc-mcp/arc-1/issues/513)) ([fe12767](https://github.com/arc-mcp/arc-1/commit/fe12767e82a917036e869152a2cbdb808ccc99ea))
* enforce package allowlist for gCTS mutations ([#490](https://github.com/arc-mcp/arc-1/issues/490)) ([dfce4be](https://github.com/arc-mcp/arc-1/commit/dfce4be6e2e76ca17a7f11b5fd1111f12e17f1df))
* fail closed on principal propagation errors ([#488](https://github.com/arc-mcp/arc-1/issues/488)) ([8c22795](https://github.com/arc-mcp/arc-1/commit/8c227951693eeff11b857d3173acfb70c7794f7f))
* gate quickfix application as a write ([#489](https://github.com/arc-mcp/arc-1/issues/489)) ([f25dce5](https://github.com/arc-mcp/arc-1/commit/f25dce5b82f80c29ed71d14c16b96eb86ae9383a))
* probe UI5 BSP filestore via /objects, not the handler-less bare node ([#498](https://github.com/arc-mcp/arc-1/issues/498)) ([0f1676c](https://github.com/arc-mcp/arc-1/commit/0f1676c95f10196766478aa42f0ee42570fb804f))
* redact audit events before sink writes ([#493](https://github.com/arc-mcp/arc-1/issues/493)) ([f7af34e](https://github.com/arc-mcp/arc-1/commit/f7af34e59dba6879adc8847711a94b541d45249f))
* require auth for HTTP transport ([#487](https://github.com/arc-mcp/arc-1/issues/487)) ([46c68a0](https://github.com/arc-mcp/arc-1/commit/46c68a097263c366611d6d2f520721da7b920cfe))
* warn on insecure SAP TLS and encode trace paths ([#494](https://github.com/arc-mcp/arc-1/issues/494)) ([b67586e](https://github.com/arc-mcp/arc-1/commit/b67586e4bb0dd741e7e05da6120b03ff55412359))

## [0.9.20](https://github.com/arc-mcp/arc-1/compare/v0.9.19...v0.9.20) (2026-06-22)


### Features

* add context-first KTD workflow with guarded writes ([#486](https://github.com/arc-mcp/arc-1/issues/486)) ([32cc3bc](https://github.com/arc-mcp/arc-1/commit/32cc3bc4fb1554f8b1439be40696922ef6484e52))
* add read-only UI console ([#485](https://github.com/arc-mcp/arc-1/issues/485)) ([68b3f2a](https://github.com/arc-mcp/arc-1/commit/68b3f2a55e38b216d16785d00aa586f809b31387))
* **extensions:** gated non-ADT writes via ctx.http (v2 §2.2 Path B) ([#474](https://github.com/arc-mcp/arc-1/issues/474)) ([4294c94](https://github.com/arc-mcp/arc-1/commit/4294c942b42ffa0fd23c534c2376202c1a5b1b5c))


### Bug Fixes

* avoid regex backtracking in ADT error parsing ([#476](https://github.com/arc-mcp/arc-1/issues/476)) ([48b32bc](https://github.com/arc-mcp/arc-1/commit/48b32bc2645e19a1152c7163470ab2ede6a2b164))

## [0.9.19](https://github.com/arc-mcp/arc-1/compare/v0.9.18...v0.9.19) (2026-06-18)


### Features

* **auth:** use @arc-mcp/xsuaa-auth for XSUAA/OAuth + BTP principal propagation ([#456](https://github.com/arc-mcp/arc-1/issues/456)) ([0e4795b](https://github.com/arc-mcp/arc-1/commit/0e4795b9e1709afdfc61cc638db726a05c49548d))
* **config:** reject non-3-digit SAP_CLIENT at startup ([#471](https://github.com/arc-mcp/arc-1/issues/471)) ([4e1b8e4](https://github.com/arc-mcp/arc-1/commit/4e1b8e409373d4c8be8473677173cdecb9a6871e))
* **extensions:** extension framework for Custom_* plugin tools ([#454](https://github.com/arc-mcp/arc-1/issues/454)) ([7425f00](https://github.com/arc-mcp/arc-1/commit/7425f005042c089ac103297386866969ba8700fb))


### Bug Fixes

* **auth:** adopt @arc-mcp/xsuaa-auth hardened OIDC + constant-time api-key verifiers ([#468](https://github.com/arc-mcp/arc-1/issues/468)) ([2dfb512](https://github.com/arc-mcp/arc-1/commit/2dfb5128baba588ac472a90d7319b3f86f7ff400))
* **extensions:** close 2 policy-boundary gaps + doc sharp edges (post-merge review) ([#467](https://github.com/arc-mcp/arc-1/issues/467)) ([8c6bbb4](https://github.com/arc-mcp/arc-1/commit/8c6bbb4b400b2b51c7dab1350375d07289feac65))

## [0.9.18](https://github.com/arc-mcp/arc-1/compare/v0.9.17...v0.9.18) (2026-06-16)


### Features

* **SAPRead:** add action="diff" for server-side single-system version diff ([#445](https://github.com/arc-mcp/arc-1/issues/445)) ([7d603ef](https://github.com/arc-mcp/arc-1/commit/7d603eff8534e7d96ed7b1a8c8feba387fcc8b40))
* **SAPTransport:** add summary=true headers-only mode for list ([#448](https://github.com/arc-mcp/arc-1/issues/448)) ([3ac3619](https://github.com/arc-mcp/arc-1/commit/3ac361969dbeabd0ef6f0593f830c2dea623f460))


### Bug Fixes

* **startup:** quiet expected feature-probe log noise + deployment/onboarding docs ([#444](https://github.com/arc-mcp/arc-1/issues/444)) ([951cb38](https://github.com/arc-mcp/arc-1/commit/951cb385e8e2dc664cd095fe5299871a75d526de))

## [0.9.17](https://github.com/arc-mcp/arc-1/compare/v0.9.16...v0.9.17) (2026-06-15)


### Features

* **transport:** add SAPTransport remove_object to clean an object out of a request ([#432](https://github.com/arc-mcp/arc-1/issues/432)) ([fc4e7d4](https://github.com/arc-mcp/arc-1/commit/fc4e7d41237674f9c2e29dade88b24e04b972dcb))


### Bug Fixes

* clearer guidance for cross-subaccount OAuth2UserTokenExchange ([#436](https://github.com/arc-mcp/arc-1/issues/436)) ([226c437](https://github.com/arc-mcp/arc-1/commit/226c437c83922c84c69af616297c164d473b4bbb)), closes [#434](https://github.com/arc-mcp/arc-1/issues/434)
* **http:** handle 304/204/205 null-body status on Cloud Connector proxy path ([#440](https://github.com/arc-mcp/arc-1/issues/440)) ([9e3906e](https://github.com/arc-mcp/arc-1/commit/9e3906ecb2e73551c02d05438e2343e5b029d601))

## [0.9.16](https://github.com/arc-mcp/arc-1/compare/v0.9.15...v0.9.16) (2026-06-12)


### Bug Fixes

* initialise class test include surgery ([#429](https://github.com/arc-mcp/arc-1/issues/429)) ([f076a67](https://github.com/arc-mcp/arc-1/commit/f076a671f738267945f9c7936c77d63a37291437))

## [0.9.15](https://github.com/arc-mcp/arc-1/compare/v0.9.14...v0.9.15) (2026-06-12)


### Features

* one-step "Install in Claude" — Claude Code plugin, MCPB bundle, tool annotations ([#425](https://github.com/arc-mcp/arc-1/issues/425)) ([48013b7](https://github.com/arc-mcp/arc-1/commit/48013b70fa3cb57fb9d72a31b8246c85b7c300c0))


### Bug Fixes

* **adt:** make SRVB publish/unpublish content negotiation 758-proof ([#403](https://github.com/arc-mcp/arc-1/issues/403)) ([909f253](https://github.com/arc-mcp/arc-1/commit/909f25340474285dc882ade952cab696a1d0c58f))
* **cache:** batch warmup writes in transactions ([#417](https://github.com/arc-mcp/arc-1/issues/417)) ([6a5ec76](https://github.com/arc-mcp/arc-1/commit/6a5ec760cf985df7cb7a5f1d35cf18e41dd56f8b))
* **config:** empty env values fall back to defaults (fail closed, not fail open) ([#427](https://github.com/arc-mcp/arc-1/issues/427)) ([cd32f54](https://github.com/arc-mcp/arc-1/commit/cd32f5403fab29437f5881589b48cd610e777bbc))
* **context:** avoid SAPContext dependency convoy ([#411](https://github.com/arc-mcp/arc-1/issues/411)) ([f37373b](https://github.com/arc-mcp/arc-1/commit/f37373b6f34b5e8a86e1f72345e1604645d1f307))
* **docker:** patch OpenSSL CVE-2026-45447 and harden release CVE gate ([#400](https://github.com/arc-mcp/arc-1/issues/400)) ([951ca09](https://github.com/arc-mcp/arc-1/commit/951ca0987af27ca02fdbd2c5c0ae2be7800291a5))
* **handlers:** accept any maxResults number, floor+clamp at the sinks ([#423](https://github.com/arc-mcp/arc-1/issues/423)) ([1eb1758](https://github.com/arc-mcp/arc-1/commit/1eb175840cea93a38209c6d566a7838f38d27ccb))
* type-check the test suite + split intent.test.ts ([#405](https://github.com/arc-mcp/arc-1/issues/405)) ([5cb235c](https://github.com/arc-mcp/arc-1/commit/5cb235c1ca27c35e4b232a923d4e2516e3a87f41))
* **xml:** make XML escaping single pass ([#414](https://github.com/arc-mcp/arc-1/issues/414)) ([df0c285](https://github.com/arc-mcp/arc-1/commit/df0c28513b97ed98855383f0e2c342a7037881a2))
* **xml:** reuse parser array tag set ([#412](https://github.com/arc-mcp/arc-1/issues/412)) ([2d12d3d](https://github.com/arc-mcp/arc-1/commit/2d12d3d779adf2d3f90392213841621c65858bd8))


### Tests

* **handlers:** Zod↔JSON-Schema type-parity guard ([#415](https://github.com/arc-mcp/arc-1/issues/415)) ([0855e2c](https://github.com/arc-mcp/arc-1/commit/0855e2c6bf4dd3ff8e8abc2a7e2d39620959ed6f))
* isolate concurrent integration/e2e runs, add teardown janitor, fix flake ([#426](https://github.com/arc-mcp/arc-1/issues/426)) ([5895a75](https://github.com/arc-mcp/arc-1/commit/5895a75f3d16e9ab07e60d1113aaa32496393c3d))
* rename dispatch-rate-limit test, featuresOff() sweep, strip intent.ts provenance ([#410](https://github.com/arc-mcp/arc-1/issues/410)) ([8a34886](https://github.com/arc-mcp/arc-1/commit/8a3488673423c598a1af0f347929fc6e29bdf5a4))
* **server:** de-flake auth-rate-limit (one server per test) + diagnosable transport errors ([#424](https://github.com/arc-mcp/arc-1/issues/424)) ([96fb89d](https://github.com/arc-mcp/arc-1/commit/96fb89dc6b30c55a710fb1028d368dca1f1c542c))


### Performance Improvements

* **lint:** memoize abaplint default configs ([#413](https://github.com/arc-mcp/arc-1/issues/413)) ([1e78acb](https://github.com/arc-mcp/arc-1/commit/1e78acb8a2fa51e47fe6731ea67d021d638c80d5))

## [0.9.14](https://github.com/arc-mcp/arc-1/compare/v0.9.13...v0.9.14) (2026-06-11)


### Bug Fixes

* enforce SRVB package gate ([#394](https://github.com/arc-mcp/arc-1/issues/394)) ([6b91dea](https://github.com/arc-mcp/arc-1/commit/6b91deada618fa01eba066410aff0bc234dcadb2))
* harden SAPRead grep regex handling ([#392](https://github.com/arc-mcp/arc-1/issues/392)) ([9d23287](https://github.com/arc-mcp/arc-1/commit/9d23287b79cbcee6e0a29bd0b55409952aaf00f8))
* ignore BTP service key files ([#395](https://github.com/arc-mcp/arc-1/issues/395)) ([ec7b6a9](https://github.com/arc-mcp/arc-1/commit/ec7b6a926ed2a46fb1e38188cfb498cf6be5e646))
* isolate PP cache state ([#393](https://github.com/arc-mcp/arc-1/issues/393)) ([3278eb8](https://github.com/arc-mcp/arc-1/commit/3278eb8e2ab40d3a0e1619411455e791549a279b))
* **write:** emit adtcore:language + masterLanguage on MSAG payloads ([#397](https://github.com/arc-mcp/arc-1/issues/397)) ([07f9a9c](https://github.com/arc-mcp/arc-1/commit/07f9a9c301b250a6dc5cf062ffc8f81ee01d1839))

## [0.9.13](https://github.com/arc-mcp/arc-1/compare/v0.9.12...v0.9.13) (2026-06-09)


### Bug Fixes

* **git:** enforce package allowlist on abapGit pull/push ([#389](https://github.com/arc-mcp/arc-1/issues/389)) ([82cec9b](https://github.com/arc-mcp/arc-1/commit/82cec9b105a31134322834bb40b90df171ebd846))
* **limits:** clamp unbounded result limits to prevent resource exhaustion ([#388](https://github.com/arc-mcp/arc-1/issues/388)) ([9656162](https://github.com/arc-mcp/arc-1/commit/9656162782a8161675d957b54fdd39cd66eff34c))
* **oauth:** match redirect-uri allowlist against parsed URL components ([#387](https://github.com/arc-mcp/arc-1/issues/387)) ([c795b53](https://github.com/arc-mcp/arc-1/commit/c795b53de317dc6386626b8a8afb35f9d3dd8c18))
* **transport:** delete requests holding locked objects via removeLockedObjects ([#386](https://github.com/arc-mcp/arc-1/issues/386)) ([e64b497](https://github.com/arc-mcp/arc-1/commit/e64b49728067dd5b909b905bbfd4766b54b4732c))

## [0.9.12](https://github.com/arc-mcp/arc-1/compare/v0.9.11...v0.9.12) (2026-06-09)


### Features

* **diagnose:** SAPDiagnose action=cds_testcases — CDS test-case scaffolding ([#351](https://github.com/arc-mcp/arc-1/issues/351)) ([b54ccd0](https://github.com/arc-mcp/arc-1/commit/b54ccd03414828576f26a7d6c5dd052c5362475b))
* **read:** generic server-driven object read — SAPRead DESD/EVTB/DTSC/CSNM/EVTO/COTA ([#356](https://github.com/arc-mcp/arc-1/issues/356)) ([ce3dacc](https://github.com/arc-mcp/arc-1/commit/ce3dacc238b1aeb22854e573352e0f97995aba94))
* **write:** server-driven object write — SAPWrite create/update/delete + SAPActivate (DESD/EVTB/DTSC/CSNM/EVTO/COTA) ([#362](https://github.com/arc-mcp/arc-1/issues/362)) ([0c7f0a6](https://github.com/arc-mcp/arc-1/commit/0c7f0a60780a73ca601b1a0c39508fe4acf20cc3))
* **xsuaa:** raise default refresh-token-validity to 30 days ([#383](https://github.com/arc-mcp/arc-1/issues/383)) ([8e0ee71](https://github.com/arc-mcp/arc-1/commit/8e0ee7192618e9449069b9f430796dece52347cf))


### Bug Fixes

* **handlers:** harden tool-arg validation against GPT/OpenAI schema pollution ([#363](https://github.com/arc-mcp/arc-1/issues/363))  ([138d89c](https://github.com/arc-mcp/arc-1/commit/138d89cbf395f1f5147850513629151afef041e6))
* **security:** close scope-router privilege escalation and bind OAuth state to client_id ([#352](https://github.com/arc-mcp/arc-1/issues/352)) ([ba0a21b](https://github.com/arc-mcp/arc-1/commit/ba0a21ba932b35ebcff5cbb73bbbbec07e856b30))
* **security:** enforce allowedPackages ceiling on activation and change_package ([#357](https://github.com/arc-mcp/arc-1/issues/357)) ([2a1135e](https://github.com/arc-mcp/arc-1/commit/2a1135e942d5836db39dbb976ae9286ea983d7dd))
* **security:** XSUAA redirect-uri allowlist for the shared default client ([#358](https://github.com/arc-mcp/arc-1/issues/358)) ([d204eb8](https://github.com/arc-mcp/arc-1/commit/d204eb826f54ca7f17aa0467f116bb931d728e80))
* **write:** emit pak:recordChanges so transportable package creation works on SAP_BASIS 816 ([#375](https://github.com/arc-mcp/arc-1/issues/375)) ([00e4197](https://github.com/arc-mcp/arc-1/commit/00e41973212c52d4746003c97b9a981dec08146d))
* **write:** thread logon user into adtcore:responsible ([#380](https://github.com/arc-mcp/arc-1/issues/380)) ([3f8dc12](https://github.com/arc-mcp/arc-1/commit/3f8dc126105532b71d26a0970b9ec0040b949ece))


### Tests

* close slow baseline and server coverage gaps ([#367](https://github.com/arc-mcp/arc-1/issues/367)) ([3968296](https://github.com/arc-mcp/arc-1/commit/3968296c283721c31a750af9b4ea9fd6232ba637))
* migrate SAP CI to A4H 2025 ([#365](https://github.com/arc-mcp/arc-1/issues/365)) ([d22392d](https://github.com/arc-mcp/arc-1/commit/d22392d303a28e872798c7b87c7ca6a9eb83b06f))
* split slow SAP test profiles ([#364](https://github.com/arc-mcp/arc-1/issues/364)) ([c63346d](https://github.com/arc-mcp/arc-1/commit/c63346d8c8403e3b0bc7f231adaf62f4a7a65933))
* tighten integration skip hygiene ([#353](https://github.com/arc-mcp/arc-1/issues/353)) ([bdca845](https://github.com/arc-mcp/arc-1/commit/bdca845d4ba43fb9d95341b79272a3c1005106d9))
* tighten live cleanup and skip telemetry ([#359](https://github.com/arc-mcp/arc-1/issues/359)) ([94551af](https://github.com/arc-mcp/arc-1/commit/94551af0fa5164ea4c88edffaa73bd33bd90c38b))

## [0.9.11](https://github.com/arc-mcp/arc-1/compare/v0.9.10...v0.9.11) (2026-06-05)


### Bug Fixes

* **lint:** don't block writes on parse errors beyond abaplint's grammar (8xx / SAP_BASIS 816) ([#350](https://github.com/arc-mcp/arc-1/issues/350)) ([79b5687](https://github.com/arc-mcp/arc-1/commit/79b5687ec1b9023f4d01dc45b11b29a59131c2ea))
* **probe:** repair broken probe CLI and validate ABAP Platform 2025 (SAP_BASIS 816) ([#347](https://github.com/arc-mcp/arc-1/issues/347)) ([6c307ec](https://github.com/arc-mcp/arc-1/commit/6c307ecd577a16f853ed344368a1416dd20d754e))

## [0.9.10](https://github.com/arc-mcp/arc-1/compare/v0.9.9...v0.9.10) (2026-06-05)


### Bug Fixes

* **adt/client:** copy tablWriteUrlCache in withSafety() clone ([#335](https://github.com/arc-mcp/arc-1/issues/335)) ([dbcd8a1](https://github.com/arc-mcp/arc-1/commit/dbcd8a1d287a86f91ca66379888c7630d8df286d))

## [0.9.9](https://github.com/arc-mcp/arc-1/compare/v0.9.8...v0.9.9) (2026-06-04)


### Features

* **fugr:** recursive include expansion for SAPRead(type=FUGR) — captures function module code ([#341](https://github.com/arc-mcp/arc-1/issues/341)) ([2f99335](https://github.com/arc-mcp/arc-1/commit/2f99335774e2e2321c5e673ee94f2a8f295e956e))
* **transport:** set explicit transport target (TR_TARGET) on SAPTransport.create ([#339](https://github.com/arc-mcp/arc-1/issues/339)) ([95d6a9c](https://github.com/arc-mcp/arc-1/commit/95d6a9cc823143e7b3018d1477e2b068e63a5a2f))


### Bug Fixes

* **atc:** bind check variant via worklist so SAPDiagnose(atc) returns findings ([#336](https://github.com/arc-mcp/arc-1/issues/336)) ([5386465](https://github.com/arc-mcp/arc-1/commit/53864653c077233b4acdbb1061983f6417b8e5c7))
* **deps:** bump express-rate-limit to 8.5.2 and key IPv6 by /56 subnet ([#330](https://github.com/arc-mcp/arc-1/issues/330)) ([1bb5e31](https://github.com/arc-mcp/arc-1/commit/1bb5e318c930c1585aab33815bfa9671b8318e16))
* **fugr:** non-expand SAPRead(FUGR) returns the real function-module list (objectstructure) ([#342](https://github.com/arc-mcp/arc-1/issues/342)) ([93b6c22](https://github.com/arc-mcp/arc-1/commit/93b6c22f6739761f205d1d31d9c2cf29143a0c86))
* surface XSUAA OAuth errors on /oauth/callback + don't prefix reserved scopes ([#327](https://github.com/arc-mcp/arc-1/issues/327)) ([f7418ed](https://github.com/arc-mcp/arc-1/commit/f7418ed9a9f6be5e743d2ccb84ea8e4af4770b0c))
* **write:** derive created-object master language from SAP_LANGUAGE ([#344](https://github.com/arc-mcp/arc-1/issues/344)) ([18672fd](https://github.com/arc-mcp/arc-1/commit/18672fdffa5c76ba64f6af43493151fb2add27c8))

## [0.9.8](https://github.com/arc-mcp/arc-1/compare/v0.9.7...v0.9.8) (2026-06-01)


### Bug Fixes

* callback proxy for XSUAA OAuth state — fixes "State does not match" from VS Code ([#325](https://github.com/arc-mcp/arc-1/issues/325)) ([c41ed97](https://github.com/arc-mcp/arc-1/commit/c41ed97fcec5fb6f0182507b1973d1fa0c896325))

## [0.9.7](https://github.com/arc-mcp/arc-1/compare/v0.9.6...v0.9.7) (2026-05-30)


### Features

* auto-initialise class-local includes on write (testclasses/CCAU) ([#314](https://github.com/arc-mcp/arc-1/issues/314)) ([2a7bdc0](https://github.com/arc-mcp/arc-1/commit/2a7bdc0708b68790aae9848744c3aa3510dfcf95))
* class-section surgery for CLAS ([#307](https://github.com/arc-mcp/arc-1/issues/307)) ([7d17ea2](https://github.com/arc-mcp/arc-1/commit/7d17ea229d8315634762b131ffa6ab2b25d3f50b))
* **read:** add TABLE_QUERY type for multi-column structured queries ([#309](https://github.com/arc-mcp/arc-1/issues/309)) ([7eb01f4](https://github.com/arc-mcp/arc-1/commit/7eb01f4e89509fa3be638a57bed872c2fa7b6234))
* **read:** SAPRead grep — regex search within object source ([#316](https://github.com/arc-mcp/arc-1/issues/316)) ([0d338e2](https://github.com/arc-mcp/arc-1/commit/0d338e2f194ead93d1e391be869dd93dbb2b2f51))
* **safety:** allowedPackages X/** subtree rule + nodestructure-backed resolver ([#284](https://github.com/arc-mcp/arc-1/issues/284)) ([2d34909](https://github.com/arc-mcp/arc-1/commit/2d349095bddcf64f94053845ba1c354685514434))


### Bug Fixes

* **btp:** per-user OAuth2UserTokenExchange Bearer token for headless BTP → ABAP ([#315](https://github.com/arc-mcp/arc-1/issues/315)) ([d5bb9ca](https://github.com/arc-mcp/arc-1/commit/d5bb9cab29433586ada48790ffcb96e5e99d57f1))
* **http:** dedupe Cookie header so live session id wins over stale file copy ([#293](https://github.com/arc-mcp/arc-1/issues/293), part 1) ([#310](https://github.com/arc-mcp/arc-1/issues/310)) ([fdb478e](https://github.com/arc-mcp/arc-1/commit/fdb478e078be22cab37a71ac3000394fdd76064c))
* **intent:** replace 3 raw NUL bytes in source with \x00 escapes ([#317](https://github.com/arc-mcp/arc-1/issues/317)) ([d125142](https://github.com/arc-mcp/arc-1/commit/d1251421a0d4b3777961a7e558bb5aa3750b1450))
* release-aware 423 lock-handle guidance ([#312](https://github.com/arc-mcp/arc-1/issues/312)) ([9c7e021](https://github.com/arc-mcp/arc-1/commit/9c7e0212feffb28514fdfb4a6d2c64945c2d4f98))
* **write:** reject mixed-case object names on update/edit_method/delete ([#311](https://github.com/arc-mcp/arc-1/issues/311)) ([2cff142](https://github.com/arc-mcp/arc-1/commit/2cff14262ddab84701dd821fc86d73b38510e3d1))


### Tests

* clean up transport test requests ([#308](https://github.com/arc-mcp/arc-1/issues/308)) ([5d643d2](https://github.com/arc-mcp/arc-1/commit/5d643d2b732085544bba6a4c1a503bfa1f61c8ce))
* convert pseudo skips to real skips ([#304](https://github.com/arc-mcp/arc-1/issues/304)) ([73437e8](https://github.com/arc-mcp/arc-1/commit/73437e8f341c078a209c6c86d4862b2e389a36d8))
* **e2e:** fix ZI_ARC1_I33_PROJ fixture activation on S/4HANA 2023 ([#318](https://github.com/arc-mcp/arc-1/issues/318)) ([9d8ac15](https://github.com/arc-mcp/arc-1/commit/9d8ac15a2799b341f57896c9e3e89d6e0b690758))
* harden e2e fixture activation ([#306](https://github.com/arc-mcp/arc-1/issues/306)) ([ab5eaa7](https://github.com/arc-mcp/arc-1/commit/ab5eaa762c5333d198d27346ffd5dfed573a46d2))

## [0.9.6](https://github.com/arc-mcp/arc-1/compare/v0.9.5...v0.9.6) (2026-05-27)


### Features

* ARC-1-native pre-write hint for canonical %admin draft include ([#271](https://github.com/arc-mcp/arc-1/issues/271)) ([21ac60b](https://github.com/arc-mcp/arc-1/commit/21ac60b8fb7cc455e5c93ce301573c535fe85e39))
* layered rate limiting (Layers 1+2+3) ([#276](https://github.com/arc-mcp/arc-1/issues/276)) ([1994298](https://github.com/arc-mcp/arc-1/commit/1994298440a25efa283a667ac4a8f086a701e318))


### Bug Fixes

* **features:** fall back to syntax-configurations endpoint for abapRelease ([95ce9bc](https://github.com/arc-mcp/arc-1/commit/95ce9bc98d0b1e75cd6c575d4374158c162f9e34))
* refuse TABL/DT writes on NW 7.50/7.51 with SE11 hint ([#285](https://github.com/arc-mcp/arc-1/issues/285)) ([#286](https://github.com/arc-mcp/arc-1/issues/286)) ([b098140](https://github.com/arc-mcp/arc-1/commit/b09814000669b4101535f91d005f6b0d238bddb6))
* route TABL/DS create to /ddic/structures ([#302](https://github.com/arc-mcp/arc-1/issues/302)) ([039d800](https://github.com/arc-mcp/arc-1/commit/039d8007db234d06e8b25abcfdb9814eb8fdd8a0))

## [0.9.5](https://github.com/arc-mcp/arc-1/compare/v0.9.4...v0.9.5) (2026-05-11)


### Features

* add SAPSearch tadir_lookup source modes + SAPWrite batch_create activateAtEnd ([#270](https://github.com/arc-mcp/arc-1/issues/270)) ([dec53b4](https://github.com/arc-mcp/arc-1/commit/dec53b46dd6143d58bcba9d22bbcb2ffc50f8718))
* stable DCR signing key + 0/negative TTL = infinite ([#267](https://github.com/arc-mcp/arc-1/issues/267)) ([1b4b191](https://github.com/arc-mcp/arc-1/commit/1b4b1917d41bf615534e472fc7e32a290a9c23f2))


### Bug Fixes

* **rap:** write handler skeletons to CCIMP, not CCDEF ([#263](https://github.com/arc-mcp/arc-1/issues/263)) ([60773f6](https://github.com/arc-mcp/arc-1/commit/60773f6f034029174d901e5cabd21c4295efae5c))

## [0.9.4](https://github.com/arc-mcp/arc-1/compare/v0.9.3...v0.9.4) (2026-05-10)


### Features

* add FUNC structured-parameter support ([#259](https://github.com/arc-mcp/arc-1/issues/259)) ([154db0f](https://github.com/arc-mcp/arc-1/commit/154db0fdda32cb95dd9fa2d70acf8cd5ae25bb49))
* add sprint 3 diagnostics cleanup ([#254](https://github.com/arc-mcp/arc-1/issues/254)) ([0bb34cc](https://github.com/arc-mcp/arc-1/commit/0bb34cc4e17fb1fb0fd38b6dd0c8521c38549343))
* add TADIR lookup and batch package overrides ([#256](https://github.com/arc-mcp/arc-1/issues/256)) ([dc2fe3d](https://github.com/arc-mcp/arc-1/commit/dc2fe3dcec0ebc28dfced882843a357d6852b05b))
* edit_method splices into class-local includes (CCDEF/CCIMP) ([#261](https://github.com/arc-mcp/arc-1/issues/261)) ([99ba5a1](https://github.com/arc-mcp/arc-1/commit/99ba5a13f4d0a1de5e5319e35b57e730883a24ec))
* SAPWrite generate_behavior_implementation action (PR-C) ([#260](https://github.com/arc-mcp/arc-1/issues/260)) ([5151d13](https://github.com/arc-mcp/arc-1/commit/5151d13ece4635a79e5b97b61c5ce28de8e8386f))


### Bug Fixes

* harden apply_quickfix payloads ([#253](https://github.com/arc-mcp/arc-1/issues/253)) ([a859fc5](https://github.com/arc-mcp/arc-1/commit/a859fc57ee630aaa3dc72f745ecfcae0f656ac65))
* retry ED064 activation and support ABAP release lint override ([#255](https://github.com/arc-mcp/arc-1/issues/255)) ([8cc8833](https://github.com/arc-mcp/arc-1/commit/8cc883305baad3deabead8b5c6ab2c54781e4b38))
* support class include writes and RAP skeletons ([#257](https://github.com/arc-mcp/arc-1/issues/257)) ([c4ac325](https://github.com/arc-mcp/arc-1/commit/c4ac325fcb9704e48e089fd9a23499117db48e7f))

## [0.9.3](https://github.com/arc-mcp/arc-1/compare/v0.9.2...v0.9.3) (2026-05-09)


### Bug Fixes

* add FUGR + FUNC create/update/delete ([#251](https://github.com/arc-mcp/arc-1/issues/251)) ([f5ed2b8](https://github.com/arc-mcp/arc-1/commit/f5ed2b881992c1aa63462d68fe1b0bb66e4f9c44))
* **btp:** harden CF deploy + add Viewer+SQL XSUAA role-collection ([#246](https://github.com/arc-mcp/arc-1/issues/246)) ([a3bfb5e](https://github.com/arc-mcp/arc-1/commit/a3bfb5e5df9ef7c149f204b2f99d5768a4883a91))

## [0.9.2](https://github.com/arc-mcp/arc-1/compare/v0.9.1...v0.9.2) (2026-05-08)


### Bug Fixes

* **ci:** re-trigger release after [#244](https://github.com/arc-mcp/arc-1/issues/244) chore-merge ([6345625](https://github.com/arc-mcp/arc-1/commit/6345625b5e402752062706a4ae1abc7cfa1ba5a2))

## [0.9.1](https://github.com/arc-mcp/arc-1/compare/v0.9.0...v0.9.1) (2026-05-08)


### Bug Fixes

* **adt:** align DEVC listing descriptions with object names ([#242](https://github.com/arc-mcp/arc-1/issues/242)) ([63cfc70](https://github.com/arc-mcp/arc-1/commit/63cfc70a00b9dd21f6c786fcdce7a5a8d72a55fd))
* **adt:** decode XML entities in parseSearchResults description ([#243](https://github.com/arc-mcp/arc-1/issues/243)) ([c522866](https://github.com/arc-mcp/arc-1/commit/c52286699fdd844628d5385f50e8d4ab213b7730))
* **docker:** drop bundled npm CLI from runtime image ([#240](https://github.com/arc-mcp/arc-1/issues/240)) ([e480206](https://github.com/arc-mcp/arc-1/commit/e480206cf13eb057818045e5765b840577e5bacb))

## [0.9.0](https://github.com/arc-mcp/arc-1/compare/v0.8.0...v0.9.0) (2026-05-08)


### ⚠ BREAKING CHANGES

* MSAG read enum + FTG2→FEATURE_TOGGLE rename (audit Plan B) ([#224](https://github.com/arc-mcp/arc-1/issues/224))
* callers that passed type='FUNC/FM', 'CLAS/LI', 'VIEW/V', or 'TRAN/O' will now fail Zod schema validation. Migrate to FUGR/FF, CLAS/I (if needed — currently absent), VIEW/DV, TRAN/T respectively, or use the canonical short forms FUNC/CLAS/VIEW/TRAN.
* SAPRead/SAPWrite/SAPActivate no longer accept type='STRU'. Callers must use type='TABL' for both transparent tables and DDIC structures. ARC-1 ships pre-1.0; the slash form 'STRU/DS' is preserved as a back-compat alias inside SLASH_TYPE_MAP only.

### Features

* cookie hot-reload on stale 401 ([#200](https://github.com/arc-mcp/arc-1/issues/200)) ([23d4bfe](https://github.com/arc-mcp/arc-1/commit/23d4bfe180d1e012926c86f5e547389420ba1139))
* layered lock-conflict detection + MSAG transport guard ([#202](https://github.com/arc-mcp/arc-1/issues/202)) ([cf0a126](https://github.com/arc-mcp/arc-1/commit/cf0a12605b584be527ee71f17dfd6b8775ff3db8))
* MSAG read enum + FTG2→FEATURE_TOGGLE rename (audit Plan B) ([#224](https://github.com/arc-mcp/arc-1/issues/224)) ([d4c0fd3](https://github.com/arc-mcp/arc-1/commit/d4c0fd3416944f193b8ed3dad8b578d576954840))
* purge invented ADT slash aliases (issue [#218](https://github.com/arc-mcp/arc-1/issues/218) audit, Plan A) ([#223](https://github.com/arc-mcp/arc-1/issues/223)) ([e130b87](https://github.com/arc-mcp/arc-1/commit/e130b8789408ab8883669d015a8ba8868190d3a2))
* three-file sync (messages + STRU) + universal write guards ([#201](https://github.com/arc-mcp/arc-1/issues/201)) ([2afedf1](https://github.com/arc-mcp/arc-1/commit/2afedf17534a7e00c31d850310d485339cdd6064))


### Bug Fixes

* **adt:** tighten HTML entity decoder + tag stripper (CodeQL alerts 6, 7, 8) ([#238](https://github.com/arc-mcp/arc-1/issues/238)) ([3bd7dac](https://github.com/arc-mcp/arc-1/commit/3bd7dac8468dd4653b297b395a1e14a8c9398678))
* collapse STRU type into TABL ([#219](https://github.com/arc-mcp/arc-1/issues/219)) ([1a310e9](https://github.com/arc-mcp/arc-1/commit/1a310e91e93ddaf30d8acfd297cff2f8f121f679))
* SAPTransport.create works on NW 7.50 (non-breaking, defaults DEVCLASS=$TMP) ([#228](https://github.com/arc-mcp/arc-1/issues/228)) ([fc29c41](https://github.com/arc-mcp/arc-1/commit/fc29c415bc3cd86a2f2783bdabd7df171972d6d7))


### Tests

* add SAPLint PrettyPrint and revision eval scenarios ([#151](https://github.com/arc-mcp/arc-1/issues/151)) ([283b744](https://github.com/arc-mcp/arc-1/commit/283b74482ed14461d918d4d660e81eec597667f9))

## [0.8.0](https://github.com/arc-mcp/arc-1/compare/v0.7.2...v0.8.0) (2026-05-06)


### ⚠ BREAKING CHANGES

* make OAuth DCR registrations survive container restarts ([#212](https://github.com/arc-mcp/arc-1/issues/212))

### Features

* ARC1_PUBLIC_URL env var for reverse-proxy / different-hostname deployments ([#216](https://github.com/arc-mcp/arc-1/issues/216)) ([6e219dd](https://github.com/arc-mcp/arc-1/commit/6e219dd463c72aac9caa50cd86ab8b824e4b2a95))
* HTTP security headers (helmet) + opt-in CORS for browser MCP clients ([#215](https://github.com/arc-mcp/arc-1/issues/215)) ([8929d21](https://github.com/arc-mcp/arc-1/commit/8929d21deae26b1fb242d1cbcddecbb5d878a0e8))
* make OAuth DCR registrations survive container restarts ([#212](https://github.com/arc-mcp/arc-1/issues/212)) ([0d78a6b](https://github.com/arc-mcp/arc-1/commit/0d78a6b0dc3c8857154ee154c41b7ef4a0f2f48a))


### Bug Fixes

* defensive dumpId encoding + endpoint-aware 403 hints ([#206](https://github.com/arc-mcp/arc-1/issues/206)) ([9046fa7](https://github.com/arc-mcp/arc-1/commit/9046fa7170f7b4f2bd347406e1524da9df57f0dd))

## [0.7.2](https://github.com/arc-mcp/arc-1/compare/v0.7.1...v0.7.2) (2026-04-28)


### Features

* ETag-validated source cache + active/inactive SAPRead version parameter ([#186](https://github.com/arc-mcp/arc-1/issues/186)) ([70bed22](https://github.com/arc-mcp/arc-1/commit/70bed22859663106aba54b0213be57758ad51829))


### Bug Fixes

* detect HANA via S4CORE/HDB components ([#182](https://github.com/arc-mcp/arc-1/issues/182)) ([87ec553](https://github.com/arc-mcp/arc-1/commit/87ec553fa8011a3ffdddf41f12f252f7184c2057))

## [0.7.1](https://github.com/arc-mcp/arc-1/compare/v0.7.0...v0.7.1) (2026-04-27)


### Bug Fixes

* restore npx package execution ([#189](https://github.com/arc-mcp/arc-1/issues/189)) ([da05e01](https://github.com/arc-mcp/arc-1/commit/da05e01ea30b0702126a9d12000a2b187fca6c9b))

## [0.7.0](https://github.com/arc-mcp/arc-1/compare/v0.6.10...v0.7.0) (2026-04-26)


### ⚠ BREAKING CHANGES

* authorization refactor ([#181](https://github.com/arc-mcp/arc-1/issues/181))

### Features

* add cds crud dependency guidance for ddls workflows ([#176](https://github.com/arc-mcp/arc-1/issues/176)) ([f597486](https://github.com/arc-mcp/arc-1/commit/f597486e71948356137e7d0111f5c3956a350c9c))
* authorization refactor ([#181](https://github.com/arc-mcp/arc-1/issues/181)) ([7be4ff0](https://github.com/arc-mcp/arc-1/commit/7be4ff0af8029c32a4fc7e8949905922bb7320f4))
* close RAP on-prem authoring gaps with preflight and handler scaffolding ([#173](https://github.com/arc-mcp/arc-1/issues/173)) ([29ee0b5](https://github.com/arc-mcp/arc-1/commit/29ee0b58f2224646a22a711cb68af03f70750233))
* detect sibling DDLS DDLX coverage mismatches in SAPContext impact ([#177](https://github.com/arc-mcp/arc-1/issues/177)) ([4f6e822](https://github.com/arc-mcp/arc-1/commit/4f6e82242b4e0b439401a4f2daf9398d3638a06f))
* harden SAPDiagnose dump and gateway diagnostics ([#174](https://github.com/arc-mcp/arc-1/issues/174)) ([9383891](https://github.com/arc-mcp/arc-1/commit/9383891055c009e9390988e1ff4553ad10917697))


### Bug Fixes

* harden SAP data preview diagnostics and SAPManage scope behavior ([#171](https://github.com/arc-mcp/arc-1/issues/171)) ([6697d3e](https://github.com/arc-mcp/arc-1/commit/6697d3ef17f9b490805dc2ae5bcc435611e15ab4))
* SAPActivate phantom success + CLI/server alignment gaps (NW 7.50) ([#179](https://github.com/arc-mcp/arc-1/issues/179)) ([4f2028e](https://github.com/arc-mcp/arc-1/commit/4f2028e048b611b1ba106aeb3042ce99202388f9))

## [Unreleased] — v0.7 — Authorization Refactor (**breaking change**)

Complete rewrite of the authorization model. Introduces a single `ACTION_POLICY` matrix as the source of truth for `(tool, action) → (scope, opType)`; replaces negated safety flags with positive opt-ins; adds per-user `transports` and `git` scopes; makes `admin` imply all scopes; and makes `allowWrites=false` truly block every mutation.

See [`docs_page/updating.md`](https://github.com/arc-mcp/arc-1/blob/main/docs_page/updating.md#v07-authorization-refactor-breaking-change) for the full migration guide.

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

## [0.6.10](https://github.com/arc-mcp/arc-1/compare/v0.6.9...v0.6.10) (2026-04-20)


### Features

* add SAPGit tool with gCTS and abapGit integration ([#159](https://github.com/arc-mcp/arc-1/issues/159)) ([196b8a0](https://github.com/arc-mcp/arc-1/commit/196b8a02a20410466d7f8b0d6c640638e800fe9f))
* diagnostic ADT type-availability probe ([#163](https://github.com/arc-mcp/arc-1/issues/163)) ([6bf4365](https://github.com/arc-mcp/arc-1/commit/6bf43655370a7e13aeb0234fbf4c9a52b816272c))


### Bug Fixes

* DTEL v2→v1 content-type fallback + SICF-aware error hints ([#169](https://github.com/arc-mcp/arc-1/issues/169)) ([1b6760f](https://github.com/arc-mcp/arc-1/commit/1b6760f173cd106c66c7f2e1d247d5b74917de5b))
* **e2e:** make E2E suite pass cleanly on NetWeaver 7.50 ([#168](https://github.com/arc-mcp/arc-1/issues/168)) ([750be05](https://github.com/arc-mcp/arc-1/commit/750be05e583c4feac672da808b82d12af7d66c4d))
* filter empty SAP_ALLOWED_PACKAGES entries and clarify docker docs ([#156](https://github.com/arc-mcp/arc-1/issues/156)) ([81001da](https://github.com/arc-mcp/arc-1/commit/81001dac40805bf5d2ac68947c1a6280cd864427))
* integration suite passes cleanly on NW 7.50 ([#167](https://github.com/arc-mcp/arc-1/issues/167)) ([1bc2984](https://github.com/arc-mcp/arc-1/commit/1bc298453a1767dd156b41be0f62f4a31e5ac4f1))
* make extract-sap-cookies work on Windows + Edge (fix [#149](https://github.com/arc-mcp/arc-1/issues/149)) ([#154](https://github.com/arc-mcp/arc-1/issues/154)) ([8e87600](https://github.com/arc-mcp/arc-1/commit/8e876006b233c46681b526a996b93a96cdba6d2e))

## [0.6.9](https://github.com/arc-mcp/arc-1/compare/v0.6.8...v0.6.9) (2026-04-17)


### Features

* Add CDS-specific impact analysis ([#143](https://github.com/arc-mcp/arc-1/issues/143)) ([0dab061](https://github.com/arc-mcp/arc-1/commit/0dab061bbb0ef97bf4ae36d622499b48fdd7cd3b))
* FEAT-43 SAPRead for AUTH, FTG2, ENHO (on-prem) ([#142](https://github.com/arc-mcp/arc-1/issues/142)) ([2a827a1](https://github.com/arc-mcp/arc-1/commit/2a827a15276e92f1edd35e3094018ca4510aaadf))
* fix cookie→PP leak, gate saml2=disabled, wire cookies & verbose CLI ([#149](https://github.com/arc-mcp/arc-1/issues/149)) ([74111ff](https://github.com/arc-mcp/arc-1/commit/74111ff80f783f8212aa1100416ed10d389a397b))
* SAPLint PrettyPrint (ADT code formatter) ([#145](https://github.com/arc-mcp/arc-1/issues/145)) ([af6da11](https://github.com/arc-mcp/arc-1/commit/af6da115c709f5da08e6c87da7420e96c5e3539f))
* SAPTransport history action (object transport reverse lookup) ([#146](https://github.com/arc-mcp/arc-1/issues/146)) ([8cae8f2](https://github.com/arc-mcp/arc-1/commit/8cae8f26997f647f8bf093361516a0b98f218ea9))
* Source Version / Revision History (on-prem) ([#144](https://github.com/arc-mcp/arc-1/issues/144)) ([92f6ef2](https://github.com/arc-mcp/arc-1/commit/92f6ef225433ca219bab9430fad9d43e7914260e))


### Bug Fixes

* modificationSupport guard + CSRF HEAD→GET fallback for S/4HANA Public Cloud ([#140](https://github.com/arc-mcp/arc-1/issues/140)) ([9fcd4aa](https://github.com/arc-mcp/arc-1/commit/9fcd4aae43d3e1268baecd0a73a4f47c6bf2debf))


### Tests

* restructure LLM evals by feature bucket + live MCP backend ([#147](https://github.com/arc-mcp/arc-1/issues/147)) ([27f4f51](https://github.com/arc-mcp/arc-1/commit/27f4f513d44273c22eb6d2a29f72939045746198))

## [0.6.8](https://github.com/arc-mcp/arc-1/compare/v0.6.7...v0.6.8) (2026-04-16)


### Features

* add change_package action for moving objects between packages ([#133](https://github.com/arc-mcp/arc-1/issues/133)) ([de2bc1a](https://github.com/arc-mcp/arc-1/commit/de2bc1ab6d5fe286aa2942b18ff90260566a25fc))
* implementation for creationg sktd objects ([#134](https://github.com/arc-mcp/arc-1/issues/134)) ([1e8f59c](https://github.com/arc-mcp/arc-1/commit/1e8f59cef66a3265b3c8b4105d5111016ff2c15d))


### Bug Fixes

* retry all HTTP methods on 503 and add CSRF token retry ([#135](https://github.com/arc-mcp/arc-1/issues/135)) ([39e3529](https://github.com/arc-mcp/arc-1/commit/39e35293cd369244f6f2d98df8a6a33ab15c2847))

## [0.6.7](https://github.com/arc-mcp/arc-1/compare/v0.6.6...v0.6.7) (2026-04-15)


### Features

* add concurrency limiter and 503 retry ([#132](https://github.com/arc-mcp/arc-1/issues/132)) ([ab18e25](https://github.com/arc-mcp/arc-1/commit/ab18e25b8fef23f2d985f69a5bbb9a8ad6d0e1dd))
* add DCLS read/write support (FEAT-37) ([#129](https://github.com/arc-mcp/arc-1/issues/129)) ([b4424e2](https://github.com/arc-mcp/arc-1/commit/b4424e28507b8d5ff261141dd7ad30429c52ddce))
* add proactive ADT discovery MIME negotiation ([#127](https://github.com/arc-mcp/arc-1/issues/127)) ([418b3d1](https://github.com/arc-mcp/arc-1/commit/418b3d1f055c5891bdb46ec7a9bbad1d4f8bcd82))
* implement FEAT-16 SAP-domain error intelligence hints ([#128](https://github.com/arc-mcp/arc-1/issues/128)) ([ce80aea](https://github.com/arc-mcp/arc-1/commit/ce80aead717bb6ec00f8c229650f99ab1421d2b9))


### Bug Fixes

* route SRVB publish/unpublish to correct OData version endpoint ([#130](https://github.com/arc-mcp/arc-1/issues/130)) ([9b0601c](https://github.com/arc-mcp/arc-1/commit/9b0601c6883e34a7c8aa0b75919a00918bf6f91d))

## [0.6.6](https://github.com/arc-mcp/arc-1/compare/v0.6.5...v0.6.6) (2026-04-14)


### Bug Fixes

* wait for Docker image before publishing to MCP Registry ([#125](https://github.com/arc-mcp/arc-1/issues/125)) ([cab65bc](https://github.com/arc-mcp/arc-1/commit/cab65bce68940ba2a6b335fed84674cb79a43098))

## [0.6.5](https://github.com/arc-mcp/arc-1/compare/v0.6.4...v0.6.5) (2026-04-14)


### Features

* add quickfix proposals and auto-fix from ATC findings ([#123](https://github.com/arc-mcp/arc-1/issues/123)) ([e3c4233](https://github.com/arc-mcp/arc-1/commit/e3c4233ee7b00c1b2717a337d96f61dfffc53074))
* add SAP object type auto-normalization ([#122](https://github.com/arc-mcp/arc-1/issues/122)) ([750c835](https://github.com/arc-mcp/arc-1/commit/750c8353961530773d2bf5389e8f3cb5b9a7ab50))
* extend abaplint CDS lint support for DDLS pre-write validation ([#121](https://github.com/arc-mcp/arc-1/issues/121)) ([b2324cc](https://github.com/arc-mcp/arc-1/commit/b2324cc90e9a56ee4ae22c1784fdc693ea1d2f37))


### Bug Fixes

* add structured DDIC diagnostics, inactive syntax check, and BDEF package handling ([#119](https://github.com/arc-mcp/arc-1/issues/119)) ([20c7ddb](https://github.com/arc-mcp/arc-1/commit/20c7ddb92d2c6fe35123bf48ffef688877cec3d3))
* CF buildpack deployment fixes and BTP write tool support ([#107](https://github.com/arc-mcp/arc-1/issues/107)) ([5fb05e0](https://github.com/arc-mcp/arc-1/commit/5fb05e05b2c227e5a725bbc417fbdb699915f25e))
* normalize SRVB bindingType and support OData V4 bindings ([#120](https://github.com/arc-mcp/arc-1/issues/120)) ([6e1735c](https://github.com/arc-mcp/arc-1/commit/6e1735c099b9c5c39144a6024bffeeb2ae9d5b93))
* skip abaplint for non-ABAP types and add per-call lintBeforeWrite ([#117](https://github.com/arc-mcp/arc-1/issues/117)) ([362e429](https://github.com/arc-mcp/arc-1/commit/362e42966b22c77649b93f266d85f5d5a9c82013))

## [0.6.4](https://github.com/arc-mcp/arc-1/compare/v0.6.3...v0.6.4) (2026-04-14)


### Bug Fixes

* add MCP Registry OCI annotation to Dockerfile ([#115](https://github.com/arc-mcp/arc-1/issues/115)) ([15c4354](https://github.com/arc-mcp/arc-1/commit/15c43542fc2780c30ee6969a4f29f11978a213b1))

## [0.6.3](https://github.com/arc-mcp/arc-1/compare/v0.6.2...v0.6.3) (2026-04-14)


### Bug Fixes

* add mcpName for MCP Registry publishing ([#113](https://github.com/arc-mcp/arc-1/issues/113)) ([bd346c5](https://github.com/arc-mcp/arc-1/commit/bd346c50dcad7ae52e27cf1af7236d1b9fb114a4))

## [0.6.2](https://github.com/arc-mcp/arc-1/compare/v0.6.1...v0.6.2) (2026-04-14)


### Features

* add 401 session timeout auto-retry and XML attribute escaping ([#85](https://github.com/arc-mcp/arc-1/issues/85)) ([37f8839](https://github.com/arc-mcp/arc-1/commit/37f8839297e6ea7ebbac36015e33793ed211140b))
* Add DOMA/DTEL write support to SAPWrite ([#86](https://github.com/arc-mcp/arc-1/issues/86)) ([252d048](https://github.com/arc-mcp/arc-1/commit/252d0489b8f417134b5b167972022f5c99d86c09))
* add FLP launchpad management via SAPManage ([#87](https://github.com/arc-mcp/arc-1/issues/87)) ([8026a84](https://github.com/arc-mcp/arc-1/commit/8026a84adbbcd84b9a342a491f2285cd1bfd1890))
* BTP Cloud Foundry deployment with SAP Cloud SDK and MTA support ([#97](https://github.com/arc-mcp/arc-1/issues/97)) ([29e6685](https://github.com/arc-mcp/arc-1/commit/29e6685749a2325833b55e802b9aea1f81a9b536))
* CDS write robustness and error handling improvements ([#101](https://github.com/arc-mcp/arc-1/issues/101)) ([c06d884](https://github.com/arc-mcp/arc-1/commit/c06d884707726bd150fda56fa94beaca9aec2464))
* DEVC package create/delete via SAPManage ([#110](https://github.com/arc-mcp/arc-1/issues/110)) ([72478d3](https://github.com/arc-mcp/arc-1/commit/72478d38e2f9a43dac9a1e7d891f3314f3696169))
* improve activation structured responses, inactive objects, preaudit ([#90](https://github.com/arc-mcp/arc-1/issues/90)) ([b8d5db0](https://github.com/arc-mcp/arc-1/commit/b8d5db09bb63aa8e120cb80efd98516b18c36631))
* MSAG (message class) read/write support ([#109](https://github.com/arc-mcp/arc-1/issues/109)) ([9a80416](https://github.com/arc-mcp/arc-1/commit/9a8041608aadaad0ba72ae152e6f79146ebc20ec))
* safe by default — read-only, no SQL, no data preview out of the box ([#89](https://github.com/arc-mcp/arc-1/issues/89)) ([5a46c9c](https://github.com/arc-mcp/arc-1/commit/5a46c9c7aae08ae2ff885a0b1865b063c696f301))
* SRVB (Service Binding) create/update/delete via SAPWrite ([#111](https://github.com/arc-mcp/arc-1/issues/111)) ([3e135a8](https://github.com/arc-mcp/arc-1/commit/3e135a84d2aee385e823a7bdb59f2a689cfff6f7))
* TABL create/update/delete support ([#104](https://github.com/arc-mcp/arc-1/issues/104)) ([03f1ece](https://github.com/arc-mcp/arc-1/commit/03f1ecea4eb365d94b53c97901a01dc9131dc993))
* transport enhancements — delete, reassign, types, recursive release (FEAT-39) ([#88](https://github.com/arc-mcp/arc-1/issues/88)) ([0f7ac83](https://github.com/arc-mcp/arc-1/commit/0f7ac8345a4914d05935f8ced359378c4840093c))
* transport pre-flight check for non-$TMP package writes ([#99](https://github.com/arc-mcp/arc-1/issues/99)) ([36d7787](https://github.com/arc-mcp/arc-1/commit/36d7787213b2c1e715b05f273efe32e4b7b9cc9f))


### Bug Fixes

* align ADT API patterns with reference abap-adt-api implementation ([#98](https://github.com/arc-mcp/arc-1/issues/98)) ([9607510](https://github.com/arc-mcp/arc-1/commit/9607510d0bb886d46e70bf2c620e014c37420dd9))
* enforce allowedPackages on all SAPWrite operations ([#81](https://github.com/arc-mcp/arc-1/issues/81)) ([5de8b44](https://github.com/arc-mcp/arc-1/commit/5de8b4443b4d090a6920cdee7c917d41bb282ab6))
* feature probe only treats 404 as unavailable, not all HTTP errors ([#95](https://github.com/arc-mcp/arc-1/issues/95)) ([5119615](https://github.com/arc-mcp/arc-1/commit/51196153b9a1889a5d572e31d6e15438e2bd09ca))
* RAP write guard, block CDS writes when RAP unavailable ([#93](https://github.com/arc-mcp/arc-1/issues/93)) ([dea0099](https://github.com/arc-mcp/arc-1/commit/dea009926d93f76301e1824bc46ee164db9bb23b))
* remove RAP write guard that blocked all CDS/DDLS writes ([#96](https://github.com/arc-mcp/arc-1/issues/96)) ([5ffef19](https://github.com/arc-mcp/arc-1/commit/5ffef19b3586d0c0cd9bfb3134d34d0303430398))
* transport hint false positive when corrNr present in URL path ([#100](https://github.com/arc-mcp/arc-1/issues/100)) ([2026702](https://github.com/arc-mcp/arc-1/commit/202670259e7e379548eb29f6a05bc360c055f4fb))
* use HEAD instead of GET for feature probing ([#94](https://github.com/arc-mcp/arc-1/issues/94)) ([4a8a156](https://github.com/arc-mcp/arc-1/commit/4a8a1565ecb9a56c7137003153b7f1359deef491))

## [0.6.1](https://github.com/arc-mcp/arc-1/compare/v0.6.0...v0.6.1) (2026-04-10)


### Features

* add API release state tool for clean core compliance (FEAT-02) ([#77](https://github.com/arc-mcp/arc-1/issues/77)) ([57e5eaf](https://github.com/arc-mcp/arc-1/commit/57e5eafdc05067e7acf4052da4087f1ea0e2b3c6))
* add BSP types and Atom XML parsers for UI5 filestore ([#61](https://github.com/arc-mcp/arc-1/issues/61)) ([264af14](https://github.com/arc-mcp/arc-1/commit/264af14d1dcfde49a64965cdf94baba6db8b3731))
* add BSP_DEPLOY type for ABAP Repository OData queries ([#66](https://github.com/arc-mcp/arc-1/issues/66)) ([90a2fc6](https://github.com/arc-mcp/arc-1/commit/90a2fc6b419720b3844480f3fe943a55bd2e9ac1))
* add class hierarchy to SAPNavigate and fix doc inaccuracies ([#70](https://github.com/arc-mcp/arc-1/issues/70)) ([1831808](https://github.com/arc-mcp/arc-1/commit/183180828a44b7fcc3dd7db7a9944785364f6050))
* add publishServiceBinding and unpublishServiceBinding to devtools ([#62](https://github.com/arc-mcp/arc-1/issues/62)) ([ced5639](https://github.com/arc-mcp/arc-1/commit/ced56393c8d396f999ecba7c673abef45dbe9dc0))
* add transliteration, field hints, cache indicators ([#64](https://github.com/arc-mcp/arc-1/issues/64)) ([0ce3347](https://github.com/arc-mcp/arc-1/commit/0ce334712e2a40b0571b86c2ee5e3b40a13b2329))
* transport/write compatibility — CTS media types, 406/415 retry, corrNr auto-propagation ([#78](https://github.com/arc-mcp/arc-1/issues/78)) ([42f0786](https://github.com/arc-mcp/arc-1/commit/42f078658fe3b98143a2344e276d6d663c64f78c))


### Bug Fixes

* add pre-cleanup for stale E2E write object ([#76](https://github.com/arc-mcp/arc-1/issues/76)) ([a5aa26f](https://github.com/arc-mcp/arc-1/commit/a5aa26f07ee7dbde7c58b8e2f0e0a13bcdd1eb76))
* correct Accept headers and entity expansion limit for ADT APIs ([#69](https://github.com/arc-mcp/arc-1/issues/69)) ([ff96ea8](https://github.com/arc-mcp/arc-1/commit/ff96ea852ccb9d3136cffa3b0e8205d6cb466799))
* implement comprehensive ADT API audit reports ([#65](https://github.com/arc-mcp/arc-1/issues/65)) ([9f210ab](https://github.com/arc-mcp/arc-1/commit/9f210ab0f0365ea65dd9cfa261436678af299c26))
* improve LLM guidance for SAPSearch empty results and SAPContext CDS usage ([#59](https://github.com/arc-mcp/arc-1/issues/59)) ([1df565a](https://github.com/arc-mcp/arc-1/commit/1df565a6d68a89fec9565fa865cded82fc8f426e))


### Tests

* reliability hardening, fixtures, skip policy, coverage, try/catch, CRUD lifecycle, telemetry ([#72](https://github.com/arc-mcp/arc-1/issues/72)) ([be42998](https://github.com/arc-mcp/arc-1/commit/be42998f19f731939ddffad59f76e89cf8c26f55))

## [0.6.0](https://github.com/arc-mcp/arc-1/compare/v0.5.0...v0.6.0) (2026-04-08)


### ⚠ BREAKING CHANGES

* simplify write safety — default $TMP, remove allowTransportableEdits, enforce package allowlist ([#56](https://github.com/arc-mcp/arc-1/issues/56))

### Features

* add class metadata types and ADT metadata parser ([#55](https://github.com/arc-mcp/arc-1/issues/55)) ([0b44fb7](https://github.com/arc-mcp/arc-1/commit/0b44fb7e32cb5fbca389edda77b6d1ef1b7c818b))
* simplify write safety — default $TMP, remove allowTransportableEdits, enforce package allowlist ([#56](https://github.com/arc-mcp/arc-1/issues/56)) ([1f6ac1d](https://github.com/arc-mcp/arc-1/commit/1f6ac1da03f61d42099dccedd3e6b1f824aec091))

## [0.5.0](https://github.com/arc-mcp/arc-1/compare/v0.4.4...v0.5.0) (2026-04-08)


### ⚠ BREAKING CHANGES

* SAPQuery now requires 'data' scope (was 'read'), SAPTransport requires 'write' (was 'admin')

### Features

* add J4D skills parity plan ([#47](https://github.com/arc-mcp/arc-1/issues/47)) ([df7ef1f](https://github.com/arc-mcp/arc-1/commit/df7ef1f98e8bcf4fa51f40af53b75d9fdd8e9672))
* add textSearch smoketest at startup and other improvments ([#45](https://github.com/arc-mcp/arc-1/issues/45)) ([792ff5b](https://github.com/arc-mcp/arc-1/commit/792ff5ba605ba00e1dce869768903eeb99adcc94))
* add Zod v4 runtime input validation for all MCP tools ([#52](https://github.com/arc-mcp/arc-1/issues/52)) ([9eea32a](https://github.com/arc-mcp/arc-1/commit/9eea32a3eec4d6a7e1276483c4aa73cc215efe52))
* two-dimensional authorization model (scopes, roles, safety) ([#48](https://github.com/arc-mcp/arc-1/issues/48)) ([8ce07d1](https://github.com/arc-mcp/arc-1/commit/8ce07d11389928709de01da5073d0165cbc605b7))


### Bug Fixes

* implement OAuth security review verification report(RFC 9700) ([#51](https://github.com/arc-mcp/arc-1/issues/51)) ([3ef81e1](https://github.com/arc-mcp/arc-1/commit/3ef81e1cd3b094a4f6645add6c866dbe2c71bf1e))
* use standard HTTP proxy for BTP connectivity ([#43](https://github.com/arc-mcp/arc-1/issues/43)) ([a60dd1b](https://github.com/arc-mcp/arc-1/commit/a60dd1b60145c40c02fb1be93b33c39aa3d9af54))

## [0.4.4](https://github.com/arc-mcp/arc-1/compare/v0.4.3...v0.4.4) (2026-04-07)


### Bug Fixes

* use native arm64 runners instead of QEMU for Docker builds ([b65fba4](https://github.com/arc-mcp/arc-1/commit/b65fba41851b0d5ae1f2d15601c4afc78b0608ae))

## [0.4.3](https://github.com/arc-mcp/arc-1/compare/v0.4.2...v0.4.3) (2026-04-07)


### Bug Fixes

* use separate deps stage to avoid QEMU arm64 crash in Docker build ([cab08fa](https://github.com/arc-mcp/arc-1/commit/cab08fa2085fbafb63d61e1954ae88af136d87b7))

## [0.4.2](https://github.com/arc-mcp/arc-1/compare/v0.4.1...v0.4.2) (2026-04-07)


### Bug Fixes

* avoid QEMU emulation crash in arm64 Docker build ([7ea7883](https://github.com/arc-mcp/arc-1/commit/7ea78838ea8bd121f6b823c0754f64ae2b69b673))

## [0.4.1](https://github.com/arc-mcp/arc-1/compare/v0.4.0...v0.4.1) (2026-04-07)


### Bug Fixes

* fix npm self-upgrade in release workflow (Node 22.22.x bug) ([17b6bf3](https://github.com/arc-mcp/arc-1/commit/17b6bf3bb1ffcd83684d0c9d8f37b34bc0f37aa5))

## [0.4.0](https://github.com/arc-mcp/arc-1/compare/v0.3.0...v0.4.0) (2026-04-07)


### Features

* add DDIC completeness — structures, domains, data elements, transactions ([#21](https://github.com/arc-mcp/arc-1/issues/21)) ([9e0fa2a](https://github.com/arc-mcp/arc-1/commit/9e0fa2ad756a3a10f937531216707c8ac56c8aae))
* add DDLS support to SAPContext and include=elements to SAPRead ([#30](https://github.com/arc-mcp/arc-1/issues/30)) ([6a2883e](https://github.com/arc-mcp/arc-1/commit/6a2883e086bd9c44d578245a61fad1a50693f60f))
* add LLM eval harness for testing tool-call accuracy ([#33](https://github.com/arc-mcp/arc-1/issues/33)) ([e8c8a65](https://github.com/arc-mcp/arc-1/commit/e8c8a6511ad69bb9b95222450e0095fde391edda))
* add object caching with on-demand + pre-warmer support ([#31](https://github.com/arc-mcp/arc-1/issues/31)) ([8ba2f0d](https://github.com/arc-mcp/arc-1/commit/8ba2f0d1624039be03cfb39d916ee11b53f94dc8))
* add runtime diagnostics (short dumps + ABAP traces) to SAPDiagnose ([#24](https://github.com/arc-mcp/arc-1/issues/24)) ([ab177fc](https://github.com/arc-mcp/arc-1/commit/ab177fc0a77f34da5c3cd2c83fbf3de64b3ee928))
* DDLX, SRVB read support and batch activation for RAP completeness ([#22](https://github.com/arc-mcp/arc-1/issues/22)) ([402c57b](https://github.com/arc-mcp/arc-1/commit/402c57bb3b43b908a3df4e9494e0cfbd08cc436f))
* enhanced abaplint integration with system-aware presets and pre-write validation ([#37](https://github.com/arc-mcp/arc-1/issues/37)) ([f17d4fa](https://github.com/arc-mcp/arc-1/commit/f17d4fa03cf725dcc45918f050b2c1cd8fd2eff4))
* method-level surgery and hyperfocused mode ([#23](https://github.com/arc-mcp/arc-1/issues/23)) ([dbd27b9](https://github.com/arc-mcp/arc-1/commit/dbd27b9be52ee32ed8de0691e033e73ffa7c2314))
* scope-based Where-Used analysis for SAPNavigate ([#38](https://github.com/arc-mcp/arc-1/issues/38)) ([f805441](https://github.com/arc-mcp/arc-1/commit/f805441d03f2f1190b461d923e7e176e4f4af1bc))


### Bug Fixes

* post-merge consistency — SAPLint schema cleanup and objectUrlForType completeness ([#26](https://github.com/arc-mcp/arc-1/issues/26)) ([214ebec](https://github.com/arc-mcp/arc-1/commit/214ebec730b717acb483665e8af0f4bde5f0ed08))

## [0.3.0](https://github.com/arc-mcp/arc-1/compare/v0.2.0...v0.3.0) (2026-04-01)


### Features

* direct BTP ABAP Environment connectivity via OAuth 2.0 ([#18](https://github.com/arc-mcp/arc-1/issues/18)) ([b1cf86c](https://github.com/arc-mcp/arc-1/commit/b1cf86c3755294f1873be80f67e480d54b1427b3))

## [0.2.0](https://github.com/arc-mcp/arc-1/compare/v0.1.4...v0.2.0) (2026-03-31)


### Features

* E2E testing infrastructure, XML error cleanup, and CI hardening ([#13](https://github.com/arc-mcp/arc-1/issues/13)) ([3830ff9](https://github.com/arc-mcp/arc-1/commit/3830ff9))
* improve tooling based on real-world LLM feedback ([#14](https://github.com/arc-mcp/arc-1/issues/14)) ([3bcb59e](https://github.com/arc-mcp/arc-1/commit/3bcb59e))


### Bug Fixes

* correct Docker image name to arc-1 and fix GHCR link ([ae58467](https://github.com/arc-mcp/arc-1/commit/ae58467))

## [0.1.4](https://github.com/arc-mcp/arc-1/compare/v0.1.3...v0.1.4) (2026-03-31)


### Bug Fixes

* add repository field for npm OIDC provenance verification ([b3a55aa](https://github.com/arc-mcp/arc-1/commit/b3a55aa))

## [0.1.3](https://github.com/arc-mcp/arc-1/compare/v0.1.2...v0.1.3) (2026-03-31)


### Bug Fixes

* install npm 11.5+ for OIDC trusted publishing support ([300f846](https://github.com/arc-mcp/arc-1/commit/300f846))

## [0.1.2](https://github.com/arc-mcp/arc-1/compare/v0.1.1...v0.1.2) (2026-03-31)


### Bug Fixes

* restore NPM_TOKEN for publish and reorganize docs navigation ([6d76b4b](https://github.com/arc-mcp/arc-1/commit/6d76b4b))
* use npm OIDC trusted publishing instead of NPM_TOKEN ([ab9f50c](https://github.com/arc-mcp/arc-1/commit/ab9f50c))

## [0.1.1](https://github.com/arc-mcp/arc-1/compare/v0.1.0...v0.1.1) (2026-03-31)

Initial release. Ported from [oisee/vibing-steampunk](https://github.com/oisee/vibing-steampunk).
