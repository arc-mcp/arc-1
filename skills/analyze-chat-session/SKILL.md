---
name: analyze-chat-session
description: Analyze the current conversation's tool calls, responses, errors, and approach to produce a structured feedback report for improving MCP tool usage with ARC-1. Use when the user asks to "analyze this session", "review my chat", "give feedback on tool usage", "how did I do", or wants a retrospective on a debugging session.
---

# Analyze Chat Session

Analyze the current conversation's tool calls, responses, errors, and overall approach to produce a structured feedback report. The goal is continuous improvement of MCP tool usage patterns, prompt strategies, and ARC-1 server capabilities.

**This skill is introspective** — the LLM analyzes its own chat session (the conversation you're currently in, or a referenced one) and generates actionable feedback.

## PRIVACY NOTICE — READ FIRST

**Before using this skill's output outside the current system (e.g., pasting into a GitHub issue, sharing in a chat), the user MUST review it for sensitive data.**

The analysis MUST NOT contain:
- SAP system URLs, hostnames, IP addresses, or ports
- Usernames, passwords, API keys, tokens, or credentials
- Client numbers, system IDs (SID), or environment identifiers
- Real business data (customer names, order numbers, financial values, employee data)
- File paths that reveal internal infrastructure (home directories, mount paths)
- Transport request numbers or package names that reveal internal naming conventions
- Any content from SAP table previews or SQL query results containing business data

**The LLM must actively redact** these from the output, replacing them with generic placeholders like `<SAP_HOST>`, `<USERNAME>`, `<OBJECT_NAME>`, `<TABLE_DATA_REDACTED>`, etc.

After generating the report, remind the user: **"Please review this report for any remaining sensitive information before sharing it outside your organization."**

---

## Smart Defaults (apply silently, do NOT ask)

| Setting | Default | Rationale |
|---|---|---|
| Output format | `issue` (GitHub issue-ready) | Most actionable format |
| Severity filter | All levels | Don't miss anything |
| Focus area | Entire session | Comprehensive analysis |
| Sensitive data | Redact all (see Privacy Notice) | Safe by default |

Proceed immediately with Smart Defaults when triggered. No questions needed.

## Input

The user triggers this skill at any point during (or after) a conversation. No additional input is required — the LLM analyzes the current chat context. Proceed immediately with Smart Defaults.

Optionally, the user may specify:
- **Focus area** — e.g., "focus on the write operations" or "focus on the search failures"
- **Output format** — `issue` (GitHub issue-ready), `internal` (detailed, for internal review), or `summary` (brief, 1 paragraph)
- **Severity filter** — only report issues above a threshold (e.g., "only blockers")

---

## Phase 1: Catalog the Session

Walk through the entire conversation and extract a structured catalog. For each turn, note:

### 1a. Identify the Goal

What was the user trying to accomplish? Categorize it:

| Goal Category | Examples |
|---|---|
| **Read / Explore** | Read source code, understand a class, explore dependencies |
| **Search / Discover** | Find objects by name, search source code, locate implementations |
| **Write / Modify** | Create objects, update source, edit methods, batch operations |
| **Diagnose / Debug** | Syntax check, unit tests, ATC, short dumps, traces |
| **Navigate / Understand** | Find definition, find references, code completion |
| **Query / Data** | Table preview, freestyle SQL, data inspection |
| **Context / Architecture** | Dependency graphs, usage analysis, API contracts |
| **Activate / Deploy** | Activate objects, manage transports |
| **Lint / Quality** | Run linter, fix lint issues, check rules |

### 1b. Catalog Tool Calls

For each MCP tool call in the session, record:

| Field | What to capture |
|---|---|
| **Tool** | Which of the 11 tools was called (SAPRead, SAPSearch, etc.) |
| **Operation** | The specific action/type/include (e.g., `SAPRead type=CLAS format=structured`) |
| **Intent** | What information was the LLM trying to get? |
| **Result** | `success`, `error`, `partial`, `empty`, `redundant` |
| **Error type** | If failed: `not_found`, `auth`, `safety`, `network`, `validation`, `btp_unsupported`, `session`, `other` |
| **Tokens** | Rough estimate: was the response small (< 1KB), medium (1-10KB), or large (> 10KB)? |
| **Necessary?** | Was this call necessary, or could the info have been obtained differently? |

### 1c. Identify Patterns

Look for these anti-patterns:

| Pattern | Description | Impact |
|---|---|---|
| **Shotgun search** | Multiple broad searches before narrowing | Wasted tokens and time |
| **Missing SAPContext** | Reading dependencies one-by-one instead of using SAPContext | 5-10x more calls than needed |
| **Unstructured class read** | Using plain SAPRead for a class instead of `format=structured` | Misses metadata, requires extra calls for includes |
| **Retry without change** | Repeating the same failing call without modifying parameters | Pure waste |
| **Wrong type guess** | Using wrong object type, then searching to find the right one | Could use SAPSearch first |
| **Ignored error hints** | Error response contains a hint (e.g., "use SAPSearch") but LLM didn't follow it | Missed recovery path |
| **Redundant reads** | Reading the same object multiple times in one session | Could cache/reuse from earlier response |
| **Over-fetching** | Reading entire objects when only a method or section was needed | Wasted tokens (use `method` param or `edit_method`) |
| **Missing method listing** | Modifying a class without first getting `method="*"` to understand the API | Blind modifications |
| **Wrong action sequence** | e.g., trying to activate before saving, or writing without reading first | Procedural error |
| **Ignored BTP constraints** | Attempting on-prem-only operations on BTP system | Known limitation, should check `SAPManage features` first |

---

## Phase 2: Assess What Worked

### 2a. Successful Strategies

Identify and highlight things that worked well:

- **Efficient tool selection** — chose the right tool on the first try
- **Good parameter usage** — used `format=structured`, `include=elements`, `method="*"`, etc.
- **Effective error recovery** — followed error hints, switched strategies after failures
- **Context-first approach** — used SAPContext/SAPSearch before diving into reads
- **Batch operations** — used batch_create or batch activate where appropriate
- **Method surgery** — used `edit_method` instead of full class rewrite

### 2b. What Partially Worked

Identify approaches that eventually succeeded but were inefficient:
- How many extra calls were needed?
- What was the corrective action?
- Could the first attempt have succeeded with different parameters?

### 2c. What Failed

Identify approaches that never worked:
- Was the information actually available through a different path?
- Was it a system limitation (BTP, permissions, missing feature)?
- Was it a tool limitation that should be reported?

---

## Phase 3: Generate Improvement Suggestions

### 3a. For the LLM (Prompt/Approach Improvements)

Suggestions the user can feed back into system prompts or skill instructions:

- **Strategy improvements** — "Start with SAPSearch before SAPRead when object type is uncertain"
- **Parameter optimizations** — "Use format=structured for class reads to reduce call count"
- **Sequence improvements** — "Read method listing before attempting method surgery"
- **Recovery patterns** — "When SAPContext fails for FUNC, pass the group= parameter explicitly"

### 3b. For ARC-1 (Server/Tool Improvements)

Suggestions that should become GitHub issues for the ARC-1 project:

| Category | Example |
|---|---|
| **Missing operation** | "No way to read message class text by message number" |
| **Poor error message** | "404 on FUNC doesn't suggest using SAPSearch to find the function group" |
| **Missing parameter** | "SAPRead for DDLS should support reading specific annotations" |
| **Performance** | "SAPContext depth=2 timed out for large dependency graphs" |
| **BTP gap** | "Cannot read service binding details on BTP" |
| **Documentation** | "Tool description doesn't mention that method='*' lists all methods" |
| **Safety false positive** | "Legitimate read operation blocked by safety check" |
| **Caching opportunity** | "Same object read 4 times — server should hint about SAPContext caching" |

### 3c. For the User (Workflow Improvements)

Suggestions for the user's workflow:
- "Provide the object type for live usage lookups to avoid an extra resolution call"
- "Use the explain-abap-code skill first to understand objects before modifying them"
- "Provide object type when possible to avoid search round-trips"

### 3d. Delivery Triage (Quick Wins vs Planned Work)

For every recommendation, classify delivery scope explicitly:

| Bucket | Definition |
|---|---|
| **Quick Win (This Session)** | Low-risk prompt/skill/doc tweak that can be implemented immediately without new backend primitives |
| **Needs Plan + Implementation Phase** | Requires code changes, new ADT integration, schema/tool contract updates, or live SAP regression testing |

Output two lists:
1. **Quick wins to execute now** (ordered by leverage)
2. **Planned items** (grouped into the minimum number of implementation plans)

This triage section is mandatory in `issue` and `internal` outputs.

---

## Phase 4: Produce the Report

### Format: `issue` (Default — GitHub Issue Ready)

Generate a report structured for creating a GitHub issue. Use this template:

```markdown
## Session Analysis: <brief goal description>

### Goal
<1-2 sentences: what the user was trying to accomplish>

### Approach Summary
<3-5 bullet points: high-level steps taken>

### Tool Call Statistics
- Total calls: N
- Successful: N (N%)
- Failed: N (N%)
- Redundant/unnecessary: N (N%)
- Tools used: SAPRead (N), SAPSearch (N), SAPWrite (N), ...

### What Worked Well
- <bullet points of effective strategies>

### What Didn't Work
- <bullet points with error classification>
  - **Error**: <redacted error summary>
  - **Root cause**: <analysis>
  - **Better approach**: <suggestion>

### Suggested ARC-1 Improvements

#### <Improvement 1 Title>
**Category**: Missing operation | Poor error message | Missing parameter | ...
**Severity**: blocker | major | minor | enhancement
**Description**: <what should change and why>
**Reproduction**: <generic steps, NO sensitive data>

#### <Improvement 2 Title>
...

### Delivery Triage
- **Quick Wins (this chat):**
  - <item>
- **Needs Plan + Implementation Phase:**
  - <item>
  - <item>

### Prompt Strategy Recommendations
- <numbered list of approach improvements for future sessions>

---
*Generated by analyze-chat-session skill. **Review for sensitive data before sharing.***
```

### Format: `internal` (Detailed Internal Review)

Same as `issue` but includes:
- Full tool call catalog table (with redacted parameters)
- Token usage estimates per call
- Sequence diagram of the call flow
- Detailed anti-pattern analysis with specific turn references

### Format: `summary` (Brief)

A single paragraph summarizing: goal, outcome, top 2 things that worked, top 2 things that didn't, and the single most impactful improvement suggestion.

---

## Phase 5: Offer Next Steps

After presenting the report, offer:

1. **"Create GitHub issues?"** — For each suggested ARC-1 improvement, offer to draft a GitHub issue body (still requires user review before posting)
2. **"Refine a specific finding?"** — Dive deeper into one particular issue
3. **"Retry the failed approach?"** — If the analysis reveals a better strategy, offer to try it now
4. **"Save as skill feedback?"** — If the analysis reveals patterns that should be encoded in a skill, offer to update the relevant `.claude/commands/*.md` file

---

## Reference: ARC-1 Tool Capabilities Quick Reference

Use this reference to assess whether the LLM used the right tools. This is a concise mapping of common goals to optimal tool usage.

### Read Operations (SAPRead)

| Object Type | Key Parameters | Notes |
|---|---|---|
| CLAS | `format=structured` (metadata+all includes), `method="*"` (list methods), `method="name"` (single method source), `include=testclasses\|definitions\|implementations\|macros` | Always prefer `format=structured` for initial read |
| DDLS | `include=elements` (field listing) | Field list is essential for understanding CDS views |
| FUNC | `group=<FUGR>` (required if not cached), `expand_includes=true` (full group source) | Group resolution is a common failure point |
| SRVB | Returns parsed binding info | Not raw DDL |
| TABLE_CONTENTS | `maxRows`, `sqlFilter` | Data preview — subject to `blockData` safety |

### Search (SAPSearch)
- `searchType=object` — by name/wildcard
- `searchType=source_code` — full-text (may be unavailable on some systems)

### Write Sequence
1. Read first (understand current state)
2. `SAPWrite action=create` or `action=update` or `action=edit_method`
3. `SAPActivate` (single or batch with `objects[]`)
4. `SAPDiagnose action=syntax` or `action=unittest` to verify

### Context & Navigation
- `SAPContext action=deps` — dependency graph (preferred over manual reads)
- `SAPContext action=usages` — live reverse dependencies from SAP
- `SAPNavigate action=definition` — go-to-definition (needs URI + line/col + source)
- `SAPNavigate action=references` — where-used

### Common Error Recovery Paths
| Error | Recovery |
|---|---|
| 404 Not Found | → SAPSearch to verify name/type |
| FUNC without group | → SAPSearch for function name, extract group from result |
| BTP type not supported | → Check BTP_HINTS in error, use equivalent cloud type |
| Source search unavailable | → Use SAPQuery or object search instead |
| SAPContext usages fails | → Use SAPNavigate references as fallback |
| Activation fails | → Read activation error, fix source, retry |
| Lock conflict | → Object locked by another user, wait or use different object |

---

## Error Handling

| Situation | How to Handle |
|---|---|
| Very short session (< 3 tool calls) | Produce a brief summary, note that limited data makes analysis less useful |
| No tool calls in session | Report that no MCP tool usage was detected; suggest this skill is meant for sessions with SAP operations |
| All calls succeeded | Focus the report on efficiency and optimization opportunities |
| All calls failed | Focus on root cause analysis and whether the goal was achievable with current capabilities |
| Mixed results | Full analysis with emphasis on the failure→recovery patterns |
| Session used non-ARC-1 tools | Catalog those separately; focus ARC-1 analysis on the SAP-related calls |

---

## Notes

### When to Use This Skill
- After a complex debugging or development session
- When a new tool pattern was discovered through trial and error
- When multiple approaches failed and you want to document what was learned
- When preparing feedback for ARC-1 improvement
- When onboarding and wanting to capture learning patterns

### What This Skill Does NOT Do
- **No automated issue creation** — it drafts issue content, but the user must review and create
- **No system access** — this skill only reads the chat history, it makes no MCP tool calls
- **No cross-session analysis** — it analyzes one conversation at a time
- **No real-time monitoring** — it's a post-hoc analysis, not a live dashboard
