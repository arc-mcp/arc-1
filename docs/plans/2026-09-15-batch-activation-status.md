# Batch activation attribution and uncertainty

## Root cause and plan

The mapper used a raw URI prefix, so an error on ZFIRST2 was assigned to ZFIRST.
It also inferred active from absence of a diagnostic after SAP cancelled the batch.
Use a shared boundary-aware object/source matcher (the same helper as #788), mark
unreported members unknown when the overall activation fails, retain their own
warnings, and render global messages separately. Include the status in every row,
including rows with messages. Retain the existing inactive syntax diagnostics.

Plan review: overall success still permits active/warning statuses; an own error
always wins. Names sharing a prefix must not share diagnostics. No transport,
activation protocol, publication retry or authorization changes are needed.

## Message retention

Global messages are separated from object-specific details before formatting. Flat
messages matching any original detail must be excluded before the formatter sees
only the unmatched details, or each object's error appears again as a global message.
Keep informational and flat-only global messages, including lock guidance, once.

## Live facts

On SAP_BASIS 8.16, two interface names shared a prefix and only the second referenced
an unknown type. SAP cancelled activation; the first remained unknown and the second
received its own error. Readback showed empty active shells and the submitted
inactive sources. Both fixtures were deleted and their absence confirmed. The
reviewer independently confirmed the attribution on 7.50 and 7.58; SAP's global
cancellation is displayed with the severity SAP supplies.
