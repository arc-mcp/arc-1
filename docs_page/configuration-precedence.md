# Configuration Precedence

How ARC-1 resolves config values from CLI args, environment variables, `.env` files, and defaults — and what changes when you run via `npx`, a local clone, Docker, or BTP Cloud Foundry.

This page is short on purpose. For the full list of what each env var does, see [configuration-reference.md](configuration-reference.md).

---

## The universal rule

For every config field, ARC-1 looks at four sources in this order and uses the first one that's set:

```
CLI flag   >   process.env   >   .env file (in CWD)   >   built-in default
```

- **CLI flag** — `--allow-writes`, `--port`, etc. Highest precedence. Always wins.
- **`process.env`** — anything already in the running process's environment when ARC-1 starts. This includes shell exports, `docker run -e`, Cloud Foundry env, and the `env` block of an `mcp.json` (because the MCP client launches ARC-1 as a subprocess with that block as its environment).
- **`.env` file** — loaded by [dotenv](https://github.com/motdotla/dotenv) from `process.cwd()` at startup ([src/index.ts:16](https://github.com/marianfoo/arc-1/blob/main/src/index.ts#L16)). **Dotenv never overrides values that are already set in `process.env`** — it only fills in missing keys.
- **Built-in default** — defined in [src/server/config.ts](https://github.com/marianfoo/arc-1/blob/main/src/server/config.ts).

That last point is the one most people miss: if `SAP_URL` is set in your shell and also in `.env`, the shell value wins. Putting something in `.env` doesn't "override" anything — it's a fallback.

---

## What changes per deployment mode

The rule above is universal. What differs across modes is **where `process.env` comes from** and **whether `.env` even exists in the CWD**.

| Mode | `process.env` source | `.env` in CWD? | Practical winner |
|---|---|---|---|
| `npx arc-1` from a shell | shell exports | usually no (CWD is wherever you ran npx, not the package cache) | shell exports > defaults |
| `npx arc-1` launched by an MCP client (stdio) | the client subprocess env (set from the `env` block in mcp.json / claude_desktop_config.json) | no | mcp.json `env` > defaults |
| `npm run dev` / `npm start` from a local clone | shell exports | yes, the repo's `.env` | shell exports > repo `.env` > defaults |
| `node dist/index.js` launched by an MCP client (stdio) | client subprocess env from mcp.json | only if you set the client's `cwd` to a directory that has one | mcp.json `env` > .env in `cwd` (if set) > defaults |
| Remote HTTP — client connects via `"url"` | the **server's** env at startup (set when you launched the server) | the server's CWD | server-side env > server's `.env` > defaults. **Client-side mcp.json `env` does nothing.** |
| `docker run -e KEY=VAL ...` | the `-e` flags + `--env-file` | not in the image; only present if you bind-mount one | `-e` / `--env-file` > defaults |
| BTP Cloud Foundry (`cf push` / `cf deploy`) | `manifest.yml` / `mta.yaml` `properties:` + `cf set-env` + bound services via `VCAP_SERVICES` | not in the droplet; not deployed | manifest/cf-set-env/VCAP > defaults |

### The one that surprises people: HTTP mode

When an MCP client connects to a remote ARC-1 instance over HTTP — i.e. the client config is

```json
{ "servers": { "sap": { "url": "https://arc1.example.com/mcp" } } }
```

— **the `env` block in mcp.json is not sent to the server**. The server is already running with whatever environment was set when it was started (`docker run -e ...`, `cf set-env ...`, or your shell). Only the URL and any auth headers (API key / OAuth token) travel from the client.

If you need to change a config value on a remote ARC-1, change it where the server runs and restart, not in mcp.json.

---

## How to debug "which value am I actually using?"

ARC-1 logs an effective-config summary on startup. The most useful lines are:

```
INFO: auth: MCP=[…] SAP=[…] (shared|per-user) [disable-saml=on?]
INFO: safety: writes=… data=… freeSQL=… transports=… git=… packages=…
```

Each value is recorded with its source (flag / env / .env / default) internally; the `arc1 config show` CLI command (when run with the same args / env as your server) prints the resolved value plus the source for every field. Use it whenever the runtime behaviour disagrees with what you thought `.env` said.

For BTP CF deploys, `cf env <app>` shows you the final environment as the container sees it (manifest values, `cf set-env` values, and `VCAP_*` injected by bound services).

---

## Common pitfalls

- **`.env` not being read.** Dotenv loads from `process.cwd()`. If you `cd /tmp && arc1 …`, the `.env` in your project root is ignored. Either `cd` into the project or use absolute env vars.
- **Shell exports shadowing `.env`.** `export SAP_URL=…` in your `~/.zshrc` will silently win over a `.env` file. Unset the shell variable or change `.env` (or just use the CLI flag for one-off overrides).
- **Quoting glob patterns.** `SAP_ALLOWED_PACKAGES=*` in a shell expands to the contents of the current directory. Use single quotes: `SAP_ALLOWED_PACKAGES='*'` or `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`. Inside `.env` files no extra quoting is needed.
- **Changing mcp.json on a remote server.** As noted above, the `env` block only applies when the client is *spawning* the server. For `url`-based remote connections, change config on the server side.
- **Container `.env` files.** `docker run` doesn't read `.env` from your host. Use `--env-file path/to/.env` or `-e` flags.
- **`ARC1_LOG_HTTP_DEBUG=1` doesn't work.** Most boolean env vars accept either `"true"` or `"1"`, but this one only accepts `"true"` (a known inconsistency — see the note in [configuration-reference.md → Logging and observability](configuration-reference.md#logging-and-observability)).

---

## See also

- [Configuration Reference](configuration-reference.md) — every env var, grouped by purpose, with effects.
- [Local Development](local-development.md) — `.env`, `npm run dev:http`, MCP client configs for local clones.
- [Docker Guide](docker.md) — `-e`, `--env-file`, and CA cert mounts.
- [BTP Cloud Foundry Deployment](phase4-btp-deployment.md) — `mta.yaml` properties, `cf set-env`, `VCAP_SERVICES`.
