# Automatic extension discovery: integration verification

Implementation and verification of the approved 2026-10-29 plan. No SAP mutations,
SQL, RFC, installed ABAP helpers, merges to main, or releases were performed.

## Review and implementation branches

- Family review: `codex/automatic-extension-bdef`, based on the combined class/source
  prerequisite `6994d2f447a18780871ae27bded04e026cda95e5`, which includes the
  combined public routing at `4f588eaca7261039ebd7372a2b970081c6f5602f`.
- Combined assembly and individually imported family commits:
  `codex/bdef-extension-discovery`.
- Both started from verified origin/main `ac8385fa47b6c40c2c77c6507e03c376bfc3b613`.
  The shared primary checkout was preserved.
- DDIC foundation `67e5703449c133e575d893d3184b531f3725bf2d` and adapter
  `a761b5e2d8a0d4b6654c6bcfb48ec5b166c6ebbf`; source public integration
  `c1fc068447bdc884f206cd3c4468d9f347c8f9eb`; class public integration
  `546ebd1a82fd08989fd014420f1bf6eabbf17694` are preserved as separate predecessor
  changes. The class prerequisite includes the reviewed local PR #1124 fallback
  commit `707e474eb0ae5e2ed86e8b8cb48a5197c083a049`; this does not claim it merged.

## Coverage

| Family | Qualified evidence and remaining boundary |
|---|---|
| DDIC appends | 750/758 dedicated metadata-linked identities, including value-help-only appends; repeated includes/suffixes and key includes preserved. Missing links and anonymous empty responses differ. A4H DDTEST_VIEW child remains unresolved through the TABL reader and is reported as an omitted source. |
| Source plug-ins | Both XML formats replayed. Live PROG on 750; context-sensitive INCL and selected FUNC/FUGR on 758. Nested and replacement edges preserved. FUGR expansion can stop at 20 sends and remains partial. |
| Class enhancements | Independent hook and native EXTED_OBJ providers. 758 structural identity and generated parent/EM001 sources verified; nested graph replay retains seven implementation identities and three replacement edges. 750 native identity discovery is unsupported, while its known generated-source route was read separately. |
| Interfaces | Tested 758 ENV fallback is unsupported_context; tested 750 native provider is unsupported. No positive interface-source claim. |
| BDEF extensions | 758 DEMO_RAP_EXTEND1 and DEMO_RAP_EVENT_EXT verified against active declarations of DEMO_RAP_EXTENSIBLE. At most two summary candidates. 750 is unqualified and makes no optional BDEF reads. WUL remains a candidate index even when all returned candidates are checked. |

The [2026-10-31 follow-up](2026-10-31-extension-test-gaps.md) adds BTP SAP_BASIS 920
qualification for DDIC, FUGR/class hooks, native class identities and four authored BDEF
extensions. It also records BTP schema exclusions, denials and unsupported contexts.
Other release/family combinations, runtime switch applicability, an atomic snapshot,
and exhaustive index coverage are unqualified. CDS/DDLX extensions and BAdIs are excluded.
An empty provider or candidate index never proves global absence.

## Combined checks

The public dispatcher creates one request-local session after the successful base read.
Every family and child uses that same attempt/streaming-byte/deadline allowance. No new
tool or persistent identity/source cache was introduced.

- Full supported source reads default to summary; partial and structured reads default
  to none. Explicit partial requests report owning object/source scope.
- None-mode whole results and the first existing content block remain unchanged.
  Sources are separate labelled bodies; generated revisions stay distinct from authored
  source and rendered plug-ins.
- The mixed-provider real HTTP regression retains seven native class identities after
  a hook HTTP 500, preserves the base, and accounts for all four optional sends once.
- Actual sends include control/auth/CSRF/retry traffic. Error and partial response bodies
  share discovery's aggregate allowance; data-preview defaults remain success-only.
- Direct and Connectivity tests cover sends, streamed bytes, in-flight deadlines,
  cancellation, denials, 401/403/429, malformed/wrong-root/unsafe metadata, source caps,
  nested owners, replacements, active/inactive separation and generated revision binding.
- Generated-history reads enforce INCL, VERSIONS and VERSION_SOURCE denials before
  sending. Known unread class sources are counted once after depth, missing-child or
  terminal stops; the final class follow-up is included.
- Graph edges use the shared cap; sources and summary identities have separate limits.
  Oversized provider summaries retain valid JSON and aggregate status/omission counts.
- Schema fields remain synchronized, and the seven schema snapshot changes were reviewed.
  The standard full tool schema is 74,964 bytes, below its unchanged 75,000-byte ceiling.

| Optional phase cap | Summary | Sources |
|---|---:|---:|
| Time | 2 s | 12 s |
| Actual sends | 6 | 20 |
| Aggregate decoded streamed response bytes | 128 KiB | 256 KiB |
| Identities/nodes | 8 rendered identities | 20 nodes, depth 5 |
| Edges | 32 | 80 |
| Additional output | 2 KiB | 16 KiB |

## Validation checkpoint

Node 24.11.1 with locked dependencies. The family review checkout passed 404 unit
files / 10,854 tests, source/scripts/tests typecheck, lint, validate:policy, build and
check:sizes. Lint has two existing informational suggestions and no errors. The final
formatter-only change was followed by a passing lint run.

The [BDEF public evidence](2026-10-29-bdef-extension-implementation/public-a4h.json)
records identical base hashes for none/summary/sources. Summary used five sends,
4,026 response bytes including control bodies, and 1,301 ms. Sources used three
sends, 3,894 bytes, and 848 ms. This is an observation with warm capability discovery,
not a latency guarantee. Cold discovery can exhaust its own optional allowance.

A [final public rerun](2026-10-29-bdef-extension-implementation/final-public-a4h.json)
at `d7f1491d` rechecked the complete final source tree (SHA-256
`9c3ee9533ac1cf960783936efce3a636243969eb082e653a9b2cff97fe11140e`). All
three modes again preserved the base. Summary verified both extensions in 1,085 ms,
five sends and 4,026 bytes; sources used 746 ms, three sends and 3,894 bytes.

Family evidence and reproduction commands are in the
[DDIC report](2026-10-29-ddic-extension-implementation/README.md),
[source report](2026-10-29-source-plugin-discovery/README.md),
[class contract](../dev/class-extension-discovery.md), and
[BDEF report](2026-10-29-bdef-extension-implementation/README.md).

The tested BDEF feature commit is `18ac603b`; the following evidence-only commit adds
this report. At that checkpoint the combined branch had identical tracked `src/` contents, checked with
`git diff codex/bdef-extension-discovery -- src`. All family implementation dependencies
are integrated locally. Review/merge ordering still depends on the prerequisite branches
and the existing PR #1124 work; no PR was merged or released. No unrelated roadmap entry
was changed; the current roadmap was checked.
