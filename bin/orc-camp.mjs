#!/usr/bin/env node
// Thin launcher for the compiled CLI dispatcher.
// (Run `npm run build` first; for dev use `npm run scan` / `npm run serve`.)
import { main } from '../dist/main.js';

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
