# Run ARC-1 locally

Use this page to run ARC-1 from source, configure a local process, or connect to an SSO-only SAP system.
For your first client connection, follow the [Quickstart](quickstart.md).

## Install methods

Use Node.js 22.19 or later for npm and source installations.

| Method | Command | Use it for |
| --- | --- | --- |
| Run the published package | `npx -y arc-1@latest` | A client-managed local process |
| Install globally | `npm install -g arc-1`, then `arc1` | An explicitly installed binary |
| Container | Follow [Docker](docker.md) | Running without local Node.js |
| Source checkout | Follow the steps below | Contributing or testing an unreleased change |

<a id="git-clone-contributing-or-running-from-source"></a>

## Run from source

```bash
git clone https://github.com/arc-mcp/arc-1.git
cd arc-1
npm ci
cp .env.example .env
```

Edit `.env` with your SAP connection, then choose a command:

| Command | Result |
| --- | --- |
| `npm run dev` | Runs TypeScript directly over stdio; restart after changes. |
| `npm run dev:http -- --http-addr 127.0.0.1:3000` | Builds, then starts HTTP on the loopback interface. |
| `npm run build` | Compiles TypeScript and copies bundled assets to `dist/`. |
| `npm start` | Runs the compiled stdio server. |

Before starting HTTP, add `ARC1_API_KEYS=YOUR_RANDOM_KEY:viewer` to your private `.env`, replacing
`YOUR_RANDOM_KEY` with a key from `openssl rand -hex 32`. HTTP requires authentication even on loopback.
The MCP endpoint is `http://127.0.0.1:3000/mcp`. Stdio servers wait for a client on standard input;
use the CLI below if you want a result in the terminal.

## Using a `.env` file

Create `.env` in the directory from which you launch ARC-1:

```dotenv
SAP_URL=https://your-sap-host
SAP_USER=YOUR_USER
SAP_PASSWORD=YOUR_PASSWORD
SAP_CLIENT=100
```

Keep credentials out of version control. All local entry points, including `npx`, load `.env` from
the process's current working directory. A desktop client may start the process in another directory;
set connection values in its server environment if the working directory is uncertain.

<a id="where-do-my-config-values-come-from"></a>

CLI flags override environment variables, which override `.env`, which overrides defaults.
For Docker and BTP, configure the server's environment instead. See
[Configuration precedence](configuration-precedence.md).

## MCP client configuration

Use the [Quickstart](quickstart.md) for the published package or
[Install in Claude](install-in-claude.md) for Claude-specific options.
To use your checkout, build it and point your client at the absolute path to `dist/index.js`:

```json
{
  "mcpServers": {
    "sap-local": {
      "command": "node",
      "args": ["/absolute/path/to/arc-1/dist/index.js"],
      "env": {
        "SAP_URL": "https://your-sap-host",
        "SAP_USER": "YOUR_USER",
        "SAP_PASSWORD": "YOUR_PASSWORD",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

VS Code uses a `servers` wrapper and `"type": "stdio"`; consult your client's MCP settings for its
wrapper. Rebuild and restart the client-managed server after a code change.

<a id="pointing-an-mcp-client-at-a-locally-built-instance"></a>

For the local HTTP server above, a VS Code entry is:

```json
{
  "servers": {
    "sap-local": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer YOUR_RANDOM_KEY" }
    }
  }
}
```

Use the same key as in the server’s `.env`. An HTTP client connects to an existing server. Set SAP credentials and capability flags on that
server, then restart it; an `env` block beside a remote `url` does not configure ARC-1.

## Read-only local UI

Add `--ui --ui-open true` to a local stdio launch:

```bash
npx -y arc-1@latest --ui --ui-open true
```

With connection settings in `.env`, this opens `http://127.0.0.1:8711/ui/` by default.
The UI shows sanitized configuration, auth and feature status, cache metadata, and recent audit events.
It does not show cached source bodies or offer mutation controls.

## Safety flags

Local ARC-1 starts read-only. To allow object changes in `$TMP` on a stdio connection, add:

```dotenv
SAP_ALLOW_WRITES=true
```

For HTTP, the caller also needs a write-capable profile; the Viewer key above stays read-only.
Leave the default package allowlist in place for this first write. Table preview, SQL, transport
mutations, and Git mutations have separate gates. Use the
[capability table](authorization.md#capability-requirements) before enabling them.

## SSO-only on-prem: cookie extractor

For a single developer, ARC-1 can reuse a browser login when on-premise SAP redirects ADT requests
to an SSO page. These cookies identify that developer; use
[per-user authentication](enterprise-auth.md) for a shared deployment.

1. From a source checkout, start the extractor:

    ```bash
    npm run extract-sap-cookies -- --url https://your-sap-host --output ./cookies.txt
    ```

2. Complete the normal SAP login in the Chrome window it opens. The extractor writes the SAP cookies
   to `cookies.txt` with file mode `0600`.
3. Start ARC-1 with the resulting file:

    ```bash
    export SAP_URL=https://your-sap-host
    export SAP_COOKIE_FILE="$PWD/cookies.txt"
    npx -y arc-1@latest
    ```

Repeat the login when the session expires; there is no refresh token. The extractor refuses to run
with `SAP_PP_ENABLED=true`. For BTP ABAP, use [service-key OAuth](btp-abap-environment.md).

## What you get at startup

The startup auth summary reports the active methods, for example:

```text
INFO: auth: MCP=[none] SAP=basic (shared)
```

Use it to check which identity path was selected, then perform a read to verify access.
For failures, see [Authentication](enterprise-auth.md) and [Log analysis](log-analysis.md).

## CLI usage (outside MCP)

From the configured source checkout:

```bash
npm run cli -- search 'ZCL_*'
npm run cli -- source clas ZCL_CUSTOMER
```

Replace `ZCL_CUSTOMER` with an existing class. The CLI uses the same server gates as MCP calls.
See the [CLI reference](cli-guide.md) for output formats and CI commands.

## Check a contribution

```bash
npm run typecheck
npm run lint
npm test
```

Unit tests need no SAP credentials. Integration and E2E tests require a dedicated system;
see [SAP test system](sap-trial-setup.md#integration-tests).
For documentation changes, install `requirements-docs.txt` and run `npm run docs:build`.
