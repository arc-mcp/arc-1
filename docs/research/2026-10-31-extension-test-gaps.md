# Extension discovery: test gap audit and BTP qualification

The audit compared the approved stage 4/5 acceptance criteria with the combined tests
at `5f8f0b5a`. Existing tests already covered base preservation, none-mode compatibility,
candidate and source limits, actual sends, streamed decoded bytes, cancellation/deadlines,
mixed providers, malformed/unsafe metadata, denials, cycles, replacements, generated
revision binding and active/inactive separation. No SAP writes or helpers were needed.

## Gaps closed

| Missing evidence | Added check |
|---|---|
| BDEF transport limits through Connectivity | All 21 BDEF real-HTTP scenarios now run through both direct and Connectivity transports, including 401/403/429, CSRF sends, failed/oversized bodies, deadlines and cancellation. |
| Request-local source and allowance isolation at public dispatch | Consecutive calls on the same client re-read a changed candidate and account for their own sends. A second client at the same endpoint still performs its own candidate read and retains a 403 instead of inheriting the first client's source. |
| Modern-release BDEF gates | Exact collection/MIME requirements and public default-summary/base preservation now run on release values 758, 816 and 920. These synthetic cases alone do not qualify a live release. |
| Live BTP | `scripts/smoke-btp-extensions.ts` asserts public base preservation, output/request/response caps, expected positive fixture identities and the separately labelled BDEF body. It distinguishes schema-excluded types and repeats summary after sources. |

At this qualification checkpoint, the source implementation was unchanged from
`5f8f0b5a`. The test/harness commit is
`1836f40780beb014f6ac6f8964efb78caf3ea4bc`. The final full suite passed 404 files /
10,881 tests, including the 69-test focused BDEF run. Typecheck, lint, policy, build and
size/schema gates passed. Lint retains two
pre-existing informational suggestions; standard-full schema size remains 74,964 bytes.

## BTP observations

[Sanitized public results](2026-10-31-extension-btp-public.json) contain 38 observations
at the harness commit above. The system reported **SAP_BASIS 920** through installed
components. Authentication was the existing service key's named-user browser OAuth;
the local Node 24.11.1 checkout called ADT directly over normal verified HTTPS. This
does not qualify a CF deployment, principal propagation or live Cloud Connector route.

| Scenario | Observed result |
|---|---|
| DSH_MEAL and DDTEST_STRU_INCLUDE | Dedicated append identities found; sources preserved include occurrences. DDTEST_VIEW remained unreadable through the TABL reader and counted as one omitted source. |
| FUGR SEEF_ADT_TEST_AUNIT_FUGR1 | Hook identities and nested/replacement sources returned. Explicit expansion reached exactly 20 sends and reported the remaining source omission. |
| FUNC SAPBC_GLOBAL_CANCEL_UPDATE | Selected-source summary returned no identities; sources reported unavailable/not-advertised units. No positive function plug-in claim. |
| CL_OO_ADT_ENHANCED_CLASS | Structural identity CL_OO_ADT_ENHANCED_CLASS1 found independently of hooks. The active enhancement source returned HTTP 403: identity retained, source omitted, no generated-history fallback. |
| CL_SEEF_ADT_TEST_AUNIT_1 | Seven native implementation identities and rendered hook sources returned; summary identity omissions stayed explicit. |
| INTF IF_DSH_ENHANCED_OPTIONS | Exact-context request returned unsupported_context. No positive interface-extension claim. |
| BDEF DEMO_RAP_EXTENSIBLE | Four active authored extensions verified: DEMO_RAP_BASE_EXT_LAYER, DEMO_RAP_EVENT_EXT, DEMO_RAP_EXTEND1 and DEMO_RAP_EXTEND2. Summary checked two and reported two remaining candidates; sources verified all four. |
| PROG and INCL | Excluded by the existing BTP public SAPRead schema; validation rejected both before a base read. No BTP public coverage claim for these types. |

BDEF summary used three sends / 9,260 decoded bytes / 920 ms; sources used five sends /
10,003 bytes / 1,235 ms. The repeated summary used 876 ms and again reported two omitted
candidates. All successful modes preserved their original base block and stayed within
the published limits. These observations use warm capability discovery; timing is not an
SLA and a first/native-provider call can exhaust the two-second summary deadline.

Reproduce on this authorized BTP test system, whose standard fixtures are required:

```sh
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json \
  node --dns-result-order=ipv4first --import tsx scripts/smoke-btp-extensions.ts
```

The harness waits up to ten minutes for startup HTTP 503s, then uses the normal browser
OAuth flow. Output contains hashes, labels and coverage metadata, never source or tokens.
Other release/family combinations, positive interface coverage, generated structural-class
source access on BTP, inactive extension snapshots, runtime switch applicability and
exhaustive WUL coverage remain unqualified. Roadmap checked: no roadmap impact.

The subsequent [Claude Code review and triage](2026-10-31-extension-claude-review.md)
records the repaired provider states, native deny gate, class section normalization and
DDIC comment handling, with additional regression and live verification.
