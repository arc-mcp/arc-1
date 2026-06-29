# Install in Claude

ARC-1 plugs into every Claude surface — but *how* you install depends on **which Claude app** you
use and **where the ARC-1 server runs** (locally on your machine, or remotely on BTP Cloud Foundry).
Find your row, then jump to that section.

| You use… | ARC-1 runs… | Install path | Skills included? |
|---|---|---|---|
| **Claude Desktop** | locally (`npx`, your machine) | [One-click `.mcpb` — or hand-edit JSON](#claude-desktop-one-click-mcpb) | — |
| **Claude Code** | locally (`npx`, your machine) | [Plugin](#claude-code-plugin-server-skills) (`/plugin install`) | ✅ all of them |
| **claude.ai / Desktop / mobile / Cowork** | remotely (BTP Cloud Foundry) | [Custom connector](#remote-btp-cloud-foundry-custom-connector) (URL + OAuth) | — |
| **Claude Code** | remotely (BTP Cloud Foundry) | [`claude mcp add --transport http`](#remote-btp-cloud-foundry-custom-connector) | add separately |

!!! info "MCPB is local-only; skills don't live inside it"
    The `.mcpb` bundle and a remote connector both wire up the **tools** only. The 18 SAP
    [skills](skills.md) (RAP, CDS, ABAP Unit, clean-core, UI5 modernization) are a *separate*
    layer. The **Claude Code plugin** is the only artifact that bundles the MCP server **and** the
    skills in one install — so for Claude Code, prefer the plugin.

---

## Claude Desktop — one-click (`.mcpb`)

The simplest path for a single developer on a SAP system reachable from your laptop.

1. Download the latest **`arc-1-<version>.mcpb`** from the
   [Releases page](https://github.com/arc-mcp/arc-1/releases). It is attached to every release
   from the first one after this feature ships; if the newest release has no `.mcpb` yet, build it
   locally per the
   [publishing guide](https://github.com/arc-mcp/arc-1/blob/main/docs/publishing-guide.md#6-claude-desktop-extensions).
2. **Double-click** it, or open Claude Desktop → **Settings → Extensions** and drag the file in.
3. Claude prompts for your SAP connection. **URL, user, and password** are required (the password is
   stored in your OS keychain). The rest are optional and default to the safe choice — client,
   language, TLS, and the **safety toggles** (Allow Writes, the write **package scope**, data preview,
   free SQL, transport and Git writes). Fill them in and enable the extension. Full field list:
   [configuration reference](configuration-reference.md).
4. Ask Claude: *"Using the SAP tools, show me the source of report `RSPO0041`."* — it should call
   `SAPRead`.

!!! note "What the bundle is"
    A pure-JS, cross-platform (macOS / Windows / Linux) build of the stdio server. It uses the
    in-memory cache (the native SQLite cache is intentionally omitted so one bundle runs everywhere).
    Read-only by default — flip **Allow Writes** in the extension's settings to enable mutations
    (writes still land in `$TMP` unless you widen the package scope). For SQLite caching, multi-user,
    or CI use, run the [Docker image](docker.md) or deploy to [BTP](btp-cloud-foundry-deployment.md)
    instead.

### Or hand-edit the JSON directly

Skip the bundle and edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Read-only by default; restart Claude Desktop after editing. To enable writes, SQL, data preview, or
transports, add the `SAP_ALLOW_*` flags to the `env` block — see
[Enabling writes](quickstart.md#enabling-writes-sql-and-data-preview).

---

## Claude Code — plugin (server + skills)

For Claude Code, ARC-1 ships as a single **plugin** from a marketplace hosted in the repo. One
install gives you the **MCP server** *and* every SAP skill.

```text
/plugin marketplace add arc-mcp/arc-1
/plugin install arc-1@arc-1
```

Claude Code prompts for your SAP connection when the plugin is enabled (password → OS keychain),
starts the `arc-1` MCP server via `npx`, and loads the skills namespaced as `/arc-1:<skill>` — e.g.
`/arc-1:generate-rap-service`. Manage it with `/plugin`; run `/reload-plugins` after an update.

??? tip "Just the server, or just the skills"
    - **Only the MCP server** (no skills, no plugin): `claude mcp add arc-1 --env SAP_URL=… --env
      SAP_USER=… --env SAP_PASSWORD=… -- npx -y arc-1` — see the
      [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).
    - **Only the skills** (server already added another way): `npx skills add arc-mcp/arc-1` —
      see the [skills README](https://github.com/arc-mcp/arc-1/tree/main/skills) for the
      cross-agent CLI (Cursor, Copilot, Codex, Gemini CLI, …).

---

## Remote (BTP Cloud Foundry) — custom connector

When ARC-1 is deployed on **BTP Cloud Foundry** (multi-user, per-user SAP identity, XSUAA OAuth),
clients connect to it over HTTP instead of running it locally. There is **no `.mcpb`** for this —
MCPB is local-only. You connect a **custom connector** by URL.

=== "claude.ai / Desktop / mobile / Cowork"

    1. Open **Settings → Connectors → Add custom connector**.
    2. Paste your server URL: `https://<your-cf-app>/mcp`.
    3. Authenticate via OAuth (XSUAA). For most clients ARC-1's Dynamic Client Registration handles
       the rest; if your client asks, supply the OAuth Client ID / Secret under *Advanced settings*.

    !!! warning "The endpoint must be internet-reachable"
        Claude connects to your server **from Anthropic's cloud**, not from your device. The CF
        route is public by design, with XSUAA OAuth + scopes enforcing access — but a server bound
        only to an internal network won't work for these clients.

=== "Claude Code (remote)"

    ```bash
    claude mcp add --transport http arc-1 https://<your-cf-app>/mcp
    ```

    Claude Code opens a browser for the OAuth login. Add the [skills](#claude-code-plugin-server-skills)
    separately with `npx skills add arc-mcp/arc-1`.

**Setting up the deployment** (XSUAA, Destination Service, Cloud Connector, per-user principal
propagation) is covered in [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md),
[XSUAA Setup](xsuaa-setup.md), and [Principal Propagation](principal-propagation-setup.md).

---

## Which path should I choose?

- **Trying ARC-1 solo against a reachable dev system** → Claude Desktop `.mcpb`. Zero config files.
- **Doing ABAP work in Claude Code** → the plugin. You get the skills, which is most of the value.
- **A team, governed access, per-user SAP identity, SSO** → deploy on BTP CF and connect via custom
  connector. Start at [Deployment](deployment.md).
- **SSO-only SAP (SAML / SPNEGO / X.509) with a local install** → Basic Auth won't work; use the
  [cookie extractor](local-development.md#sso-only-on-prem-cookie-extractor).

After connecting, see the [Tools Reference](tools.md), the [MCP Usage Guide](mcp-usage.md), and the
[authorization model](authorization.md) for what each capability needs.
