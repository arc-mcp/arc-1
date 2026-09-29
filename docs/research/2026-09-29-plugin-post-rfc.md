# Extension POST and function-module investigation — 2026-09-29

## Evidence and decision

[#884](https://github.com/arc-mcp/arc-1/issues/884) and
[#885](https://github.com/arc-mcp/arc-1/issues/885), reported by Silvio Marino, describe real
limitations: no parameterized `ctx.run` operation, and raw POSTs require write authorization.
The inspected [claude-sap-kit source](https://github.com/silvius1996/claude-sap-kit/tree/abb20b5b8c037b95b5d48510c0f5ba1fc0a72117/skills/sap-arc1-kit/assets/arc1-extension/src)
uses `/sap/bc/soap/rfc` for both SmartForm reads and writes. A URL-only read exception would permit
both bodies. Its regex SOAP helper assumes the legacy operation/response shape; it is useful use-case
evidence, not a verified contract for modern configured service bindings. No source was copied.
The [extension sample](https://github.com/arc-mcp/arc-1-extension-sample/tree/d71abdc5a626d6a33abcaaf93bcd31a7dce0aba4/src/tools)
also has LISA read POSTs with dedicated paths: those are narrower FEAT-77 candidates than a shared
dispatcher. An approved read-only GET service works with the existing API; a POST-only service
needs a backend change to use that alternative.

Primary sources checked:

- [SAP ABAP Web Services lifecycle](https://help.sap.com/docs/SAP_NETWEAVER_740/f1cccec432514a3181f2852f2b91d306/c84cb8db0b3b43908ae4e987f3a3ade5.html): SOAP Processor 6.20 under `/sap/bc/soap/` is deprecated; SAP recommends newer ABAP Web Services infrastructure. This does not mean all SOAP services are deprecated.
- [SAP binding WSDL guidance](https://help.sap.com/docs/SUPPORT_CONTENT/abapconn/3354079866.html): configured bindings supply endpoint/protocol details; design-time WSDL is not an interchangeable execution contract.
- [SAP RFC authorization](https://help.sap.com/docs/SAP_NETWEAVER_740/c495ada972d045b2be2869f5573af8e7/488d1bd1ae444e6ee10000000a421937.html): `S_RFC` authorizes execution, not general proof of read-only behavior.
- [HTTP retry semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2): automatic replay of a non-idempotent request needs knowledge that it is safe or was not applied. The raw plugin API has neither.
- [OData batch protocol, section 11.7](https://docs.oasis-open.org/odata/odata/v4.0/errata03/odata-v4.0-errata03-part1-protocol-complete.pdf): a batch can carry changesets; its shared URL cannot establish purity.

| Probe | Observation | Limit |
|---|---|---|
| SAP_BASIS 758, direct HTTPS/Basic, client 001; GET `/sap/bc/soap/wsdl11?services=STFC_CONNECTION&sap-client=001`, 09:25 UTC | HTTP 403 service-inactive HTML; no WSDL | Only the WSDL node was probed; dispatcher state and other configured bindings are unknown. No SOAP execution or SAP changes |
| Actual plugin dispatcher with local HTTP service | Read-scoped POST, disabled raw writes and disabled writes each send zero requests | Local authorization reproduction, not SAP read-only semantics |
| Actual plugin dispatcher, loopback HTTP service commits then returns 429, 503 or DB-500 | Main sends two POSTs / two simulated executions; fix sends one | Transport reproduction; no claim of a naturally occurring SAP duplicate |
| Named classRun / programRun, real dispatcher and loopback service, respectively 503 / DB-500 after execution | Before review fix: two POSTs / executions; shared no-transient-replay helper: one, with unconfirmed-completion guidance | Local fault injection, not live ABAP execution |
| Response disconnect after execution | One POST, but main advises retry; fix reports unconfirmed completion | No exactly-once guarantee |

Do not ship a new generic RFC executor, path-based read bypass, or guessed public SOAP codec.
A small codec remains a candidate after one supported binding is supplied. Record the distinct
remaining outcomes as FEAT-76/77; keep both issues open. Pure XML helpers cannot establish SAP
compatibility, operation authorization, or read-only semantics by themselves.

## Applied change and limits

Raw POST, classRun and programRun share the existing `retryTransientErrors: false` option and
preserve typed errors with `pluginPostOutcome: 'unknown'` for 429/5xx/network outcomes. The
dispatcher renders inspection guidance; a plugin that catches the error must preserve that warning.
Auth, any 403 (treated as possible CSRF expiry), and negotiation can still resend. No exactly-once
claim, new flag, or change to GET/PUT/DELETE and built-in ADT behavior. The separate read facade
[#886](https://github.com/arc-mcp/arc-1/pull/886) does not add RFC support.
