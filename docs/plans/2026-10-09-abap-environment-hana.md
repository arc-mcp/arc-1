# HANA detection for ABAP Environment

## Root cause and plan

The captured BTP ABAP Environment 920 SP04 component feed contains SAP_BASIS,
SAP_CLOUD, DW4CORE, HOME, LOCAL, ZLOCAL and demo content, without SAP_ABA. Its
hanainfo endpoint is absent. The component classifier recognizes S/4HANA and
BW/4HANA but misses this Cloud identity and reports HANA unconfirmed.

[SAP documents that ABAP Environment owns an ABAP-managed HANA Cloud instance](https://help.sap.com/docs/btp/btp-developers-guide/understanding-available-technology).
This supports an inference from a verified ABAP Environment identity, not from a
caller-supplied BTP mode or deployment location.

Add one component rule: SAP_BASIS and exact SAP_CLOUD present, exact SAP_ABA absent.
Reuse the existing component fallback and explicit on/off precedence; add no
endpoint, version threshold, cache, deployment heuristic or DW4CORE prefix rule.
Keep the existing inferred label. The feed proves product identity, not a database
version or authorization to use a particular HANA endpoint.

## Plan review and validation

Test the actual captured component names, mixed-case names, missing/ambiguous
identity, unrelated Cloud-looking names and mode overrides. Exercise the complete
feature probe with hanainfo 404. Compare fresh 750/758/816 probes; replay the saved
BTP component feed while named-user OAuth login is unavailable. A replay must not
be presented as fresh BTP qualification. No object lifecycle is needed for this
reporting-only change. COMPAT-14 existed only in the local audit, not main's roadmap.

Review found one related reporting defect: a component fallback always called the
hanainfo endpoint absent, including 401/403 or network failure. The fallback now
retains the real probe diagnostic while identifying its independent component
inference. Two authentication-denial regressions verify this.

Two new tests failed on the baseline; the implemented result passes all 8,071 unit
tests, typecheck, Biome, policy validation, build and size/schema budgets. Strict
documentation build also passes. Fresh compiled public probes retain 750 as
unconfirmed and 758/816 as HANA inferred. The saved 920 SP04 component feed changes
from false to true in replay. Explicit on/off overrides still win. No fresh BTP
probe is claimed; named-user OAuth reauthentication remains pending.

Final review found no further change needed in this scope. No write/data-query
behavior or runtime identity selection changed. No roadmap impact on main after
checking; the local audit recommendation is resolved in code with fresh BTP
qualification still outstanding.
