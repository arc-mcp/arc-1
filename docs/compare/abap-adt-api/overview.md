# marcellourbani/abap-adt-api — Commit & Issue Tracker

> Tracking commits and issues from [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) as an **API reference** for ARC-1's ADT implementation. This library is the most complete TypeScript ADT client and shows which endpoints/patterns exist.

_Last updated: 2026-04-27_

## Approach

- **Purpose**: Unlike fr0ster and VSP trackers (competitor analysis), this tracker is about **API implementation reference** — what ADT endpoints exist, how they're called, what parameters they need.
- **Commits**: Tracked from v5.2.0 (2023-11-06) onwards — trace APIs and later additions. Earlier versions are foundational but already known.
- **Issues**: All 18 issues evaluated — some reveal ADT API quirks relevant to ARC-1's implementation.
- **Evaluations**: Focus on ADT endpoints and patterns ARC-1 doesn't yet implement.

## Stats

| Metric | Commits | Issues |
|--------|---------|--------|
| Total | ~115 | 19 |
| Tracked | 53 | 19 |
| Evaluated | 53 | 19 |
| Pending evaluation | 0 | 0 |
| Skipped (not relevant) | 26 | 7 |
| Evaluation files | 11 | 5 |

## API Surface Comparison

This library has **~90 public methods** on its ADTClient class. Here's how ARC-1 coverage maps:

### ✅ ARC-1 Has (implemented differently)
- Object source read/write (getObjectSource, setObjectSource)
- Object structure, search, creation, deletion
- Lock/unlock
- Activation (single + batch)
- Transport management (create, release, list, user transports)
- Syntax check (ABAP + CDS)
- Code completion, find definition, find references
- ATC check run + worklist
- Unit test execution
- Short dumps (feeds/dumps)
- Profiler traces (list, hitlist, dbAccess, statements)
- Node contents (tree browsing)
- CDS view support
- Service binding read
- Table contents / free SQL
- DDIC elements (domains, data elements, structures)

### ⚠️ Partial Coverage
- **Traces**: ARC-1 reads traces but can't create/delete trace configurations
- **ATC**: ARC-1 runs checks and gets worklists but lacks exemption management
- **Debugger**: Not implemented (13 methods in abap-adt-api)
- **DDIC write**: ARC-1 reads DOMA/DTEL; abap-adt-api can write domain/data element properties

### ❌ ARC-1 Lacks
- **Refactoring**: rename (3 methods), extract method (3 methods), change package (2 methods)
- **Fix proposals**: fixProposals + fixEdits (auto-fix from ATC findings)
- **abapGit**: full repo management (10 methods)
- **PrettyPrint**: code formatting + settings
- **Revisions**: source version history
- **ABAP Documentation**: F1 help text
- **Type hierarchy**: OO type hierarchy navigation
- **Inactive objects**: system-wide inactive object list
- **Service binding publish/unpublish**
- **Usage reference snippets**: code context for where-used results
- **Object source versions**: load specific version of source

## Priority Summary

### High Priority (implement in ARC-1)
| Item | Source | ARC-1 Impact |
|------|--------|-------------|
| DDIC domain/data element write | commit 646bb9b | Enables full DDIC management via SAPWrite |
| Fix proposals / auto-fix | API: fixProposals + fixEdits | Auto-fix ATC findings — high value for AI workflows |

### Medium Priority (evaluate)
| Item | Source | ARC-1 Impact |
|------|--------|-------------|
| ABAP documentation (F1) | commit 7d5c653 | GetAbapHelp feature gap |
| Extract method refactoring | commit 460200a | Reduces manual edits — roadmap FEAT-05 |
| Change package refactoring | commit a55c8f8 | Move objects between packages |
| Object source versions | commit d3c6940 | Version comparison / revision history |
| Language attributes on create | commit ffa43d7 | Multi-language object creation |
| ENHO splicing & object enhancements | commit d8c4390 | New "what enhancements affect this PROG/INCL/FUGR" reverse-lookup — extends `SAPRead(type='ENHO', target=...)` |
| Dynpro (screen) metadata access | issue #44 | New SAPRead DYNT action — ADT endpoint at /sap/bc/adt/programs/programs/<PROG>/dynpros |
| Non-native object source retrieval | issue #44 | Fallback endpoint for legacy types (SAP Note 2980930) |
| Stateful session handling | issue #30 | Verify ARC-1 lock/write uses stateful correctly |
| Include lock handling | issue #36 | Verify ARC-1 locks class includes properly |
| runQuery API issue | issue #42 | Verify ARC-1 RunQuery doesn't have same bug |

### Low Priority / No Action
- Logger fixes, TLS fixes, test infrastructure, dependency bumps

## How This Differs from Competitor Trackers

| Aspect | fr0ster / VSP Tracker | abap-adt-api Tracker |
|--------|----------------------|---------------------|
| Purpose | Competitive intelligence | API implementation reference |
| What to track | New features, issues, UX patterns | ADT endpoint patterns, API signatures |
| Action items | "Should ARC-1 build this?" | "How does the ADT endpoint work?" |
| Priority basis | Market positioning | Implementation accuracy |

_When implementing a new ADT endpoint in ARC-1, check this tracker first to see if abap-adt-api has already solved the API pattern._
