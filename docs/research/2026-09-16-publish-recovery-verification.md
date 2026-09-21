# Publication failure handling: verification and limits

## Current behavior after independent review

PR #795 now prevents transient publication replay and reads state after the exact BTP V4 UI
missing-inbound error. It no longer automatically publishes a second time. Explicit active
published state confirms success; unpublished/unknown state preserves the SAP error and
returns guidance. The strict XML fixtures retain the relevant live wire shape with identities
sanitized. No SAP implementation source or credentials are included.

The 2026-09-21 review removed the ten-second delay, 150-second recovery deadline, 20-send
allowance, second state read, retry and package-revalidation plumbing. The original publish's
package/write gates remain. State inspection uses caller cancellation and existing HTTP limits.
The former budget did not include subtree package BFS; there is no total-send cap claim now.

Publication opts out of availability/database-session replay. Existing protocol behavior is
retained, including one token-refresh replay after any 403. Minimal mode now keeps standard
HTTP status and request-correlation guidance. Unpublish and other writes are unchanged;
the broader create/retry gap in the feedback investigation is still separate.

## Historical live SAP evidence — earlier implementation

Personal OAuth authentication and the existing free-tier system were renewed for the
2026-09-17 run. Build `b156f805`, SAP_BASIS/SAP_CLOUD 920 SP04, used an owned disposable package.
These are historical tests of the former automatic-retry implementation, not current-build
verification or proof of a successful natural transient recovery.

- Nine ordinary publications succeeded, each with one physical publish POST and explicit
  active `published=true`: one baseline plus eight variants.
- Four variants ran twice: immediate publication, a ten-second pre-wait, identical SRVD
  source update before activation, and a fresh HTTP client with the same OAuth identity.
  Immediate POSTs started 0.614–0.679 seconds after activation. A new client does not prove
  a different SAP application server. The eight variants took 45.058–52.308 seconds.
- Deleting one owned unpublished binding's generated SCO2 reproduced the exact error on
  both publication attempts. The former retrying call took 12.644 seconds, returned an error
  and left explicit unpublished state. `bindingCreated=true` did not establish readiness;
  retry, reactivation and save/activation did not recreate that missing dependency.
- No natural missing-inbound or `Usage of <SRVD> not permitted` error occurred.
- All created source/binding objects and generated objects were cleaned up and returned 404.
  A pre-existing package deletion problem remained; no forced package cleanup was attempted.

The customer's reported successful repetition remains plausible but unreproduced. The final
implementation therefore provides state evidence without assuming an automatic repair.
The [feedback investigation](2026-09-17-publish-feedback-investigation.md) preserves the full
variant table, controlled create-response-loss experiment and cleanup inventory.

## Current local validation

The no-republish and minimal HTTP disclosure regressions failed before the review changes.
Tests cover published/unpublished/unknown state, strict XML identity/namespaces, target/error
exclusions, concurrent identities, cancellation during a real pending state read, safe-read
503 retry, MIME handling and the retained 403 replay. Real-HTTP loopback cases commit a job
before 429/500/502/503/504 response replacement or connection loss: only one publication POST,
completion reported unconfirmed in both modes, and explicit committed-state readback.
These are simulations, not live SAP availability errors or customer-root-cause proof.

All **7,010 tests in 229 files** pass on the simplified implementation. Typecheck, lint,
build, policy, file/schema budgets and strict MkDocs pass; no budget was raised. A fresh
unauthenticated HEAD to the configured BTP ADT discovery endpoint still returned 503,
so no current-build BTP publication test was performed. No BTP objects were created during
this review. GitHub CI was not waited on. Historical live results above remain distinct.
