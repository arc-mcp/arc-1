# SAPLint

Check or format ABAP source. Lint runs locally; SAP formatting calls the connected system. For
server-side syntax checks, ATC, and unit tests, use [SAPDiagnose](sap-diagnose.md).

```text
SAPLint(action="lint", source="REPORT zexample.\nWRITE 'Hello'.")
```

In multi-target v1, only the offline `lint`, `lint_and_fix`, and `list_rules` actions are listed and
accepted. `format` and formatter-settings actions contact or modify SAP and remain unavailable.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `lint`, `lint_and_fix`, `list_rules`, `format`, `get_formatter_settings`, or `set_formatter_settings` |
| `source` | string | No | ABAP source code (for `lint`, `lint_and_fix`, and `format`) |
| `name` | string | No | Object name (used for filename detection) |
| `indentation` | boolean | No | PrettyPrinter indentation toggle (for `set_formatter_settings`) |
| `style` | string | No | PrettyPrinter keyword style: `keywordUpper`, `keywordLower`, `keywordAuto`, or `none` (for `set_formatter_settings`) |
| `rules` | object | No | Rule overrides: `{ "rule_name": false }` to disable, `{ "rule_name": { "severity": "Warning" } }` to configure |

## Actions

- **`lint`** — Check ABAP source for issues. Returns errors and warnings with line/column positions.
- **`lint_and_fix`** — Lint + auto-fix all fixable issues (keyword case, obsolete statements, etc.). Returns the fixed source code alongside remaining unfixable issues.
- **`list_rules`** — List all available rules with current config (preset, enabled/disabled status, severity). No source needed.
- **`format`** — Pretty-print ABAP source via SAP ADT PrettyPrinter using the SAP system's global formatter settings. Returns formatted source text.
- **`get_formatter_settings`** — Read SAP global PrettyPrinter settings (indentation + keyword style).
- **`set_formatter_settings`** — Update SAP global PrettyPrinter settings. Provide at least one of `indentation` or `style`. Requires `write` scope and `SAP_ALLOW_WRITES=true`.

## System-Aware Presets

The lint rules auto-configure based on the detected SAP system:
- **BTP/Cloud**: `cloud_types` (Error), `strict_sql` (Error), `obsolete_statement` (Error) — enforces ABAP Cloud constraints
- **On-premise**: `cloud_types` (disabled), `obsolete_statement` (Warning) — more relaxed, allows classic ABAP

## Pre-Write Validation

When `--lint-before-write` is enabled (default: true), SAPWrite automatically runs a strict subset of lint rules before writing to SAP. Parser errors and cloud violations block the write within the supported grammar. For releases beyond
abaplint's grammar ceiling (currently 758), parser errors become warnings; use SAP-side syntax checks
and activation for that newer syntax. Style issues never block writes.

## Custom Configuration

Use `--abaplint-config /path/to/abaplint.jsonc` to load custom rules. The file uses the [abaplint config format](https://abaplint.org):

```jsonc
{
  // Override specific rules
  "rules": {
    "line_length": { "severity": "Error", "length": 80 },
    "abapdoc": true,           // re-enable a disabled rule
    "obsolete_statement": false // disable a rule
  },
  // Optional: override syntax version
  "syntax": { "version": "v757" }
}
```

Rules from the config file are merged on top of the auto-detected preset (cloud/on-prem). Per-call overrides via the `rules` parameter take precedence over the config file.

## Response shapes

- **`lint`** returns: `[{ rule, message, line, column, endLine, endColumn, severity }]`
- **`lint_and_fix`** returns: `{ fixedSource, appliedFixes, fixedRules, remainingIssues }` — use `fixedSource` as the corrected code
- **`list_rules`** returns: `{ preset, abapVersion, enabledRules, disabledRules, rules }` — shows active config
- **`format`** returns: plain text (formatted ABAP source)
- **`get_formatter_settings`** returns: `{ indentation, style }`
- **`set_formatter_settings`** returns: `{ indentation, style }` (effective merged settings)

## Examples

```
SAPLint(action="lint", source="DATA lv_test TYPE string.\nlv_test = 'hello'.")
SAPLint(action="lint_and_fix", source="data lv_x type i.\nadd 1 to lv_x.", name="ZCL_TEST")
SAPLint(action="list_rules")
SAPLint(action="format", source="report ztest. data lv type string.")
SAPLint(action="get_formatter_settings")
SAPLint(action="set_formatter_settings", style="keywordLower")
SAPLint(action="lint", source="...", rules={"line_length": {"severity": "Error", "length": 80}})
```

[All tools](../tools.md)
