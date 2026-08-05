# BTP ABAP Environment: SAP-Side Prerequisites

Everything that has to be true **in SAP and BTP before ARC-1 is configured**. None of it is
ARC-1-specific — it is the same setup Eclipse ADT needs, and SAP owns the canonical procedures. This
page is a checklist with the exact SAP Help entry points; the ARC-1 setup itself lives in
[BTP ABAP Environment Setup](btp-abap-environment.md).

If Eclipse ADT can already log on to the system and create an object, you are done here — skip
straight to the [ARC-1 setup](btp-abap-environment.md).

## Checklist

| # | What | Owner | Why ARC-1 needs it |
|---|---|---|---|
| 1 | An ABAP Environment service instance | BTP subaccount admin | The ADT endpoints ARC-1 calls |
| 2 | Trust to SAP Cloud Identity Services (the booster) | BTP subaccount admin | Without it there is no SSO login, only a dead classic login form |
| 3 | `SAP_BR_DEVELOPER` business role for every user | ABAP env admin | ADT access is refused without it — for ADT *and* ARC-1 |
| 4 | A service key of the instance | BTP subaccount admin | Local OAuth login, or the OAuth client the per-user destination uses |
| 5 | A development package (not `ZLOCAL`, not `$TMP`) | ABAP developer | Only needed for writes — see [Writing objects on BTP](btp-abap-environment.md#writing-objects-on-btp) |

## 1. Provision the instance

Follow SAP's [Getting Started with a Customer Account in the ABAP Environment](https://help.sap.com/docs/btp/sap-business-technology-platform/getting-started-with-customer-account-in-abap-environment),
or the tutorial [Get an Account on SAP BTP to Try Out Free Tier Service Plans](https://developers.sap.com/tutorials/btp-free-tier-account..html)
if you still need the account itself. The instance parameters (cockpit JSON or
`cf create-service abap <plan> <name> -c params.json`) are:

```json
{
  "admin_email": "your.email@example.com",
  "is_development_allowed": true,
  "sap_system_name": "H01"
}
```

- `admin_email` must be a real address — a missing/invalid one is the cause of the broker error
  `/admin_email must NOT have fewer than 6 characters, /admin_email must match pattern…`.
- `sap_system_name` is a 3-character SID.
- Provisioning takes **30–60 minutes**; watch it with `cf service <name>`.

!!! note "Free tier"
    The `free` plan needs a consumption-based commercial model (PAYG or BTPEA) and is limited to
    **one system**, **90 days** (since 3 April 2024), and community support without an SLA. Within
    those 90 days you can switch to the standard plan without data loss. Free-tier systems are
    **stopped every night** and must be restarted manually from the **Landscape Portal** (scheduled
    start/stop is not available on this plan) — a stopped system looks to ARC-1 like a connectivity
    failure (`ECONNREFUSED` / timeouts), not an auth problem. Current
    limits: [Service Plans and Metering for SAP BTP ABAP environment](https://help.sap.com/docs/btp/sap-business-technology-platform/commercial-information).

No customer account at all? SAP's trial track ends at the same place: mission
[SAP BTP ABAP Environment: Create a Trial User](https://developers.sap.com/mission.abap-env-trial-user.html)
· [Create an SAP BTP ABAP Environment Trial User](https://developers.sap.com/tutorials/abap-environment-trial-onboarding..html).

## 2. Run the booster

A freshly provisioned instance has **no password-based login** — the classic *Benutzer/Kennwort* form
appears but no credentials exist. The booster **Prepare an Account for ABAP Development**
(BTP Cockpit → Global Account → **Boosters**) configures trust to SAP Cloud Identity Services (IAS),
so login redirects to IAS, and makes your user the initial administrator.

SAP tutorial: [Use a Booster for creating a Subaccount with an ABAP Environment](https://developers.sap.com/tutorials/btp-ea-onboard-05-abapb..html).

If the subscription is missing afterwards, add **Web Access for ABAP** from the subaccount's Service
Marketplace.

## 3. Assign the developer role

The booster assigns only the **administrator** role. Every human who will use ARC-1 (or ADT) also
needs the **`SAP_BR_DEVELOPER`** business role:

1. BTP Cockpit → your space → Service Instances → the ABAP instance → **View Dashboard** (the
   administration launchpad).
2. Open **Maintain Business Users**, select the user.
3. **Assigned Business Roles** → **Add** → `SAP_BR_DEVELOPER` → save.

SAP Help: [Assigning the ABAP Developer User to the ABAP Developer Role](https://help.sap.com/docs/btp/sap-business-technology-platform/assigning-abap-developer-user-to-abap-developer-role)
· [Required Business Roles](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/required-business-roles).
For more than a handful of developers, provision them from the identity provider instead of by hand:
[Provision Users into your SAP BTP ABAP Environment](https://developers.sap.com/tutorials/abap-environment-ips..html).

Without it, ADT and ARC-1 both fail with *"You have not been successfully logged on. Make sure the
developer role is assigned to the user."*

## 4. Create a service key

BTP Cockpit → Subaccount → **Instances and Subscriptions** → the ABAP instance → **Service Keys** →
create, then download the JSON:

```json
{
  "uaa": {
    "url": "https://<subdomain>.authentication.<region>.hana.ondemand.com",
    "clientid": "sb-abap-12345...",
    "clientsecret": "..."
  },
  "url": "https://<guid>.abap.<region>.hana.ondemand.com",
  "abap": { "url": "https://<guid>.abap.<region>.hana.ondemand.com", "sapClient": "100" }
}
```

ARC-1 uses this key in one of two ways — directly for [local browser login](btp-abap-environment.md#local-development-service-key-browser-login),
or as the OAuth client of a [per-user destination](btp-abap-environment.md#recommended-btp-deployment-with-a-per-user-destination).

!!! danger "A service key is a full-access SAP credential"
    `uaa.clientid` + `uaa.clientsecret` + `url` grant OAuth access to the whole ABAP system. Keep it
    outside the repository (e.g. `~/.config/arc-1/`) and never commit it. ARC-1's `.gitignore` /
    `.dockerignore` / `.cfignore` match `*service-key*.json` as a backstop only.

!!! warning "Use the `.abap.` host, not `.abap-web.`"
    The service key's `url` is the **API host** (`https://<guid>.abap.<region>.hana.ondemand.com`) —
    that is what ADT and ARC-1 call. The `.abap-web.` host is the Fiori launchpad and returns login
    HTML instead of ADT responses ([#301](https://github.com/arc-mcp/arc-1/issues/301)).

## 5. Verify with Eclipse ADT

Before touching ARC-1, connect Eclipse ADT to the system and open one object. It exercises exactly
the same login and authorization path, and it separates "SAP not ready" from "ARC-1 misconfigured".

Tutorials: [Download the Eclipse IDE and add the ABAP Development Tools (ADT) Plugin](https://developers.sap.com/tutorials/abap-install-adt..html)
→ [Create an ABAP Cloud Project](https://developers.sap.com/tutorials/abap-environment-create-abap-cloud-project..html)
(browser logon, or **Use a Service Key** with the key from step 4 — the same key ARC-1 uses).

SAP Help: [Getting Started as a Developer in the ABAP Environment](https://help.sap.com/docs/btp/sap-business-technology-platform/getting-started-as-developer-in-abap-environment-dev)
· [Connect to the ABAP System](https://help.sap.com/docs/btp/sap-business-technology-platform/connect-to-abap-system).

## Optional: a development package for writes

ARC-1 only needs this if you enable writes. `$TMP` does not exist in the ABAP Environment; the
software component **`ZLOCAL`** plays that role, and its `ZLOCAL` *structure* package cannot hold
development objects — you create a development sub-package under it. The SAP tutorial
[Create Your First ABAP Console Application](https://developers.sap.com/tutorials/abap-environment-console-application..html)
walks through exactly that step (right-click `ZLOCAL` → **New > ABAP Package**, package type
*Development*), and ARC-1 can do it itself with `SAPManage(action="create_package")` — see
[Writing objects on BTP](btp-abap-environment.md#writing-objects-on-btp).

Background: SAP Help [Software Components](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/software-components)
· [Manage Software Components](https://help.sap.com/docs/btp/sap-business-technology-platform/manage-software-components)
(a transportable component instead of local `ZLOCAL`).

## Troubleshooting (SAP side)

| Symptom | Cause / fix |
|---|---|
| Classic *Benutzer/Kennwort* form instead of an SSO redirect | Booster not run — no IAS trust. Run it (step 2). |
| "You have not been successfully logged on…" | `SAP_BR_DEVELOPER` missing (step 3). Business roles are separate from BTP role collections. |
| "Entity is currently being edited by another user" while assigning roles | A booster or browser session still holds the user record. Close the launchpad tabs, wait 1–2 minutes, retry. |
| Broker error on `admin_email` | Invalid/missing email in the instance parameters JSON (step 1). |
| Provisioning fails | Missing `abap` entitlement, plan not available in the region/commercial model, an existing free instance, or Cloud Foundry not enabled in the subaccount. |
| 403 on some ADT endpoints although login works | The business role lacks the authorization; cross-system ATC scenarios additionally need communication arrangements (`SAP_COM_0763` configuration, `SAP_COM_0901` test integration). |

## Next

[BTP ABAP Environment Setup](btp-abap-environment.md) — configure ARC-1 against the system you just
prepared.
