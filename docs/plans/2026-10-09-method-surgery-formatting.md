# Preserve formatting during method surgery (#956)

## Evidence and root cause

The issue's small lowercase class reproduces all three effects locally and on
SAP 7.58. SAP's definition range starts at METHODS, excluding the preceding
ABAP Doc. Deleting only that range leaves the documentation on the next method;
removing the implementation joins the blank runs on either side. Adding a stub
does not insert a separator. Body-only editing manufactures uppercase boundary
lines instead of preserving the existing source. The disposable live class was
activated and deleted after the reproduction.

## Reviewed plan

- Extend a deleted definition upward only over contiguous ABAP Doc lines.
  Collapse only blank runs touching each deletion seam to at most one line.
  Do not format the rest of the class or remove ordinary comments.
- Add one separator before an inserted implementation when the preceding line
  is nonblank. Preserve existing blank space.
- Keep the original opening and closing statements for body-only edits. Use
  existing abaplint statement positions to preserve multiline headers and
  boundary comments too; rebuilding two fixed lines loses AMDP attributes.
  Keep full-block replacement unchanged. Refuse ambiguous shared-line ranges
  instead of deleting neighboring statements.
- Test exact source preservation, LF/CRLF, attached/unrelated docs, abstract
  methods, insertion at empty/populated blocks and body-only boundary variants.
  Repeat the public write sequence live, then activate and remove the fixture.

Review: no new formatter, configuration or general surgery framework is needed.
Do not extend this fix to changing visibility, signatures or chained declaration
semantics. Existing locking, package authorization and pre-write validation stay
in place. No roadmap impact after checking the current inventory.

## Validation

The issue regression file failed against main (nine failures); all 15 final
regression cases pass with the candidate. Final review added coverage for a split
ENDMETHOD statement, existing separator runs and abstract-method deletion. Only
blank runs touching the deleted ranges are collapsed.

All 8,082 unit tests, typecheck, lint, policy validation, build and file-size
checks pass. The live 7.58 sequence (create, activate, delete second, add fourth,
edit first, activate) passed all exact-source assertions. The fixture was deleted
and a subsequent read returned 404. AMDP, inline and split boundaries are covered
locally, not claimed as live AMDP verification. Full-block replacement retains
its existing contract; the extra ambiguity refusal applies to body-only edits.

The final diff review found no further issue. No roadmap impact.

## Claude review follow-up

The boundary counter also matched assignments to legal identifiers named `method`
and `endmethod`. Both new reproductions fail on the original PR head. Boundary
recognition now uses abaplint's MethodImplementation/EndMethod statement types,
not token spelling. The existing AMDP, same-line ambiguity and comment cases
still pass. This uses the parser already present and adds no abstraction.

The revised build passes all 8,084 unit tests, typecheck, lint, policy, build and
size/schema checks. On 758 SP02/client 001 over HTTPS/Basic, a disposable class
containing both identifiers activated successfully, then a body-only edit
preserved the rest of the source exactly and activated again. Deletion and a
404 read-back confirmed cleanup. AMDP remains unit-tested only. Roadmap rechecked:
no roadmap impact.
