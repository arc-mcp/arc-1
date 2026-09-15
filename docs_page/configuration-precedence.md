# Configuration Precedence

If a setting has no effect, inspect the configuration of the running server. Values in an HTTP client configuration do not change the remote server.

## The universal rule

ARC-1 uses the first configured value in this order:

```
CLI flag   >   process.env   >   .env file (in CWD)   >   built-in default
```

Environment values include shell exports, container variables and MCP subprocess `env` entries.
Dotenv reads `.env` from the process working directory and fills only missing environment values.
For example, an exported `SAP_URL` wins over the same setting in `.env`.

## What changes per deployment mode

The rule above is universal. What differs across modes is **where `process.env` comes from** and **whether `.env` even exists in the CWD**.

| Deployment | Set process variables in | `.env` lookup |
|---|---|---|
| Local `arc1`, `npx`, source checkout | Shell exports | Current working directory, if a file exists |
| MCP client starts a local subprocess | Client's `env` block | Subprocess working directory, if a file exists |
| Client connects to remote HTTP URL | Running server's deployment configuration | Server's working directory |
| Docker | `-e` or `--env-file` | Only if a file is mounted into the container's working directory |
| BTP Cloud Foundry | MTA/manifest, `cf set-env`, service bindings | Repository `.env` files are excluded from shipped artifacts |

### The one that surprises people: HTTP mode

An MCP client configured with `"url": "https://arc1.example.com/mcp"` sends requests to an existing server.
Its local `env` block is not sent. Change the remote server's configuration and restart it.

## How to debug "which value am I actually using?"

ARC-1 logs an effective-config summary on startup. The most useful lines are:

```
INFO: auth: MCP=[…] SAP=[…] (shared|per-user) [disable-saml=on?]
INFO: safety: writes=… data=… freeSQL=… transports=… git=… packages=…
```

Run `arc1 config show` with the same arguments, environment and working directory as the server. It shows resolved values and their source labels. Dotenv has already merged file values into the environment at startup.

For BTP CF deploys, `cf env <app>` shows you the final environment as the container sees it (manifest values, `cf set-env` values, and `VCAP_*` injected by bound services).

## Common pitfalls

- **`.env` not being read.** Dotenv loads from `process.cwd()`. If you `cd /tmp && arc1 …`, the `.env` in your project root is ignored. Run from the intended directory or set process environment variables explicitly.
- **Shell exports shadowing `.env`.** `export SAP_URL=…` in your `~/.zshrc` will silently win over a `.env` file. Unset the shell variable or change the exported value; use a CLI flag for a one-off override.
- **Quoting package rules.** Use single quotes in shell commands, for example `SAP_ALLOWED_PACKAGES='ZTEAM/**,$TMP'`, so `$TMP` stays literal and argument patterns are not expanded.
- **Changing mcp.json on a remote server.** As noted above, the `env` block only applies when the client is *spawning* the server. For `url`-based remote connections, change config on the server side.
- **Container `.env` files.** `docker run` doesn't read `.env` from your host. Use `--env-file path/to/.env` or `-e` flags.
- **`ARC1_LOG_HTTP_DEBUG=1` doesn't work.** Most boolean env vars accept either `"true"` or `"1"`, but this one only accepts `"true"` (a known inconsistency — see the note in [configuration-reference.md → Logging and observability](configuration-reference.md#logging-and-observability)).

## Restriction lists on BTP: `.mtaext` is durable, `cf set-env` is not

MTA deployment reapplies the descriptor chain. Keep lasting settings in the landscape `.mtaext`; after an emergency `cf set-env`, restart the app and update the descriptor too.

| You want | Do this |
|---|---|
| Enable the blocklist durably on BTP | Set the value in the landscape `.mtaext` and deploy |
| A temporary incident-response brake | `cf set-env` + restart, then promote the value into the `.mtaext` |
| Disable it | Write the explicit empty value `SAP_BLOCKED_DATA_SOURCES: ""` |

An MTA extension can override a property but cannot remove it. To disable a feature, set its explicit off-value.
The shipped descriptors use an empty `SAP_BLOCKED_DATA_SOURCES` so deployments can clear an earlier list.

Verify the effective value after every deploy with `arc1 config show` or the startup policy log — the
log reports whether the policy is enabled, how many entries it has, and a fingerprint you can compare
across environments.

## See also

- [Configuration Reference](configuration-reference.md) — every env var, grouped by purpose, with effects.
- [Local Development](local-development.md) — `.env`, `npm run dev:http`, MCP client configs for local clones.
- [Docker Guide](docker.md) — `-e`, `--env-file`, and CA cert mounts.
- [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) — `mta.yaml` properties, `cf set-env`, `VCAP_SERVICES`.
