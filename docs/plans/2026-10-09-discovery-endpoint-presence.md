# Preserve listed discovery collections (#950)

Base: `d6cb05382`; implementation is PR #953. The parser drops listed collections
without media types, so presence gates mistake missing MIME data for endpoint
absence. The issue's three XML fragments confirm this for domains, table types
and lock objects. Eleven parser/gate/negotiation assertions fail on main; tests
for tables and packages use synthetic listed collections, not reporter captures.

A controlled replay of live SAP_BASIS 758 SP02 discovery, replacing only the five
collections' accept values with empty elements, reproduces the false 7.50/7.51
DOMA refusal. Restoring those keys as empty arrays permits create/read/delete of
a unique `$TMP` domain on the same system; cleanup returned 404. This uses a
developer identity and modified discovery, not a display-only role or PP replay.

## Plan and review

1. Retain each listed ADT path in the existing map, with `[]` when no media type
   is advertised. Keep the last usable definition for duplicate paths, as before.
2. Skip empty arrays during MIME lookup, preserving shallow parent fallback and
   explicit headers. No new cache, parallel set, startup plumbing or schema.
3. Test reported XML, absent/unprobed states, target isolation, duplicate paths,
   parent fallback and the domain-create handler. Replay the built fix against
   real 758 and compare old/new negotiation over live discovery paths.
4. Run the six local gates, update operator guidance, review the diff and open a PR.

`app:accept` describes representations accepted for POST, not whether the listed
collection exists ([RFC 5023 §8.3.4](https://www.rfc-editor.org/rfc/rfc5023#section-8.3.4)).
Presence is only a capability hint: scopes, write opt-in, real package and SAP
authorization checks remain required. MIME-based feature gates remain MIME-based.
Discovery failure remains unknown; no read-side gates or role changes are added.

Built-fix verification: 644 live 758 collections are retained (232 advertise MIME
types); 3,864 collection/object/source Accept and Content-Type comparisons retain
the old negotiation. The controlled empty-accept replay passes all five gates and
the domain create/read/delete check. Unmodified live 750 discovery still makes
all five gates return false. No display-only credentials or PP route were available.

## Review follow-up

The fix applies only to listed collections. The reporter's 664-versus-669 total
collections and missing table entry in the old MIME map do not establish whether
`/ddic/tables` was omitted or listed without media types. `/packages` was not
checked. Neither the controlled replay nor developer-user discovery resolves
that uncertainty. The operator guidance and PR claim are narrowed accordingly;
no release heuristic or guessed endpoint is added. Resolving that remaining
question needs the reporter's original startup discovery, not broader roles.

A document whose collections all lack media types now yields a nonempty map.
`hasDiscoveryData()` therefore reports loaded discovery, and MIME-based capability
gates can return false instead of unknown. This is a representation consequence,
not a change to MIME selection or authority. The reporter had 142 usable entries,
so this is not its failure shape. No all-empty live capture is available; it is
not claimed to be impossible. Existing MIME-based gates are left unchanged.

Roadmap checked: no impact. ARCH-01 is broader endpoint routing; FEAT-50 still
needs complete captures from additional releases and authorization setups.
