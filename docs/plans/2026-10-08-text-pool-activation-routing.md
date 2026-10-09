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

Merge preparation: include main `3fc533ab2`, which contains #952's program-delete guard.
Together with #946, this completes the reported program workflow in #940.
Roadmap impact: narrow COMPAT-12 to unverified cross-user deletion; keep FEAT-81's
function-group gap and FEAT-34's translation scope.
Move fixture cleanup into test-finished hooks so cleanup errors preserve the test failure.
