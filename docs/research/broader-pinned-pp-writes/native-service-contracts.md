# Native package, API and service contracts

The [research index](inventory.md) distinguishes these target-bound findings from public admission
and unfinished native/PP qualification.

## Packages and API state

Empty/incomplete browsing does not prove package emptiness. Captured A4H/758 CL_PAK_ADT_PERSIST /
CL_PACKAGE code checks real contents, children and interfaces before non-recursive DELETE/SAVE.
The local profile requires native LOCAL/non-recording metadata and lock evidence, not a dollar
name. Protected `$TMP` and recorded deletion refuse; local TADIR/CTS bookkeeping may still have effects.
[Non-cascade contract](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-local-package-delete.md).

A parentless LOCAL root is not a descendant of `$TMP`. Creation and existing-parent paths need their
own package/recording evidence. Explicit SAP responsibility is not an acting-identity assertion and
cannot come from an unverified JWT name. Package moves may leave partial native effects after later
verification fails. [Root-create evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-local-root-create.md).

The observed nonempty deletion refusal is HTTP 400, com.sap.adt, ExceptionResourceDeletionFailure,
PAK051 and the exact package. This bounded diagnostic is neither absence nor a generic HTTP-400
classifier. Success still requires typed absence; uncertainty/bookkeeping/owning cleanup remain.
[Captured refusal](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-native-package-nonempty-envelope.md).

API state uses the existing native release resource and optimistic metadata proof. Preserve native
contract/visibility/ReadOnly information rather than rebuilding defaults or inferring permission
from a contract name. Activation, API release and publication remain separate operations.
[API/binding evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-pinned-package-api-publication.md).

## Binding activation

A4H CL_SRVB_OBJECT_PERSIST.prepare_object_data_for_get initializes `binding_created=false`, then
obtains native service/release details for the exact service/version. It can add an empty Base64
`bindingTypeData` wrapper. CL_RAP_SERVICE_CONTRACT maps UI to C1 and A2X/Web API to C2; the observed
category-1 result was C2. These narrow getter-derived fields are not a caller-selected service,
universal category observation or exemption for arbitrary binding data.

Post-activation proof retains binding identity/category, service/version, package, source dependency
and unrelated opaque fields. A missing pre-activation wrapper is not by itself a failed create;
acknowledged activation with contradictory readback remains unconfirmed.
[Getter and comparison boundary](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-srvb-native-activation-getter.md).

## Publication and generated resources

V4 publication needs explicit version and fresh binding metadata proof. Publication/generated
state differs from repository active state. Native request selection is not caller selection:
the native-governed alternative needs explicit unrestricted request policies independently at
server and destination. HTTP success never fabricates a request/task receipt. Unknown effects stay
unknown, without replay or automatic CTS compensation.
[Publication contract](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-v4-publication.md)
and [recording corrections](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-publication-native-governed-corrections.md).

The current product retains one single-binding native-governed executor. Private batches,
qualification handlers and the speculative non-recording reader mode are retired. A general
native non-recording configuration reader remains an unimplemented gap; historical evidence
does not create a product guarantee.

Generated V4 parent deletion is a historical native investigation outside the product build: exact parent provenance,
publication/generated state and scope need proof. Generic repository DELETE is no substitute;
parent absence does not prove all generated children absent. Private experiments do not broaden
public admission; the [write guide](../../../docs_page/multi-target-writes.md) retains the
generated-binding deletion restriction.
[Investigation and cleanup limits](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-generated-v4-binding-delete.md).
