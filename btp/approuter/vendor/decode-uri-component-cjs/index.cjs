'use strict';

// CommonJS bridge to the patched decode-uri-component 0.5.0.
//
// @sap/approuter's query-string@7 is CommonJS and calls this module as a bare
// function, but every fixed release (>= 0.4) is ESM-only. `require()` of an ES
// module returns the namespace ({ __esModule, default }), not the function, so
// unwrap `.default` here. Upstream keeps owning the decoder — this file must
// never grow a reimplementation of it.
//
// Requires Node >= 22.12 for require(esm); enforced by "engines" in
// ../../package.json. See ../../.npmrc for why this is copied, not linked.
//
// Updating: bump BOTH the "decode-uri-component-esm" alias and this package's
// own "version" in package.json. GitHub reads the dependency graph from the
// lockfile path, so this package is what it sees as decode-uri-component — the
// real tarball hides behind the alias and never matches an advisory. Dependabot
// cannot do this bump itself; approuter-config.test.ts fails if they drift.
//
// Deleting: once @sap/approuter ships a chain that no longer resolves
// decode-uri-component <= 0.4.2 (e.g. it moves to query-string >= 9), drop this
// directory, the override in ../../package.json, ../../.npmrc and the test.
module.exports = require('decode-uri-component-esm').default;
