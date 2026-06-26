# NW 7.50 ADT Discovery — Gap Analysis

Cross-reference of every endpoint in the NW 7.50 ADT discovery document (`tests/fixtures/xml/discovery-nw750.xml`) against what ARC-1 implements. Only endpoints present in the discovery XML are listed — ARC-1 endpoints not in the discovery file (e.g., custom endpoints, OData services) are out of scope.

## Potentially Valuable Gaps

Endpoints present in NW 7.50 discovery but not implemented in ARC-1.

| # | Discovery Endpoint | Title | Notes |
|---|---|---|---|
| 1 | `/sap/bc/adt/datapreview/cds` | Data Preview for CDS | Only `freestyle` and `ddic` are used. CDS preview supports association navigation. |
| 2 | `/sap/bc/adt/abapsource/typehierarchy` | Type Hierarchy | Class/interface inheritance tree |
| 3 | `/sap/bc/adt/abapsource/cleanup/source` | Source Cleanup | SAP's built-in source cleanup/refactoring |
| 4 | `/sap/bc/adt/abapsource/codecompletion/elementinfo` | Element Info (code completion) | Hover-style type info for symbols |
| 5 | `/sap/bc/adt/abapsource/codecompletion/insertion` | Code Insertion | Pattern-based code insertion |
| 6 | `/sap/bc/adt/ddic/ddl/dependencies/graphdata` | DDL Dependency Graph | Server-computed CDS dependency graph |
| 7 | `/sap/bc/adt/ddic/ddl/elementinfo` | DDL Element Info | CDS field/annotation metadata |
| 8 | `/sap/bc/adt/ddic/ddl/elementinfos` | DDL Mass Element Info | Batch CDS field info |
| 9 | `/sap/bc/adt/ddic/ddl/activeobject` | DDL Active Object | Resolve active CDS entity from data source |
| 10 | `/sap/bc/adt/ddic/ddl/createstatements` | DDL sqlView Create Statement | Generated SQL view DDL |
| 11 | `/sap/bc/adt/ddic/ddl/ddicrepositoryaccess` | DDL Dictionary Repository Access | CDS path-based field resolution |
| 12 | `/sap/bc/adt/ddic/ddl/formatter/identifiers` | DDL Case Preserving Formatter | CDS identifier formatting |
| 13 | `/sap/bc/adt/ddic/codecompletion` | DDIC Code Completion | Dictionary-level code completion |
| 14 | `/sap/bc/adt/ddic/elementinfo` | DDIC Element Info | Dictionary element type info |
| 15 | `/sap/bc/adt/ddic/typegroups` | Type Groups (TYPS) | Missing object type — can't read type group source |
| 16 | `/sap/bc/adt/ddic/dbprocedureproxies` | Database Procedure Proxies | AMDP proxy objects |
| 17 | `/sap/bc/adt/repository/informationsystem/usageSnippets` | Usage Snippets | Source snippets for where-used results |
| 18 | `/sap/bc/adt/repository/informationsystem/messagesearch` | Message Search | Search T100 messages by text |
| 19 | `/sap/bc/adt/repository/informationsystem/executableObjects` | Executable Objects | Find runnable programs |
| 20 | `/sap/bc/adt/repository/informationsystem/fullnamemapping` | Full Name Mapping | Map full names to ADT URIs |
| 21 | `/sap/bc/adt/repository/informationsystem/metadata` | Repository Metadata | Repository-level metadata |
| 22 | `/sap/bc/adt/repository/informationsystem/objecttypes` | Object Types | Enumerate available object types |
| 23 | `/sap/bc/adt/repository/informationsystem/releasestates` | Release States | C0/C1/C2 API release state list |
| 24 | `/sap/bc/adt/repository/informationsystem/executableobjecttypes` | Executable Object Types | Enumerate executable object types |
| 25 | `/sap/bc/adt/repository/nodepath` | Node Path | Object-to-package path |
| 26 | `/sap/bc/adt/repository/objectstructure` | Object Structure | Object internal structure |
| 27 | `/sap/bc/adt/repository/typestructure` | Type Structure | Type component breakdown |
| 28 | `/sap/bc/adt/repository/proxyurimappings` | Proxy URI Mappings | Proxy URI resolution |
| 29 | `/sap/bc/adt/oo/classrun` | Class Run | Execute `IF_OO_ADT_CLASSRUN` classes |
| 30 | `/sap/bc/adt/oo/linenumber` | Line Number | Line mapping across includes |
| 31 | `/sap/bc/adt/oo/validation/objectname` | OO Name Validation | Validate class/intf name before create |
| 32 | `/sap/bc/adt/docu/abap/langu` | ABAP Language Help | ABAP keyword documentation |
| 33 | `/sap/bc/adt/docu/ddl/langu` | DDL Language Help | CDS keyword documentation |
| 34 | `/sap/bc/adt/docu/dcl/langu` | DCL Language Help | DCL keyword documentation |
| 35 | `/sap/bc/adt/acm/dcl/parser` | DCL Parser Info | DCL parser metadata |
| 36 | `/sap/bc/adt/acm/dcl/validation` | DCL Name Validation | Validate DCL name before create |
| 37 | `/sap/bc/adt/ddic/ddl/parser` | DDL Parser Info | DDL parser metadata |
| 38 | `/sap/bc/adt/ddic/ddl/validation` | DDL Name Validation | Validate DDL name before create |
| 39 | `/sap/bc/adt/ddic/ddl/elementmappings` | DDL Element Mappings | CDS element mapping |
| 40 | `/sap/bc/adt/ddic/ddl/elementmappings/strategies` | DDL Mapping Strategies | CDS mapping strategy options |
| 41 | `/sap/bc/adt/classifications` | Object Classifications | C0/C1/C2 API release classification |
| 42 | `/sap/bc/adt/runtime/traces/abaptraces/parameters` | Trace Parameters | Profiler trace configuration |
| 43 | `/sap/bc/adt/runtime/traces/abaptraces/requests` | Trace Requests | Trigger profiler trace capture |
| 44 | `/sap/bc/adt/enhancements/enhoxh` | Enhancement Implementation (alt URL) | ARC-1 uses `enhoxhb`, discovery lists `enhoxh` |
| 45 | `/sap/bc/adt/enhancements/enhsxs` | Enhancement Spots | Enhancement spot definitions (not implementations) |
| 46 | `/sap/bc/adt/xslt/transformations` | XSLT Transformations | Missing object type — XSLT/ST source |
| 47 | `/sap/bc/adt/system/users` | Users | Query SAP users |
| 48 | `/sap/bc/adt/system/clients` | Clients | List SAP clients |
| 49 | `/sap/bc/adt/system/information` | System Information | System-level metadata |
| 50 | `/sap/bc/adt/system/landscape/servers` | System Landscape | Application server list |
| 51 | `/sap/bc/adt/packages/settings` | Package Settings | Package configuration metadata |
| 52 | `/sap/bc/adt/cts/transportrequests/reference` | Transport Reference | Transport reference data |
| 53 | `/sap/bc/adt/atc/customizing` | ATC Customizing | ATC check configuration |
| 54 | `/sap/bc/adt/atc/ccstunnel` | ATC CCS Tunnel | CCS proxy tunnel |
| 55 | `/sap/bc/adt/atc/results` | ATC Results | Persistent ATC result sets |
| 56 | `/sap/bc/adt/atc/approvers` | ATC Approvers | Exemption approver list |
| 57 | `/sap/bc/adt/atc/variants` | ATC Variants | Check variant list |
| 58 | `/sap/bc/adt/atc/exemptions/apply` | ATC Exemptions | Apply ATC exemptions |
| 59 | `/sap/bc/adt/checkruns/reporters` | Check Reporters | Available check reporters |
| 60 | `/sap/bc/adt/basic/object/properties` | Basic Object Properties | Generic object property reader |
| 61 | `/sap/bc/adt/urifragmentmappings` | URI Fragment Mapper | Map URI fragments to plain text |
| 62 | `/sap/bc/adt/abapsource/occurencemarkers` | Occurrence Markers | Highlight all occurrences of a symbol |
| 63 | `/sap/bc/adt/abapsource/parsers/rnd/grammar` | ABAP Parser Grammar | ABAP parser metadata |
| 64 | `/sap/bc/adt/abapsource/abapdoc/exportjobs` | ABAP Doc Export | Export ABAP documentation |
| 65 | `/sap/bc/adt/sqlm/data` | SQLM Marker Data | SQL Monitor marker data |
| 66 | `/sap/bc/adt/security/reentranceticket` | Reentrance Ticket | Security reentrance ticket |
| 67 | `/sap/bc/adt/ato/settings` | ATO Settings | Adaptation Transport Organizer |
| 68 | `/sap/bc/adt/sscr/registration/objects` | SSCR Object Registration | Developer key management |
| 69 | `/sap/bc/adt/sscr/registration/objects/validation` | SSCR Object Validation | SSCR validation |
| 70 | `/sap/bc/adt/sscr/registration/developers/validation` | SSCR Developer Validation | Developer registration validation |
| 71 | `/sap/bc/adt/businesslogicextensions/badis` | BAdI Definitions | BAdI read + compatibility check |
| 72 | `/sap/bc/adt/businesslogicextensions/badinameproposals` | BAdI Name Proposals | BAdI naming suggestions |
| 73 | `/sap/bc/adt/ddic/dataelements/validation` | Data Element Validation | Validate DTEL name before create |
| 74 | `/sap/bc/adt/ddic/structures/validation` | Structure Validation | Validate structure name before create |
| 75 | `/sap/bc/adt/ddic/views/$validation` | View Validation | Validate view name |
| 76 | `/sap/bc/adt/ddic/validation` | DDIC SQSC Validation | DDIC-level validation |
| 77 | `/sap/bc/adt/ddic/typegroups/validation` | Type Group Validation | Validate type group name |
| 78 | `/sap/bc/adt/enhancements/enhoxh/validation` | Enhancement Impl Validation | Validate ENHO name |
| 79 | `/sap/bc/adt/enhancements/enhsxs/validation` | Enhancement Spot Validation | Validate ENHS name |
| 80 | `/sap/bc/adt/programs/validation` | Program Validation | Validate program name before create |
| 81 | `/sap/bc/adt/includes/validation` | Include Validation | Validate include name |
| 82 | `/sap/bc/adt/functions/validation` | Function Group Validation | Validate FUGR name |
| 83 | `/sap/bc/adt/messageclass/validation` | Message Class Validation | Validate MSAG name |
| 84 | `/sap/bc/adt/filestore/ui5-bsp/ui5-rt-version` | SAPUI5 Runtime Version | UI5 runtime version info |
| 85 | `/sap/bc/adt/filestore/ui5-bsp/deploy-storage` | UI5 Deploy Storage Marker | Deploy storage support flag |

## Eclipse-Only / Not Useful for MCP (excluded)

| Category | Count | Endpoints | Why excluded |
|---|---|---|---|
| BOPF | 8 | `/sap/bc/adt/bopf/*` | Legacy BOL/BOPF, Eclipse wizard-specific |
| Solution Manager CM | 3 | `/sap/bc/adt/solutionmanager/cm/*` | SolMan Change Management integration |
| UI Flexibility | 1 | `/sap/bc/adt/ui_flex_dta_folder/` | DTA folder deployment |
| AMDP Debugger | 1 | `/sap/bc/adt/amdp/debugger/main` | Interactive HANA debugging session |
| Code Composer | 6 | `/sap/bc/adt/cmp_code_composer/*` | Eclipse template wizard |
| Dummy types | 4 | `/sap/bc/adt/dummygroup/*` | SAP internal test types |
| Object Type Admin | 4 | `/sap/bc/adt/objtype_admin/*` | Object type registration admin |
| Enterprise Services | 13 | `/sap/bc/esproxy/*` | SOA proxy management |
| Feed Repository | 3 | `/sap/bc/adt/dataproviders`, `/feeds` | ADT internal feed framework |
| Dynamic Logpoints | 3 | `/sap/bc/adt/dlp/*` | Interactive runtime logging |
| Debugger | 12 | `/sap/bc/adt/debugger/*` | Interactive ABAP debugging |
| Web Dynpro | 27 | `/sap/bc/adt/wdy/*` | WDA component editor |
| FPM | 1 | `/sap/bc/adt/fpm/creationtools` | FPM wizard |
| NHI / HANA Integration | 6 | `/sap/bc/adt/nhi/*` | HANA repository transport |
| Data Preview AMDP | 2 | `/sap/bc/adt/datapreview/amdp*` | AMDP-specific preview |
| ADT HTTP Endpoint | 1 | System-specific full URL | ADT framework internal |

## Already Implemented

| Endpoint | ARC-1 Usage |
|---|---|
| `/sap/bc/adt/programs/programs` | SAPRead PROG |
| `/sap/bc/adt/programs/includes` | SAPRead INCL |
| `/sap/bc/adt/oo/classes` | SAPRead CLAS |
| `/sap/bc/adt/oo/interfaces` | SAPRead INTF |
| `/sap/bc/adt/functions/groups` | SAPRead FUGR/FUNC |
| `/sap/bc/adt/ddic/ddl/sources` | SAPRead DDLS |
| `/sap/bc/adt/acm/dcl/sources` | SAPRead DCLS |
| `/sap/bc/adt/ddic/structures` | SAPRead STRU |
| `/sap/bc/adt/ddic/dataelements` | SAPRead DTEL |
| `/sap/bc/adt/ddic/views` | SAPRead VIEW |
| `/sap/bc/adt/messageclass` | SAPRead MSAG |
| `/sap/bc/adt/repository/informationsystem/search` | SAPSearch (quick search) |
| `/sap/bc/adt/repository/informationsystem/usageReferences` | Where-used analysis |
| `/sap/bc/adt/repository/nodestructure` | Package hierarchy browsing |
| `/sap/bc/adt/datapreview/ddic` | SAPQuery table preview |
| `/sap/bc/adt/datapreview/freestyle` | SAPQuery free SQL |
| `/sap/bc/adt/activation` | SAPActivate |
| `/sap/bc/adt/activation/inactiveobjects` | List inactive objects |
| `/sap/bc/adt/checkruns` | Pre-write syntax check |
| `/sap/bc/adt/abapunit/testruns` | Unit test execution |
| `/sap/bc/adt/atc/runs` + `worklists` | ATC check runs |
| `/sap/bc/adt/quickfixes/evaluation` | Quick fix proposals |
| `/sap/bc/adt/abapsource/prettyprinter` + `/settings` | Pretty printer |
| `/sap/bc/adt/abapsource/codecompletion/proposal` | Code completion |
| `/sap/bc/adt/navigation/target` | Go-to-definition |
| `/sap/bc/adt/cts/transports` | Transport info check |
| `/sap/bc/adt/cts/transportrequests` | Transport management |
| `/sap/bc/adt/cts/transportchecks` | Transport requirement checks |
| `/sap/bc/adt/refactorings` | Refactoring framework |
| `/sap/bc/adt/refactoring/changepackage` | Package move (incorrectly gated at 754) |
| `/sap/bc/adt/runtime/dumps` + `dump/{id}` | Short dump listing + detail |
| `/sap/bc/adt/runtime/systemmessages` | SM02 system messages |
| `/sap/bc/adt/runtime/traces/abaptraces` | Profiler trace listing + detail |
| `/sap/bc/adt/gw/errorlog` | Gateway error log |
| `/sap/bc/adt/system/components` | System detection (SAP_BASIS release) |
| `/sap/bc/adt/filestore/ui5-bsp/objects` | UI5 BSP app listing |

## Top 10 Most Valuable Gaps (ranked by MCP usefulness)

1. **`/sap/bc/adt/ddic/ddl/dependencies/graphdata`** — CDS dependency graph. Would supercharge `SAPContext action="impact"` with server-computed dependency trees instead of client-side where-used traversal.

2. **`/sap/bc/adt/datapreview/cds`** — CDS-aware data preview with association navigation. Currently ARC-1 only has `ddic` (table) and `freestyle` (SQL). CDS preview would enable reading CDS view data directly.

3. **`/sap/bc/adt/abapsource/typehierarchy`** — Inheritance tree. Useful when an LLM needs to understand class hierarchies for refactoring.

4. **`/sap/bc/adt/ddic/typegroups`** — Type groups (TYPS). A missing object type — can't read type group source.

5. **`/sap/bc/adt/classifications`** — API release classification (C0/C1/C2). Important for cloud-readiness checks.

6. **`/sap/bc/adt/repository/informationsystem/messagesearch`** — Search T100 messages by text. Currently requires SQL (`SAPQuery`).

7. **`/sap/bc/adt/xslt/transformations`** — XSLT/Simple Transformations source. A missing object type.

8. **`/sap/bc/adt/oo/classrun`** — Execute `IF_OO_ADT_CLASSRUN` classes. Could enable running console apps.

9. **`/sap/bc/adt/enhancements/enhsxs`** — Enhancement spots. Currently only ENHO (implementations) is supported, not ENHS (spots).

10. **`/sap/bc/adt/businesslogicextensions/badis`** — BAdI definitions. Would let an LLM read BAdI structures and run compatibility checks.

## Known Issues Found

- **`change_package` incorrectly gated at `minRelease: 754`** — The NW 7.50 discovery XML (line 1287) explicitly lists `/sap/bc/adt/refactoring/changepackage` with title "Change Package Assignment". The `ACTION_RELEASE_GATES` entry in `tools.ts` and `intent.ts` should be removed.

- **`enhoxh` vs `enhoxhb` URL mismatch** — Discovery lists `/sap/bc/adt/enhancements/enhoxh`, but ARC-1 uses `/sap/bc/adt/enhancements/enhoxhb`. Both may exist; worth verifying which URL the probe catalog should reference.
