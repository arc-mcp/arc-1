# sapcli issue #70: parse server errors reported in HTML

- Issue: https://github.com/jfilak/sapcli/issues/70
- State: Closed (2022-10-05)
- Topic: Non-XML SAP error handling (e.g., UCON/forbidden HTML pages)

## What sapcli implemented
When SAP/ICM/UCON returns HTML instead of ADT XML payloads, sapcli now extracts meaningful message text instead of surfacing opaque parser errors.

## ARC-1 relevance
High. ARC-1 already classifies ADT errors well, but HTML fallback normalization improves operator and LLM guidance.

## Suggested ARC-1 action
1. Enhance `AdtApiError`/`formatErrorForLLM` with HTML body extraction heuristics.
2. Add regression tests for representative HTML forbidden/blocked responses.
3. Preserve raw payload snippets only when safe/redacted.
