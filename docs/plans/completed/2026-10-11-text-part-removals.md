# Report text-part replacements from SAP state

PR #975 demonstrates a real usability gap: `edit_text_symbols` intentionally
replaces one complete part, but its success message hides removed texts and lost
`@DDICReference` annotations. Preserve that contract and report confirmed losses.

## Root cause and design review

On 758 SP02 and 816 SP01, a sparse selection write removes omitted labels and
loses dictionary references that are not resent. BTP ABAP 920 SP05 shows the same
replacement behavior for class symbols. Native read-back and deletion/404 checks
were performed through HTTPS Basic (on-prem) and named-user OAuth (BTP).

The external input-comparison approach has counterexamples: SAP accepts lowercase
keys and leading whitespace, resolves dictionary labels, and returns placeholders
for unmaintained selections. Its proposed exemption for dictionary-label lengths
is also incorrect: SAP rejects supplied labels over 30 characters on 758/816.

Use the existing pool lock and session for GET → PUT → GET. Compare only native
bodies, then unlock and request activation as before. A small parser records keys,
maintained-text presence and dictionary annotations; it does not validate outgoing
syntax. Report emptied text values and removed symbol definitions (including empty
definitions), as well as lost dictionary references independently, without claiming a
removed dictionary entry became fixed text. Restore instructions refer to the
previous complete body, because reading after replacement cannot recover it.

SAP remains the authority for syntax/length validation. Reimplementing its parser
would add a second compatibility contract; the companion transport fix removes
redundant retries of application validation failures. No merge mode, flag or schema
change is needed. Each write costs two extra GETs inside its existing lock.

## Failure states and verification

A failed first GET prevents PUT. A failed PUT keeps its original error. If PUT
succeeds but read-back or unlock fails, explicitly retain saved-state information
and do not request activation. If activation fails, preserve the verified removal
report alongside the existing saved-state hint, including in minimal-error mode.
The existing cache invalidation and package/scope/safety gates stay in place.

Unit regressions cover native normalization, omitted and emptied symbols,
selection placeholders, dictionary references, lock ordering and saved-state hints.
Live verification uses 758 SP02 / 816 SP01 over HTTPS Basic and BTP ABAP 920 SP05
class symbols over named-user OAuth. The lifecycle suite includes PROG/FUGR,
activation/recovery, lowercase keys, dictionary labels and explicit clears.
All disposable owners are deleted and verified 404. Final-revision results belong
in the PR's validation record; 750 lacks the service, and no 7.40, PP or BTP
classic-object coverage is claimed.

No roadmap impact; FEAT-34 addresses translation beyond these existing surfaces.
