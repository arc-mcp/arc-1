# BTP ABAP Environment prerequisites

<a id="btp-abap-environment-sap-side-prerequisites"></a>

Prepare the SAP system and user access before configuring ARC-1. If Eclipse ADT already logs in and reads an object, continue to [BTP ABAP Environment setup](btp-abap-environment.md).

## Checklist

| # | What | Owner | Why ARC-1 needs it |
|---|---|---|---|
| 1 | An ABAP Environment service instance | BTP subaccount admin | The ADT endpoints ARC-1 calls |
| 2 | Trust to SAP Cloud Identity Services (the booster) | BTP subaccount admin | Without it there is no SSO login, only a dead classic login form |
| 3 | `SAP_BR_DEVELOPER` business role for every user | ABAP env admin | ADT access is refused without it — for ADT *and* ARC-1 |
| 4 | A service key of the instance | BTP subaccount admin | Local OAuth login, or the OAuth client of the per-user destination |
| 5 | A development package (not `ZLOCAL`, not `$TMP`) | ABAP developer | Only for writes — see [Writing objects on BTP](btp-abap-environment.md#writing-objects-on-btp) |

## 1. Provision the instance

Create the ABAP Environment instance with `"is_development_allowed": true`; ARC-1 needs the same ADT access as Eclipse. Follow SAP's [customer-account setup](https://help.sap.com/docs/btp/sap-business-technology-platform/getting-started-with-customer-account-in-abap-environment) or [trial setup](https://developers.sap.com/mission.abap-env-trial-user.html).

For free-tier eligibility, lifetime and availability, check SAP's current [service plans](https://help.sap.com/docs/sap-btp-abap-environment/abap-environment/commercial-information). Free instances stop automatically each night and must be started through the Landscape Portal. A stopped system can produce timeouts or `ECONNREFUSED`; check its state before debugging authentication.

## 2. Run the booster

Run **Prepare an Account for ABAP Development** under **Global Account → Boosters**. It establishes SAP Cloud Identity Services trust and initial administrator access:
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

Create it on the ABAP instance in the cockpit and download the JSON. ARC-1 requires
`url`, `uaa.url`, `uaa.clientid`, and `uaa.clientsecret`. Local login uses optional `abap.url` and
`abap.sapClient` as URL/client overrides. Use the key for
[local browser login](btp-abap-environment.md#local-development-service-key-browser-login) or the
OAuth client of a [per-user destination](btp-abap-environment.md#recommended-btp-deployment-with-a-per-user-destination).

Keep the key outside the repository, for example under `~/.config/arc-1/`, with restricted permissions. It contains OAuth client credentials; never commit or share it.

Use the key's **`.abap.` API host**. The `.abap-web.` host is the Fiori launchpad and returns login HTML instead of ADT responses.

## 5. Verify with Eclipse ADT

Connect Eclipse ADT and open one object to confirm that SAP login and authorization work.
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
