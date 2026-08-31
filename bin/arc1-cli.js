#!/usr/bin/env node

// Back-compatible alias of arc1/arc-1. All names expose the same command set.

const { main } = await import('../dist/cli.js');
process.exitCode = await main(process.argv.slice(2));
