# Compare Projects

Evaluate all competing SAP ADT/MCP projects against ARC-1 for new features, bug fixes, and patterns to adopt.

## Instructions

For each project in the `docs/compare/` folder, perform the following checks:

### 1. Check Recent Activity
For each repository, fetch the latest commits and releases:
- https://github.com/oisee/vibing-steampunk (upstream Go)
- https://github.com/mario-andreschak/mcp-abap-abap-adt-api (abap-adt-api wrapper)
- https://github.com/mario-andreschak/mcp-abap-adt (read-only)
- https://github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer (AWS)
- https://github.com/fr0ster/mcp-abap-adt (monorepo, advanced auth)
- https://github.com/lemaiwo/btp-sap-odata-to-mcp-server (OData bridge)
- https://github.com/DassianInc/dassian-adt (elicitation-heavy)

Use `gh api repos/{owner}/{repo}/commits?per_page=10` and `gh api repos/{owner}/{repo}/releases?per_page=3` to get recent changes.

### 2. Evaluate Each New Commit/Release
For each new change since the last update (check the `_Last updated` date in each file):

1. **Is it a bug fix?** → Check if ARC-1 has the same bug
2. **Is it a new feature?** → Evaluate:
   - Does ARC-1 need this feature?
   - Should it go in ARC-1 or mcp-sap-docs?
   - What's the effort estimate?
   - What's the priority?
3. **Is it a pattern improvement?** → Review if ARC-1's implementation can benefit

### 3. Update Documents
For each project document (`docs/compare/01-*.md` through `docs/compare/07-*.md`):
- Update the `## Changelog & Relevance Tracker` table with new entries
- Update the `_Last updated` date
- If a new feature was found, add it to the appropriate "Features This Project Has That ARC-1 Lacks" table

### 4. Update Feature Matrix
Update `docs/compare/00-feature-matrix.md` if any project added new capabilities.

### 5. Update Priority Action Items
Review and re-prioritize the action items at the bottom of `00-feature-matrix.md` based on:
- New findings from this scan
- Whether any items have been implemented in ARC-1 since last check
- Changed priority based on ecosystem movement

### 6. Summary Report
Output a concise summary:
- **New findings**: List each new relevant change found
- **Action required**: Items that should be implemented soon
- **No action needed**: Items reviewed but not relevant
- **Status updates**: Previously tracked items that have changed

## Output Format

```
## Compare Projects Scan - [DATE]

### New Findings
- [PROJECT] [COMMIT/RELEASE]: [Description] → [Relevant? Y/N] [Action]

### Action Required
1. [Description] (from [PROJECT]) - Priority: [H/M/L]

### Completed Since Last Scan
- [Item that was in TODO but is now done]

### No Action Needed
- [Items reviewed but not relevant]
```
