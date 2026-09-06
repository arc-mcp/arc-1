# BTP archive inspection and acceptance corrections

## Summary

Replace the deployment runbook's duplicated shell scripts with a local, explicit-artifact
inspection command. Inspect and deploy the same named MTAR without rebuilding in between.
Correct the administration guide's remaining claim that `SAPRead SYSTEM` proves the SAP login
identity by linking to the existing backend-identity verification procedure.

No runtime/auth changes, CF deployment, configuration wizard, prebuilt archive distribution,
new documentation page in the site, or general-purpose secret scanner.

## Implementation plan

1. Add `npm run btp:inspect-mtar -- --archive <path> [--format json]`. Require one path,
   never infer newest/version. Text and JSON share outcomes, digest, limits and findings.
2. Use `yauzl` 3.4 as a direct **development-only** dependency (MIT, Node >=12;
   maintained June 2026, one dependency). Its lazy-entry/stream APIs support stored and
   deflated ZIPs; reject encryption and other compression. Check CRCs and expanded byte
   counts explicitly. No OS unzip dependency or filesystem extraction.
3. Bound the MTAR snapshot to 256 MiB, each expanded module ZIP/file to 128 MiB,
   combined expanded bytes to 512 MiB and combined entries to 20,000. Metadata is limited
   to 1 MiB. Stream file bodies; retain only metadata/module ZIPs and the small npm config.
   Reject ambiguous/unsafe names, duplicates, symlinks/special files, missing/empty modules
   and unsupported layouts. Do not recursively unpack arbitrary application archives.
4. Check `META-INF/MANIFEST.MF`, deployment descriptor and declared module payloads together.
   Permit reviewed wrapper descriptors, but apply credential-name checks to the wrapper too.
   Apply module/operator-path checks to payloads; only the exact reviewed AppRouter root
   `.npmrc` is exempt. Report names, never file contents or raw parser errors.
5. Read/hash the captured bytes once; recheck file identity, size and timestamps before success
   to detect changes during inspection. A later deploy is a separate action: the digest is not a
   signature and cannot close the time gap after inspection.
6. Shorten the runbook to command, expected evidence, failure action and exact-file deploy.
   Link the administration identity check to the canonical PP procedure, not a second recipe.

## Verification and review

- Synthetic base/UI fixtures and explicit selection among multiple archives.
- Corrupt/truncated/empty payloads, missing/extra modules and manifest inconsistencies.
- Forbidden wrapper/module paths; exact, altered and misplaced AppRouter `.npmrc`.
- Traversal, absolute/backslash names, duplicates, symlinks, encryption, unsupported methods,
  CRC/size mismatch and resource limits. No extraction or network/child-process calls.
- CLI usage errors vs inspection failures; text/JSON agreement, filenames with spaces,
  escaping of untrusted names, archive replacement/read errors.
- Linux unit suite plus focused Windows CI in the existing Test workflow; macOS local smoke.
- Build and inspect actual base/UI MTARs locally without deployment. Full unit suite,
  typecheck, lint, MTA validation and strict documentation build.
- Review the shortened task from Start Here. Do not claim measured usability improvement;
  the optional before/after wrong-artifact task remains a later formative evaluation.

Dependency reference: [yauzl API and limitations](https://github.com/thejoshwolfe/yauzl).
Deployment context: [SAP Cloud MTA Build Tool](https://sap.github.io/cloud-mta-build-tool/).

## Commit/review boundary

One PR, two logical commits: tested local inspector; runbook/acceptance corrections and
regression coverage. Keep the existing deployment npm scripts compatible, but the reviewed
customer procedure names its selected artifact explicitly. Rollback must restore an
explicit-artifact procedure before removing the command.
