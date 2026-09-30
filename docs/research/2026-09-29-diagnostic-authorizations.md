# Diagnostic authorization hints — 2026-09-29

The old dump hints named `S_ADMI_FCD` value `ST22`; ST22 is the transaction name,
not a verified value for that authorization object. Correct the diagnostic text,
without changing SAP permissions, error classification or minimal-error handling.

## Evidence and scope

Read-only active-source GETs on SAP_BASIS 758 and 816 (direct HTTPS Basic, client
001) confirmed:

- `CL_RABAX_ADT_RES_DUMP` delegates display checks to `CL_DUMP_AUTHORIZATION`.
- That class checks `S_ABAPDUMP` ACTVT `03`; detail text uses `DUMP_INFO`, and
  user/client categories use `DUMP_CUSER` and `DUMP_CCLNT`.
- `CL_ADT_WB_RES_APP=>CHECK_RESOURCE_AUTHORIZATION` checks `S_ADT_RES`, field
  `URI`, using a 40-character value. The dump/list/Gateway path prefixes named
  in ARC-1's hints fit within that length; there is no need to broaden them to
  all runtime or Gateway resources.

[SAP's dump authorization documentation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/ba879a6e2ea04d9bb94c7ccd7cdac446/a89da3f6ef78466e80c1f672c9fc1255.html?locale=en-US&state=PRODUCTION&version=202510.001)
confirms exclusive use of `S_ABAPDUMP` from 7.58 (SAP Note 3229193). Earlier
releases can use legacy checks. [SAP's ADT role documentation](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_FOR_SOH_740/c238d694b825421f940829321ffa326a/4ec2c02e6e391014adc9fffe4e204223.html?version=7.40.17)
defines `S_ADT_RES` with `URI`, not activities.

The Gateway hint directs the operator to STAUTHTRACE for the effective user;
we do not prescribe one backend role across releases and security configurations.

These are source/documentation checks, not a reproduced authorization denial:
the available test users already have access. No role was weakened or expanded,
no dump contents were retrieved, and no live 403 was induced. Unit tests exercise
the endpoint-specific 403 hints. Roadmap checked: FEAT-74 concerns dump filters;
this correction has no roadmap impact.
