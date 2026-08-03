# Issue #661 — Windows plugin permission false positive

**Status:** Root cause reproduced locally with a platform-surface spike on 2026-08-03. The proposed fix is
small, but the regression tests and operator documentation must distinguish POSIX permission bits from
Windows ACLs.

## Reported failure

On Windows, setting `ARC1_PLUGINS` to any valid absolute `.js` or `.json` plugin path aborts startup with:

```text
Plugin 'C:\absolute\path\to\plugin\dist\index.js' is world-writable — refusing to load
```

The reporter measured the file's Node `fs.Stats.mode` as `0666`, so the loader's `st.mode & 0o002` test is
always truthy. Patching that test to run only when `process.getuid` exists restored direct loading, MCP
startup, tool discovery, and an end-to-end tool call.

## Root cause

`assertLoadablePath()` in `src/server/plugin-loader.ts` mixes two filesystem models:

```ts
if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
  // POSIX-only owner check
}
if ((st.mode & 0o002) !== 0) {
  // Unconditional POSIX "other write" check
}
```

Node documents `process.getuid()` as unavailable on Windows. Node's filesystem documentation also says
Windows does not implement the owner/group/other permission distinction; only a limited owner read/write
model is exposed. Therefore `0o002` is not evidence that a Windows ACL lets every user modify the file.
The unconditional test interprets a synthetic compatibility mode as a POSIX access-control decision.

This affects all extension entry forms because code plugins, standalone manifests, and manifests referenced
by code plugins all pass through `assertLoadablePath()`. The exception intentionally propagates through the
fail-fast startup path, which explains the MCP handshake failure.

The issue is not caused by plugin contents, ARC-1/plugin version skew, MCP transport, or client-side variable
expansion: the failure occurs before `import()` or manifest parsing and depends only on path metadata.

## Spike and evidence

A focused Vitest regression was added before changing production code. It:

1. creates a valid manifest plugin;
2. forces its mode to `0666`;
3. temporarily removes `process.getuid`, matching Node's Windows API surface;
4. calls the real `loadPlugins()` function and expects the tool to register.

Pre-fix command:

```bash
npx vitest run tests/unit/server/plugin-loader.test.ts -t 'POSIX ownership APIs are unavailable'
```

Pre-fix result: **failed as expected** at `assertLoadablePath()` with `is world-writable — refusing to load`.
This proves the failure is in the platform-inappropriate permission check rather than later plugin loading.

## Fix decision

Run both ownership and world-writable checks only when Node exposes `process.getuid()`:

```ts
if (typeof process.getuid === 'function') {
  if (st.uid !== process.getuid()) throw ...;
  if ((st.mode & 0o002) !== 0) throw ...;
}
```

Using the capability check is preferable to a literal `process.platform === 'win32'` branch: it describes
the condition the checks actually require and matches Node's own availability contract. POSIX behavior stays
fail-closed. Windows still requires an absolute, stat-able path, but ARC-1 cannot infer Windows ACL safety
from POSIX mode bits and should not claim to do so.

## Security assessment

This does not weaken an effective Windows control: the current owner and world-writable tests cannot model
Windows ownership/ACLs, and the owner test is already skipped there. The trusted-plugin risk remains bounded
by the administrator-controlled local allowlist, fail-fast plugin validation, `Custom_*` namespace, immutable
deployment guidance, and normal host ACLs. Documentation should call these two checks POSIX-only and continue
to recommend that plugins be deployed with the same change control as ARC-1.

No auth, SAP safety-ceiling, scope, URL, SQL, XML, cache, logging, or mutating HTTP path changes.

## Primary references

- [Node.js `process.getuid()` documentation](https://nodejs.org/api/process.html#processgetuid)
- [Node.js filesystem mode constants](https://nodejs.org/api/fs.html#file-mode-constants)
- [GitHub issue #661](https://github.com/arc-mcp/arc-1/issues/661)
