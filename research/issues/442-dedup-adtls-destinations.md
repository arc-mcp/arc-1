# Issue #442 — Dedup connection config with ADT-for-VSC `~/.adtls/destinations.json` (VALIDATED)

**Status:** Valid feature request, scope validated live (2026-06-15). Partial dedup is feasible and
worth doing; a **full** dedup is impossible because the file never stores the password by design.
**Author:** @albertmink (Albert Mink, SAP — works on ADT/abapGit; an authoritative source on the file).
**Type:** `feature-request` (not a bug). No duplicate; no prior dossier; `marianfoo/arc-1` has no
existing `~/.adtls` code.

## The ask

> Dedup configuration from this plugin and the ADT for vsc extension. `~/.adtls/destinations.json`
> (comes with ADT for vsc) contains similar if not the same as the cc configuration from the plugin.

Reference: [`.claude-plugin/plugin.json#L25-L50`](https://github.com/marianfoo/arc-1/blob/8af87085/.claude-plugin/plugin.json#L25-L50)
— the plugin's `userConfig` block (`sap_url`, `sap_user`, `sap_password`, `sap_client`,
`sap_language`, …). The same `SAP_*` env vars are resolved in `src/server/config.ts:289-293`.

## TL;DR

- **Partial dedup is real and useful.** A `basicAuth` destination in `~/.adtls/destinations.json`
  carries exactly the non-secret half of ARC-1's connection config: `systemUrl`, `client`,
  `language`, `user`. ARC-1 could read a named destination and pre-fill `SAP_URL` / `SAP_CLIENT` /
  `SAP_LANGUAGE` / `SAP_USER` instead of asking the user to retype them.
- **Full dedup is impossible.** The password is **never** written to `destinations.json` — verified
  live (no password field on disk) *and* in SAP's own server behavior: adt-ls does **not** persist
  the create-time password (`~/DEV/arc-1-lsp/docs/adt-ls-headless-notes.md:85`). So ARC-1 always
  still needs `SAP_PASSWORD` from env / OS keychain. The "config" they share is everything *except*
  the one secret.
- **`reentranceTicket` / `oauth` / `sso` destinations aren't directly usable by ARC-1's MCP server
  today.** Those entries store only `systemUrl` (no user/client). ARC-1's MCP server authenticates
  with HTTP Basic, cookies, or BTP OAuth — it has no browser reentrance-ticket flow. (That flow is
  what the separate **arc-1-lsp** edition does; see `project_arc1_lsp_edition`.) So a destinations.json
  reader can populate `SAP_URL` from these, but the user still supplies auth separately.
- **Recommendation:** small, additive config feature (opt-in `SAP_ADTLS_DESTINATION=<id>` resolving
  from `~/.adtls/destinations.json`), analogous to the existing `SAP_BTP_SERVICE_KEY_FILE` path.
  Hand to `/deep-feature`.

## Live validation (2026-06-15)

`~/.adtls/destinations.json` on this machine — the actual on-disk schema:

| `authenticationKind` | Fields present on disk | Maps to ARC-1 |
|---|---|---|
| `reentranceticket` (current file) | `id`, `protocol`, `systemUrl` | `SAP_URL` only |
| `basicAuth` (`.bak-arc1` backup)  | `id`, `protocol`, `systemUrl`, `client`, `language`, `user` | `SAP_URL`, `SAP_CLIENT`, `SAP_LANGUAGE`, `SAP_USER` |
| any | — **no `password` field, ever** | `SAP_PASSWORD` must still come from env/keychain |

```jsonc
// basicAuth example (from ~/.adtls/destinations.json.bak-arc1) — richest case, still no password
{
  "id": "A4H",
  "protocol": "http",
  "properties": {
    "authenticationKind": "basicAuth",
    "client": "001",
    "language": "EN",
    "systemUrl": "http://a4h.marianzeis.de:50000",
    "user": "DEVELOPER"
  }
}
```

Two independent witnesses that the password is **not** in the file:
1. **On disk:** every destination (live + both backups) has no `password` key.
2. **SAP's own server:** `~/DEV/arc-1-lsp/docs/adt-ls-headless-notes.md:83-85` — with `basicAuth`,
   session dispatch throws *"The password must not be null or empty"* because *"adt-ls does NOT
   persist the create-time password"*. The password is held in the editor's secret store, never the
   JSON.

`authenticationKind` values the destinations plugin emits: `basicAuth`, `reentranceTicket`, `oauth`,
`sso` (`adt-ls-headless-notes.md:36`).

## Root cause / why this is the right framing

There is no bug. The reporter is correct that the two configs overlap — but the overlap is exactly
the **non-secret** fields. ARC-1's `plugin.json` asks for 6 connection inputs; `destinations.json`
can supply up to 4 of them (`url`, `client`, `language`, `user`) for `basicAuth` destinations and 1
(`url`) for the rest. The remaining secret (`sap_password`) is intentionally absent from the file, so
dedup reduces typing and drift, it does not eliminate the password prompt.

## Affected files (if implemented — for `/deep-feature`)

Mirrors the existing file-backed config precedent (`SAP_BTP_SERVICE_KEY_FILE`,
`src/server/config.ts:469`):

- `src/server/config.ts` — new resolver: if `SAP_ADTLS_DESTINATION` (and optional
  `SAP_ADTLS_DESTINATIONS_FILE`, default `~/.adtls/destinations.json`) is set, read the named
  destination and seed `url`/`client`/`language`/`username` **below** explicit CLI/env/.env (precedence
  stays CLI > Env > .env > **adtls** > Defaults). Fail-soft: missing file / unknown id → clear warning,
  fall through to normal config.
- `src/server/types.ts` — `ServerConfig` fields / defaults for the new options.
- `.claude-plugin/plugin.json` — optional `userConfig` entries (`sap_adtls_destination`) + env wiring,
  keeping the three-input password/url fallback intact.
- `docs_page/configuration-reference.md`, `AGENTS.md` config table, `.env.example` — document the new
  option and the **password-still-required** caveat.
- Tests: `tests/unit/server/config.*` — basicAuth dest → fills 4 fields; reentranceTicket dest →
  fills url only; explicit env overrides dest; missing id → warn + fall through; never reads a password.

## Out of scope

- **Reentrance-ticket / SSO / OAuth auth** against destinations — that's the arc-1-lsp edition's job
  (`project_arc1_lsp_edition`), not the MCP server.
- **Writing** to `~/.adtls/destinations.json` — read-only; it's the user's shared VS Code/Eclipse/Cursor
  store (`adt-ls-headless-notes.md:114-117`). ARC-1 must never mutate or pollute it.
- Reading the password from any OS keychain the ADT extension uses — out of scope; keep `SAP_PASSWORD`
  the single secret source.

## Draft GitHub reply (for @marianfoo to review & post — do not auto-post)

```markdown
Thanks @albertmink — good call, and you're right that the two overlap.

I dug into `~/.adtls/destinations.json` to scope exactly what can be deduped:

- A **`basicAuth`** destination carries `systemUrl`, `client`, `language`, `user` — i.e. the
  non-secret half of ARC-1's connection config. ARC-1 can absolutely read those and stop asking
  you to retype them.
- A **`reentranceTicket` / `oauth` / `sso`** destination stores only `systemUrl` (no user/client),
  so for those we can pre-fill the URL but not the rest.
- The **password is never in the file** — confirmed both on disk and from adt-ls itself, which
  doesn't persist the create-time password (it lives in the editor's secret store). So ARC-1's MCP
  server will still need `SAP_PASSWORD` supplied separately; the dedup removes the *typing/drift*,
  not the secret.

One more constraint: ARC-1's MCP server authenticates over HTTP Basic / cookies / BTP OAuth — it has
no browser reentrance-ticket flow — so `reentranceTicket` destinations can seed the URL but you'd
still provide credentials. (The separate ARC-1 *LSP* edition is the one that speaks reentrance.)

Plan: add an opt-in `SAP_ADTLS_DESTINATION=<id>` (reading `~/.adtls/destinations.json`, read-only,
never mutated) that seeds `SAP_URL` / `SAP_CLIENT` / `SAP_LANGUAGE` / `SAP_USER` below any explicit
env/CLI value — same shape as the existing `SAP_BTP_SERVICE_KEY_FILE` option. Tracking this as
accepted.
```

## Recommendation

**Fix it (small, additive).** Hand this dossier to `/deep-feature` pointed at
`research/issues/442-dedup-adtls-destinations.md`. It's close to a one-file change in `config.ts` plus
types/docs/tests; if scoped tightly, `/implement-feature` is also fine.
