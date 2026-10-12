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
  existing abaplint statement positions and types to preserve multiline headers
  and boundary comments; rebuilding two fixed lines loses AMDP attributes.
  Statement types distinguish METHOD/ENDMETHOD from assignments to identifiers
  named `method` or `endmethod`.
  Keep full-block replacement unchanged. Refuse ambiguous shared-line ranges
  instead of deleting neighboring statements.
- Test exact source preservation, LF/CRLF, attached/unrelated docs, abstract
  methods, insertion at empty/populated blocks and body-only boundary variants.
  Repeat the public write sequence live, then activate and remove the fixture.

Review: no new formatter, configuration or general surgery framework is needed.
Do not extend this fix to changing visibility, signatures or chained declaration
semantics. Existing locking, package authorization and pre-write validation stay
in place. No roadmap impact after checking the current inventory.

## Live verification

On 758 SP02/client 001/HTTPS Basic, the create/delete-method/add-method/edit-method
sequence preserved expected source and activated successfully. A class with
`method`/`endmethod` variables also edited and activated correctly. Fixtures were
deleted and absence verified. AMDP and split boundaries have unit coverage only.
