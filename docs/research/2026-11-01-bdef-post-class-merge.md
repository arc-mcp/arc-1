# BDEF branch after class PR #1146 merged

Class [PR #1146](https://github.com/arc-mcp/arc-1/pull/1146) merged into main as
`8b795daad8c086fe6f3ac9999208b61ffd151916`. This maintenance incorporates that main
revision into the BDEF branch. **PR #1145 remains open and must not be merged**
without the user's later instruction.

## Conflict resolution

The class implementation had already been incorporated from its original commits,
so main's squash produced 21 textual conflicts. The resolved production tree is
byte-for-byte identical to the previously reviewed and live-qualified BDEF runtime:
`5f8058ccc1b685e0875113e5a9f820d99f47cb234d4f8f822a5475ab661cf664`.

The resolution retains BDEF dispatch/schema/fixtures and the shared native-relation
predicate and sink checks, including hyperfocused `SAP.navigate` denial. That guard
covers main's class-only check while retaining independent class hooks. All five
new upstream denial cases are adopted verbatim. The current upstream class evidence
is preserved, including its additional MCP observations; no old evidence key was
changed. Class/ENHO docs now include upstream's exact active revision, identity,
canonical content URI and INCL/VERSIONS/VERSION_SOURCE requirements, with links to
the later combined runtime qualification.

## Validation and review

- **419 unit files / 11,330 tests passed** on Node 24.11.1, four workers.
  Typecheck, lint, action policy, build and size/schema gates pass. The standard-full
  tool schema remains 74,945/75,000 bytes.
- Claude Code's immutable-snapshot merge-resolution review found **no actionable
  findings**. It noted that low-level guard calls lacked direct tests.
- Four additional cases now call the native provider directly: standard and
  hyperfocused denials reject root metadata reads and both WUL/EXTED_OBJ POST paths
  with no HTTP sends. The focused three-file cohort passes **100 tests**.
- An isolated archive with both guard calls removed makes all four new tests fail
  because the calls unexpectedly resolve. The working-tree runtime was never
  modified. This verifies the tests detect missing guards rather than incidental
  mock/protocol failures.
- The focused review of those four cases also reports **no actionable findings**.
  Both reviews used Read/Grep/Glob only and stayed inside immutable snapshots.
  Reviewed file/patch hashes are checked against the staged and committed content;
  adopted upstream files are compared directly against main's Git blobs.

The [prior full CI](https://github.com/arc-mcp/arc-1/actions/runs/41307042748) on
`feb0e4e28` completed with both Node jobs green, **160 E2E passes / 0 failures /
11 skips**, and **281 integration passes / 1 failure / 117 skips**. All 15 cache
cases and both on-prem BDEF cases passed. The sole failure remains
[#1057](https://github.com/arc-mcp/arc-1/issues/1057): both native HTTP 200 responses
omitted the consumer while returning root/scaffolding references. This is not a
claim that all native result arrays were empty or that index lag is the cause.
The first attempt's integration/E2E artifacts and diagnostics are retained. GitHub
rejected the attempted rerun while E2E was active; no unchanged retry was started.
The superseding maintenance commit needs its own full CI.

The earlier nine BTP 920 cases and 15 cache cases on each 758/816 target apply to
this identical production tree. They were not re-executed after this maintenance.
See [qualification and scope](2026-11-01-cache-fixture-and-btp-requalification.md).
Deployed CF/principal propagation, positive interface extensions, exhaustive
indexes and runtime applicability remain unqualified. No SAP objects or data were
changed locally in this maintenance. No where-used assertion, fixture, timing,
polling or production retry was changed.

[Machine-readable evidence](2026-11-01-bdef-post-class-merge.json) binds the two
merge parents, reviewed trees, comparisons, test results and prior CI artifacts.
Checked `docs_page/roadmap.md` before and after this change: **No roadmap impact**;
FEAT-03 enhancement authoring remains unchanged.
