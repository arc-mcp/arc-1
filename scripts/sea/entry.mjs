// Entry point of the single-executable bundle (see scripts/build-sea.mjs).
// No top-level await: the bundle is CommonJS.
import { main } from '../../dist/cli.js';

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
