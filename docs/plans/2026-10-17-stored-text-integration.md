# Classic stored-text integration and model evaluation

## Decision

Expose stored classic SAPscript access as the semantic `SAPQuery(action="long_text")` route with a
nested `longText` request. Its required `mode` is `discover`, `read`, or `search`. Read and search
share one exact-key list (1–25 entries); discovery returns the same `{object,name,id,language}`
objects for direct reuse. The connected client is trusted configuration, never an argument. This
route is authorized by `data` scope and the server data-preview gate/blocklist; it does not accept
SQL. Arbitrary freestyle SQL remains a separate SAPQuery action requiring the `sql` scope and
`SAP_ALLOW_FREE_SQL`. No RFC or installed companion is used.

Options considered:

| Option | Assessment |
|---|---|
| New standalone MCP tool | Adds another tool and duplicates existing intent routing; unnecessary. |
| SAPSearch discovery/content + SAPRead reads | Natural naming, but duplicates the key schema, adds search-specific policy routing and normalizer exceptions, and splits model context. |
| Two SAPRead types for headers and bodies | Viable, but still duplicates fields and needs a separate content-search selector. |
| One SAPQuery semantic action with nested mode | Selected: the SAPQuery family represents data access, while `long_text` keeps SAP text semantics bounded and separate from model-authored SQL. It reuses one exact-key shape and preserves distinct `data`/preview versus `sql`/free-SQL gates. |
| Raw SQL against STXH/STXL + model-side decoding | Makes every model reproduce binary and application semantics and can accidentally require broader SQL access. Rejected. |

Discovery requires a known text object and literal stored-name prefix. It does not invent
business-key mappings. SO10 uses TEXT, but configured document text IDs and composite names must
come from the user/system. Language is an exact internal one-character SAP key; no fallback.
Results distinguish missing, empty, reference failures, unsupported formats and infrastructure errors.
They preserve ITF commands as data, not executable instructions or rendered document content.

## Runtime contract

Promote the previously live-qualified codec/store logic to `src/adt/stored-text/`, retaining manual
research wrappers and independent synthetic SAP fixtures. Keep handler projections small: exact
keys, lines, metadata needed to interpret them, typed failures and recovery hints. Do not return
binary payloads or internal compression details to an LLM.

The request shares the existing data-preview admission/response scope through serialization/audit. Session
limits: 60 seconds, 120 table queries, eight reference hops; batches: 25 keys, 10,000 lines, 2 MiB
of decoded JSON; discovery: 50 headers; phrase search: 50 literal matches within supplied keys.
Headers and terminal bytes are reread for change detection. This is not a transactional snapshot.
BTP is hidden/refused. Endpoint absence is unsupported capability, not missing text; no release-only
assumption turns the observed 750 failure into a claim about every 750 system.

## Model evaluation

Initial prototype evals used the former `SAPRead(type="LONG_TEXT")` surface; they did not test the
final `SAPQuery(action="long_text")` schema/router. The current evals score ordered multi-turn traces,
exact nested arguments, all forbidden calls, and final-answer assertions.
Use actual handler output produced from sanitized SAP-generated synthetic fixtures. Models receive
the real tool definitions, including distractors. No LLM receives private existing-business captures.

Evaluate exact reads, space preservation, discovery-to-read, ambiguity, duplicate/missing batches,
case-sensitive bounded phrase search, SO10 versus repository text elements, unsupported unsaved/archive
requests, and malicious instructions in retrieved text. Include negative cases requiring clarification.
Report model/version, cases, failures, repetitions, and inference settings; do not infer perfect or
universal understanding from finite evals. Refine descriptions based on observed errors, retain
regression cases, and distinguish first-call routing from end-to-end task success.

Design references: [Anthropic tool design](https://www.anthropic.com/engineering/writing-tools-for-agents)
recommends evaluating task-shaped tools and clear descriptions; [agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
emphasizes whole trajectories and outcome grading. [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
defines model-facing input schemas and read-only annotations. These motivate evaluation; measured
results, not the references alone, decide whether this contract is usable.

## Verification

Run core and handler tests, auth/safety/deny/blocklist/cancellation/audit checks, schema snapshots and
budgets, actual local-model evals, and read-only public-dispatch calls on the qualified SAP targets.
Record final counts and limitations in the research report and narrow FEAT-86 to remaining gaps.
