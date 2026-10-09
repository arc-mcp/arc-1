# Table-type dimension inputs

## Problem and native contract

TTYP create writes zero built-in length/decimals unless supplied internally. Public
`length`/`decimals` are DOMA/DTEL fields; the TTYP builder never receives them.
Description-only updates preserve existing dimensions, but callers cannot set or
change them. This is a missing authoring capability, not an update precision-loss
regression. Cloud exposure and advanced access/key definitions are separate work.

On October 9, the unmodified main builder's explicit metadata activated and read
back CHAR 32/0, DEC 5/2 and DEC 31/14 on 758 and 816 over verified HTTPS/Basic.
Each owned object was deleted with a confirming metadata 404. 750 discovery lacks
tabletypes; the public create refused it. Earlier BTP 920 direct-handler evidence
also confirms DEC 5/2; fresh Cloud qualification will accompany the change.

## Small implementation

1. Add `rowTypeLength` and `rowTypeDecimals` to public top-level and batch metadata
   on-prem inputs (Cloud TTYP remains excluded), with non-negative integer validation and a six-digit wire limit. Numeric
   strings can be normalized; booleans, fractions and empty strings are refused.
2. Route only TTYP create/update dimensions. Keep existing DOMA/DTEL field meaning.
   Require built-in row kind when dimensions are supplied; native SAP remains the
   authority on type-specific maximums and combinations. Do not add a release table
   for every DDIC data type.
3. Forward the fields through the existing metadata extraction and XML builder.
   Under the existing update lock, explicit values override stored dimensions;
   omission preserves them only if row name and kind remain unchanged. A changed
   row type must not inherit a different type's length/scale.
4. Keep advanced-definition update refusals and all discovery, scope, safety and
   real-package checks. No new endpoint, cache, generic metadata abstraction or
   alternative update engine.
5. Synchronize JSON schema, runtime schema, snapshots and examples. Add regression
   coverage for the actual emitted XML, explicit-zero update, omission preservation,
   changed row type, dictionary refusal and batch path.

## Plan review

- Existing internal names match the native model and avoid ambiguous reuse of
  DOMA/DTEL fields. The feature adds two fields, not an arbitrary XML escape hatch.
- Validation must not reject stored dictionary-row metadata merely because SAP
  reports its resolved dimensions. Carry dimension fields only for built-in rows.
- Reject invalid inputs before create; state-dependent update checks can occur
  after LOCK but before PUT, with normal finally/unlock behavior.
- Do not infer unsupported native combinations from a local schema pass. Use SAP
  activation/readback on supported targets, and test the 750 refusal explicitly.
- Reuse current merge/builder functions; a new shared framework is unnecessary.

## Validation and review completion

The regression failed on main (7 failures), then passed after implementation.
Final automated gates: 8,087 unit tests in 270 files; typecheck, Biome, action-policy
validation, build, size/schema budgets, and strict documentation build pass. Two
existing Biome informational suggestions remain. Review caught dictionary resolved
metadata propagation, misleading Cloud hints, and the schema token budget; the
implementation now keeps Cloud dimensions excluded and stays within the budget.

The compiled public dispatcher passed 16 scenario records each on 758 and 816:
single and batch DEC 5/2 creation; active readback; length-only 7 preserving scale;
explicit scale zero; accumulating inactive updates; description preservation;
CHAR 32 and STRING type changes; dictionary transition and dimension refusal;
a succeeding update after refusal (lock released); four invalid creates with
confirmed object absence. Both created objects per system were deleted, followed
by metadata 404. 750 returned the expected discovery refusal without creating an
object. Earlier direct-native cases also covered DEC 31/14 on both newer systems.

This is public dispatcher coverage with compiled ARC-1 code over HTTPS/Basic,
not HTTP MCP/PP or CTS qualification. BTP's named-user OAuth session needs renewed
login; its public TTYP type remains excluded by this PR. No Cloud pass is claimed.

Final review: JSON/runtime schema and batch metadata are aligned; explicit zero
survives nullish merging; invalid dictionary updates unlock without PUT; scope,
package, discovery and advanced-definition gates remain in the existing path.
Native SAP remains authoritative for type-specific bounds. No remaining finding
in this scope. FEAT-78 (advanced table definitions) remains deferred. FEAT-84 was
only a local audit recommendation, not present on main's roadmap; this implements
it without adding a completed entry. Cloud exposure remains separate.
