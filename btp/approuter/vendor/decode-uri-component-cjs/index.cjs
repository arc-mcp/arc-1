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
// ../../package.json.
module.exports = require('decode-uri-component-esm').default;
