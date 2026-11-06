# Windows X.509 client-certificate SSO (cookie route)

For on-prem SAP systems where users log on with an X.509 client certificate (typically a domain-issued
user certificate in the Windows store) and Basic auth is not available. ADT answers anonymous requests
with `401` and `WWW-Authenticate: Basic`, but returns `200` when the certificate is presented via mutual TLS.

Browser cookies from such a login are usually not usable by ARC-1, because the browser authenticated each
request with the certificate. `extract-sap-cookies` therefore cannot help here. This example authenticates
**with the certificate itself**, then hands the resulting SAP session cookies to ARC-1.

> Developer-only, single user, shared identity: ARC-1 acts as you. Do not combine with `SAP_PP_ENABLED=true`
> and do not use it for shared or deployed instances (see the cookie auth notes in
> [local-development](../../docs_page/local-development.md)).

## How it works

1. `arc1-launch.ps1` picks the newest valid user certificate from `Cert:\CurrentUser\My` (optional issuer filter,
   Client Authentication EKU) and calls `/sap/bc/adt/discovery?sap-client=<client>` with it.
2. The session cookies (`SAP_SESSIONID_*`, `MYSAPSSO2`, `sap-usercontext`) are written as a Netscape cookie file.
3. ARC-1 starts with `SAP_COOKIE_FILE` pointing at that file. ARC-1 re-reads the file after a `401`.
4. A background runspace repeats the certificate logon every 15 minutes and rewrites the file.

## Configuration

The script contains no system data. Everything comes from the `env` block of the MCP server entry:

| Variable | Meaning |
|---|---|
| `SAP_URL`, `SAP_CLIENT` | Target system and client (the variables ARC-1 reads anyway). Client defaults to `100`. |
| `ARC1_CERT_ISSUER` | Optional. Issuer filter for the user certificate, wildcards allowed, e.g. `*My-Issuing-CA*`. Without it, every valid client-authentication certificate with a private key is tried (newest first) and the first one SAP accepts is used. Set it if your store holds several client certificates, e.g. from device or tenant enrollment. |
| `ARC1_EXE` | Path to `arc-1.exe` (default: `arc-1.exe` from `PATH`). |
| `ARC1_COOKIE_DIR` | Cookie directory (default: `%LOCALAPPDATA%\arc1-cookies`). |
| `ARC1_COOKIE_REFRESH_MINUTES` | Re-logon interval (default: `15`). |
| `SAP_COOKIE_FILE` | Overrides the generated cookie file name. |

All other ARC-1 variables (`SAP_ALLOW_WRITES`, `ARC1_SYSTEM_LABEL`, ...) pass through unchanged.

## Setup

One MCP server entry per system, so the client does not cache a system choice:

```json
{
  "servers": {
    "arc1-dev": {
      "type": "stdio",
      "command": "powershell.exe",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\path\\to\\arc1-launch.ps1"],
      "env": {
        "SAP_URL": "https://sap-dev.example.com:44300",
        "SAP_CLIENT": "100",
        "ARC1_CERT_ISSUER": "*My-Issuing-CA*",
        "ARC1_EXE": "C:\\Tools\\arc-1\\arc-1.exe",
        "SAP_ALLOW_WRITES": "false"
      }
    }
  }
}
```

To test the logon without starting ARC-1, set the variables in a terminal and run `.\arc1-launch.ps1 -LoginOnly`.

## Notes

- Always pass `sap-client`: some systems default to a different client than the one you intend (the logon then
  creates a session for the default client).
- Certificate logon only proves the identity to SAP. SAP authorizations of the mapped user still apply.
- The cookie file holds a live session. Keep it in a private directory (the default is under `%LOCALAPPDATA%`).
- Not verified: macOS/Linux (the script uses the Windows certificate store).
