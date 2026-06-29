# Quickstart

Get ARC-1 talking to your SAP system in five minutes. Zero install, Basic Auth, and a JSON config for your MCP client of choice — Claude Code or GitHub Copilot (VS Code / Eclipse). Using Claude Desktop? See [Install in Claude](install-in-claude.md).

If this path doesn't match you — SSO-only SAP, Docker, BTP, a team server — skip straight to:

- **[Local development](local-development.md)** — full local dev (npx / npm / Docker / git-clone), `.env` patterns, SSO cookie extractor
- **[Deployment](deployment.md)** — multi-user / production (Docker, BTP Cloud Foundry, BTP ABAP)

---

## Prerequisites

- Node.js 22+
- Network access to a SAP system (dev/sandbox ideally)
- A SAP user + password with ADT authorizations

That's it. No global install, no config files.

---

## 1. Verify ARC-1 can reach your SAP

```bash
npx arc-1@latest --url https://your-sap-host:44300 \
                 --user YOUR_USER --password YOUR_PASS \
                 --client 100 \
                 --insecure true   # only for self-signed dev certs; omit on trusted TLS
```

You should see a startup line like:

```
INFO: auth: MCP=[none] SAP=basic (shared)
INFO: ARC-1 MCP server running on stdio
```

Hit `Ctrl+C` to stop. If this failed, check TLS, the client number, and that the user can log into SE80 via the web GUI.

!!! warning "`--insecure` needs an explicit value"
    Pass `--insecure true` (or `--insecure=true`), **not** a bare `--insecure`. The flag takes a value;
    `--insecure` on its own is parsed as *off*, so a self-signed cert still fails with `fetch failed`.
    The same applies to the other boolean flags (`--allow-writes true`, etc.) and to the `SAP_INSECURE=true`
    environment variable.

### If direct ADT HTTP(S) is not reachable

ARC-1 normally connects to SAP's ADT HTTP(S) endpoint. For local systems where Eclipse ADT works through RFC/SAProuter but raw HTTP(S) routing to the ICM port is blocked, run a local ADT-to-RFC bridge and point `SAP_URL` at the bridge instead. One open-source option is [`enricoandreoli/adt-rfc-bridge`](https://github.com/enricoandreoli/adt-rfc-bridge):

```bash
# After starting the bridge on port 8410
SAP_URL=http://127.0.0.1:8410 \
SAP_USER=YOUR_USER SAP_PASSWORD=YOUR_PASS SAP_CLIENT=100 \
ARC1_MAX_CONCURRENT=1 \
npx arc-1@latest
```

This is a local development workaround, not needed for normal deployments. Details and caveats: [Authentication Overview -> Local ADT-to-RFC Bridge](enterprise-auth.md#3-local-adt-to-rfc-bridge-local-rfcsaprouter-workaround).

---

## 2. Wire it into your MCP client

ARC-1 speaks stdio, so every client launches the same `npx arc-1@latest` subprocess — only the **config file and the top-level key differ**. Pick yours below; all three start read-only, and [enabling writes](#enabling-writes-sql-and-data-preview) covers the opt-in flags.

=== "Claude Code"

    Create `.mcp.json` in your project root (commit it to share with your team) — or `~/.claude.json` for user scope. Claude Code uses the `mcpServers` shape:

    ```json
    {
      "mcpServers": {
        "sap": {
          "command": "npx",
          "args": ["-y", "arc-1@latest"],
          "env": {
            "SAP_URL": "https://your-sap-host:44300",
            "SAP_USER": "YOUR_USER",
            "SAP_PASSWORD": "YOUR_PASS",
            "SAP_CLIENT": "100"
          }
        }
      }
    }
    ```

    Or add it from the CLI: `claude mcp add sap --env SAP_URL=… --env SAP_USER=… --env SAP_PASSWORD=… --env SAP_CLIENT=100 -- npx -y arc-1@latest`. Keep secrets out of a committed `.mcp.json` — use user scope or shell env vars.

    !!! tip "Want the SAP skills, or using Claude Desktop?"
        The Claude Code **plugin** bundles this server **and** the 18 SAP skills (RAP, CDS, ABAP Unit, clean-core, UI5) in one install. For that — and for Claude Desktop (`.mcpb` or direct JSON) — see **[Install in Claude](install-in-claude.md)**.

=== "GitHub Copilot — VS Code"

    Create `.vscode/mcp.json` in your workspace (or run **MCP: Open User Configuration** from the Command Palette for a global setup). VS Code uses `servers` — **not** `mcpServers`:

    ```json
    {
      "servers": {
        "sap": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "arc-1@latest"],
          "env": {
            "SAP_URL": "https://your-sap-host:44300",
            "SAP_USER": "YOUR_USER",
            "SAP_PASSWORD": "YOUR_PASS",
            "SAP_CLIENT": "100"
          }
        }
      }
    }
    ```

    Open Copilot Chat, switch the mode selector to **Agent**, and the `SAP*` tools appear in the tools picker (🛠). Manage servers any time with **MCP: List Servers**.

=== "GitHub Copilot — Eclipse"

    Requires Eclipse 2024-03 or later with the latest **GitHub Copilot** plug-in. Click the **GitHub Copilot** status-bar icon → **Edit Preferences** → expand **GitHub Copilot** → **MCP**, paste the config, then **Apply and Close** — it takes effect immediately. Eclipse uses the same `servers` shape as VS Code:

    ```json
    {
      "servers": {
        "sap": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "arc-1@latest"],
          "env": {
            "SAP_URL": "https://your-sap-host:44300",
            "SAP_USER": "YOUR_USER",
            "SAP_PASSWORD": "YOUR_PASS",
            "SAP_CLIENT": "100"
          }
        }
      }
    }
    ```

    Open Copilot Chat in **Agent** mode; the `SAP*` tools become available.

### What you just got — read-only by default

| Capability | Result |
|---|---|
| Writes | Off |
| Freestyle SQL | Off |
| Named table preview | Off |
| Transports / Git writes | Off |
| Package scope | `$TMP` if you later enable writes |

Those four are the minimum. Any ARC-1 setting can live in this `env` block — TLS, request language, caching, rate limits, authentication, and more. For every supported variable, with its default and precedence, see the **[Configuration Reference](configuration-reference.md)** (connection variables under [SAP connection](configuration-reference.md#sap-connection)).

Cursor, Gemini CLI, Goose, and other stdio clients use the same shape — see [local-development.md](local-development.md#mcp-client-configuration).

### Enabling writes, SQL, and data preview

Everything above is read-only. Each capability is a separate positive opt-in — add only the flags you need to the **same `env` block**, on any client. For full local development on a dev/sandbox system you are comfortable modifying:

```json
"SAP_ALLOW_WRITES": "true",
"SAP_ALLOW_DATA_PREVIEW": "true",
"SAP_ALLOW_FREE_SQL": "true",
"SAP_ALLOW_TRANSPORT_WRITES": "true",
"SAP_ALLOWED_PACKAGES": "*"
```

| Capability | Result |
|---|---|
| Writes | On |
| Free SQL | On |
| Named table preview | On |
| Transports | On |
| Package scope | `*` (all packages) |

Want just table preview + SQL while staying read-only? Add only `SAP_ALLOW_DATA_PREVIEW` and `SAP_ALLOW_FREE_SQL`. Full model in [authorization.md](authorization.md#capability-requirements); each flag's default and precedence is in the [Configuration Reference](configuration-reference.md#authorization-and-safety).

---

## 3. Try a read

In your MCP client (Claude Code, or Copilot in **Agent** mode), ask:

> Using the SAP tools, show me the source of report `RSPO0041`.

The assistant should call `SAPRead` and return the ABAP source.

---

## Next steps

- **Your SAP uses SSO (SAML / SPNEGO / X.509)?** Basic Auth won't work. See [local-development.md → SSO-only on-prem](local-development.md#sso-only-on-prem-cookie-extractor).
- **Running on BTP or deploying for a team?** → [deployment.md](deployment.md).
- **Understand the authorization model** → [authorization.md](authorization.md). **Full flag reference** → [configuration-reference.md](configuration-reference.md).
