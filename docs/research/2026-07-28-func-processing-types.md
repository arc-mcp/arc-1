# Function-module processing types over ADT

**Date:** 2026-07-28
**Status:** Implemented; full lifecycle verified live on SAP_BASIS 758 (v3) and 750 (v2)
**Scope:** On-premises `SAPWrite action="create" type="FUNC"`

## Why this change exists

ARC-1 could create a function module and its ABAP source, but it always used the
legacy create envelope without an execution kind. That was sufficient for a
normal function module. It was not sufficient for an SDK-free RFC fixture:
making a module Remote-Enabled is an object property in ADT, not an annotation
that can be recovered from `/source/main`.

The same distinction applies to update-task modules. Treating these settings as
source text would make a create appear successful while leaving SAP with a
normal function module.

SAP's public documentation describes the corresponding ABAP concepts:

- [Remote-enabled function modules](https://help.sap.com/docs/abap-cloud/abap-integration-connectivity/create-remote-enabled-function-module-rfm?locale=en-US)
- [Update function modules](https://help.sap.com/docs/SAP_NETWEAVER_731_BW_ABAP/cfae740a0a21455dbe6e510c2d86e36a/417af4daa79e11d1950f0000e82de14a.html)
- [Function-module processing types in ADT](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/abbd1a32f3444dc1a5cf72042b319d61.html)

## Observed ADT contract and the failed first approach

Function-module roots on representative SAP_BASIS 750 and 758 systems use these
exact, case-sensitive attribute values:

| ABAP behavior | `fmodule:processingType` | `fmodule:updateTaskKind` |
|---|---|---|
| Normal | `normal` | omitted |
| Remote-Enabled | `rfc` | omitted |
| Update, V1 restartable | `update` | `startImmediate` |
| Update, V1 non-restartable | `update` | `immediateStartNoRestart` |
| Update, V2 | `update` | `startDelayed` |

The first implementation put these fields only on the collection POST. That
looked plausible and SAP returned success, but an immediate root readback on
SAP_BASIS 758 still reported `normal`. A second experiment used the versioned
v3 media type on the POST and produced the same result. This ruled out content
negotiation, source PUT, and activation as the cause: collection POST creates a
normal shell and does not persist processing properties.

That result was re-confirmed independently during review by POSTing
`fmodule:processingType="rfc"` with no follow-up PUT; the inactive root came
back as:

```xml
<fmodule:abapFunctionModule fmodule:releaseState="notReleased" fmodule:processingType="normal" …>
```

Because the attribute is inert on every release we can test and unproven on the
ones we cannot, ARC-1 does **not** send it on the create POST at all. The create
envelope is byte-identical to the pre-feature one, and the locked metadata PUT
is the single place the processing kind is written.

The working ADT lifecycle is:

1. POST the function-module shell to the parent group's `fmodules` collection;
2. GET the new child root with `version=inactive`;
3. preserve the server-provided envelope and change only the processing
   attributes;
4. lock the child, PUT the root metadata, and unlock in `finally`;
5. GET the inactive root and assert the requested values before reporting
   success; and
6. write source, activate, and verify the active root in the integration test.

ARC-1 takes the metadata PUT media type from the GET response or ADT discovery.
This selects v3 on the verified 758 system and v2 on a 750 discovery document,
instead of hard-coding one release family. Both backends return the header with a
parameter (`…fmodules.v3+xml; charset=utf-8`), so the negotiated value is reduced
to the bare media type before it is sent — on-prem backends reject parameterised
vendor media types, which is the same reason `resolveObjectPackage` sends a bare
`Accept`. Omitting `processingType` preserves the previous create behavior and
adds no metadata update round trip.

The readback that gates success reads the attributes from the **root element
only**. The same document also carries an `<adtcore:containerRef>` child, so a
whole-document scan could answer the fail-closed check from something that is not
the function module's own metadata.

This sequence also matches independent client implementations:

- [abapify/adt-cli FUNC model](https://github.com/abapify/adt-cli/blob/main/packages/adk/src/objects/repository/fugr/func/func.model.ts)
  records that SAP ignores processing type during POST and performs a
  post-create metadata PUT.
- [sapcli function attribute tests](https://github.com/jfilak/sapcli/blob/master/test/unit/test_sap_cli_function.py)
  exercise GET, lock, child metadata PUT, and unlock.

The implementation does not expose `collectiveRun`, `unsupportedKind`,
`rfcScope`, `rfcVersion`, or basXML switches. Those values were not needed for
the supported behaviors and were not promoted without a complete public
contract and live proof.

## Containment and safety

A function module has no standalone generic ADT address. Its canonical URL
contains the parent function group:

```text
/sap/bc/adt/functions/groups/{group}/fmodules/{function_module}
```

For that reason, `objectBasePath("FUNC")` remains fail-closed. Single and batch
creation use the same FUNC-aware URL helper.

A function module also inherits its package from the function group. ARC-1 reads
the real parent package and applies the package safety and transport checks to
that value before creation. A FUNC-level `package` is accepted only as an
assertion and must match the inherited package. The top-level package of a mixed
batch remains the default for ordinary objects; it is not interpreted as a
claim about contained function modules.

## Verification method

A successful create response is not sufficient evidence because SAP can accept
the POST while retaining the normal shell. The integration contract therefore:

1. creates a disposable function group;
2. creates an implicit normal module plus explicit normal, Remote-Enabled,
   both V1 variants, and V2 update modules;
3. reads each inactive root and, for explicit RFC/update kinds, updates it
   under a lock;
4. writes a minimal source body;
5. asserts the exact inactive processing attributes;
6. activates each object;
7. reads the active root and asserts the same attributes; and
8. removes all disposable objects.

The complete create → locked metadata PUT → source PUT → activation → active
readback lifecycle passed on **SAP_BASIS 758 and SAP_BASIS 750** for implicit and
explicit normal, Remote-Enabled, both V1 update variants, and V2 update modules.
Cleanup of the disposable graph passed as part of the same test on both.

The 750 run matters because it is the only exercise of the **v2** representation:
the negotiation reads `…fmodules.v2+xml; charset=utf-8` off the GET, reduces it to
the bare media type, and 750 accepts that on the locked PUT. A spot check on 750
confirmed the state transition end to end — inactive root `processingType="rfc"`,
activate, active root `processingType="rfc"`.

> Reading `?version=active` **before** activating returns the pre-activation state
> and shows `normal`. That is not a defect; the readback is only meaningful after
> `SAPActivate`.

Getting there took clearing a system-side block. Before it was fixed, every create
on 750 failed with:

```text
403 at /sap/bc/adt/functions/groups — No development license for user DEVELOPER
403 at /sap/bc/adt/programs/programs — No development license for user DEVELOPER
```

The identical message on a plain `PROG` create identified it as the ABAP
development-license / developer-key check refusing **all** object creation on that
system, rather than authorization for FUGR/FUNC or anything this code path
controls. Worth remembering the next time a 750 write test "fails": check the
developer key before suspecting the code.

### The 750 read contract, from 372 live function-module roots

Independently of the mutation run, the wire contract was checked against real
SAP-shipped modules instead of being inferred from discovery:

| Question | Result on SAP_BASIS 750 (372 roots sampled) |
|---|---|
| Root element prefix | `fmodule` on every root — the matcher's hard-coded prefix holds |
| Representation | `application/vnd.sap.adt.functions.fmodules.v2+xml; charset=utf-8` on every response |
| `processingType` values | `normal`, `rfc` observed |
| `updateTaskKind` values | `startImmediate` (`SCD0/CHANGEDOCUMENT_EVENT_CREATE`) and `startDelayed` (`SCD4/CHANGEDOCUMENT_DELETE_V2`) observed |
| Root tags truncated by the `[^>]*` matcher | 0 of 372 |

The attribute names, the case-sensitive values, and the v2 representation are
therefore confirmed on 750 from both directions: SAP's own objects read back, and
ARC-1's writes round-tripped.

### The ADT root is not the last word — TFDIR is

ADT echoing an attribute it stored is weaker evidence than the ABAP runtime
agreeing. After activation on 758, the dictionary itself was queried:

```text
SELECT funcname, fmode, utask FROM tfdir WHERE funcname LIKE 'Z…%'
→ …_RFC     FMODE="R"  UTASK=""    (Remote-Enabled)
→ …_UPDATE  FMODE=""   UTASK="2"   (V2 update)
```

`TFDIR-FMODE`/`TFDIR-UTASK` are what the ABAP runtime dispatches on, so the
requested execution semantics survive the whole lifecycle, not just the
metadata envelope.

### Why the root-tag rewrite may use a plain regular expression

`rewriteFunctionModuleProcessingMetadata` locates the root element with
`<fmodule:abapFunctionModule\b[^>]*>`, which would truncate if an attribute value
contained a raw `>`. Three independent checks say it cannot:

- `escapeXmlAttr` escapes `>` on the way in.
- A live probe with the description `A > B & C < D "q"` came back escaped
  (`A &gt; B &amp; C &lt; D &quot;q&quot;`), so SAP escapes it on the way out.
- None of the 372 sampled 750 roots truncated, and every one used the `fmodule`
  prefix.

The prefix stays hard-coded on purpose. The rewrite *writes* `fmodule:`-qualified
attributes, so matching a different prefix would produce a silently wrong document
instead of the current explicit "SAP did not return an abapFunctionModule
envelope" failure.

Unit tests separately cover invalid field combinations, unchanged omission
behavior, structured parameters, SAPGUI comment stripping, canonical batch
routing, inherited-package enforcement, and zero mutation on a missing group or
package mismatch.

The earlier 201-only FUNC creation smoke test could not catch this defect; the
root and post-activation readbacks are deliberate regression gates.

Only structural assertions and release family were retained. No credentials,
system identities, endpoints, object payloads, business data, or captures are
stored in the repository.
