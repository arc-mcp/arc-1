# Class discovery test-gap audit — 2026-10-31

At the initial audit, the implementation was unchanged from `30ddc0bd4c62145fa9e121b8153489eb03a78bc0`
(functional implementation `6994d2f4`). This follow-up adds 17 unit cases and a dedicated,
read-only BTP public-handler integration suite. It does not create or modify SAP fixtures.

## Gaps found and covered

| Missing evidence | Added check |
|---|---|
| Cancellation after a generated content response has begun | Direct and Connectivity loopback transports abort mid-stream, propagate cancellation, release response reservations and perform exactly six sends without a child request. |
| Unsupported native responses alongside working hooks | ENV fallback plus HTTP 404/405/406/501 retain eight hook bodies. |
| Hook denial after native identities were discovered | Preserve seven identities; count seven unread native sources plus the denied hook unit; make no ENHO source fallback reads. |
| Native source boundary outcomes | Valid owner metadata with no body remains unavailable; unsupported XHB source remains explicit; exhausted depth prevents reads; a full node budget omits the generated representation. |
| Public partial/structured behavior | Implementations, macros and testclasses default to none; opt-in reads their selected hooks. A line window preserves its exact base. Unversioned structured payloads never become active extension evidence. |
| BTP public integration and authorization boundary | Five real SAPRead cases, each compared with none mode and checked in summary/sources mode; known main fixture asserts seven ownership edges, three replacements and eight hook bodies. |

The seven focused suites pass **148 tests**. Informational V8 coverage from those suites is
98.33% lines / 90.26% branches for `class-extensions.ts`, 97.77% / 90% for
`enhancement-include.ts`, and 95.45% / 77.58% for the shared `extension-read.ts` wrapper.
The wrapper's other family adapters are outside this focused run. All 39 measured functions
are exercised. Raw per-file counters are in [test-gap-coverage.json](test-gap-coverage.json).
Coverage thresholds and schema budgets are unchanged.

## BTP live qualification

The service was reached through its existing service key and browser OAuth using direct HTTPS,
with writes disabled. Installed components report **SAP_BASIS 920**; this is not the earlier
816 research environment. The final run passes five tests / ten optional-provider observations:

- `CL_ABAP_RANDOM`: original source preserved; native ENV fallback is unsupported context.
- `IF_OO_ADT_CLASSRUN`: original source preserved; native ENV fallback is unsupported context.
- `CL_OO_ADT_ENHANCED_CLASS`: native discovery finds `CL_OO_ADT_ENHANCED_CLASS1` independently
  of hooks. Its authored metadata/source route returns 403 for the current identity. Keep the
  identity and missing-source count; do not use a generated revision fallback.
- `CL_SEEF_ADT_TEST_AUNIT_1` main: seven native ownership edges, three replacement edges and
  eight rendered hook bodies. Its summary reaches the existing node/output bounds and reports
  omissions; sources mode fits within the existing allowance.
- The same class's `definitions`: selected hooks remain separate from main. Native identities
  are retained, while the first ENHO source read returns 403 and all seven pending sources stay
  omitted. No generated fallback or broader identity is used.

The none-mode base blocks are byte-identical to the corresponding summary/sources bases in every
case. Every optional result stays below the existing send, aggregate-byte and output caps.
Sanitized observations, hashes and runtime-file fingerprints are in [btp-public.json](btp-public.json).
They contain no source bodies, credentials, tokens, cookies or user identifiers.

Reproduce with `TEST_BTP_SERVICE_KEY_FILE`, optionally
`TEST_BTP_CLASS_EXTENSION_FIXTURE=CL_OO_ADT_ENHANCED_CLASS,CL_SEEF_ADT_TEST_AUNIT_1` and
`TEST_BTP_CLASS_EXTENSION_OUTPUT=<path>`:

    npx vitest run --config vitest.integration.config.ts tests/integration/class-extensions.btp.integration.test.ts

A browser login may be needed. The two released-object cases run by default; the named structural,
hook and selected-section fixtures are opt-in so their availability is explicit.

## Gate results

- All 17 added unit cases pass; all seven focused suites pass 148 tests with coverage.
- The first full run before the final nine test additions passed 10,796 tests. After those
  additions, the normal full run passed 10,804/10,805 and hit the unchanged shutdown test's
  five-second subprocess-startup wait. The two-worker rerun passed 10,803/10,805 and hit that
  wait plus the unchanged HTTP body-admission test's ten-second timeout. These are failed full
  runs, not an unqualified full-suite pass. Both timing-sensitive suites pass in an isolated one-worker run: 35/35 tests in 3.70s. No unrelated timeout or runtime code was changed.
- Typecheck, lint, policy validation, build and file/schema size gates pass. Lint retains two
  existing informational suggestions. Standard full schema stays at 74,971/75,000 bytes.
- All five BTP live integration cases pass, with no skips or SAP mutations.

## Claude review and corrections

[Claude Code review 1](claude-review-1.md) raised five findings. The runtime corrections:

- Forward the probed release through public ENHO/INCL fallback checks. Tests use the exact 750
  unsupported-technology and 758 null-reference bodies, and reject them for 920.
- Count EIMP and other unqualified real INCLUDE references as missing sources without fetching
  them. Comments/literals remain excluded; only the discovered, same-owner EMnnn path is read.
- Preserve observed hook switch metadata when the same canonical active node already exists.
  Active and provider_current summary observations remain separate: the approved contract keys
  identities by type/name/version and labels unversioned observations without implying active
  coverage. Collapsing those versions would hide that distinction. A regression freezes it.
- Normalize class source-section selection case before discovery.
- Keep the active/draft warning together with revision provenance, and give optional discovery
  the already retrieved fallback body instead of rereading its failed direct route.

The original 98.33% coverage measurement above belongs to the initial audit candidate. After the
corrections, the final full suite passed **10,814 tests** (397 files, four workers, 40.87s). The focused
recheck also passed 85 tests. These clean full runs supersede the earlier timing failures
without changing any unrelated timeout. Required gates also pass.

Read-only live reruns pass all eight public class cases on each A4H 758 and NPL 750 target,
plus explicit ENHO and INCL generated-revision/provenance reads on both. BTP 920 again passes
all five public cases, now also asserting that the switched-off hook's state survives in the
combined active source result. Evidence: `review-fixed-*-public.json` and
`review-fixed-*-legacy.json`. Source hashes identify the corrected runtime. No SAP writes occurred.

## Remaining qualification

Positive interface extensions are still unqualified: tested 758 and 920 return ENV, and NPL 750
has no qualified provider. BTP generated include/child source retrieval is not qualified after the
observed 403; the 750/758 evidence remains separate. BTP principal propagation, multi-target
live routes, other releases, runtime switch applicability and atomic snapshots remain unqualified.
This work does not bypass any of those boundaries to manufacture positive coverage.

Roadmap checked: **No roadmap impact**. FEAT-03 concerns enhancement authoring and stays unchanged.
