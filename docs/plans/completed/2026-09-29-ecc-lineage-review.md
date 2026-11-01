# ECC pooled/cluster lineage review (#862 / #863)

Main refuses every catalog class except TRANSP, so enabling a blocklist prevents
unlisted ECC pooled/cluster reads too. The contributor's small existing patch is
an appropriate base: retain the bounded catalog query, require one active row,
reject replacement metadata on POOL/CLUSTER, and check the physical SQLTAB against
the blocklist. Keep transparent-table behavior and all permission gates intact.

Plan: merge current main, independently check SAP's 7.50 contract and the negative
cases, prove the new regressions fail with main's policy, run full gates, and use
available live systems for regression checks. Avoid another resolver or a general
physical-storage graph. COMPAT-08 is implemented; COMPAT-07 remains separate.

SAP's 7.50 keyword documentation explicitly forbids replacement objects on these
classes. The existing union and one container check are sufficient; no production
rewrite is warranted. Direct container reads still fail closed. Blocklist approval
does not make unsupported SQL valid or replace SAP authorization.

External live evidence in #862/#863 covers non-HANA ECC 7.50 SP23 through BTP PP.
That customer system is unavailable here; distinguish it from our direct-Basic
regression checks on 758 and 816 (11 passed / 3 cluster-fixture skips each). Tests detect missing/ambiguous metadata, blocked containers,
logical sibling independence, and container checks through dependency traversal.

Validation: full unit suite passes; typecheck, lint (two
pre-existing infos), policy, sizes, build and strict MkDocs pass. Restoring main's
policy makes nine targeted tests fail. No extra production logic was needed.
