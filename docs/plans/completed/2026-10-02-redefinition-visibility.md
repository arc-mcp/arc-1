# Preserve inherited method visibility

Root cause: the visibility action discarded SAP's `redefinition="true"` metadata and moved ordinary inherited methods, creating an invalid inactive draft. SAP 758 reproduced success plus one PUT followed by failed activation; #902's qualified-name guard does not cover these names.

Keep that flag through unified and split method parsing. After the existing no-op check, refuse a visibility move before lint/save. SAP metadata also covers pragmas and chained declarations without reparsing ABAP. No tool schema/configuration change; ordinary moves remain unchanged.

Validation: dispatcher regressions fail without the guard or parser flag; no-op tests cover ordinary and interface names. Live SAP 758 (Basic/client 001) and BTP 920 SP04 (named-user OAuth/client 100) refuse protected/private moves with zero PUTs and unchanged source; subsequent edit/activation proves unlock. Every disposable class was deleted and confirmed absent. The final implementation was not tested on 816: login failed with license-check error E 00 179 before writes. Split metadata has unit coverage; no fresh 750 live run. A final SAP 758 check also verifies the repair hint: an invalid draft stays unchanged after refusal, then edit_class_definition repairs its section while preserving the body, and activation succeeds.

No roadmap impact after checking the idea list. Contract: [SAP — Redefining Methods](https://help.sap.com/docs/abap-cloud/abap-keyword/abap-objects-redefining-methods?locale=en-US&state=PRODUCTION&version=latest).
