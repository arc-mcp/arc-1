# SAPTargets

List the SAP targets available through `/multi/mcp`. This catalog is separate from the 12 core tools and is available only on the aggregate multi-target route.

```text
SAPTargets()
```

List the SAP targets that can be selected through `/multi/mcp`. The tool takes no `target` parameter
and does not contact SAP. Listing a target proves only that ARC-1 accepted its configuration; it
does not prove that the current user's SAP identity can access it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Case-insensitive filter over target IDs and descriptions. Admin results also match destination name, status, code, and message. Maximum 160 characters. |
| `offset` | integer | No | Admin-only diagnostic-page offset. Follow `diagnosticNextOffset` when the bounded result is truncated. |

- A reader sees `SAPTargets` only when more than one target is active. Its compact response contains
  target IDs, descriptions, and `identity` (`per-user` or `shared`).
- An Admin sees it with zero, one, or many targets, including paged, secret-safe registry and
  quarantine diagnostics. Destination URLs, credentials, tokens, certificates, and raw Cloud
  Connector location IDs are never returned. It remains available when registry discovery fails.
- It is never listed on `/<SYSTEM>/<CLIENT>/mcp`, an alias-pinned route, or the explicitly configured
  single-target `/mcp` route.

See [Multi-system administration](../multi-target-administration.md#saptargets-operator-surface) for the response shape, privacy
boundary, and target-selection behavior.

[All tools](../tools.md)
