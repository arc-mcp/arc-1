# Pinned function source: comparison candidate and native read evidence

PR #1142, FEAT-93. This is implementation research, not public capability admission or
principal-propagation qualification. Function resources remain outside the public pinned surface.

## Source comparison candidate

An A4H/001 SAP_BASIS 758 GET of `SU_USER/BAPI_USER_GETLIST` on 2026-11-01 at
23:40:49.353 UTC returned a lowercase FUNCTION/signature/ENDFUNCTION frame. The raw
9,066-byte response has SHA-256
`cf571884e5f4100b4f907c14df6585550dd6085491676c5fb4451d3767e412f9`.
The original source is private; no SAP source is included here.

`prepareFunctionSourceVerification` uses the existing signature boundaries and abaplint tokens
to compare function framing. Only ASCII identifier tokens in the signature and footer are
case-insensitive. Literal values, token kinds, parameters, comments, prefix and function body
remain significant; the body is exact apart from CRLF normalization. Framing must be provable
before PUT. Readback returns the hash of the actual retrieved bytes.

Offline tests exercise authored examples of this native shape and reject changed parameter
names/types/directions, passing modes, literals, comments and body text. Comparing an authored
uppercase frame with this captured GET also succeeded. Neither check establishes what SAP
normalizes during a PUT. A native save with body-preservation and parameter readback is still
required, followed by PP qualification through the final deployed artifact.

## Other read-only findings

- The native inactive-object feed contains `CLAS/OM/private`, `CLAS/OM/public` and `CLAS/OSI`
  fragments rooted at the selected class source. The first two have composite display names;
  `CLAS/OSI` carries the owner name in its fragment. This was an inactive-list GET, not a
  preaudit activation response. Current pinned activation continues to refuse these fragments.
  The 21,127-byte feed has SHA-256
  `a41870c2e23e759bcd4ff35091334a204a359cdc8af5e5f834b1c796708bfff8`.
- SAP's `CL_FB_ADT_URI_MAPPER_FUGR` distinguishes function, structural-include, group-main and
  text-pool representations. Source mapping can differ from metadata mapping. The 44,205-byte
  source GET has SHA-256 `f6ddb731dd9275b3f1e8cb4ea97ccefdae25bc6f93abd75a192a16b08315da62`.
- `CL_FB_ADT_RES_FUGR` contains a main-source PUT path that updates the main program and
  restores its function-pool program category. Therefore main-source replacement remains an
  **unqualified capability**, not an established unsupported SAP operation. The private factory
  still refuses it pending native write, ownership and generated-membership evidence. The
  77,419-byte source GET has SHA-256
  `16ccde1dbef4503f07d3b66ecdc2ad2646dbe83beed3da6fc6e04271831a811c`.
- `CL_SEDX_ADT_URI_MAPPER` maps text pools differently depending on the Workbench key and
  mapping options, including class-pool and function-group program representations. A source
  inspection does not establish which representation a particular preaudit returns. The
  20,541-byte source GET has SHA-256
  `36deda1a1ca572b79a47bd14f389b831a504d3cd973a58576c9309b492b058e0`.

All captures used HTTPS on `a4h.marianzeis.de:443`, client 001, with writes disabled. Receipts
and SAP sources remain in private local qualification storage, outside review snapshots.
No role, destination, XSUAA or application configuration changed. FEAT-93 remains open.
