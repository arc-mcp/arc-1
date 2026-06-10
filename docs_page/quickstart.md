# Quickstart

Get ARC-1 talking to your SAP system in five minutes. Zero install, Basic Auth, Claude Desktop.

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
                 --client 100
```

You should see a startup line like:

```
INFO: auth: MCP=[none] SAP=basic (shared)
INFO: ARC-1 MCP server running on stdio
```

Hit `Ctrl+C` to stop. If this failed, check TLS (`--insecure` for self-signed dev certs), the client number, and that the user can log into SE80 via the web GUI.

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

## 2. Wire it into Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and pick one of the two paths below.

### Path A — read and search only (safe defaults)

No extra config needed. The defaults give read-only access.

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

#### What you just got — read-only by default

| Capability | Result |
|---|---|
| Writes | Off |
| Freestyle SQL | Off |
| Named table preview | Off |
| Transports / Git writes | Off |
| Package scope | `$TMP` if you later enable writes |

Want table preview + SQL added to the read-only setup? Add `"SAP_ALLOW_DATA_PREVIEW": "true"` and `"SAP_ALLOW_FREE_SQL": "true"` to the `env` block above.

### Path B — full local development

Same structure as Path A — only the `env` block changes. Use this only on a dev or sandbox system you are comfortable modifying.

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
        "SAP_CLIENT": "100",
        "SAP_ALLOW_WRITES": "true", "SAP_ALLOW_DATA_PREVIEW": "true", "SAP_ALLOW_FREE_SQL": "true", "SAP_ALLOW_TRANSPORT_WRITES": "true",
        "SAP_ALLOWED_PACKAGES": "*"
      }
    }
  }
}
```

#### What you just got — writes, SQL, data, and transports

| Capability | Result |
|---|---|
| Writes | On |
| Free SQL | On |
| Named table preview | On |
| Transports | On |
| Package scope | `*` (all packages) |

Need something in between? Enable only the flags you need — each capability is a separate positive opt-in. Full model in [authorization.md](authorization.md#capability-requirements).

Restart Claude Desktop after updating the config. The SAP tools (`SAPRead`, `SAPSearch`, etc.) should appear in the tool picker.

Other MCP clients (Claude Code, Cursor, VS Code Copilot, Gemini CLI, Goose): same shape, see [local-development.md](local-development.md#mcp-client-configuration).

---

## 3. Try a read

In Claude Desktop, ask:

> Using the SAP tools, show me the source of report `RSPO0041`.

Claude should call `SAPRead` and return the ABAP source.

---

## Next steps

- **Your SAP uses SSO (SAML / SPNEGO / X.509)?** Basic Auth won't work. See [local-development.md → SSO-only on-prem](local-development.md#sso-only-on-prem-cookie-extractor).
- **Running on BTP or deploying for a team?** → [deployment.md](deployment.md).
- **Understand the authorization model** → [authorization.md](authorization.md). **Full flag reference** → [configuration-reference.md](configuration-reference.md).
