# Issue #549 — Windows `cmd /c start` truncates the OAuth authorize URL at `&` (CONFIRMED)

**Status:** Confirmed bug, root cause validated by code inspection + an independent sibling-repo
implementation of the exact fix (2026-07-08). The reporter (`@sanerdemirel`) is correct; their
proposed fix (`rundll32 url.dll,FileProtocolHandler`) is the same one already shipped in the
`arc-1-lsp` sibling project.

**Symptom (Windows only):** BTP browser Authorization-Code login opens the XSUAA `/oauth/authorize`
URL through `cmd.exe`, which treats every `&` query-separator as a command separator. The browser
receives only `.../oauth/authorize?response_type=code` — no `client_id`, `redirect_uri`, `state`, or
`code_challenge` — and XSUAA rejects it: *"Authorization Request Error … Client id must not be empty."*
macOS and Linux are unaffected.

## TL;DR

- **Real on HEAD.** [`src/adt/oauth.ts:271`](../../../src/adt/oauth.ts) opens the browser with
  `execFile('cmd', ['/c', 'start', '', url], cb)`. The authorize URL built at
  [`oauth.ts:402-409`](../../../src/adt/oauth.ts) always contains **five** `&` separators.
- **The mechanism is deterministic, not probabilistic.** Node's Windows argument quoting only wraps
  an arg in `"…"` when it contains a space, tab, `"`, or is empty. The URL has none of those, so Node
  passes it to `cmd.exe` **unquoted**. `cmd` then parses `&` as a statement separator *before* `start`
  ever sees its target → the URL is chopped at the first `&`.
- **Reporter's fix is correct and already proven.** The maintainer's own `arc-1-lsp` sibling repo
  hit the identical bug and fixed it exactly this way — see
  [`arc-1-lsp/src/server/open-browser.ts:16-22`](../../../../arc-1-lsp/src/server/open-browser.ts),
  whose comment reads: *"NOT `cmd /c start <url>` — cmd re-parses the tail under its own grammar, so a
  URL with `&` query params … truncates at the first `&` (and is an arg-injection surface).
  `rundll32 url.dll,FileProtocolHandler` takes the URL as a true argv argument with no shell re-parse
  → safe and `&`-correct."*
- **Second, latent occurrence of the same bug:** [`src/server/ui.ts:243-244`](../../../src/server/ui.ts)
  (the local read-only UI opener) uses the identical `cmd /c start` shape. Fix it in the same PR.
- **The existing test hides the bug:** [`tests/unit/adt/oauth.test.ts:575`](../../../tests/unit/adt/oauth.test.ts)
  asserts the buggy `cmd /c start` argv — but with URL `https://example.com`, which has no `&`, so the
  assertion passes while the failing case is never exercised. The fix must update this assertion and
  add an `&`-bearing regression URL.
- **Not a duplicate, not already fixed.** Reporter's version 0.9.25 == current HEAD version. The
  win32 branch has been present and unchanged since PR #51 (2026-04-08).

## Verified facts

| Claim | Verified? | Evidence |
|---|---|---|
| HEAD uses `cmd /c start` for win32 | ✅ | [`src/adt/oauth.ts:271`](../../../src/adt/oauth.ts) |
| Authorize URL contains multiple unquoted `&` | ✅ | [`oauth.ts:402-409`](../../../src/adt/oauth.ts) — 5 `&` separators |
| Node passes the URL to cmd unquoted (no space/tab/quote) | ✅ | Node Windows arg-quoting rule; URL is percent-encoded, space-free |
| `cmd` treats `&` as a statement separator | ✅ | Documented cmd.exe grammar; corroborated by `arc-1-lsp` maintainer comment |
| macOS / Linux branches are safe | ✅ | `open`/`xdg-open` invoked directly, no shell re-parse ([oauth.ts:268,274](../../../src/adt/oauth.ts)) |
| Proposed fix `rundll32 url.dll,FileProtocolHandler` works | ✅ | Already shipped in [`arc-1-lsp/src/server/open-browser.ts:21`](../../../../arc-1-lsp/src/server/open-browser.ts); reporter verified locally |
| Duplicate of an existing issue | ❌ | `gh issue list` (all states): #549 is unique; #214/#301/#473 are unrelated OAuth issues |
| Already fixed on HEAD | ❌ | HEAD == v0.9.25 (reporter's version); code unchanged since PR #51 |

## Live-repro caveat (read this)

This is a **client-side Windows shell-parsing bug that fires before any SAP call** — it is not an ADT
endpoint behavior, so none of the three live SAP systems (npl / a4h / a4h-2025, all Linux) can
exercise it, and no Windows host was available in this research environment to spawn `cmd.exe`.

That does **not** weaken the verdict. Unlike a release-sensitive ADT quirk, this is a *deterministic*
mechanism, and every input to it was verified directly: the exact code path, the exact URL shape (5
`&`), Node's documented no-quote-without-space rule, and `cmd`'s documented `&`-as-separator grammar.
On top of that, the **same maintainer independently hit and fixed this exact bug the exact proposed
way** in `arc-1-lsp`, and the reporter states they verified the fix locally. Code inspection + an
independent shipped implementation is a stronger proof here than a single flaky live run would be.

### The mechanism, concretely

Effective Windows command line Node builds from `['/c', 'start', '', url]`:

```
cmd /c start "" https://xxx.authentication.eu10.hana.ondemand.com/oauth/authorize?response_type=code&client_id=sb-...&redirect_uri=http%3A%2F%2Flocalhost%3A54321%2Fcallback&state=...&code_challenge=...&code_challenge_method=S256
```

`cmd` splits that into separate statements at each unquoted `&`:

```
start "" https://...authorize?response_type=code      ← the only thing the browser gets
client_id=sb-...                                       ← cmd tries to run as a command → not recognized (discarded by /c)
redirect_uri=http%3A%2F...                             ← "
state=...                                              ← "
code_challenge=...                                     ← "
code_challenge_method=S256                             ← "
```

The browser opens `…/authorize?response_type=code` with no `client_id` → XSUAA: *"Client id must not be empty."* Exactly as reported.

## Root cause

`execFile('cmd', ['/c', …])` invokes `cmd.exe` explicitly as the program. Even though `execFile`
itself spawns no shell, the program *is* a shell, and `cmd` re-tokenizes its command line under its
own grammar where `& && | < > ^ ( )` are control operators. Node only quotes argv entries containing
whitespace/quotes, so a space-free URL reaches `cmd` bare and is split at the first `&`. The
`darwin`/`linux` branches call `open`/`xdg-open` directly (no shell), so they are immune — the bug is
strictly win32.

The fix removes `cmd` from the path entirely: `rundll32 url.dll,FileProtocolHandler <url>` hands the
URL to the registered protocol handler as a single true argv argument with no shell re-parse, so `&`
is preserved literally. This also closes the arg-injection surface the `cmd` path opens (low severity
in ARC-1, since the URL is server-built from the service key + generated PKCE/state, not
attacker-controlled — but the fix closes it for free).

## Security

Assessed after the fix question was raised. The `cmd` path is a **latent command-injection-class
pattern, but not remotely exploitable in the shipped flow** — the `&`s that break login are ARC-1's
*own* literal query-string joiners ([`oauth.ts:404-409`](../../../src/adt/oauth.ts)), which is why it
breaks deterministically for every Windows user rather than being data-dependent.

- **No untrusted input reaches the `cmd` metacharacter parser.** Every interpolated URL value is
  neutralized: `client_id` and `redirect_uri` are `encodeURIComponent`'d (turning `& | < > ^` into
  `%26`…); `state`/`code_challenge` are base64url (`A-Za-z0-9-_`, no metachars). The only un-encoded
  component is `serviceKey.uaa.url` — operator-supplied config (the same file holds the client
  secret), so already fully trusted. The `ui.ts` URL is the local bind address. No remote path in.
- **Fails closed, no auth downgrade.** The truncation drops the PKCE `code_challenge` and `state`, so
  XSUAA rejects the request and issues no code — it does *not* silently proceed without PKCE/CSRF, and
  the callback server still validates `state` (`oauth.test.ts` "rejects callback with mismatched state").
- **No secret leak.** On failure ARC-1 logs the full authorize URL ([`oauth.ts:412,418`](../../../src/adt/oauth.ts));
  that is safe — auth-code+PKCE keeps the client *secret* out of the URL, and
  `client_id`/`state`/`code_challenge` are non-secret by design.
- **Real-world severity is availability, not confidentiality/integrity:** Windows browser-login is
  100% broken (self-DoS for Windows users). The `rundll32` fix restores it and removes the latent
  injection surface as defense-in-depth for any future change that interpolates less-sanitized data.

## Affected files (for the fix — hand to `/deep-feature` or `/implement-feature`)

- **`src/adt/oauth.ts`** — win32 branch [line 271](../../../src/adt/oauth.ts); the OAuth login path
  the reporter cites (functional impact: BTP browser login broken on Windows). Also update the stale
  doc comments at lines 14 and 248 ("Windows (start)").
- **`src/server/ui.ts`** — win32 branch [lines 243-244](../../../src/server/ui.ts); same latent bug in
  the local read-only UI opener. Fix for consistency (its URL may not carry `&` today, but the defect
  is identical).
- **`tests/unit/adt/oauth.test.ts`** — update the win32 assertion at [line 575](../../../tests/unit/adt/oauth.test.ts)
  to expect the `rundll32` argv; add a regression URL containing `&` so the failing case is actually
  exercised. Consider factoring a pure `browserOpenCommand(url, platform)` builder like
  [`arc-1-lsp/src/server/open-browser.ts:12`](../../../../arc-1-lsp/src/server/open-browser.ts) so the
  exact argv is unit-testable per platform without spawning.
- No schema / tool-surface change (not a tool). `fix:` commit → patch release.

## Recommended fix (matches `arc-1-lsp`, zero new dependency)

```ts
// src/adt/oauth.ts, win32 branch
case 'win32':
  // NOT `cmd /c start` — cmd re-parses `&` in the URL as a command separator, truncating it.
  execFile('rundll32', ['url.dll,FileProtocolHandler', url], cb);
  break;
```

Apply the equivalent one-line change at `src/server/ui.ts:243-244`.

## Out of scope

- Adding the `open` npm package. (`mcp-abap-adt-fr0ster` *declares* `open` in package.json but never
  calls it in `src/` — not evidence of a deliberate fix; `open` is just the de-facto cross-platform
  opener projects reach for.) Ponytail: `rundll32` is a zero-dependency one-liner already proven in
  the `arc-1-lsp` sibling, and `open` would add a 6-package transitive tree whose main extra value
  (WSL handling) never reaches the win32 branch (`process.platform` is `linux` under WSL). No new dep
  for what one line does.
- The reporter's `npx` cache-vs-global note and "restart the server after patching" are correct
  operational advice, not code changes.

## Draft GitHub reply (review, then post from `marianfoo` — do NOT auto-post)

```markdown
Confirmed — thank you, this is an excellent, accurate report. Reproduced by code inspection and
cross-checked against our own LSP sibling project, which already fixes it exactly the way you propose.

**Root cause (your analysis is right):** `openBrowser()` uses `execFile('cmd', ['/c', 'start', '', url])`
(`src/adt/oauth.ts:271`). The authorize URL we build (`oauth.ts:402-409`) always has five `&`
separators. Node only wraps an argv entry in quotes when it contains a space/tab/quote — our URL has
none, so it reaches `cmd.exe` **unquoted**, and `cmd` parses each `&` as a statement separator before
`start` ever sees its target. The browser gets `…/authorize?response_type=code` with no `client_id`,
so XSUAA returns "Client id must not be empty." macOS/Linux are unaffected (they call `open`/`xdg-open`
directly, no shell).

**Fix:** exactly your suggestion —
`execFile('rundll32', ['url.dll,FileProtocolHandler', url], cb)`. We independently landed the same fix
in our LSP edition; its comment sums it up: *rundll32 takes the URL as a true argv argument with no
shell re-parse → safe and `&`-correct* (and it also closes the arg-injection surface the `cmd` path
opens).

Two things we found while verifying:
1. There's a **second** occurrence of the same pattern in `src/server/ui.ts:243-244` (the local
   read-only UI opener). We'll fix both in one go.
2. Our existing unit test asserts the `cmd /c start` shape but with `https://example.com` (no `&`), so
   it passed while never exercising the broken case. We'll update it and add an `&`-bearing regression
   URL.

Tracking with a small patch PR now. Thanks again for the precise root cause and the verified fix —
saved us a lot of time.
```

## Recommendation

**Fix it.** Small, surgical, cross-platform-safe change (only the win32 branch moves; macOS/Linux
untouched) with a fix already proven in `arc-1-lsp`. Given it's ~2 source files + a test tweak, this
is a good fit for **`/implement-feature`** (or `/deep-feature` if you want the full lifecycle). Hand it
this dossier: `docs/research/issues/549-windows-cmd-start-oauth-url-truncation.md`. `fix:` → patch
release; call out in the PR that a running MCP process must be restarted for the fix to take effect.
