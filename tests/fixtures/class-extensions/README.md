# Class enhancement fixtures

Sanitized SAP standard-object responses from the approved read-only 2026-10-29 research and
verification. A4H is SAP_BASIS 758; NPL is 750. No user credentials, session headers or business
data are included. Source fixture line endings may be normalized by Git; the adapter preserves
actual response source unchanged.

- `class-exted.xml`: A4H exact EXTED_OBJ identity/edge for CL_OO_ADT_ENHANCED_CLASS.
- `class-hook-native.xml`: fresh 758 EXTED_OBJ graph with nested enhancement ownership;
  the native parent/child edges do not themselves identify hook replacement semantics.
- `nested-owner-source-reference.xml`: verified 758 nested XHH metadata identifies its
  discovered parent through that same parent's `/source/main` representation. The URI is validated
  as ownership evidence and is never followed as a request target.
- `interface-env.xml`: A4H's ENV fallback for IF_DSH_ENHANCED_OPTIONS; negative coverage evidence.
- `class-feed.xml`, `class-generated.abap`: exact REPS owner, active id 00000 and generated parent.
- `method-feed.xml`, `method-generated.abap`: the EM001 child actually named by that parent;
  feed from NPL research, source verified again on both targets.

Parent/child revision paths contain sentinel 1970 timestamps. Selection is by active id and
exact feed/content ownership, never by sorting dates. Generated bodies omit enhancement names.
The separate hook graph fixtures in `../extensions/source/` qualify hook coverage, including
seven implementations and three replacement edges; native ENHO/XH does not identify technology.
