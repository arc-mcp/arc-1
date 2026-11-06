# Exact object lookup on 7.50 (COMPAT-09)

Main a0fc4cb8 returns found=false on 750 SP02 because quickSearch decorates
object names (for example `T000 (Database Table)`). Review reproduced this for
classes, tables and programs as well as functions. 758 SP02 and 816 SP01 return
plain names. The #911 function-group resolver does not serve this lookup.

## Plan and review

1. Preserve existing exact-name matches.
2. For a decorated result, require both a display label beginning with `NAME (`
   and a relative ADT URI whose final segment decodes to the requested name.
3. Return the canonical name and preserve ambiguity across types, packages and
   distinct URIs. Ignore malformed, unrelated and non-object URI suffixes.
4. Test standard/namespaced functions, classes, tables, programs, conflicting
   labels, malformed URIs and ambiguity; repeat public lookup/usages live.

Review: this replaces the function-only branch with one type-independent rule.
No resolver framework, cache, schema or permission change is needed. The label
and URI must agree for decorated results; exact-name behavior stays unchanged.
The reproduced decoration is specific to 7.50; no BTP live coverage is claimed.

## Validation

The old rule missed T000, SAPMSSY0, CL_ABAP_TYPEDESCR and BAPI_USER_GET_DETAIL
on 750 SP02, including type-free class usages. Tests cover functions, classes,
tables, programs, namespaces, misleading labels, malformed URIs and ambiguity.
Public tadir_lookup and type-free usages pass on 750 SP02, 758 SP02 and 816 SP01
(local handleToolCall, HTTPS Basic, read-only). All local gates pass. The completed
COMPAT-09 entry is removed from the roadmap.
