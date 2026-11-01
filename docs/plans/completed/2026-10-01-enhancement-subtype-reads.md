# Enhancement subtype reads (#896)

The ENHO reader always uses `enhoxhb`, so hook metadata is fed to SAP's BAdI
transformation. Live 758/816 discovery advertises separate XHB and XHH routes;
XHH has a different XML root and a text source. On 750 only `enhoxh` is advertised,
and it can serve BAdIs. XH is therefore a legacy/generic route, not proof that an
object is a class enhancement. Some XH objects still fail inside SAP.

## Implemented plan and review decisions

1. Keep the current single-GET XHB success path and payload. After HTTP 400, 404
   or 500, resolve the exact name or constructed object URI through repository
   search. Retry only
   a different, recognized ENHO subtype; never try every collection or follow a
   returned URL. Authentication, authorization, network and throttling failures
   propagate without subtype fallback.
2. Use a small module for routing and hook parsing. Return XHH metadata, hook
   positions/overwrite flags and `/source/main`; a source failure remains a tool
   error. Preserve legacy BAdI `isActive`/`isDefault` flags on the XH fallback.
3. Keep read/search safety checks and the caller's client. No cache, SQL, writes,
   new tool arguments or slash aliases. Refuse unsupported explicit versions.
   Keep failure status and attach a collection/SAP GUI hint only to API errors
   400/404/500; connection, authentication and authorization errors keep their
   own guidance.
4. Prove dispatcher routing, one-request BAdI behavior, source-error propagation,
   exact identity/allowlisted routes, minimal errors and unchanged schemas.
   Replay reduced live XML fixtures, then verify live on 758/816 and legacy 750.
5. Correct the outdated ENHO research page and tool docs. FEAT-03 remains about
   authoring; ARCH-01 remains a general endpoint resolver, outside this fix.

Reference: [SAP source-code plug-ins](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/4ec1abd36e391014adc9fffe4e204223.html).

## Outcome

The dispatcher regression tests fail before the fix, including misleading SAP
GUI guidance on connection and authorization errors. Local test, type, lint,
policy, size, build and strict-docs gates pass. Tool schemas are unchanged.

Live HTTPS/Basic reads through `handleToolCall` pass on 758 SP02, 816 SP01 and 750.
The [research record](../../research/abap-types/types/enho.md) retains the subtype
contracts, 750 decorated-name evidence and remaining SAP-side XH failures.
No SAP objects were changed. Customer-specific objects, inactive drafts, PP, BTP
and MCP transport remain unverified. This change adds reads, not enhancement
authoring or a repair for SAP's remaining 500 errors. The failing XH object's
underlying enhancement technology is unverified.
