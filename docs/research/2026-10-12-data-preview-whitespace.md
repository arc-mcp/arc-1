# Data-preview whitespace (#982)

The shared XML parser trimmed cell text: `"   A  B"` became `"A  B"`, shifting
positional flags. Separately, the SQL echo collapsed spaces inside literals.
Both defects reproduced against main `128aafbff`, including old/asx and modern XML.

Use the same parser options/entity decoder with `trimValues: false` only for
data-preview rows and metrics. Ordinary ADT metadata keeps its existing trimming.
Return the decoded SQL echo without additional normalization. XML's own newline
normalization still applies; the echo is not a request-body capture.

Cell values remain strings. Preserve all native whitespace, including numeric
padding (`"7 "`), rather than guessing which spaces have semantic meaning. Numeric
metrics trim explicitly before conversion. The authorization-trace decoder also
trims numeric FIRSTCALL and ABAPLINE before interpreting them; a live constant
projection on 758/816 reproduced an empty timestamp without this adjustment.
Authorization values and raw query cells retain their whitespace.
No new tool input or release rule.

Initial read-only constants probe, direct HTTPS Basic:

| SAP_BASIS | SAP response | Before fix | LENGTH |
|---|---|---|---|
| 758 SP02 | `"   A  B"` | `"A  B"` | 7 |
| 816 SP01 | `" A B"` | `"A B"` | 4 |

The 816 response already contains different literal spacing. Its upstream cause is
outside this parser fix; preserving response text cannot reconstruct omitted spaces.

Regression coverage includes both XML formats, blank-only/empty cells, leading and
trailing spaces, zero-prefixed values, numeric padding, entities, CDATA and echo
whitespace. Public-tool live validation and remaining release limits belong in the PR.
Roadmap checked: no roadmap impact.
