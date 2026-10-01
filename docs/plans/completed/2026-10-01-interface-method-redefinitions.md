# Interface method redefinitions (#895)

The declaration reader accepts only bare names, so `/NS/IF~METHOD` disappears from
the definition comparison and is falsely reported as an orphan implementation.
`add_method` separately rejects every qualified name, even a valid inherited
interface method redefinition. SAP documents `METHODS meth [FINAL] REDEFINITION`
as an instance-method override with a matching implementation in the subclass.
SAP also omits the declaration range for bodies supplied by `INTERFACES`, so
`objectstructure` alone cannot detect every existing implementation.

## Implemented plan

1. Recognize a complete bare or interface-qualified name (including `/NS/`) in
   both declaration readers. Do not accept a valid prefix of a malformed name.
2. Allow qualified `METHODS ... [FINAL] REDEFINITION` through `add_method` in
   public visibility. Check the locked source for an existing body as well as
   the declaration ranges; explain how to add a new interface's missing body.
   Keep package checks, the locked read/modify/write lifecycle, and refusal of
   missing or orphaned implementations intact.
3. Reproduce both reports through the dispatcher, including true method removal,
   duplicate additions, and ordinary method behavior. Test the final code on
   disposable subclasses on SAP 758 and 816; verify activation and cleanup.
4. Document the supported form and release impact. No schema change or general
   ABAP parser rewrite is needed. The roadmap has no related unfinished item.

References: [SAP METHODS — REDEFINITION](https://help.sap.com/doc/abapdocu_750_index_htm/7.50/en-US/abapmethods_redefinition.htm),
[SAP interface visibility](https://github.com/SAP-samples/abap-cheat-sheets/blob/main/04_ABAP_Object_Orientation.md#implementing-interfaces).

## Outcome

Implemented with a shared name pattern and a narrow redefinition-clause check.
Whitespace/comment handling uses line-bounded indentation; a bounded process test
covers both malformed clauses and blank-line declaration blocks. Regression tests
reproduce the original report and the duplicate-body defect before their fixes.

Live on 2026-10-01, direct HTTPS/Basic through `handleToolCall`: SAP_BASIS 758 SP02
and 816 SP01 accepted and activated all three `/IWBEP/` redefinitions from #895.
A definition-only edit preserved implementation bytes; duplicate additions, real
orphan removal and an out-of-package write were refused. Both disposable `$TMP`
classes were deleted and their absence verified. This tests representative
subclasses, not the reporter's unavailable class, Kiro, transports or PP.

The review retest on both systems used disposable interfaces, implementing
classes and subclasses. SAP omitted definition ranges for the interface bodies;
duplicate `add_method` calls sent zero PUTs and preserved active and current
source. Existing bodies remained editable. Namespaced components also activated
and survived definition edits, using `lintBeforeWrite:false` because abaplint
rejects that syntax. All six objects were deleted and verified absent.
