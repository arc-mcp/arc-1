# SAP 816 CI session failures

## Evidence and limits

Five historical E2E runs failed immediately after integration jobs on the shared
816 system; ten comparable runs passed. The first failing operation was package
LOCK, outside #853's changed code, followed by short-lived stateful write failures.
A test-only branch also failed. This establishes a recurring session failure, not
its cause: the retained logs omit CSRF probe status and session information.

## Plan and review

1. Recheck the historical artifacts and reproduce integration → E2E on 816 where
   available, with unique test objects and owned-server cleanup. Separate injected
   protocol failures from a natural reproduction and note overlapping CI traffic.
2. Stop classifying generic LOCK/UNLOCK HTTP 400 "Service cannot be reached" as skippable
   backend instability. It must fail the test; do not disguise a reliability defect.
3. Record secret-free CSRF probe metadata using the existing audit event: endpoint,
   method, status, duration, session mode and whether the request carried a context
   cookie. Never record token, cookie, credential or response body values.
4. Regression-test failures and successful fallback without changing HTTP retries,
   mutation behavior, SAP configuration or job order. Do not add an unexplained sleep.
5. Keep unresolved hypotheses and the next SAP-side evidence request in a research
   note. Existing object-name isolation does not guarantee backend session isolation.

This is an observability and test-verdict fix unless a separately reproduced runtime
cause justifies a small additional change. No existing roadmap idea covers it.

## Outcome

The local failure and a later passing sequence, including their CI overlaps, are
recorded in [the research note](../../research/2026-09-27-sap-816-session-failures.md).
The runtime cause remains unresolved. No transport recovery or timing workaround
was added. Full local gates pass (7,295 unit tests); a four-letter-run-ID fixture
regression exposed during reproduction was fixed and verified on 816.
