# Local Development

Everything for running ARC-1 locally against your own SAP — one developer, one laptop.

Already did the [Quickstart](quickstart.md)? This page is the full toolbox: all install methods, `.env` patterns, MCP client configs, safety profiles, and the cookie extractor for SSO-only on-prem systems.

For multi-user / production deployments see [deployment.md](deployment.md).

---

## Install methods

Pick how you want to install and update ARC-1. The executable has a few limitations listed below.

### npx (zero install)

```bash
npx arc-1@latest --url https://your-sap-host:44300 \
                 --user YOUR_USER --password YOUR_PASS \
                 --client 100
```

npx downloads on first run and caches. `@latest` follows the npm latest tag, which can advance across minor or major releases. Best for trying things out.

Slow startup on Windows? Try the [single-file executable](#windows-setup-and-updates).

### npm install -g (faster startup)

```bash
npm install -g arc-1
arc1 --url https://your-sap-host:44300 --user YOUR_USER --password YOUR_PASS --client 100
```

Startup is ~1s faster than npx. Update with `npm install -g arc-1@latest`.

### Docker (local)

```bash
export ARC1_LOCAL_KEY=$(openssl rand -hex 32)
docker run -d --name arc1 -p 127.0.0.1:8080:8080 \
  -e ARC1_API_KEYS="$ARC1_LOCAL_KEY:admin" \
  -e SAP_URL=https://your-sap-host:44300 \
  -e SAP_USER=YOUR_USER \
  -e SAP_PASSWORD=YOUR_PASS \
  -e SAP_CLIENT=100 \
  ghcr.io/arc-mcp/arc-1:latest
```

Defaults to HTTP Streamable on `:8080`. Connect MCP clients to `http://localhost:8080/mcp` with `Authorization: Bearer <ARC1_LOCAL_KEY value>`. Full Docker reference → [docker.md](docker.md).

For stdio mode inside Docker (Claude Desktop wraps the `docker run` in the MCP config), add `-e SAP_TRANSPORT=stdio` and use `docker run -i --rm` instead of `-d`.

### Single-file executable (no Node.js, no `node_modules`)

Starting with 1.7.0, each [GitHub Release](https://github.com/arc-mcp/arc-1/releases) carries one executable per platform plus `SHA256SUMS.txt`:

| Platform | File |
|---|---|
| Windows x64 | `arc-1-<version>-windows-x64.exe` |
| Linux x64 / arm64 | `arc-1-<version>-linux-x64`, `arc-1-<version>-linux-arm64` |
| macOS Apple Silicon / Intel | `arc-1-<version>-macos-arm64`, `arc-1-<version>-macos-x64` |

On Linux or macOS, replace the filename below with the one you downloaded, then make it executable and run it from that directory:

```bash
chmod +x arc-1-1.7.0-linux-x64
./arc-1-1.7.0-linux-x64 --url https://your-sap-host:44300 --user YOUR_USER --password YOUR_PASS --client 100
```

The npm package installs several thousand files that antivirus scanners inspect on first start; the executable is one file ([#957](https://github.com/arc-mcp/arc-1/issues/957)). It runs the same code on the Node.js runtime it was built with (a [Node SEA](https://nodejs.org/api/single-executable-applications.html)), so behavior matches the npm package apart from these differences:

- **SQLite cache** — the native `better-sqlite3` addon cannot be embedded, so `ARC1_CACHE=sqlite` uses Node's built-in `node:sqlite` (prints an `ExperimentalWarning` on stderr; stdout is unaffected). Cache files use the same schema.
- **Not available** — the read-only local UI (`public/ui`) is not embedded, and `ARC1_PLUGINS` extensions are untested in the executable. Use npm or Docker for those.
- **First start can still be slow** — Windows Defender and similar tools can scan each new executable (~100 MB); startup time depends on your machine and security policy. Windows binaries are not code-signed yet and may be blocked by corporate policy. macOS executables are ad-hoc signed; if Gatekeeper blocks a download, run `xattr -d com.apple.quarantine <file>`.
- **Updating** — download and verify the new file; there is no built-in auto-update. See the [Windows steps](#windows-setup-and-updates) below.

Build one yourself with `npm run build && npm run build:sea` (current platform only; output in `dist-sea/`), then check it with `npm run test:sea-smoke -- dist-sea/<file>`.

#### Windows setup and updates

1. **Download** the Windows x64 `.exe` and `SHA256SUMS.txt` from the **same [official release](https://github.com/arc-mcp/arc-1/releases)**.
2. **Verify** in PowerShell from your download folder. Replace `1.7.0` with your downloaded version:

    ```powershell
    (Get-FileHash .\arc-1-1.7.0-windows-x64.exe -Algorithm SHA256).Hash
    Select-String -Path .\SHA256SUMS.txt -SimpleMatch 'arc-1-1.7.0-windows-x64.exe'
    ```

    The hashes must match, ignoring uppercase/lowercase. If they differ, do not run the file. A checksum detects download corruption; it is not a publisher signature.

3. **Configure** your MCP client. Move and rename the verified file to a stable path, for example `C:\Tools\arc-1\arc-1.exe` (create the folder first). In your existing server entry, replace the `npx` command and remove its `-y` and `arc-1@…` arguments:

    ```json
    {
      "command": "C:\\Tools\\arc-1\\arc-1.exe",
      "args": []
    }
    ```

    This fragment assumes SAP settings are in `env`: keep that existing block. If you use ARC-1 flags such as `--url`, keep them in `args` instead. Restart the client. For a first setup, use the [MCP client configuration](#mcp-client-configuration) below with this command.

4. **Update** by downloading and verifying the next version first. Stop **all clients and ARC-1 processes using this file**, keep the old executable as a backup, replace it at the same path, then restart. If replacement fails, keep using the old file and retry once it is no longer running.

**Automating updates?** Check outside MCP startup so downloads do not delay connections. Verify each download, stage it separately, and replace the executable only when it is stopped. Serialize updates when several clients share the file; leave the working copy intact on failure.

### git clone (contributing or running from source)

For every contribution, check the [idea roadmap](roadmap.md) before starting and before opening or
updating the PR. Record useful deferred work, narrow partially completed ideas, and remove completed
items from both the overview and details in the same PR. State the affected IDs or "No roadmap
impact" in the PR description. This also applies to fixes, documentation, refactors, and research.

For SAP-facing or runtime changes, test through ARC-1 on a real, authorized SAP test system when
possible. Use the [PR template](https://github.com/arc-mcp/arc-1/blob/main/.github/pull_request_template.md)
to record the tested build, SAP release, deployment/authentication route, observed results, and
untested scenarios. If you lack access, explain why and what still needs verification; this does
not prevent you from contributing. Documentation-only changes can mark live testing as N/A.

For contributor tooling (`lint-staged`), use Node.js 22 (22.22.1 or later) or 24; the published package's
runtime minimum remains Node.js 22.19.

```bash
git clone https://github.com/arc-mcp/arc-1.git
cd arc-1
npm ci
cp .env.example .env       # then edit for your SAP system

# Pick one:
npm run dev                # stdio from source; restart after edits
npm run dev:http           # builds + runs HTTP streamable on 0.0.0.0:8080
npm run build && npm start # production-style: compile to dist/, run from there
```

**`npm ci` fails looking for Python or Visual Studio.** An [npm bug](https://github.com/npm/cli/issues/9837)
can run `node-gyp rebuild` for `better-sqlite3` 13 when installing from a lockfile, despite its
bundled prebuilt binaries. This commonly affects Windows machines without the build toolchain.
For this specific failure, skip install scripts for this one install:

```powershell
npm ci --ignore-scripts
npm run build
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log(db.prepare('SELECT 1 AS ok').get()); db.close()"
```

The SQLite check should print `{ ok: 1 }`. If it fails, the workaround is insufficient;
resolve the native-module error before continuing. `--ignore-scripts` skips **all** install
scripts, including Git-hook setup: run `npm run prepare` before committing. Keep this flag
on the affected install command rather than setting it globally. See [#1038](https://github.com/arc-mcp/arc-1/issues/1038)
for the reported Windows environment and results.

| Script | What it does | When to use it |
|---|---|---|
| `npm run dev` | `tsx src/index.ts` — runs from source over stdio. No build step; does not watch files or restart automatically. | Iterating on stdio-mode code; pairing with `node` debugger. |
| `npm run dev:http` | `npm run build && tsx src/index.ts --transport http-streamable` | Iterating on HTTP-mode code; testing OAuth/XSUAA flows; pointing remote MCP clients at your laptop. |
| `npm run build` | `tsc` + copies AFF schemas to `dist/`. | Producing the `dist/index.js` you ship in Docker or invoke as `node dist/index.js`. |
| `npm start` | `node dist/index.js` (assumes you ran `npm run build` first). | Production-equivalent local run; useful when you want to test the same artifact CI publishes. |

All four read `.env` from the repo root (their CWD). CLI flags and shell env vars override `.env` — see [Where do my config values come from?](#where-do-my-config-values-come-from) below.

### Read-only local UI

For Claude Desktop, Claude Code, Cursor, or any stdio client, add `ARC1_UI=local` (or pass `--ui`) to start a loopback browser console next to the MCP subprocess:

```bash
npx arc-1@latest --ui --ui-open true \
  --url https://your-sap-host:44300 \
  --user YOUR_USER --password YOUR_PASS \
  --client 100
```

The sidecar binds to `127.0.0.1:8711` by default and serves `http://127.0.0.1:8711/ui/`. It is read-only: sanitized config, safety/auth state, feature status, cache metadata, and recent sanitized audit events. It never exposes cached ABAP source bodies or mutation controls.

---

## Using a `.env` file

Copy `.env.example` to `.env` and uncomment what you need. Priority is CLI > env > `.env` > defaults.

Minimal `.env` for basic auth:

```bash
SAP_URL=https://your-sap-host:44300
SAP_USER=YOUR_USER
SAP_PASSWORD=YOUR_PASS
SAP_CLIENT=100
SAP_LANGUAGE=EN
```

**The `.env` file loads automatically for `npm run dev`, `npm start`, and the `arc1` CLI.** `npx` also reads `.env` if one exists in its launch directory. Docker requires explicit `--env-file`/`-e` settings or a mounted file.

Full grouped template with every option: see [`.env.example`](https://github.com/arc-mcp/arc-1/blob/main/.env.example). The file is grouped into Layer B (ARC-1 → SAP) and Layer A (MCP Client → ARC-1) blocks with fail-fast rules documented inline.

### Where do my config values come from?

ARC-1 resolves every config field from four sources, in order: **CLI flag > `process.env` > `.env` file (in CWD) > built-in default**. The `.env` file is loaded by dotenv from the running process's CWD and **never overrides values already in `process.env`** — it only fills in missing keys.

What `process.env` contains depends on how you launched ARC-1:

- **`npm run dev` / `npm start` from a shell** — your shell exports + the repo's `.env`. Shell wins over `.env`.
- **`npx arc-1` from an MCP client (stdio)** — the `env` block in your `mcp.json` / `claude_desktop_config.json` becomes the subprocess's environment. Dotenv also checks the subprocess working directory; do not assume which directory your client chooses.
- **Remote HTTP — MCP client connects via `"url"`** — only the server's startup environment matters. Putting `env:` in mcp.json next to a `url:` does **nothing**.
- **Docker / BTP CF** — `-e` flags, `--env-file`, `cf set-env`, manifest properties, and `VCAP_SERVICES`. No `.env` inside containers.

Full per-mode table + debugging tips: [Configuration Precedence](configuration-precedence.md).

---

## MCP client configuration

All MCP clients that speak stdio work the same way — they spawn `npx arc-1` as a subprocess and talk JSON-RPC over stdin/stdout. The `env` block is where credentials and safety flags go, for example `SAP_ALLOW_WRITES`, `SAP_ALLOW_FREE_SQL`, and `SAP_ALLOWED_PACKAGES`.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

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

To keep the same local setup but allow SQL + named table preview while staying read-only, add `"SAP_ALLOW_DATA_PREVIEW": "true", "SAP_ALLOW_FREE_SQL": "true"` inside that same `env` block.

### Claude Code

Project-scoped: create `.mcp.json` in the repo root with the same shape as above. User-scoped: `~/.claude.json` with a `mcpServers` block.

### Cursor

Cursor Settings → MCP — same JSON shape as Claude Desktop.

### VS Code / GitHub Copilot

For local stdio mode in `.vscode/mcp.json`, use `servers` (Claude Desktop uses `mcpServers`):

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

For a long-running local server, first generate `ARC1_LOCAL_KEY` as in the Docker example, then run ARC-1 as an HTTP Streamable server:

```bash
npx arc-1@latest --url https://host:44300 --user dev --password secret \
                 --client 100 --api-keys "$ARC1_LOCAL_KEY:admin" \
                 --transport http-streamable --http-addr 127.0.0.1:3000
```

Then in VS Code MCP settings:

```json
{
  "servers": {
    "sap": { "type": "http", "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer <ARC1_LOCAL_KEY value>" } }
  }
}
```

If you want read-only SQL access in VS Code / Copilot, change the command that starts ARC-1, not the MCP JSON. The JSON only tells VS Code where the already-running server lives:

```bash
SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true \
npx arc-1@latest --url https://host:44300 --user dev --password secret \
                 --client 100 --api-keys "$ARC1_LOCAL_KEY:admin" \
                 --transport http-streamable --http-addr 127.0.0.1:3000
```

> For a local loop, bind to `127.0.0.1` not `0.0.0.0` — stops other machines on the network from hitting your instance. HTTP authentication is required even on loopback; for setup see [api-key-setup.md](api-key-setup.md).

### Gemini CLI / Goose / OpenCode / other stdio clients

Same pattern: spawn `npx -y arc-1@latest` with the same `env` block. Use each client’s configuration syntax; the subprocess command is the same.

### Pointing an MCP client at a locally-built instance

When you're iterating on ARC-1 itself (or just want to skip the npx download), point the client at your local clone instead.

**Stdio against compiled `dist/`** — closest to what the published package does. Run `npm run build` first.

```json
{
  "mcpServers": {
    "sap-local": {
      "command": "node",
      "args": ["/absolute/path/to/arc-1/dist/index.js"],
      "env": {
        "SAP_URL": "https://your-sap-host:44300",
        "SAP_USER": "dev",
        "SAP_PASSWORD": "secret",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

Dotenv reads `.env` from the subprocess CWD, which may differ from the directory containing `dist/index.js`. Pass settings via `env`, or set the working directory if your client supports it.

**Stdio against `tsx` (no build step)** — handy while iterating on source.

```json
{
  "mcpServers": {
    "sap-local": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/arc-1/src/index.ts"],
      "env": { "SAP_URL": "…", "SAP_USER": "…", "SAP_PASSWORD": "…", "SAP_CLIENT": "100" }
    }
  }
}
```

**HTTP against a long-running `npm run dev:http`** — useful for testing OAuth/XSUAA or sharing one instance across multiple clients. Start the server in a terminal:

```bash
cd /path/to/arc-1
ARC1_API_KEYS="$ARC1_LOCAL_KEY:admin" npm run dev:http -- --http-addr 127.0.0.1:3000  # reads .env from repo root
```

Then point any MCP client at the URL:

```json
{
  "servers": {
    "sap-local": { "type": "http", "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer <ARC1_LOCAL_KEY value>" } }
  }
}
```

> For local HTTP loops, bind to `127.0.0.1` (not `0.0.0.0`) so other machines on your network can't hit the instance. HTTP authentication is required even on loopback — see [api-key-setup.md](api-key-setup.md).

In HTTP mode, the `env` block in mcp.json **does nothing** — the server already has its own environment from when you launched `npm run dev:http`. Change config by editing `.env` (or shell-exporting) and restarting the server. Full mode-by-mode breakdown: [Configuration Precedence](configuration-precedence.md).

---

## Safety flags

ARC-1 ships read-only. For local development, enable only what you need via positive-opt-in flags.

### What's blocked by default

| Capability                 | Default | Opt-in flag                           |
|----------------------------|---------|---------------------------------------|
| Object writes              | off     | `SAP_ALLOW_WRITES=true`               |
| Named table preview        | off     | `SAP_ALLOW_DATA_PREVIEW=true`         |
| Freestyle SQL              | off     | `SAP_ALLOW_FREE_SQL=true`             |
| Transport mutations        | off     | `SAP_ALLOW_TRANSPORT_WRITES=true` (also needs `SAP_ALLOW_WRITES=true`) |
| Git mutations              | off     | `SAP_ALLOW_GIT_WRITES=true` (also needs `SAP_ALLOW_WRITES=true`)       |
| Writes to any package       | `$TMP` only | `SAP_ALLOWED_PACKAGES='$TMP,Z*'` (or `*` for any) |

Transport reads (list / get / check / history) and Git reads (list_repos / whoami / branches / ...) work without any opt-in flag — only mutations are gated.
The Git opt-in currently enables gated abapGit workflows and SAP-side Git egress; every gCTS mutation
is quarantined before HTTP. Accepted abapGit mutations without an authoritative postcondition return
error/incomplete, so inspect state before retrying.

### Common local starting points

- **Just explore** (default): no config needed.
- **Table preview + SQL**: `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true`.
- **Developer**: `SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES='$TMP,Z*'` — optionally add `SAP_ALLOW_TRANSPORT_WRITES=true` or `SAP_ALLOW_GIT_WRITES=true`.
- **Full local dev**: all 5 `SAP_ALLOW_*=true` + `SAP_ALLOWED_PACKAGES='*'` (quote the `*` in shell so it isn't expanded to filenames).

For fine-grained blocking even after the above flags are set, use `SAP_DENY_ACTIONS` — e.g. `SAP_DENY_ACTIONS="SAPWrite.delete,SAPManage.flp_*"`. See [authorization.md](authorization.md#advanced-deny-actions).

Full model and per-user scope handling: [authorization.md](authorization.md). Production hardening: [security-guide.md](security-guide.md).

---

## SSO-only on-prem: cookie extractor

> ⚠️ **Developer-only escape hatch.** Single user, short-lived session, never for deployed / shared instances. The script refuses to run if `SAP_PP_ENABLED=true`.

Some corporate on-prem SAP systems return an HTML login page on `/sap/bc/adt/` instead of accepting Basic Auth — typically when SAML2 / SPNEGO / X.509 / Kerberos SSO is enforced. You're expected to authenticate through a browser.

For a single-developer local loop, the included extractor scrapes your existing SAP session cookies from Chrome and writes them to a file ARC-1 can reuse:

```bash
npm run extract-sap-cookies -- --url https://your-sap-host:44300
```

What it does:

1. Launches Chrome with remote-debugging enabled (CDP).
2. You complete your normal SSO login in the browser window (IdP redirect, MFA, whatever your corp flow is).
3. Return to the terminal and press Enter. The script then reads the SAP session cookies (`SAP_SESSIONID_*`, `MYSAPSSO2`, `sap-usercontext`) out of Chrome.
4. Writes them to `cookies.txt` with mode `0600`.

Then point ARC-1 at the cookie file:

```bash
export SAP_URL=https://your-sap-host:44300
export SAP_COOKIE_FILE=$PWD/cookies.txt
npx arc-1@latest
```

Startup log:

```
INFO: auth: MCP=[none] SAP=cookie (shared)
```

### When to use it

- ✅ SSO-only on-prem SAP, solo developer loop.
- ✅ Your IdP enforces MFA / X.509 client certs that can't be scripted.
- ❌ Multi-user / deployed ARC-1 — cookies are one user's session.
- ❌ BTP ABAP Environment — use [service-key OAuth](btp-abap-environment.md).
- ❌ Combined with `SAP_PP_ENABLED=true` — the extractor refuses, and ARC-1 fails at startup unless the explicit escape-hatch `SAP_PP_ALLOW_SHARED_COOKIES=true` is set.

### Limitations

- Cookies expire (usually minutes to hours). Re-run the script to refresh.
- SAP sees whichever user you logged in as, not "the MCP caller" — fine for solo dev, wrong for a shared service.
- No refresh token — you get whatever session the browser has.

For per-user SAP identity with a deployed ARC-1, use a **per-user BTP Destination**: Cloud Connector Principal Propagation for on-premise SAP, or `OAuth2UserTokenExchange` for BTP ABAP Environment. See [deployment.md](deployment.md).

---

## What you get at startup

Every ARC-1 startup prints a one-line auth summary on stderr:

```
INFO: auth: MCP=[none] SAP=basic (shared)
INFO: auth: MCP=[api-key] SAP=cookie (shared)
INFO: auth: MCP=[oidc] SAP=pp (per-user) [disable-saml=on]
```

This line tells you which Layer A / Layer B methods are active. If it disagrees with what you thought you configured, that's the first place to look.

Full auth reference (all methods, combinations, coexistence rules): [enterprise-auth.md](enterprise-auth.md).

---

## CLI usage (outside MCP)

Sometimes you just want to shell-test an ADT endpoint without running the full MCP server:

```bash
# Works off .env
npm run cli -- search ZCL_CUSTOMER
npm run cli -- source clas ZCL_CUSTOMER

# Verbose (shows every HTTP request)
SAP_VERBOSE=true npm run cli -- search ZCL_CUSTOMER
```

Full CLI reference → [cli-guide.md](cli-guide.md).

---

## Next

- **Deploy for a team** → [deployment.md](deployment.md)
- **All flags** → [configuration-reference.md](configuration-reference.md)
- **Where config values come from** → [configuration-precedence.md](configuration-precedence.md)
- **Auth internals and combinations** → [enterprise-auth.md](enterprise-auth.md)
- **Update ARC-1** → [updating.md](updating.md)
