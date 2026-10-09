# Route explicit program text-pool activation (#940)

Base: `d9a6d483` (includes the text-write fix in #946). `REPT` fell through to
the program-source URI; `PROG/PX` was rejected. Root-cause reproduction, live
metadata and limitations: [REPT evidence](../research/abap-types/types/rept.md).

## Plan

1. Route `PROG/PX` → `REPT` to the program text-pool URI for single and batch activation.
2. Reuse discovery and package guards; validate every batch package before activation.
3. Report `requested` and explain the first PROG activation needed by a new program.
4. Cover routing, gates, errors and cache isolation with regressions that fail on main.
5. Verify live REPOTEXT state, preservation of source drafts and fixture cleanup;
   run the local gates and review the diff.

## Plan review

Pool metadata supplies its package, so reuse the existing activation helper without
an owner resolver or new probes. Preserve source activation, legacy unknown-type
fallbacks and class/function-group aliases. Never automatically activate owner source.

Review follow-up: #940 stays open for the separately reproduced deletion gap.
Roadmap impact: add COMPAT-12; FEAT-34 remains translation beyond text elements.
Move fixture cleanup into test-finished hooks so cleanup errors preserve the test failure.
