# Explicit server-driven read versions (#840)

The SDO read branch exits before common version handling and drops the requested version on both
GETs. Live 816 reproduction with different active/draft DRTY, DESD and DTDC source confirms that
`SAPRead(version="active")` returns the draft. Raw explicit-version requests distinguish them.

## Implementation and review

- Pass explicit `active`/`inactive` to both metadata and source. Keep omitted/`auto` unversioned to
  preserve developer workflows; correct the model description and human documentation.
- SAP also substitutes missing versions: newly created objects answer an active request with
  inactive metadata; activated objects without drafts answer inactive with active metadata.
  Refuse explicit reads when metadata cannot confirm the requested version. Do not retry another
  version or return mislabeled source. Existing HTTP failures propagate.
- Keep discovery, per-user identity, metadata formats and cache bypass. No per-release switches,
  new public parameters or separate version cache. Reads remain two requests, not an atomic
  repository snapshot against simultaneous activation.
- Verify JSON/text, DTDC and UIAD contracts live, version failures through the dispatcher, tool
  description snapshots and local repository gates. No roadmap impact after checking.

## Evidence

Direct HTTPS/Basic, owned `$TMP` objects, 2026-09-25:

| Target | Verified behavior |
|---|---|
| 758 | DRTY and DTDC active plus different draft: explicit reads distinguish them; omitted/auto retains draft; UIAD and DESD discovery absent |
| 816 | DRTY, DESD and DTDC: same active/draft distinction; active requested before activation and inactive requested without a draft are refused |
| 816 UIAD | Both creates and updates save active immediately; active/auto/omitted read the saved source; explicit inactive is refused |

Every created object was deleted and metadata 404 verified. The dispatcher reproduced the original
active→draft error before implementation. Twelve new unit cases cover the four representative
families, cache bypass, unconfirmed metadata and HTTP failures. All 7,117 tests pass (full run plus
focused rerun after updating a wording assertion); typecheck, lint, policy, budgets, build and
strict docs pass. Not every registry type/release or BTP identity mode was exercised live.

[SAP's activation guide](https://help.sap.com/docs/SAP_NETWEAVER_750/cc0c305d2fab47bd808adcad3ca7ee9d/4ed266bd6e391014adc9fffe4e204223.html)
explains active repository versions; it does not establish each ADT endpoint's fallback behavior.
The live metadata/source pairs above determine the implementation, including the missing-version
refusal. This intentionally differs from older non-SDO reads that allow active fallback.
