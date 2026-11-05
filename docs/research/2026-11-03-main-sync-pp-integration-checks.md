# Main synchronization and current PP integration checks

Exact source `22905a20800cfde138d887921f09181abfd2b705` merges main `61126376971b18407fe25b069ecbcaa234654b01` into the reviewed pinned-write candidate. It includes upstream MCP parsed-body/compression protections, standalone runtime checks and release1.10.0 metadata, plus the current PP qualifier.

All **287 tests across 11 focused suites** passed: MCP HTTP body admission/encoding/limits, pinned/aggregate routes and destinations, target authorization, current PP workflows/native readers/harness controls, and standalone-policy/workflow checks. All three TypeScript projects, lint, policy, file/schema budgets, production build and strict documentation build passed. The final verifier confirmed all **4,912** archived files unchanged. Full-suite results from earlier revisions remain earlier evidence and were not relabeled as rerun here.

The process/worker guards reported zero external socket attempts, two legacy startup dotenv attempts blocked before content, and ten permitted inspected TSX loader IPC uses. No SAP/BTP/CF/ARC1 credential environment variable names were present in the execution environment. Tests used the immutable source archive with envDir:false; no native calls, credentials, deployment or permission changes occurred. Standalone policy tests do not claim that a standalone executable was built or smoke-tested on this host.

Commands, exit records, logs and immutable source: `/Users/marianzeis/.local/state/arc1-review/pr1142-main-sync-integration-checks-20261103-121545`. This is root integration validation, not a new independent security verdict, native/PP acceptance or merge approval.
