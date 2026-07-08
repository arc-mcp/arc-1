# Plan — Issue #549: Windows `cmd /c start` truncates OAuth authorize URL at `&`

**Dossier:** [docs/research/issues/549-windows-cmd-start-oauth-url-truncation.md](../research/issues/549-windows-cmd-start-oauth-url-truncation.md)
**Verdict:** Confirmed bug (Windows only). Fix = drop `cmd` from the browser-open path; use
`rundll32 url.dll,FileProtocolHandler <url>` (URL rides as one argv arg, no shell re-parse → `&`
preserved). Same fix already shipped in the `arc-1-lsp` sibling. Zero new dependency.

## Scope (what changes)

| File | Change |
|---|---|
| `src/adt/oauth.ts` | win32 branch (line 271): `execFile('cmd', ['/c', 'start', '', url], cb)` → `execFile('rundll32', ['url.dll,FileProtocolHandler', url], cb)`. Update doc comments (lines 14, 248): "Windows (start)" → "Windows (rundll32)". Add a one-line `// NOT cmd /c start — …` note at the branch. |
| `src/server/ui.ts` | win32 branch (lines 243-244): `'cmd'` → `'rundll32'`, `['/c', 'start', '', url]` → `['url.dll,FileProtocolHandler', url]`. Same one-line note. **Also add `child.on('error', …)`** — the detached `spawn` currently has no error listener, so a blocked/missing `rundll32` would throw unhandled (crash-guard, parity with `oauth.ts`). |
| `tests/unit/adt/oauth.test.ts` | Update the win32 assertion (line 575) to expect the `rundll32` argv, **and change the test URL to one containing `&`** so the regression (truncation) is actually exercised: assert the full `&`-bearing URL reaches `rundll32` as a single array element. |
| `docs/research/issues/549-*.md` | Two corrections: (a) fr0ster declares `open` but does **not** call it in `src` — it is not evidence of a deliberate fix; (b) fold in the security provenance conclusion (no untrusted input reaches the `cmd` path; fix is defense-in-depth; fails closed; no secret leak). |

## Exact edits

**`src/adt/oauth.ts`**
```ts
      case 'win32':
        // NOT `cmd /c start` — cmd re-parses `&` in the URL as a command separator, truncating it
        // (issue #549). rundll32 takes the URL as one argv arg with no shell re-parse.
        execFile('rundll32', ['url.dll,FileProtocolHandler', url], cb);
        break;
```
Comment lines 14 & 248: replace "`start` (Windows)" / "Windows (start)" with "Windows (rundll32)".

**`src/server/ui.ts`**
```ts
  // win32: rundll32 (NOT `cmd /c start` — cmd truncates URLs at `&`, issue #549)
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : process.env.BROWSER || 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => logger.warn('Could not open browser', { error: err.message, url }));
  child.unref();
```

**`tests/unit/adt/oauth.test.ts`** (win32 case, ~line 568)
```ts
  it('opens browser on Windows via rundll32, preserving & in the URL (issue #549)', async () => {
    const { execFile } = await import('node:child_process');
    const { platform } = await import('node:os');
    vi.mocked(platform).mockReturnValue('win32');

    const url = 'https://x.auth.example/oauth/authorize?response_type=code&client_id=sb-abc&state=xyz';
    await openBrowser(url);

    // Whole URL — incl. everything after the first `&` — must reach the browser as ONE argv arg.
    expect(execFile).toHaveBeenCalledWith('rundll32', ['url.dll,FileProtocolHandler', url], expect.any(Function));
  });
```

## Decisions (ponytail)

- **In-place edits, no shared helper.** Two call sites, but they live in different modules with
  different spawn mechanisms (`execFile`+callback vs `spawn`+detached). Extracting a
  `browserOpenCommand()` module (as `arc-1-lsp` did) is cleaner in the abstract but adds a file +
  imports + a second test for a one-line-each change. Skip it; add when a third caller appears.
- **No `open` npm dependency.** `rundll32` is a zero-dep one-liner already proven in `arc-1-lsp`.
  `open` would add a 6-package transitive tree, and its main extra value (WSL handling) doesn't even
  reach the win32 branch (`process.platform === 'linux'` under WSL). See dossier §"Why not `open`".
- **Test only `oauth.ts`'s opener.** `ui.ts`'s `openInBrowser` is private and reads `process.platform`
  directly (not the mocked `os.platform`), so unit-testing it means exporting internals for an
  identical one-liner. The `oauth` test proves the win32 argv is correct; `ui.ts` uses the same argv.
- **No user-facing doc change.** Only the dossier + code comments describe this; `grep` of
  `docs_page/` found nothing.

## Verification

1. `npx vitest run tests/unit/adt/oauth.test.ts` — new win32 `&` test passes; darwin/linux/metachar tests unchanged.
2. `npm run typecheck && npm run lint && npm test` — full gate green.
3. `npm run build && npm run check:sizes` — build + size ratchet.
4. Manual/log reasoning: effective invocation is now `rundll32 url.dll,FileProtocolHandler <full-url>` — no shell, `&` intact. (No Windows host in this env; mechanism verified in dossier.)

## Out of scope

- WSL-correct dev login (would need the `xdg-open` branch to detect WSL). YAGNI.
- Scheme validation on the URL before opening (both `rundll32` and `open` hand any scheme to
  ShellExecute; URL here is always admin-config `https://…/oauth/authorize`). Not a regression.
- Refactor to a shared cross-module browser-open helper (revisit on a 3rd caller).

## Commit / PR

- Branch: `claude/deep-issue-549-c93c27` (current worktree).
- Commit: `fix: open browser via rundll32 on Windows to preserve & in URLs (#549)` → patch release
  (covers both the OAuth login opener in `oauth.ts` and the local UI opener in `ui.ts`).
- PR body: root cause + one-line-per-site fix + note that a running MCP process must be **restarted**
  (not just patched) for the fix to take effect (Node has cached the old module). Link the dossier.
