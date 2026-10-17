# Verified diagnostic improvements

## Scope and acceptance

Stack on policy draft #1010. Upstream main `041a9e48` includes #1006, #1007 and release 1.6.0;
none adds these features. Preserve all single-object behavior, SQL/data gates and the multi-target mutation ceiling.

| Stage | Small implementation | Evidence needed before a pass |
|---|---|---|
| SYN-01 / FEAT-69 | Native checkObjectList, 1–20 explicit CLAS/PROG/INTF/DDLS objects; shared handler for SAPRead SYNTAX and SAPDiagnose syntax | Exactly one processed recognized report per requested URI; unknown, duplicate, missing or unowned evidence stays incomplete |
| FEED-01 / FEAT-74 | Target-advertised dumps schema plus at most eight typed conjunctive filters | Unique advertised attribute/operator contract, validated operand count/type, no grammar delimiters; retain user/from/to and existing pagination |
| DDIC-01 / FEAT-71 | GET the existing object's advertised canonical activation-log relation | Verified metadata identity and one safe relation; bounded hierarchy, explicit unsupported/denied/unavailable, retrieval time separate from unknown activation time |
| Historical research | Inspect pilot-prioritized Dictionary/text/FUGR history | Two differing historical payloads and ownership before any adapter; no current-versus-current substitutes |

## Plan review

- Reuse existing syntax result parsing, object URL normalization, HTTP deadlines/byte limits and
  feed pagination. No package fan-out, retry fallback per object, new SQL or activation.
- The prototype exposes batch syntax only through SAPDiagnose; the maintained preferred SAPRead
  SYNTAX route needs the same bounded input and shared result contract.
- The prototype can ignore a foreign reporter or unrequested empty report. Regression tests must
  fail before fixing attribution. A successful requested report cannot conceal other evidence.
- Feed schema ambiguity must fail closed. This release supports the observed AND grammar only;
  no speculative quoting, nested expression trees, arbitrary feed paths or shared schema cache.
- DDIC logs remain observations. Do not reactivate an object to produce evidence or claim the log
  belongs to the latest attempt. Preserve truncation and unknown severity rather than inferring success.
- Read only existing authorized test objects. Query a deliberately nonmatching dump filter to
  validate wire grammar without collecting incident content. Keep private raw evidence local.

## Test and review loop

1. Bounded read-only live spike on 758; probe advertised support on 750/816 where available.
2. Replay real captures; add regression tests for report ambiguity, malformed schemas, injection,
   byte/time/object limits, cancellation, unsafe links and compatibility with old inputs.
3. Add the schema/handler/policy/tool surfaces together, update snapshots and multi-target docs.
4. Focused and full tests, typecheck/build/lint/policy/schema/file/docs gates; document release and
   identity limitations honestly.
5. Create a draft PR, obtain Claude Opus 5.5 Max GUI review, evaluate findings, correct and retest.

No mutation, deployment, merge or persistent permission change is authorized by this plan.
