# BTP ABAP Environment: SAP-Side Prerequisites

What must be true **in SAP and BTP before ARC-1 is configured**. None of it is ARC-1-specific — it is
the setup Eclipse ADT needs, and SAP owns the procedures, so this page is a checklist plus the
gotchas that bite, not a copy of SAP's instructions. If ADT can already log on and create an object,
skip straight to [BTP ABAP Environment Setup](btp-abap-environment.md).

## Checklist

| # | What | Owner | Why ARC-1 needs it |
|---|---|---|---|
| 1 | An ABAP Environment service instance | BTP subaccount admin | The ADT endpoints ARC-1 calls |
| 2 | Trust to SAP Cloud Identity Services (the booster) | BTP subaccount admin | Without it there is no SSO login, only a dead classic login form |
| 3 | `SAP_BR_DEVELOPER` business role for every user | ABAP env admin | ADT access is refused without it — for ADT *and* ARC-1 |
| 4 | A service key of the instance | BTP subaccount admin | Local OAuth login, or the OAuth client of the per-user destination |
| 5 | A development package (not `ZLOCAL`, not `$TMP`) | ABAP developer | Only for writes — see [Writing objects on BTP](btp-abap-environment.md#writing-objects-on-btp) |

## 1. Provision the instance

[Getting Started with a Customer Account in the ABAP Environment](https://help.sap.com/docs/btp/sap-business-technology-platform/getting-started-with-customer-account-in-abap-environment)
has the procedure; [Get an Account on SAP BTP to Try Out Free Tier Service Plans](https://developers.sap.com/tutorials/btp-free-tier-account..html)
covers the account itself. Two things matter for ARC-1: create the instance with
`"is_development_allowed": true` (ADT and therefore ARC-1 are refused otherwise), and expect
provisioning to take 30–60 minutes.

Without a customer account, SAP's trial track ends at the same place:
[SAP BTP ABAP Environment: Create a Trial User](https://developers.sap.com/mission.abap-env-trial-user.html).

!!! note "Free tier"
    The `free` plan needs a consumption-based commercial model (PAYG or BTPEA), is limited to **one
    system** and **90 days** (since 3 April 2024), and has no SLA; within those 90 days you can switch
    to the standard plan without data loss. Free-tier systems are **stopped every night** and must be
    restarted by hand from the **Landscape Portal** — to ARC-1 a stopped system looks like a
    connectivity failure (`ECONNREFUSED` / timeouts), not an auth problem. Current limits:
    [Service Plans and Metering](https://help.sap.com/docs/btp/sap-business-technology-platform/commercial-information).

## 2. Run the booster

A freshly provisioned instance has **no password-based login** — the classic *Benutzer/Kennwort* form
appears, but no credentials exist. The booster **Prepare an Account for ABAP Development**
(BTP Cockpit → Global Account → **Boosters**) establishes trust to SAP Cloud Identity Services so
logon redirects to IAS, and makes you the initial administrator:
[Use a Booster for creating a Subaccount with an ABAP Environment](https://developers.sap.com/tutorials/btp-ea-onboard-05-abapb..html).

If the **Web Access for ABAP** subscription is missing afterwards, add it from the subaccount's
Service Marketplace — the admin apps in step 3 run there.

## 3. Assign the developer role

The booster assigns only the **administrator** role. Every human using ARC-1 (or ADT) also needs the
**`SAP_BR_DEVELOPER`** business role, assigned in the instance's administration launchpad (**View
Dashboard** → **Maintain Business Users**):
[Assigning the ABAP Developer User to the ABAP Developer Role](https://help.sap.com/docs/btp/sap-business-technology-platform/assigning-abap-developer-user-to-abap-developer-role)
· [Required Business Roles](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/required-business-roles).
Beyond a handful of developers, provision them from the identity provider instead:
[Provision Users into your SAP BTP ABAP Environment](https://developers.sap.com/tutorials/abap-environment-ips..html).

Without the role, ADT and ARC-1 both fail with *"You have not been successfully logged on. Make sure
the developer role is assigned to the user."*

## 4. Create a service key

Create it on the ABAP instance in the cockpit and download the JSON. ARC-1 reads exactly four fields —
`url` (the ABAP system), `uaa.url`, `uaa.clientid`, `uaa.clientsecret` — and uses them either for
[local browser login](btp-abap-environment.md#local-development-service-key-browser-login) or as the
OAuth client of a [per-user destination](btp-abap-environment.md#recommended-btp-deployment-with-a-per-user-destination).

!!! danger "A service key is a full-access SAP credential"
    `uaa.clientid` + `uaa.clientsecret` + `url` grant OAuth access to the whole ABAP system. Keep it
    outside the repository (e.g. `~/.config/arc-1/`) and never commit it. ARC-1's `.gitignore` /
    `.dockerignore` / `.cfignore` match `*service-key*.json` as a backstop only.

!!! warning "Use the `.abap.` host, not `.abap-web.`"
    The service key's `url` is the **API host** (`https://<guid>.abap.<region>.hana.ondemand.com`) —
    that is what ADT and ARC-1 call. The `.abap-web.` host is the Fiori launchpad and returns login
    HTML instead of ADT responses ([#301](https://github.com/arc-mcp/arc-1/issues/301)).

## 5. Verify with Eclipse ADT

Connect ADT and open one object before touching ARC-1: same login and authorization path, so it
separates "SAP not ready" from "ARC-1 misconfigured".
[Install the ADT plugin](https://developers.sap.com/tutorials/abap-install-adt..html) →
[Create an ABAP Cloud Project](https://developers.sap.com/tutorials/abap-environment-create-abap-cloud-project..html)
(browser logon, or **Use a Service Key** with the key from step 4 — the same key ARC-1 uses).

## 6. A development package (writes only)

`$TMP` does not exist here; the software component **`ZLOCAL`** plays that role and its `ZLOCAL`
*structure* package cannot hold development objects, so create a development sub-package under it —
[tutorial step](https://developers.sap.com/tutorials/abap-environment-console-application..html)
("Create ABAP package"), or let ARC-1 do it with `SAPManage(action="create_package")`
([Writing objects on BTP](btp-abap-environment.md#writing-objects-on-btp)). For transportable code
instead of local `ZLOCAL`, create your own
[software component](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/software-components).

## Troubleshooting (SAP side)

| Symptom | Cause / fix |
|---|---|
| Classic *Benutzer/Kennwort* form instead of an SSO redirect | Booster not run — no IAS trust (step 2). |
| "You have not been successfully logged on…" | `SAP_BR_DEVELOPER` missing (step 3). Business roles are separate from BTP role collections. |
| "Entity is currently being edited by another user" while assigning roles | A booster or browser session still holds the user record. Close the launchpad tabs, wait 1–2 minutes, retry. |
| Broker error `/admin_email must NOT have fewer than 6 characters…` | Missing or invalid email in the instance parameters (step 1). |
| Provisioning fails | Missing `abap` entitlement, plan unavailable in the region/commercial model, an existing free instance, or Cloud Foundry not enabled in the subaccount. |
| 403 on some ADT endpoints although login works | The business role lacks that authorization; cross-system ATC scenarios additionally need communication arrangements (`SAP_COM_0763` configuration, `SAP_COM_0901` test integration). |

Then continue with [BTP ABAP Environment Setup](btp-abap-environment.md).
