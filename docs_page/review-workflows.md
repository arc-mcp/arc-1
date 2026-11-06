# Transport reviews

Use `SAPTransport` through your MCP client. The same workflow runs when ARC-1 is hosted
on BTP Cloud Foundry, including pinned and aggregate read-only targets. No local files
or report renderer are required. These improvements require a build newer than 1.6.0.
Administrators can disable these bounded reads with `SAP_DENY_ACTIONS=SAPTransport.diff`.

## Review a request

1. Confirm the system/client and parent request ID. On `/multi/mcp`, supply `target` on every call.
2. Call `SAPTransport` with `{"action":"diff","id":"A4HK906371"}`.
3. Read `pageSummary`, `inventoryReason` and `notCompared` before interpreting the hunks.
4. If `nextOffset` is present, repeat with that `offset`. Keep the same request and target.
5. Summarize changes and unresolved gaps separately. Source evidence is not a release verdict.

Use `summary:true` for counts without hunks; it performs the same SAP reads. `get` provides
raw CTS entries. Run syntax, ATC or ABAP Unit separately when needed: these check current
objects and do not validate an old transported snapshot.

## What the comparison means

| Request status | Source selected |
|---|---|
| Released (`R`, `N`) | Historical snapshot attributed to the request or one of its tasks |
| Modifiable (`D`, `L`) | Active source; missing attribution is labeled as a candidate comparison |
| Releasing (`O`, `P`) or unknown | No comparison until a stable state can be selected |

The predecessor skips active/inactive work states and earlier saves under the same request.
Active source uses the latest retained snapshot outside the request; its own timestamp is not a
historical boundary. An attributed inactive draft is reported as pending and is never compared.
No retained predecessor does **not** prove creation. A missing part does **not** prove deletion
or unchanged source. Read each part's [baselineStatus](tools.md#actiondiff-reviewing-what-a-transport-changed).
Method keys select whole class source; they do not attribute individual hunks to methods.

## Object coverage

| CTS scope | Available evidence |
|---|---|
| Programs, standalone includes, interfaces | Source revisions, where SAP retains history |
| Classes | Main source and local definitions, implementations, macros, tests; CTS components narrow the parts read |
| Function modules | Source revisions after resolving the owning group |
| CDS definitions/access controls, behavior definitions, service definitions | Source revisions (`DDLS`, `DCLS`, `BDEF`, `SRVD`) |
| Text-only entries (`REPT`) | Explicit inventory gap; no unrelated source comparison |
| Dictionary objects, function-group sources, translations, Customizing | Inventory only; historical comparison is not verified |
| Whole objects | Source comparison leaves metadata unreviewed; classes/programs also leave texts, and programs screens/GUI status |

Fresh A4H/001 tests demonstrated two historical snapshots for programs and classes. The
other supported source families returned readable history but did not all have two snapshots.
Dictionary metadata advertised history links, but historical content returned “not supported”.
SAP BTP ABAP as the **backend** remains unverified; that is separate from hosting ARC-1 on CF.

## Limits and paging

| Per call | Limit |
|---|---|
| Objects | 20 by default, maximum 40 |
| Collection | 20 seconds, 180 reads/SAP attempts, 8 MiB cumulative bodies, 1 MiB per response |
| Diff calculation | 100 ms / 20,000 edits per part |
| Display | 400 lines / 16 KiB per part; 64 KiB total response |

A limit returns `stoppedBy` and any available evidence. An unfinished later object is retried
at `nextOffset`; a first object that alone exceeds the limit retains its explicit gap so paging
can advance. Display omissions preserve computed counts; unavailable comparisons do not.
Each page rereads inventory and sources. Objects or source may change between calls; restart
at offset 0 after such changes. There is no stored snapshot or cross-page consistency guarantee.
