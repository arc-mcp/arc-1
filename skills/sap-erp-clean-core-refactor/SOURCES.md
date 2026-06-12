# SAP Authoritative Sources — JIT lookup catalog

This file is the **catalog of authoritative SAP documentation sources** that the [`sap-erp-clean-core-refactor`](./SKILL.md) skill consults just-in-time when it needs evidence for a specific custom-code finding. It is **NOT a pre-crawled knowledge base**; it is a **list of URLs + how to query each one**.

The skill reads this file and decides which sources to consult per finding, within a bounded per-finding lookup budget. Results are cached locally under `.cache/sap-clean-core/` for 30 days (stable docs) or 7 days (community / blogs).

## Tier 1 — Git-cloned sources (free, weekly refresh, no Apify cost)

These are SAP-maintained git repositories that can be `git clone`d locally and refreshed via `git pull --ff-only`. They are the **first source consulted** for every finding because they are free, fast, and authoritative.

| ID | Source | URL | Domain | Refresh strategy |
|---|---|---|---|---|
| `abap-atc-cr-cv-s4hc` | SAP API Release State repository | https://github.com/SAP/abap-atc-cr-cv-s4hc | Released ABAP object authority — JSON files per object class, per edition (Public Cloud / Private Cloud / On-Premise) | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-samples-cap-sflight` | SAP-samples — CAP SFlight reference | https://github.com/SAP-samples/cap-sflight | Canonical CAP service + Fiori Elements V4 example | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-samples-cloud-cap-samples` | SAP-samples — CAP samples (multi-domain) | https://github.com/SAP-samples/cloud-cap-samples | Multiple side-by-side patterns: orders, hello-world, sflight, … | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-samples-btp-cap-multitenant-saas` | SAP-samples — multitenant CAP SaaS | https://github.com/SAP-samples/btp-cap-multitenant-saas | Multi-customer extension pattern | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-samples-cap-event-handling` | SAP-samples — CAP event handling | https://github.com/SAP-samples/cap-sample-event-handling | Event Mesh / NATS subscription patterns | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-samples-odata-v4-cds-cap-fiori` | SAP-samples — OData V4 + CDS + CAP + Fiori | https://github.com/SAP-samples/odata-v4-cds-cap-fiori | End-to-end OData V4 / CAP / FE V4 example | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-samples-btp-typescript` | SAP-samples — BTP TypeScript app | https://github.com/SAP-samples/btp-build-business-application-with-typescript | TypeScript CAP scaffolding | `git clone --depth 1`, weekly `git pull --ff-only` |
| `sap-cloud-sdk` | SAP Cloud SDK (docs only) | https://github.com/SAP/cloud-sdk | JS/TS/Java SDK for consuming S/4 + BTP services | `git clone --depth 1 --filter=blob:none`, weekly `git pull --ff-only` |

**Operational note**: a project that installs this skill runs a one-time setup that clones the Tier 1 list under `.cache/git/`. Total size after clone ≈ 100-200 MB. Weekly refresh is bandwidth-only (no compute cost).

## Tier 2 — JIT Apify lookups (per-page cost, user pays at lookup time)

These are HTTP / SPA sources that cannot be efficiently mirrored offline. They are queried on-demand via Apify only when a finding's evidence requires it, and only for the specific page that holds the answer (not a full-site crawl).

| ID | Source | URL | Domain | Apify actor | Est. cost / page |
|---|---|---|---|---|---|
| `api-sap-com` | SAP API Hub | https://api.sap.com/ | OData service lifecycle (released / sandbox / deprecated), Communication Scenario membership, version history | `apify/puppeteer-scraper` (React SPA) | ~€0.01 |
| `help-sap-clean-core` | SAP Help Portal — Clean Core | https://help.sap.com/docs/btp/sap-business-technology-platform/clean-core | Clean Core principles + Levels A/B/C/D definitions | `apify/website-content-crawler` | ~€0.005 |
| `help-sap-btp` | SAP Help Portal — BTP | https://help.sap.com/docs/btp/sap-business-technology-platform | BTP services, runtime, eventing | `apify/website-content-crawler` | ~€0.005 |
| `help-sap-s4hana-cloud` | SAP Help Portal — S/4HANA Cloud | https://help.sap.com/docs/SAP_S4HANA_CLOUD | S/4HANA Cloud feature docs | `apify/website-content-crawler` | ~€0.005 |
| `help-sap-abap-development` | SAP Help Portal — ABAP for Cloud Development | https://help.sap.com/docs/abap-cloud | ABAP Cloud language reference, released-API catalog | `apify/website-content-crawler` | ~€0.005 |
| `help-sap-integration-suite` | SAP Help Portal — Integration Suite | https://help.sap.com/docs/integration-suite | iFlow design, API Management | `apify/website-content-crawler` | ~€0.005 |
| `help-sap-event-mesh` | SAP Help Portal — Event Mesh | https://help.sap.com/docs/event-mesh | BTP Event Mesh | `apify/website-content-crawler` | ~€0.005 |
| `developers-clean-core` | developers.sap.com — Clean Core topic | https://developers.sap.com/topics/clean-core.html | Clean Core tutorials | `apify/website-content-crawler` | ~€0.005 |
| `cap-cloud-sap` | SAP CAP — capire documentation | https://cap.cloud.sap/docs/ | CAP runtime, CDS, deployment | `apify/website-content-crawler` | ~€0.005 |
| `sapui5-sdk` | SAPUI5 SDK Reference | https://sapui5.hana.ondemand.com/sdk/ | UI5 / Fiori Elements V4 controls and annotations | `apify/website-content-crawler` | ~€0.005 |
| `community-sap-com` | SAP Community Q&A | https://community.sap.com/ | Recent symptom-specific troubleshooting | `apify/website-content-crawler` (recent-90d filter) | ~€0.01 |
| `blogs-sap-com` | SAP Blogs | https://community.sap.com/t5/technology-blogs-by-sap/bg-p/technology-blog-sap | Architecture / pattern essays from SAP engineers | `apify/website-content-crawler` (tag-filtered) | ~€0.01 |
| `fiori-design` | SAP Fiori Design Guidelines | https://experience.sap.com/fiori-design-web/ | Fiori UX guidance | `apify/website-content-crawler` | ~€0.005 |
| `discovery-center` | SAP Discovery Center | https://discovery-center.cloud.sap/ | Reference architectures | `apify/puppeteer-scraper` (SPA) | ~€0.01 |
| `learning-sap-com` | learning.sap.com / openSAP | https://learning.sap.com/ | Clean Core / extensibility courses | `apify/puppeteer-scraper` (SPA, some pages auth-gated) | ~€0.01 |

**Operational note**: every Tier 2 lookup hits `.cache/sap-clean-core/<topic-hash>/<source-id>-<yyyy-mm-dd>.md` first. Cache TTL: 30 days for stable docs, 7 days for community / blogs. Within the TTL window, repeat lookups are free.

## Tier 3 — Manual-consultation sources (auth-gated, NOT crawled)

These sources require S-user credentials and **cannot be automated** without the customer providing valid login. They are listed for awareness only; the skill emits "consult manually" pointers when they apply.

| ID | Source | URL | Auth | Purpose |
|---|---|---|---|---|
| `launchpad-support` | SAP Notes | https://launchpad.support.sap.com/ | S-user required | Authoritative SAP Notes for specific code paths / corrections |
| `me-sap-com` | Software Lifecycle | https://me.sap.com/ | S-user required | Product lifecycle, release information |
| `support-sap-com` | Support Catalog | https://support.sap.com/ | S-user required | Support documentation, incident management |

## Tier 4 — MCP-server-backed lookup (preferred when installed)

When the consuming environment has these MCP servers configured, the skill prefers them over Apify (faster, often free, better structured):

| MCP server | Replaces Apify for | When preferred |
|---|---|---|
| `mcp-sap-docs` | help.sap.com, abap-atc-cr-cv-s4hc queries | When `mcp__sap-docs__*` tools are available |
| `context7` | Generic library docs (non-SAP) | When the lookup is about an npm package or non-SAP library |

## When-to-use heuristic — what source for what finding

| Finding category | Tier 1 (git) | Tier 2 (Apify) | Tier 3 (manual) |
|---|---|---|---|
| `non-released-api` | `abap-atc-cr-cv-s4hc` (check object status) | `api-sap-com` (find released alternative service) | `launchpad-support` (SAP Note for migration path) |
| `direct-db-access` | `abap-atc-cr-cv-s4hc` (released CDS view available?) | `help-sap-abap-development` (released-CDS catalog) | — |
| `modification` (Level D) | — | `help-sap-clean-core` (BAdI / enhancement Level B pattern) | `launchpad-support` (mandatory SAP Note for the modification) |
| `enhancement-point` (Level B eligible) | — | `developers-clean-core` (tutorial for key-user extensibility) | — |
| `side-by-side candidate` | `sap-samples-*` (matching pattern repo) + `sap-cloud-sdk` | `cap-cloud-sap` + `help-sap-btp` (target framework docs) | — |
| `unused` (zero SCMON hits) | — | — | — (remove after stakeholder sign-off; no doc lookup needed) |

## Refresh discipline

**Tier 1 git-clones**: weekly `git pull --ff-only` for each repo. Cost: bandwidth only.

**Tier 2 Apify cache**: per-entry TTL applies. The cache is local to the project (under `.cache/sap-clean-core/`), not shared across projects. Users with multiple projects on the same machine can symlink the cache to a shared location.

**No centralized infrastructure**: this skill does NOT maintain a centralized KB. There is no weekly cron crawling everything; there is no shared cache for all users. Every project owns its own cache; every Apify call is on the user's own account.
