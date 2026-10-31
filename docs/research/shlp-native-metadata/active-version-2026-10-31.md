# SHLP active-version qualification — 2026-10-31

Claude's initial review correctly identified that the implementation's active label lacked recorded
version-selection evidence. We traced the live native backend on **750 SP02 (NPL)** and **758 SP02
(A4H)** using authenticated, read-only ADT source reads.

## Native selection chain

1. The ordinary GET invokes `CL_SBD_ADT_RES_ELEMENT_INFO`. ARC-1 supplies `path` and `type=SHLP`,
   without a source/context payload.
2. On 750, its local factory selects `CL_DADT_SHLP_INFO_PROVIDER` for `SHLP`. On 758, the ordinary
   path delegates to `CL_DDIC_ELEM_INFO_PROVIDER`; that class's local factory selects the same
   SHLP provider. Both routes were inspected on the live systems.
3. `CL_DADT_SHLP_INFO_PROVIDER->GET_SEARCH_HELP_DATA` calls `DDIF_SHLP_GET` with the name and
   language. It omits the optional `STATE` argument.
4. On both releases, the function's native signature declares `STATE DEFAULT 'A'` (active).
   `LSDIFF00`'s `GET_READSTATE` preserves `A`: for `state ca 'AM'`, it assigns `readstate = state`.
5. `DDIF_SHLP_GET` applies that read state to both `get_state-SHHD` (header) and `get_state-SHFD`
   (parameters), then passes it to `DD_SHLP_GET`. There is no request to select the caller's
   inactive draft in this path.

The active selection is therefore made by SAP's native provider. ARC-1 does not need an extra
version query parameter or another production request. `sourceVersion: 'active'` is justified for
these qualified backends by their explicit Dictionary read contract.

## Evidence and regression check

- [A4H source fingerprints and observed contract](active-backend-a4h-2026-10-31.json)
- [NPL source fingerprints and observed contract](active-backend-npl-2026-10-31.json)
- SHA-256 values cover the UTF-8 source strings returned by `AdtClient`, including original line
  endings. Full SAP source bodies are not published in this repository.
- `tests/integration/shlp.integration.test.ts` now checks the provider's omitted state argument,
  the function's active default, the identity mapping and the header/parameter state assignments.
  The updated suite passed **8/8 on each system**.

Qualification used backend-source inspection plus live metadata reads. No draft was created or
changed, and no second-user draft comparison was performed. This is recorded explicitly rather
than claiming a draft-mutation control. Other releases and customized provider implementations
remain unqualified; changes to the native selection chain require requalification.
