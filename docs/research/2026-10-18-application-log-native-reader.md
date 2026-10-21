# Application logs and the remaining scope of PR #844

## Decision

Keep [#844](https://github.com/arc-mcp/arc-1/pull/844) open. Its STXL use case overlaps with
[#1012](https://github.com/arc-mcp/arc-1/pull/1012), but INDX/custom clusters, generic DDIC layouts,
and legacy formats are absent from main. Application-log messages are useful for diagnosing failed
imports and background processing; a small native reader is preferable to generic BALDAT decoding.

The proposed `SAPQuery(application_log)` reads one exact saved log number. It uses two guarded GETs
to SAP's existing `APL_LOG_MANAGEMENT_SRV`, with TypeScript validation/projection. It does not run
ABAP, call RFC, install helpers, or copy code from #844. See [ADR-0009](../adr/0009-abap-execution-and-rfc-belong-in-extensions.md).

## Why the native service

SAP documents [Application Logs app activation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/b5670aaaa2364a29935f40b16499972d/087c5416539445fa8fcf0fdbd10b96d5.html?version=202310.002)
and [on-premise application-log authorization](https://help.sap.com/docs/ABAP_PLATFORM_NEW/b5670aaaa2364a29935f40b16499972d/238dc17aeea4498d8cf687f890f2194c.html?version=202310.latest).
This is an SAP-delivered UI service; those documents do not establish a stable released remote API.
Availability must be checked on each landscape. SAP's documented application-log uses include
[diagnosing asynchronous planning-data uploads](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/e296651f454c4284ade361292c633d69/d2c2524cf40a4405a382091f31731532.html?version=2022.000).

Read-only native-source inspection found:

- Overview CDS access control checks `S_APPL_LOG` object/subobject and display activity.
- Message reads retain native log loading, authorization checks, restriction BAdIs and object
  whitelisting. SAP renders the localized messages; ARC-1 does not reconstruct T100 substitution.
- Native calls load log data into session memory. No persistent mutation was found in the inspected
  read chain. Source inspection is not a restricted-user authorization test.

Reading BALHDR/BALDAT directly would need a separately documented table-access security contract;
it cannot promise the same log-specific checks and rendering behavior.

## Verified request contract

1. `ApplicationLogOverviewSet?$filter=LogNumber eq '<20 digits>'&$top=2&$format=json`.
2. Require exactly one matching number; use its returned opaque `LogHandle` in
   `ApplicationLogOverviewSet('<escaped handle>')/ApplicationLogMessageSet` with positive `$top`,
   `$skip`, and `$format=json`.

Direct message filtering by `LogNumber` failed with HTTP 400: the message metadata does not expose
that property, even though native provider source contains a branch for it. A numeric log number
is also not the entity's handle. Both overview and header navigation worked with a real handle.
Unknown-handle navigation returned HTTP 200 with an empty collection, so an empty message response
alone cannot establish whether a log exists. The reader first resolves visibility through overview.

No visible overview match returns `not_found_or_not_visible`. Native 401/403/404/500 failures remain
errors. A successful empty message page is distinct. Unexpected identities, duplicate message
numbers, malformed responses and oversized pages are refused. Next links are never followed.

## Bounds and qualification limits

- Existing data-preview opt-in, caller `data` scope, deny actions and per-user client apply.
- Two GETs share the existing result-admission lease, cumulative byte budget and a 30-second deadline.
- Default 50 messages, maximum 100; one extra message detects continuation. Offset ceiling 5000.
- Native `$top=0` means unlimited and is never emitted. SAP still loads the selected log before
  paging; the client deadline and returned row limit do not bound all SAP-side computation.
- No standalone `/$count`: the inspected native count shortcut precedes the normal header check.
  No text search: native search can render the entire log despite paging.
- Any configured table blocklist hides the action and refuses calls before SAP access. The opaque service can use
  exits/custom persistence, so its complete table lineage cannot be proven.
- No cross-request cache, transactional snapshot, automatic details/long-text loading, log discovery,
  or BTP ABAP support. Message timestamp strings retain SAP's OData representation.
- Audit sinks redact log arguments, native URL keys/filters and response payloads.

Live probes on 2026-10-18:

| Target | Result |
| --- | --- |
| 7.58 | Expanded public `data`-scoped reads matched 4,527 native message projections across 35 logs / 11 object-subobject families. All 59 paging/end/ceiling checks passed, including five empty logs and offset 5000 in a 12,920-message log. This is bounded sampling, not a full read of the largest log. |
| 8.16 SP01 | Metadata returned 403 with Gateway `/IWFND/MED/170` (service not found). Backend registration exists, but the frontend registration is absent. No positive application-log read qualification. |
| 7.50 SP02 | Metadata returned the same service-not-found error; the accessible Gateway catalog contains no matching service. Provider classes exist, but table preview returned 404, so registration tables could not be checked. No positive application-log read qualification. |

The expanded sample includes Gateway runtime errors, Fiori repository logs, master-data updates,
SPAU, ATC, repository/content activation, archives and CTS. Message types E/W/I/S were present;
the first pages contained 185 long-text and 301 detail availability flags (bodies were not read).
Eight English/German pairs matched SAP's rendering for 67 messages: 25 texts changed with language,
and 23 German messages contained non-ASCII characters. Technical/free text may remain untranslated.

A separate repeatable integration run passed for nine families: 991 messages read completely in
default-size pages, plus page sizes 1/2/100 and exact-end/beyond-end checks. Real HTTP probes also
verified cumulative byte-limit rejection, cancellation during a native GET and queued admission,
and successful reads after each failure. No reader defect was found in these runs.

The reader probes were read-only; private responses and SAP source remain outside the repository.
Public-tool checks preserved native errors without a table/RFC fallback. Most comparisons use native
HeaderSet navigation; the independent SLG1 and restricted-user checks below add bounded coverage.
PP, BTP ABAP, additional active-service releases, non-Latin text and exception-specific rendering
remain unqualified; no universal compatibility claim.

### Service setup and restricted-user follow-up

On 8.16, `/IWBEP/I_MGW_SRH` contains version 0001 of the service, while `/IWFND/I_MED_SRH`
contains no matching frontend service. On 7.58 both registrations exist. The documented
[Gateway catalog](https://help.sap.com/saphelp_em92/helpdata/en/7c/a326519eff236ee10000000a445394/content.htm)
returned HTTP 200 on all three systems: filtering `ServiceCollection` by the exact service title
returned one entry on 7.58 and none on 8.16/7.50. This supports a service-setup diagnosis, not a
failed `S_APPL_LOG` check. Check registration/routing in `/IWFND/MAINT_SERVICE` and
`/IWBEP/REG_SERVICE` before changing user permissions. No services were activated.

SAP [KBA 2679134](https://me.sap.com/notes/2679134) describes a registration issue for specific
7.50/7.51 support packages; neither tested failing release falls in that range. Its workaround
was not applied. An HTTP 403 alone does not identify an authorization failure.

The follow-up review caught a misleading generic authorization hint on this error. ARC-1 now
recognizes the exact JSON error code on an OData 403 and points to service registration, including
in multi-target error handling. Unit tests cover unrelated codes, malformed bodies and cookie
sessions. Fresh public-tool calls verified the corrected hint on 7.50/8.16 and a successful 7.58
control read. This correction does not enable the missing service or qualify those two releases.

On 2026-10-18, WebGUI SU01/PFCG prepared an existing empty test account on 7.58 with a temporary
role containing only the service's IWSG/IWSV `S_SERVICE` grants and `S_APPL_LOG` activity 03 for
`RSTCO_UT` / `ACT_XPRA_MESS`. Public `data`-scoped calls at `8e4cc6bd` passed this matrix:

| Saved log | Administrator | Restricted account |
| --- | --- | --- |
| Granted object and subobject | Messages returned | Messages returned |
| Same object, another subobject | Messages returned | `not_found_or_not_visible`; no header/messages |
| Another object | Messages returned | `not_found_or_not_visible`; no header/messages |

Calls alternated separate administrator/restricted clients. The existing integration test also
passed as the restricted account for all 150 messages of the allowed log, including page sizes
1/2/50/100 and end-of-log checks. After removing the role assignment, SU01 showed no profiles
and a fresh restricted session received HTTP 403 with no messages. The unused role remains
unassigned; no credentials or service registrations changed. This qualifies these grants and
identities on this system, not principal propagation or every native authorization path.

Independent WebGUI SLG1 spot checks matched a two-error log's complete text/order and a
150-message activation log's total count, first 15 texts/order and long-text availability flags.
The larger log's remaining messages were compared through native HeaderSet, not visually.

To repeat the read-only integration test, configure the usual `TEST_SAP_*` credentials and
`TEST_APPLICATION_LOG_NUMBERS` with 1–10 comma-separated exact numbers. Choose stable saved logs
with at most 200 messages each; include an empty log and different application families. Then run:

```sh
npm run test:integration -- tests/integration/application-log.integration.test.ts
```

The test fails on native errors when fixtures are configured; without numbers it records an explicit
fixture skip. It does not discover logs, create data, enable services, or change authorizations.

Unit coverage checks input/response validation, scope and safety denials, privacy, paging, native
errors, and standard/hyperfocused tool contracts. Nine model-evaluation scenarios cover routing,
missing identity, continuation, authorization failure, SO10 distinction, empty/hidden logs,
the offset ceiling and detail flags. Scripted replay tests validate these contracts; no actual-model
accuracy score is claimed.

## Generic cluster proposal

Focused review of #844 at `d27d7cab0bfbf87cbda8e83a783427d42cf3dcca` reproduced unbounded inflate,
row-count allocation amplification, a large-Unicode-string conversion failure, and key collisions
from trimming leading spaces. Other concerns require genuine kernel fixtures: byte order/code-page
coverage, legacy numeric scale, current DDIC layouts versus historical exports, and fragment errors.
The native log reader avoids importing that parser. FEAT-89 retains the useful unfinished scope;
FEAT-88 covers wider native-log functionality and qualification.

Test invitations were posted to [#1000](https://github.com/arc-mcp/arc-1/issues/1000#issuecomment-6241918322)
and [#844](https://github.com/arc-mcp/arc-1/pull/844#issuecomment-6241918732) for the already merged
stored-text feature. Neither invitation describes an unreleased build as an npm release.
