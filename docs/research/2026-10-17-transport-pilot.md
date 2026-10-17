# Transport pilot: eight existing requests

The local CLI at `56c1d518` (product `f7598c33`) reviewed eight existing requests on SAP_BASIS
758 SP02, HTTPS 443, client 001, using the existing Basic test identity with mutations disabled.
No ATC, Unit, activation or transport release was triggered. These are demo/test requests,
not representative customer measurements.

| Request | Mode | Objects | Result | First-page sends / bytes / ms | Whole CLI ms |
|---|---|---:|---|---|---:|
| A4HK905229 | active | 9 | partial | 23 / 50413 / 3804 | 9297 |
| A4HK906287 | active | 1 | partial | 1 / 12641 / 114 | 3728 |
| A4HK906357 | active | 17 | partial | 1 / 46307 / 215 | 4806 |
| A4HK906369 | released | 5 | partial | 16 / 25840 / 2550 | 7671 |
| A4HK906371 | released | 2 | partial | 10 / 18704 / 1468 | 7259 |
| A4HK906375 | active | 6 | partial | 10 / 29422 / 1256 | 5718 |
| A4HK906379 | active | 5 | partial | 3 / 344572 / 911 | 4339 |
| A4HK906578 | released | 0 | complete | 1 / 5019 / 124 | 3909 |

## What the pilot tells us

Seven reviews retain explicit gaps. The empty released request is the only complete collection;
its report expressly provides no release verdict. The known class/program change retains all three
attributed source diffs. Missing demo programs and class includes remain unavailable, never unchanged
or proven deleted. No false complete label was found in this inspected sample.

The largest unsupported group is Dictionary metadata (DOMA, DTEL, TABL, TTYP), followed by
whole-object non-source scope and function-group ownership. Prioritize a bounded historical
Dictionary/text investigation. A current metadata read or an active-only version is insufficient;
require two differing historical snapshots and stable field semantics before enabling an adapter.

The organizer listing returned only three recent released requests, although known older requests
remain individually readable. We used those known fixtures directly and do not claim exhaustive
landscape coverage. The first open-request listing returned 50 of 68 rows; no inventory enumeration
beyond the requests needed for this sample was required.

## Evidence and limits

[Machine-readable summary](adt-vscode-1.2/evidence/transport-pilot-summary.json) includes per-request
metrics, object-family counts and hashes of the private full reports. Those reports remain under
`test-results/transport-review/live/pilot-*/` in the transport worktree. Page metrics exclude CLI
startup and the collector's final inventory revalidation; wall times include both.

Reviewer preparation time, rework, usefulness and time savings need a human pilot; they were not
measured here. These runs do not prove historical coverage on 750/816 or release readiness.
