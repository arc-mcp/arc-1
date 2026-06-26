# Update Competitor Commit & Issue Trackers

Fetch new commits and issues from all tracked repos, evaluate relevance to ARC-1, and update all tracking documents.

## Repos to Track

| Repo | Tracker Dir | Comparison Doc | Purpose |
|------|------------|----------------|---------|
| `fr0ster/mcp-abap-adt` | `docs/compare/fr0ster/` | `docs/compare/05-fr0ster-mcp-abap-adt.md` | Competitor analysis |
| `oisee/vibing-steampunk` | `docs/compare/vibing-steampunk/` | `docs/compare/01-vibing-steampunk.md` | Competitor analysis |
| `marcellourbani/abap-adt-api` | `docs/compare/abap-adt-api/` | `docs/compare/02-mcp-abap-abap-adt-api.md` | API implementation reference |

## Instructions

**Run all repos in sequence.** For each repo, follow steps 1–4, then do step 5 (cross-repo updates) once at the end.

---

### 1. Fetch New Commits

Read `docs/compare/<repo>/commits.json` and note the `lastCheckedSha`.

Fetch commits newer than that SHA:
```
/opt/homebrew/bin/gh api "repos/<owner>/<repo>/commits?per_page=100" --jq '.[] | "\(.sha[:7])|\(.commit.author.date[:10])|\(.commit.message | split("\n")[0])"'
```

Stop when you reach the `lastCheckedSha`. If there are no new commits, skip to step 3.

### 2. Triage New Commits

For each new commit:

1. **Auto-skip** these prefixes — no evaluation needed:
   - `chore:`, `docs:`, `ci:`, `test:`, `style:`, `refactor:`, `Merge`, `release:`, version bumps

2. **Evaluate** `feat:` and significant `fix:` commits:
   - Check if ARC-1 already has this feature/fix
   - Assess relevance: does ARC-1's architecture need this?
   - Assign priority: `high` (implement), `medium` (consider), `low` (defer), `skip` (not relevant)
   - Write a decision: `implement`, `consider-future`, `verify`, `defer`, `skip`, `no-action`, `not-applicable`, `keep-current`, `covered-by-X`

3. **Add to commits.json**:
   - Insert new commits into the correct release group (or create a new release group)
   - Update `lastCheckedSha` to the newest commit
   - Update stats counters

4. **Create evaluation files** for high/medium priority items:
   - Path: `docs/compare/<repo>/evaluations/<sha>-<slug>.md` for commits
   - Follow the existing format (Priority, Source, ARC-1 component, What they did, ARC-1 current state, Assessment, Decision)
   - For low/skip items, the JSON entry is sufficient — no separate file needed

### 3. Fetch New Issues

Read `docs/compare/<repo>/issues.json` and check the highest issue number.

Fetch issues newer than that:
```
/opt/homebrew/bin/gh api "repos/<owner>/<repo>/issues?per_page=100&state=all&sort=created&direction=desc" --jq '.[] | select(.pull_request == null) | "\(.number)|\(.state)|\(.created_at[:10])|\(.title)"'
```

Also check if any previously open issues have been closed.

### 4. Evaluate New Issues

For each new issue:
1. Is it a bug report? → Check if ARC-1 has the same bug
2. Is it a feature request? → Evaluate relevance and priority
3. Is it a user help request? → Usually skip, but note if it reveals UX gaps
4. Create evaluation file for medium+ priority issues

Add to `issues.json` with status, priority, relevance, and evaluationFile.

### 5. Update All Documents (once, after both repos)

**Per-repo overview** (`docs/compare/<repo>/overview.md`):
- Update stats table
- Update priority summary if new high/medium items found
- Update `_Last updated` date

**Per-repo comparison doc** (`docs/compare/01-vibing-steampunk.md` or `docs/compare/05-fr0ster-mcp-abap-adt.md`):
- Update version/release count in header
- Add new entries to `## Changelog & Relevance Tracker` table
- Update feature gap tables if new features found or ARC-1 closes gaps
- Update `_Last updated` date

**Feature matrix** (`docs/compare/00-feature-matrix.md`, if needed):
- Update columns if new capabilities added
- Update version references
- Add corrections to the corrections table if anything changed
- Update Priority Action Items if new items or completions
- Update `_Last updated` date

### 6. Summary Report

Output a concise summary for **all repos**:

```
## Competitor Tracker Update — [DATE]

### fr0ster/mcp-abap-adt
- New Commits: [count] ([count] feat, [count] fix, [count] skipped)
- New Issues: [count]
- High priority: [list or "none"]
- Medium priority: [list or "none"]

### oisee/vibing-steampunk
- New Commits: [count] ([count] feat, [count] fix, [count] skipped)
- New Issues: [count]
- High priority: [list or "none"]
- Medium priority: [list or "none"]

### marcellourbani/abap-adt-api (API reference)
- New Commits: [count] ([count] feat, [count] fix, [count] skipped)
- New Issues: [count]
- New ADT API patterns: [list or "none"]

### Cross-repo patterns
- [Any shared issues, e.g. both repos hitting same SAP bug]

### Documents Updated
- [list of files updated]
```

## Key Rules

- **Never create evaluation files for skip/no-action items** — the JSON entry is enough
- **Group related commits** into a single evaluation (e.g., all TLS commits → one file)
- **Cross-reference between repos** — if both repos hit the same SAP issue, note it in both evaluations
- **Cross-reference with the feature matrix** — if a new commit addresses a tracked item, update both
- **Be honest about ARC-1's architecture differences** — not everything competitors do is relevant to an intent-based 11-tool system
- **Use `/opt/homebrew/bin/gh api`** — the `gh` binary is not in default PATH
- **Quote URLs in shell** — zsh expands `?` in unquoted strings
