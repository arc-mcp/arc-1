# Native SRVB activation getter proof

This source correction follows the consumed RAP retained-v3 activation attempt at
`37dd23fce3264a735f8e92ad9d3cd2e5076a78b6`. It does not retry or approve a native phase, reopen a
claim, relax ordinary SRVB CRUD, or establish PP/publication/generated-child absence.

The actual activation request's first preaudit POST returned HTTP 200 with positive check,
activation and generation flags. No confirmation POST was needed. The next native GET reported an
active, unpublished binding, but the adapter reported activation-not-confirmed. The offline replay
through the real handler and AdtHttpClient reproduces the exact first refusal: its shared read
function required bindingCreated=false even during post-activation verification. Clearing only that
flag in an external counterfactual still fails the old stable-document comparison.

## Primary native contract

The retained active `CL_SRVB_OBJECT_PERSIST.prepare_object_data_for_get` source (lines 844–918)
initializes binding_created=false and, when native service existence succeeds, sets it true, obtains
its release contract and maps service details into the exact matching service/version. That mapping
can add an empty bindingTypeData wrapper with core content/encoding=base64. This is getter-derived
state, not a new caller-selected service or permission to ignore arbitrary binding data.

`CL_ODATAV4_BINDING_TYPE_IMPL.get_contract_information` delegates to
`CL_RAP_SERVICE_BINDING_ODATA.get_contract_by_binding`, which reads the active binding category.
`CL_RAP_SERVICE_CONTRACT` maps UI to C1 and A2X/Web API to C2. Existing wire category 0/1 selection
therefore determines the only accepted added contract. UI normalization has source and synthetic
coverage here; this actual attempt observed category 1/C2. No standard SAP source is committed.

| Retained primary body | SHA-256 |
|---|---|
| CL_SRVB_OBJECT_PERSIST | `8165d55ae56f85f3e3788e1f8f1a44338b6b99be4f478a7cfa46b08ac889eecc` |
| CL_RAP_SERVICE_CONTRACT active GET | `0396f129ad5de11e53f0ea216f61343c3bcd6fbe571743885df3ee4435720e75` |
| Actual inactive binding | `1d8fd1b3e5cf15e1736fd1633af4edcf6103f73f3981244a1ba6bf51d24b39be` |
| Actual activation response | `c133bb966fcddec726a0314273490d805f43b1feaf39701442184025aff815d9` |
| Actual active binding, later default/active/inactive GETs identical | `581b50b79cb750455cd68ffe9bf978140396bf4d6f90fef96098544fb1d66dff` |

## Narrow production change

Capture and repeated preaudit validation still require an unpublished, non-generated owner and
compare its full metadata hash. Only verification of a successful activation may accept the
source-backed inactive false→active true transition for one unchanged OData V4 service/version,
its same owned implementation name and a supported UI/Web API category. Release support must be
explicit. A previously absent contract may gain the corresponding C1/C2; an existing contract cannot
change. The empty wrapper is excluded only at the exact expanded structural path
serviceBinding/services/content/bindingTypeData, only when previously absent, and only with one
empty core content child carrying exactly encoding=base64. Attributes, extra children, payload text,
wrong namespaces, opaque nesting and same-prefix siblings remain unselected content differences.

All other identity, package, metadata, service references, release state and opaque content stay in
the comparison. Both current and explicit-active views must be active, free of inactive alternatives
and independently match the captured owner. Other generated representations and multi-service
activation derivations remain unqualified. Existing stable non-generated behavior remains unchanged.
The ordinary save/publication projection and full metadata hashes are untouched; a getter-derived
field change during preaudit still blocks confirmation. No new fields, requests, retry, scope or
permission are added, and generated/published initial-owner refusal remains.

Two sanitized complete native wire fixtures retain the actual before/after structure. Only names,
responsibility/system, timestamps and description are replaced with nonpersonal test values. Private
external probes replay the original bytes. Tests cover direct native execution and prompt/confirmation,
metadata-only preaudit drift, explicit-active divergence, exact names/types/URIs, opaque preservation,
namespace aliases, unsafe derived shapes and unchanged CRUD/publication/generated-delete behavior.
The original failing replay remains preserved; it is not a newly observed native mutation.

## Remaining work

The failed qualification claim stays failed despite the physical activation. A separately reviewed
fixed continuation must freshly adopt all completed stages and the now-active binding, then perform
only unfinished publication and reverse cleanup. Neither activation nor the four completed stages
may be replayed. The sealed operator packet and independent execution audit remain authoritative;
this source checkpoint alone grants no native execution or final PR acceptance.
