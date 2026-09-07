# ARC-1 repository graph — experimental

Optional metadata/relationship backend in the ARC-1 repository. **Independently installed,
built and deployed**; not a root workspace dependency or part of the normal ARC npm/image.
PostgreSQL and SAP HANA share the same v2 API. No AI Core; no full-source persistence.

Start with the [graph guide](../../docs_page/repository-graph.md), then follow
[backend setup](../../docs_page/repository-graph-backend.md). The
[specification](../../docs_page/repository-graph-specification.md) records limits and future gates.

For an offline PostgreSQL test, from this directory (Node >=22.19 and Docker Compose v2):

```sh
npm ci
npm run graph:setup
npm run graph:test:offline
```

No SAP credentials are needed. Port 8091 is loopback-only. Keep `.secrets/` and the Docker
volume; setup preserves existing credentials and refuses a mismatched descriptor.
`npm run graph:down` stops services without deleting data. Never use `down -v` as a retry.

Development gates: `npm test`, `npm run typecheck`, `npx biome check .`.
Optional larger test: `npm run graph:test:large`; restore rehearsal:
`sh scripts/graph/test-restore.sh`. These use the current Compose project; choose a dedicated
project/secret directory/port before setup to avoid touching another installation.

Live collection is manual and bounded to 500 supported objects per run. Cloud Connector collection
supports an explicitly bound Connectivity service and an OnPremise/BasicAuthentication technical
destination. Headless principal propagation is still refused. Shared metadata requires administrator approval
for all ARC readers. MCP tools remain off until separately enabled in ARC.

For capacity planning, see [storage sizing](../../docs_page/repository-graph-sizing.md).
`node dist/graph/cc-probe.js` verifies a CF-only SAP path and authentication negatives without
storing source. The separate `dist/graph/soak.js` comparison experiment imports bounded metadata
into **both** configured databases; it is not a normal collector command or dual-write mode.

Third-party packages retain their own licenses. In particular, `@sap/hana-client` declares
`SEE LICENSE IN developer-license-3_2.txt`; installing it does not relicense SAP's native driver
under ARC's license. Review those upstream terms before redistributing a backend image. This PR
does not publish a backend image or include the driver in ARC's default distribution.
