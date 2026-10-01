# Interface method redefinitions (#895)

The declaration reader accepts only bare names, so `/NS/IF~METHOD` disappears from
the definition comparison and is falsely reported as an orphan implementation.
`add_method` separately rejects every qualified name, even a valid inherited
interface method redefinition. SAP documents `METHODS meth [FINAL] REDEFINITION`
as an instance-method override with a matching implementation in the subclass.

## Implemented plan

1. Recognize a complete bare or interface-qualified name (including `/NS/`) in
   both declaration readers. Do not accept a valid prefix of a malformed name.
2. Allow qualified `METHODS ... [FINAL] REDEFINITION` through `add_method`, while
   retaining the hint for attempts to declare a new interface method there.
   Keep package checks, the locked read/modify/write lifecycle, and refusal of
   missing or orphaned implementations intact.
3. Reproduce both reports through the dispatcher, including true method removal,
   duplicate additions, and ordinary method behavior. Test the final code on
   disposable subclasses on SAP 758 and 816; verify activation and cleanup.
4. Document the supported form and release impact. No schema change or general
   ABAP parser rewrite is needed. The roadmap has no related unfinished item.

Reference: [SAP METHODS — REDEFINITION](https://help.sap.com/doc/abapdocu_750_index_htm/7.50/en-US/abapmethods_redefinition.htm).

## Outcome

Implemented with a shared name pattern and a narrow redefinition-clause check.
Whitespace/comment handling avoids overlapping scans; a bounded process test
rejects large malformed clauses without blocking.
Eight new regression cases failed on main before the fix. Full validation passed
(7,689 unit tests plus typecheck, lint, policy, sizes, build and strict docs).

Live on 2026-10-01, direct HTTPS/Basic through `handleToolCall`: SAP_BASIS 758 SP02
and 816 SP01 accepted and activated all three `/IWBEP/` redefinitions from #895.
A definition-only edit preserved implementation bytes; duplicate additions, real
orphan removal and an out-of-package write were refused. Both disposable `$TMP`
classes were deleted and their absence verified. This tests representative
subclasses, not the reporter's unavailable class, Kiro, transports or PP.
