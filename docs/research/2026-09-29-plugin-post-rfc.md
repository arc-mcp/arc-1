# Extension POST and function-module investigation — 2026-09-29

## Evidence and decision

[#884](https://github.com/arc-mcp/arc-1/issues/884) and
[#885](https://github.com/arc-mcp/arc-1/issues/885), reported by Silvio Marino, describe real
limitations: no parameterized `ctx.run` operation, and raw POSTs require write authorization.
The inspected [claude-sap-kit source](https://github.com/silvius1996/claude-sap-kit/tree/abb20b5b8c037b95b5d48510c0f5ba1fc0a72117/skills/sap-arc1-kit/assets/arc1-extension/src)
uses `/sap/bc/soap/rfc` for both SmartForm reads and writes. A URL-only read exception would permit
both bodies. Its regex SOAP helper assumes the legacy operation/response shape; it is useful use-case
evidence, not a verified contract for modern configured service bindings. No source was copied.

Primary sources checked:

- [SAP ABAP Web Services lifecycle](https://help.sap.com/docs/SAP_NETWEAVER_740/f1cccec432514a3181f2852f2b91d306/c84cb8db0b3b43908ae4e987f3a3ade5.html): SOAP Processor 6.20 under `/sap/bc/soap/` is deprecated; SAP recommends newer ABAP Web Services infrastructure. This does not mean all SOAP services are deprecated.
- [SAP binding WSDL guidance](https://help.sap.com/docs/SUPPORT_CONTENT/abapconn/3354079866.html): configured bindings supply endpoint/protocol details; design-time WSDL is not an interchangeable execution contract.
- [SAP RFC authorization](https://help.sap.com/docs/SAP_NETWEAVER_740/c495ada972d045b2be2869f5573af8e7/488d1bd1ae444e6ee10000000a421937.html): `S_RFC` authorizes execution, not general proof of read-only behavior.
- [HTTP retry semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2): automatic replay of a non-idempotent request needs knowledge that it is safe or was not applied. The raw plugin API has neither.
- [OData batch protocol, section 11.7](https://docs.oasis-open.org/odata/odata/v4.0/errata03/odata-v4.0-errata03-part1-protocol-complete.pdf): a batch can carry changesets; its shared URL cannot establish purity.

| Probe | Observation | Limit |
|---|---|---|
| SAP_BASIS 758, direct HTTPS/Basic, client 001; GET `/sap/bc/soap/wsdl11?services=STFC_CONNECTION&sap-client=001`, 09:25 UTC | HTTP 403 service-inactive HTML; no WSDL | No SOAP execution, service activation or authorization change; no conclusion about other configured bindings |
| Actual plugin dispatcher with local HTTP service | Read-scoped POST, disabled raw writes and disabled writes each send zero requests | Local authorization reproduction, not SAP read-only semantics |
| Actual plugin dispatcher, loopback HTTP service commits then returns 429, 503 or DB-500 | Main sends two POSTs / two simulated executions; fix sends one | Transport reproduction; no claim of a naturally occurring SAP duplicate |
| Response disconnect after execution | One POST, but main advises retry; fix reports unconfirmed completion | No exactly-once guarantee |

Do not ship a new generic RFC executor, path-based read bypass, or guessed public SOAP codec.
A small codec remains a candidate after one supported binding is supplied. Record the distinct
remaining outcomes as FEAT-76/77; keep both issues open. Pure XML helpers cannot establish SAP
compatibility, operation authorization, or read-only semantics by themselves.

## Applied plan and review

Use the existing `retryTransientErrors: false` option only for `ctx.http.post`. Preserve the
original typed error and tag ambiguous 429/5xx/network outcomes. Render inspection guidance before
the dispatcher's generic retry hints, including minimal-error mode. Existing permission gates,
identity, audit and CSRF/auth/negotiation behavior stay intact; no new flag or transport abstraction.

Four regression scenarios fail on main. Real-loopback tests cover committed failures, disconnect,
success, CSRF recovery, a pre-execution 400, existing gate refusals and terminal audit. The change
is deliberately limited to the raw plugin POST surface; GET, PUT, DELETE and named execution
operations retain their current policies. Even POST can resend after auth/CSRF/negotiation errors;
plugins must not advertise exactly-once execution or automatically retry an ambiguous tool error.

The separate read-facade correction [#886](https://github.com/arc-mcp/arc-1/pull/886) prevents new
internal client methods from silently becoming plugin capabilities. It does not add RFC support.
