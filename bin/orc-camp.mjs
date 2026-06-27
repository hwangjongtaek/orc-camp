#!/usr/bin/env node
// Thin launcher for the compiled CLI. The only command in the scan slice is `scan`.
// (Run `npm run build` first; for dev use `npm run scan`.)
import { run } from '../dist/cli.js';

const argv = process.argv.slice(2);
// Accept an optional leading `scan` subcommand for forward-compat with `serve`/`doctor`.
const args = argv[0] === 'scan' ? argv.slice(1) : argv;

run(args).then((code) => {
  process.exitCode = code;
});
