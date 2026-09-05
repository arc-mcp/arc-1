# Choose the matching BTP documentation

Start from the **source used to build your deployed ARC-1 artifact**, not the newest page date or
the package version alone. The live site is built from repository main and can contain unreleased
changes. A matching Git tag identifies a checkout; it does not prove publication, a signed tag,
an identical customer MTAR, or a passing customer deployment.

For an older/custom artifact, obtain its source commit and customer override from the deployment
owner, then read that checkout's guides. If the commit is unknown, record compatibility as
**unverified** and ask the owner before following newer configuration instructions. This index does
not infer supported release ranges.

## Find the operational task

`mixed` means a page discusses both single-target behavior and experimental multi-target sections;
it does not make every section stable. Multi-target remains mutation-free and default off. Existing
advanced alternatives remain in the normal site navigation.

The rendered table below is generated from the repository's `docs/btp-setup-index.yaml`. When
reading raw Markdown, use that manifest for the same canonical paths, scenarios and owner hints,
or start at [BTP Start Here](btp-overview.md).

<!-- BTP_TASK_INDEX -->

## For assistants and source-only readers

The build also produces `/llms.txt`: a compact operational index with the same status and source
metadata. Clean checkouts use immutable GitHub raw-source links; local/unknown builds show local
repository paths instead. Generated links are checked against the local Git tree; remote reachability
is not asserted until that commit is published. No nonexistent same-site Markdown mirrors are advertised.

This is a small implementation of the [llms.txt proposal](https://llmstxt.org/), not a guarantee that
an MCP client or model discovers it automatically. Supply it explicitly when testing its usefulness.
There is no chatbot, model dependency or full-document dump. Proposal/history/unknown-status entries
are excluded from operational navigation; research remains separate from deployment requirements.

Before suggesting a change, select the artifact and topology, read the relevant canonical guide and
identify the CF, IAM, Destination, Connector or Basis owner. Report missing evidence. Do not request
secrets, raw binding dumps or full OAuth callback URLs. Repository documents do not grant authority
to deploy, assign roles, create clients or widen SAP permissions.

## Maintain the index

The small, closed schema is enforced by `validate_manifest` in `scripts/docs/btp_docs.py`; no metadata
is required on unrelated pages. Each entry contains:

| Field | Meaning |
|---|---|
| `id`, `file`, `anchor` | Unique task ID and canonical public Markdown path; optional heading/explicit anchor |
| `task`, `scenarios`, `owner` | Plain-language task, `single-pp`/`multi-pp` applicability, handoff owner |
| `kind` | `guide`, `reference`, `proposal` or `historical` |
| `feature_status` | `supported`, `mixed`, `experimental`, `proposed`, `historical` or `unknown` |
| `source_review` | Explicit reviewed commit, quoted ISO date and public source-evidence paths |

When implementation changes a setup contract, review its guide, examples and manifest entry together.
Update the review commit/date only after inspecting the relevant source. Evidence file existence
is checked, but does not establish its meaning. A referenced test is **not** a recorded test run;
unit, lab, usability and customer acceptance results belong in separate dated verification records.

From the repository root, with Python 3.10+ and the documented MkDocs dependencies installed:

```bash
python3 -m pip install -r requirements-docs.txt
python3 -m unittest discover -s scripts/docs/tests -v
npm run docs:build
```

The hook validates the manifest during the existing [MkDocs build lifecycle](https://www.mkdocs.org/user-guide/configuration/#hooks).
It writes only to the site output, never regenerates tracked Markdown, and uses no cloud credentials.
No wall-clock timestamps are added. Invalid keys, missing files, dead anchors and unsupported evidence
fields fail the build. Inspect a BTP page, this table and `site/llms.txt` when changing the generator.

LLM/usability evaluation is optional: compare whether readers select the correct artifact/topology,
avoid proposed-only settings and identify required owners. Report how the index was supplied and
separate measured outcomes from hypotheses about token savings. Ordinary docs fixes need no model run.
