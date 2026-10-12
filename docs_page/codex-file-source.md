# Send a local source file through Codex

Use this workflow when Codex can compose a local command's result directly into an
already-connected ARC-1 tool. It prevents the model from retyping large ABAP sources
and accidentally changing characters. It works with a local or remote ARC-1 connection;
the file is read on the Codex machine, then sent as the ordinary `source` argument.
The remote server never receives a laptop path or needs filesystem access.

Install the ARC-1 npm package locally as described in the [CLI guide](cli-guide.md).
The `arc1-source` helper needs no SAP credentials or configuration. It has two commands:

- `arc1-source read FILE`: emit a JSON envelope containing exact UTF-8 source, byte
  count and SHA-256. It accepts a regular, non-empty file up to 200,000 bytes and
  preserves newlines. Invalid UTF-8, NUL characters and a leading BOM are refused
  before any SAP call; save BOM files as UTF-8 without BOM.
- `arc1-source verify`: read the received envelope from stdin and verify its contents.
  A mismatch exits nonzero. Verification prints only the digest/count, never source.

## Codex composition recipe

Ask Codex to use the following sequence in its JavaScript tool-composition environment.
This is a host-specific recipe, not JavaScript to paste into a terminal. First select
the correct connected `SAPWrite` tool, action, object and authorized file. Replace the
example path/name below. For an unreleased checkout use `node /path/to/bin/arc1-source.js`
instead of the installed command. A host without local execution plus programmatic
MCP tool invocation cannot use this recipe.

```javascript
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const read = await tools.exec_command({
  cmd: 'arc1-source read ' + quote('/work/zcl_example.clas.abap'),
  max_output_tokens: 100000,
});
if (read.exit_code !== 0 || read.session_id) throw new Error('File read incomplete');
const envelope = JSON.parse(read.output);

// Compact JSON escapes source newlines; a quoted heredoc prevents shell expansion.
const verified = await tools.exec_command({
  cmd: "arc1-source verify <<'ARC1_SOURCE_JSON'\n"
    + JSON.stringify(envelope) + '\nARC1_SOURCE_JSON',
  max_output_tokens: 1000,
});
if (verified.exit_code !== 0 || verified.session_id) throw new Error('Verification failed');
const check = JSON.parse(verified.output);
if (check.verified !== true || check.sourceBytes !== envelope.sourceBytes
    || check.sourceSha256 !== envelope.sourceSha256) throw new Error('Integrity mismatch');

// Use the actual tool name for the selected connection. Do not print/retype source.
text(await tools.mcp__arc_1__SAPWrite({
  action: 'update', type: 'CLAS', name: 'ZCL_EXAMPLE', source: envelope.source,
}));
```

The same transfer works for `create` or surgical actions such as `edit_unit`: supply
that action's normal arguments and the correct file content (whole object versus unit
body). Verification is mandatory before the write: truncated output can still be valid
JSON. The digest detects transfer damage; it does not approve source content or protect
against another developer editing SAP. Use existing concurrency checks where supported.

## Limits and BTP

Authentication, user identity, write/package/scope gates and activation behavior remain
those of the selected connection. Use a writable single-target connection. If login has
expired, reconnect in the host; the helper does not store tokens or fall back to Basic.
A BTP-hosted ARC-1 uses this same source argument. Actual deployed CF/XSUAA/Principal
Propagation continuity has not been qualified by this helper's tests.

The helper caps its encoded envelope at 300,000 bytes. Codex output and local shell
command limits may be lower; parsing/verification must fail closed, never continue with
a partial source. Linux limits a single shell argument to roughly 128 KiB, including
the encoded heredoc: use a smaller method/unit file there. Large-file composition was
qualified on macOS. Windows shells need equivalent literal stdin handling and are
not qualified by that test.

Remote ARC-1's default HTTP request limit is 100 KiB for the **whole JSON request**,
including escaping and other arguments. This helper does not raise it. For larger writes,
the administrator must explicitly configure `ARC1_MAX_HTTP_REQUEST_BYTES` (on CF in
`.mtaext` properties), or use a smaller method/unit edit. See the
[configuration reference](configuration-reference.md). After saving, review/read back
and activate as appropriate; a lost response needs investigation before retrying.
