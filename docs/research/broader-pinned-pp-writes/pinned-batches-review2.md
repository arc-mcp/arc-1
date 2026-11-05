# Independent batch F1 correction review

Root/Codex fallback, 2026-11-02. Candidate ff03853b1fae7d13133ef2be396de5144758ce81; base ba0f21182871d14b1f072a6dd418e21b0b05fd59. Root authored neither the feature nor the correction. Private integration GO for the feature together with this correction; no native, PP, public-admission or whole-PR approval.

Read the independent feature verdict and author follow-up, inspected the entire two-file correction from Git, and independently ran all 91 pinned batch tests against the clean candidate. `root-independent-batches.log` records the pass. The worktree remained clean. Existing focused legacy/static author checks are identified in result.md, not repeated or presented as root runs.

Object.hasOwn checks the property set retained by schema parsing, avoiding inherited Object.prototype names while retaining normal parsed/defaulted fields. The recursive guard continues checking the complete raw input before mutation. Nine JSON-input regressions cover first and later items plus nested fixed-value rows, and require both an empty native call log and untouched fetch. The retained failing-before log proves the former implementation incorrectly proceeded. No wider authority bypass was demonstrated by the original P3.

The original independently reviewed feature snapshot/verdict remains historical evidence for unchanged implementation. This narrow independent follow-up closes F1; combined-primary integration checks remain required. No source edit, dependency installation, credentials, SAP/native request or deployment occurred in this review.
