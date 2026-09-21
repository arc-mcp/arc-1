#!/usr/bin/env node

// ARC-1 — all published executable names share the same strict CLI runtime.
// Keeping this as an in-process import lets stdio MCP own stdin/stdout directly.

const { main } = await import('../dist/cli.js');
process.exitCode = await main(process.argv.slice(2));
