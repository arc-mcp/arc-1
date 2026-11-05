# Independent native LOCAL package failure audit

The native run at `fc14a7465cf10eed29b5e0291f33b3310e8a5ac0` **failed and remains consumed**. Root/child package creation and readback, class creation/source save, and class activation succeeded. The first planned root-nonempty DELETE returned HTTP400, which the exact refusal classifier did not recognize. No later negative test or fixture cleanup ran. All three owners remain present in the separately captured fresh inspection. This audit grants no replay or cleanup permission and is not PP/public/whole-PR qualification.

Protocol: `/Users/marianzeis/.local/state/arc1-qualification/pr1142-native-local-package-v1`.
Intent SHA-256: `46983b4383cbc5f69e6e93395b2521ec603574d1295930cae4a9fa93c5a83a45`.
Result SHA-256: `22a2901a427c42d01ae7e0747c4ec0d84b58474f984f10a793825e8450a7bbcc`.
Execution: 2026-11-03 09:31:30.812–09:31:48.099 UTC, using preflight `AB1A9102C35FD216`. Earlier GET-only preflight `1A95F2F3A8C48EC7` was not selected after its freshness was consumed by browser sign-in. The permanent attempt directory is the one-time claim; it must not be removed or reused.

## Observed native facts

| Owner | Latest observed state | Exact relationship |
|---|---|---|
| `$ARC1_PK_R_A5CD6186AFDACA31` | Active DEVC/K, created by/responsible MARIAN | Explicit empty native superPackage, LOCAL, empty layer, development, recordChanges=false; owned child reference present |
| `$ARC1_PK_C_A5CD6186AFDACA31` | Active DEVC/K, created by/responsible MARIAN | Exact native parent `$ARC1_PK_R_A5CD6186AFDACA31`, LOCAL, empty layer, development, recordChanges=false |
| `ZCL_ARC1_PK_A5CD6186AFDACA31` | Active CLAS/OC, MARIAN, native masterSystem A4H | Exact child package, intended description and source marker |

The journal has **214 sequential rows and 66 visible request/response-or-error pairs**. Two package POSTs returned201; the class POST returned200 and its subsequent owner/source readback establishes creation. One class source PUT returned200. The one activation returned200 with native `checkExecuted=true`, `activationExecuted=true`, `generationExecuted=true`, followed by matching active owner/source reads. Seven native CTS checks returned success with LOCAL/blank recording for the exact owned packages. Root CREATE remains native-governed recording evidence, not a verified claim of no CTS effects; the recording metadata and checks do not erase that distinction.

The sole DELETE targeted the exact root package under its own lock: request00208, error00209. Native HTTP400 was returned at09:31:47.922, followed by root UNLOCK200 at00211 and the owning-session closure predicate true at00212. There were exactly two observed owning LOCK/UNLOCK pairs in the run (class source save and root negative deletion), both UNLOCK200, and both reported sessionClosed=true/unlockFailed=false. Lock handle bodies are intentionally digest-only; close success is the shared owning-session callback predicate, not a retained raw close HTTP response.

`cleanupUnconfirmed=false` describes that owning lock/session cleanup. It does **not** mean the three repository fixtures were deleted. No fixture cleanup stage, child DELETE, class DELETE, cascade confirmation, or final absence check occurred. The later zero-lock searches likewise do not prove object absence.

## Why the refusal is unqualified, and the lost diagnostic

The adapter at00212 reported `ok=false`, `state=delete-rejected`, `phase=delete`, `retryable=false`, `statusCode=400`. `nativePackageNonempty` returned undefined, so the driver stopped at `refuse-root-child` with `package-stage-unconfirmed`; `expectedRefusals` remains empty. The source correctly refuses to treat generic400 as the planned PAK051 result.

The **700-byte native error text was not preserved**. Row00209 stores SHA-256 `76ae8e3c1718995163603b756d1210fd9bf608c4ac0a87dc9fb9eb3af1fe5864`, size and status only. `observeNativeHttp` marks any request carrying `lockHandle` sensitive, strips that query value and suppresses its response/error body. The full192-byte adapter result was also deliberately reduced by `packageAdapterEvidence` to selected outcome fields and SHA-256 `b79caf1341b0ba18e7ef53f48139634646b48bb0e3cda18718f661b9b4788404`. Neither complete payload occurs among retained bodies.

Consequently the audit cannot determine whether SAP returned another error or an unsupported representation of the expected nonempty error. It cannot recover the native namespace/type/T100 properties/message from those hashes, assert PAK051, or justify changing the refusal classifier. The original four successful forward stages remain valid facts, but the first noncascade refusal remains unqualified. No request should be replayed merely to recover missing diagnostics.

## Independent verification and controls

I recomputed all **256 original protocol file hashes**, the nine finalized operator/control/collector files and the15 separate retained-inspection files. All remained unchanged through final verification. The original body/byte hashes directly verify **109 retained bodies**; **23 canonical owner snapshots** independently match native metadata and exact source hashes. Empty sensitive responses match the empty-body digest. The two nonempty LOCK bodies, the lost DELETE body and five full adapter outputs remain digest-only; their raw payloads cannot independently be rehashed. The later saved inventory body independently matches all earlier inventory digests.

Intent/attempt/preflight bindings, all four prerequisite file hashes, exact graph/stage lists, prior source verdict/evidence hashes, prior V5 audit hash, fixed entry hash and package-lock hash match. The execution checkout was read-only inspected clean at exactfc14 before and after this audit; the ledger records the relevant source hashes. Installed third-party dependency bytes are not attested by the package lock. No native script or repository module was executed by the auditor; verification used offline Python, saved files and read-only Git status/hash checks.

The used preflight completed09:29:36.184 after typed absence of all three future owners and a valid suffix-free inactive inventory. Baseline suffix/user receipt times were09:30:09.717/09:30:35.486. The complete attempt finished before its unchanged09:34:34.485 freshness deadline. CI evidence records no in-progress or queued runs at09:31:18.190; operator evidence records caffeinate protection. Those are saved operator controls, not independently recreated host/process observations.

I viewed both actual post-failure JPEGs: user09:34:27.463 shows A4H(001), client001/userMARIAN/table*/argument* and complete LockTable(0); suffix09:35:22.156 shows client001/user*/table*/argument*A5CD6186AFDACA31* and complete LockTable(0), with no displayed error. The original JPEG signatures and receipt hashes match. Baseline images have the same exact pixels/hashes as those later empty searches; timing comes from the operator capture receipts and root's new-search observations, not from unique pixels. The09:33:38.570 session-timeout screenshot is explicitly excluded as lock evidence and retained unchanged.

## Separate fresh retained-state evidence

The collector and manifest at `.../pr1142-native-package-execution-20261103/retained-inspection` are independently hash-bound. The collector permits only13 fixed GETs, uses a write-disabled client, checks clean exact source before/per request/after, and has a60-second deadline. It ran09:39:33.204–09:39:35.291. This audit did not run it.

All13 saved response bodies/byte hashes verify. All default/active/inactive metadata queries return native **active** state; they do not demonstrate separate inactive versions. Their complete raw metadata and canonical receipts match the last original pre-DELETE observations, including exact authors/descriptions and root→child→class relationships:

- Root raw metadata: `78bb32a381ef81b3a84be1f1018385372d470feb41f932e3ef41ca928d4c19e9`; canonical receipt: `a88621465bda7127c54b0f214df28c51371250995a00ec4595ce0f7bbae90b5c`.
- Child raw metadata: `1cea5da5e790e78a413a26e68381063695689a39dadeea184a52d5eb078bbc77`; canonical receipt: `76b20a59dc20fccdecef2c15b201bdf5e4d24f80217abdef91572728d3f99c3e`.
- Class raw metadata: `1326212441c4010691dc072852c8c84a8c141fc725444aabb517be6e51ada400`; canonical receipt: `2e3192ca8d7fcdfdb919bee00506a518a5a7abfc1ca6c9d37a29147895507998`.
- Class default/active/inactive source requests all return the same215-byte source, SHA-256 `8983b81cbe288e20cc351c6dc91492cdcc002a65bf0d383bb963b0a79b1ff6cb`, equivalent to the intended LF source after the known CRLF conversion. An inactive query returning this source does not prove a draft.
- Fresh native inactive inventory contains no fixture suffix and hashes `d93ca87f48d67f099e6c22d6e47c0d9b43764814c349a44a4adb2c2b0b499554`, identical to both preflights and the attempt's initial inventory. Unrelated private inventory contents are not reproduced in this report.

These later reads establish surviving unchanged owned state; they do not identify the earlier error, make the failed refusal successful, or prove repository/CTS rollback.

## Smallest proposed continuation, not execution approval

Preserve the original protocol, failed result and permanent claim unchanged. Bind a **new fixed retained-owner cleanup** to those exact files and this separate fresh inspection, with its own irreversible claim, reviewed source/runtime, GET-only nonclaiming preflight and genuinely fresh SM12 controls. No create, source update, activation, transport override or new fixture is needed.

Before any next mutation, add narrowly bounded non-secret native-error diagnostics for that cleanup: retain original error size/hash and an explicit structured diagnostic projection (native namespace/type, ordered T100 properties and safe message/language), removing the exact owning handle and marking redactions/unknown shapes. Keep credential/header/session data excluded. Test the capture boundary and malformed/unknown cases; **do not broaden `nativePackageNonempty` from the unrecoverable400**.

After fresh exact owner/source/parent/marker verification, perform only **class→child→root** DELETEs through normal current package authorization, owning lock/CTS/shared deletion, final-send source/history/deadline checks, typed owner absence, survivor checks and owning cleanup. The root DELETE after removing its actual child is a declared changed-state cleanup, not a retry of the unknown first negative test. Stop on any drift or uncertain effect, retain confirmed partial deletions, never automatically retry or cascade into an unbound owner, and finish with typed all-three absence, suffix-free inventory and new lock observations. The cleanup must not require inventing a successful refusal first.

After cleanup, the minimum still-owed noncascade qualification is a separately reviewed representative native negative case with sufficient retained diagnostics and unchanged-survivor proof. The original accepted package experiment specifically sought a parent-with-child and a package-with-contained-object refusal; neither is qualified by this attempt. A later bounded graph can cover both in one lifecycle, but no second experiment is implemented or approved here. Its native outcome must be observed before deciding whether an exact additional diagnostic representation belongs in the classifier. This audit is Basic-native contract evidence only; current-build two-writer PP and public/merge acceptance remain separate.

The audit builder, its initial corrected report-filename lookup diagnostic and final successful verification log remain private outside the protocol. No original artifact, source, credential, browser or SAP state was changed by this audit.
