# MCP tool-schema client compatibility

ARC-1 exposes its tools via MCP `tools/list`, whose `inputSchema` is JSON Schema. But **most MCP
clients do not pass that schema through** — they convert it to their model's function-calling schema
(OpenAI / Anthropic / Gemini / OpenAPI), and those converters accept only a subset of JSON Schema. So
ARC-1's **default visible schemas must stay on a portable lowest-common-denominator subset**, or
whole-server tool loading fails — often silently (see #520).

## The rule

Default tool schemas use only: `type` as a **single** string, `properties`, `required`, `items`,
`enum`, `description`. **Avoid in the default schema:**

| Construct | Why |
|---|---|
| `type: ["x","null"]` (nullable unions) — or any `type` array | Rejected by Copilot IDEs, Gemini CLI, Azure AI Foundry, … → whole server's tools silently dropped (#520) |
| `anyOf` / `oneOf` / `allOf` | Rejected by Azure AI Foundry and others |
| `$ref`, `not`, `patternProperties`, `dependentSchemas` | Inconsistent converter support |

A CI test enforces "no `type: []` arrays in the default tool schemas" (added with the #520 fix, #526).

## Client matrix — nullable `type: ["x","null"]` unions

| Client | Nullable unions | Notes |
|---|---|---|
| GitHub Copilot — Eclipse | ❌ rejects (silent whole-server drop) | #520; upstream `microsoft/copilot-for-eclipse#325` |
| GitHub Copilot — IntelliJ | ❌ rejects | `microsoft/copilot-intellij-feedback#691` |
| GitHub Copilot — VS Code / CLI | ⚠️ same risk class | not separately confirmed |
| Gemini CLI / Code Assist | ❌ rejects | `google-gemini/gemini-cli#21094` |
| Azure AI Foundry Agents | ❌ rejects unions + `anyOf` | per docs |
| Cursor / JetBrains AI | ⚠️ reported issues | not confirmed by us |
| Claude Desktop / Code | ✅ tolerant | Anthropic strict tools still limit unions |
| OpenAI / Azure OpenAI strict mode | ✅ **requires** the `type: [...,"null"]` form | the one case that needs it (#360) |

## ARC-1 mechanism

- `ARC1_SCHEMA_NULLABLE_OPTIONALS=auto|on|off` — default `auto` resolves to portable `off`. `on`
  re-enables nullable unions for OpenAI/Azure strict-mode clients (#360); applied only to `SAPWrite`.
- Runtime `stripLlmEmptyValues` strips `null`-valued optionals before Zod, so strict-mode callers keep
  working even on the portable (`off`) schema.

## When adding or changing a tool schema

Stay on the portable subset above. If a specific client genuinely needs a nullable/union/`anyOf`
shape, gate it behind a config flag (like `ARC1_SCHEMA_NULLABLE_OPTIONALS`) — never make it the default.

## References

- `docs/research/issues/520-copilot-eclipse-nullable-schema.md` (full investigation)
- PRs: #526 (fix), #523 (earlier size-trim — wrong dimension), #363/#360 (why nullable existed)
- Upstream: `microsoft/copilot-for-eclipse#325`
