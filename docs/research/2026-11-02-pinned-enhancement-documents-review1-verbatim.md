# Independent review — private ENHO / SKTD candidate

## Verdict

**CHANGES REQUESTED before private integration: one P2 preservation defect and one P3 result-scope defect.** No P0/P1 issue was confirmed. The corrected candidate needs regression coverage and a new source-bound review. This is not native, PP, public capability or whole-PR approval.

Candidate: `249eb70703b7b95d077be4852167c323f8095c85`, base `5884adc722f5dba8f85cd6c425b51840b4785880`. I authored neither this implementation nor its committed tests. This is Codex fallback following the confirmed Claude limit, not a Claude review.

## F1 — P2: Qualify KTD write slots by namespace and native structure before the lexical rewrite

Location: `src/handlers/write/pinned-document-write.ts:165–171` (`prepare`, calling `rewriteKtdDocument`). Related validation: `src/adt/pinned-document-owner.ts::parsePinnedDocument`; lexical matching: `src/adt/ddic-xml.ts::findKtdElements`, `rewriteKtdShortTexts` and `replaceKtdText`.

The private adapter verifies the native root, reference and package, but does not qualify the document nodes/attributes that the reused lexical writer can edit. That writer finds `sktd:element`, `sktd:text` and `sktd:shortText` by spelling throughout the XML. It does not resolve their namespace or require the supported native position. A full canonical hash proves the input has not changed; comparing readback with the newly generated body does not prove that generation changed only permitted fields.

Three independent real-client/mock-HTTP probes demonstrate the consequence:

1. Add an opaque `<x:extension xmlns:x="urn:extension">` containing a `sktd:element` that rebinds `sktd` to `urn:foreign`. Give that element ID `ZTEST.SHADOW` and a Base64 text. Updating `## ZTEST.SHADOW` sends **one PUT**, changes the foreign field and returns **`saved-inactive`**.
2. The same nested element **using the genuine KTD namespace** still sits under the opaque extension rather than the qualified native node structure. It is likewise overwritten and confirmed. Checking only the prefix binding is insufficient.
3. Rebind `sktd` to `urn:foreign` on the apparent `sktd:shortText` of an otherwise native `ZTEST` element. `shortTexts: [{node: "ZTEST", text: "foreign changed"}]` sends **one PUT**, changes the foreign attribute and returns **`saved-inactive`**.

The existing preservation checks protect ordinary untouched extension fields and unexpected server readback changes, but these probes show the generated body itself can edit opaque content. That contradicts the private profile's stated preservation boundary. These are adapter-level mock reproductions; they are not evidence that a particular live SAP release produces these shapes, nor evidence of a target/package authorization bypass.

Before invoking the shared lexical writer, qualify every potential write slot against the native KTD namespace, supported element position and relevant attribute namespaces, refusing shadowed/unknown lexical layouts. Alternatively make the shared transformation namespace/path aware while preserving legacy behavior. Protect the before/after projection so only the selected verified native text fields can differ. Do not fix this with only a root namespace check or a readback comparison against the generated body.

Required regressions: all three cases above must either refuse without PUT or preserve every opaque value while changing only an independently verified native target. Include both Markdown and short-text paths, nested prefix rebinding, valid native namespace inside an opaque subtree, and ordinary multi-node/draft/short-text success controls. Create follow-up saves and dry-run transformation should use the same validated boundary.

Evidence: `codex-probes.test.ts`, `codex-probes-complete.log`. All three refusal assertions fail, each with `puts: 1`, `foreignContentChanged: true`, `state/result: "saved-inactive"`. The original smaller probe logs are retained.

## F2 — P3: Report document activation as document scope

Location: `src/handlers/write/pinned-activation.ts:217–220`, feeding document evidence into `binding`; result construction at lines 430–431.

The new document branch reuses the `binding` variable for ENHO/SKTD evidence. The result builder therefore reports `scope: "selected-service-binding-owner-only"` for both successful ENHO and SKTD activation. The same reuse also labels document verification as `binding-active-verification`. The requests are bounded to the correct owner in the probes, but the machine-readable operation scope is factually wrong.

Keep the shared activation core while distinguishing the selected document profile in output scope and verification phase. Add success and verification-failure checks for ENHO, SKTD and the KTD alias, retaining the existing SRVB scope behavior.

Evidence: both independent activation probes return `state: "activated"` with `scope: "selected-service-binding-owner-only"`; their assertions fail in `codex-probes-complete.log`.

## Reviewed behavior

I read the supplied complete implementation/test diff and author report, relevant governing instructions, FEAT-93 at start and finish, accepted broader-write plan, shared lifecycle guidance, and ENHO/KTD native contract/routing/short-text/parent research. The review covered:

- The KTD create-helper extraction and optional ENHO native-spot validator, with ordinary single-target behavior preserved in existing regressions.
- Exact document root/type/name/parent/technology checks, alias handling and conservative unsupported-parent/lexical refusals.
- Complete canonical metadata guards before and under lock, own-session cleanup, fresh package/CTS/lock checks and common write/target/deny/context admission.
- ENHO ordered patch construction and stored filter/opaque-entry preservation, and KTD draft accumulation, heading/short-text routing and references.
- Cumulative all-response/attempt propagation through the shared facade, no replay, cancellation/deadline limits and separate cleanup allowances.
- Creation partial outcomes, post-write verification refusal remaining unconfirmed, typed delete absence, exact activation preaudit and consistent native view checks.
- Private symbol/context boundaries and unchanged public capability/schema admission.

Three additional adversarial controls pass: normal KTD opaque-field preservation; ENHO metadata drift under its own lock refuses PUT and unlocks; loss of a KTD opaque field after PUT remains `document-save-unconfirmed` and performs own cleanup. Apart from F1/F2, this review confirmed no other actionable defect. It does not convert unverified native contracts into support claims.

## Checks and source integrity

All checks used existing dependencies and Node 22.21.1. No installation was performed.

| Check | Result | Evidence |
| --- | --- | --- |
| First source action: snapshot verifier | **4,640 files unchanged**, exact candidate | Initial tool result |
| Focused document, KTD/ENHO, lifecycle/client/isolation and real transport-budget tests | **12 files / 283 tests passed** | `codex-focused.log` |
| Additional legacy write/DDIC handler tests | **1 file / 95 tests passed** | `codex-legacy-ddic.log` |
| Combined committed-test coverage | **13 files / 378 tests passed** | Above two logs |
| Independent adversarial probes | **3 passed / 5 failed**; three reproduce F1, two reproduce F2 | `codex-probes-complete.log` |
| Source/scripts/tests typecheck | All three projects passed | `codex-typecheck.log` |
| Full lint | 1,323 files passed; three existing informational suggestions | `codex-lint.log` |
| Policy | 135 policy entries / 14 schemas passed | `codex-policy.log` |
| File/schema sizes | 1,051 tracked source/test files and all 12 schema scenarios passed | `codex-sizes.log` |
| Final source action: snapshot verifier | **4,640 files unchanged**, same candidate | `codex-snapshot-final.log` |

Focused command:

```text
node_modules/.bin/vitest run tests/unit/handlers/pinned-documents.test.ts tests/unit/handlers/write-ktd-smbc.test.ts tests/unit/handlers/write-ktd-parent-description.test.ts tests/unit/handlers/write-ktd-short-text.test.ts tests/unit/adt/ktd-routing.test.ts tests/unit/adt/enhancement-impl.test.ts tests/unit/adt/ktd-short-text.test.ts tests/unit/adt/mutation-client.test.ts tests/unit/adt/mutation-lifecycle.test.ts tests/unit/adt/mutation-compatibility.test.ts tests/unit/adt/mutation-isolation.test.ts tests/unit/adt/request-attempt-budget.test.ts
```

Additional commands: `vitest run --reporter=default tests/unit/handlers/write-ddic.test.ts`; `vitest run --config ../codex-probes.config.mjs`; `npm run typecheck`; `npm run lint`; `npm run validate:policy`; `npm run check:sizes`. Both source verifications used `/opt/homebrew/bin/python3 review-input/verify-snapshot.py`.

The author reports 525 files / 14,702 tests and build/docs passes. I did not repeat or relabel that full-suite/build/docs evidence. The initial focused run used the repository reporter and emitted its normal generated `test-results/unit.json`; subsequent test runs used explicit default/external reporters. Bound source files remained unchanged. Probe files/configuration/logs and this verdict are outside the snapshot; no source action followed the final verifier.

No manual Git command, source edit, live SAP/native/integration CLI, credential or .env inspection, browser action, deployment, external-network experiment or delegation was performed. The approved transport-budget unit tests use their existing local loopback servers. Reviewer logs contain no dotenv-load, `getaddrinfo`, `ENOTFOUND` or `ECONNREFUSED` markers.

## Remaining qualification limits

The separately integrated editable-read framework does not itself implement ENHO/SKTD read extensions. Those known follow-ups remain open and are not treated as a newly discovered defect here. Private integration after correction still does not authorize public admission. Current-code native local/transported CRUD and activation, two distinct mapped SAP writers, refusal/partial-result/cleanup cases, classic/cloud BAdI filters and every claimed KTD parent/native node layout remain required. Native normalization and unsupported contracts must remain conservative; mocks cannot establish them. This report grants no native execution approval.
