/**
 * SPEC-100 §2.1 — top-level CLI dispatch.
 *   orc-camp [serve|scan|doctor|purge] [flags]
 *   orc-camp (no subcommand) = serve + browser open (default)
 */
import { fileURLToPath } from 'node:url';
import { run } from './cli';
import { serveCommand } from './server/serve';
import { doctorCommand } from './server/doctor';
import { purgeCommand } from './server/purge';
import { APP_VERSION } from './server/version';

const TOP_USAGE = `orc-camp — visualize tmux camps and AI-agent orcs (local-first)

Usage:
  orc-camp [serve] [--port <n>] [--host <addr> [--allow-external]] [--no-open] [--json]
  orc-camp scan    [--json] [--watch [interval]]      # read-only discovery (no server)
  orc-camp doctor  [--json] [--report [path]]         # environment health
  orc-camp purge   [--yes] [--json]                   # remove local config + log data
  orc-camp (--help | --version)

With no subcommand, orc-camp starts the local server and opens the dashboard.`;

export async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === undefined || first.startsWith('-')) {
    if (first === '--version' || first === '-V') {
      process.stdout.write(APP_VERSION + '\n');
      return 0;
    }
    if (first === '--help' || first === '-h') {
      process.stdout.write(TOP_USAGE + '\n');
      return 0;
    }
    return serveCommand(argv, { open: true }); // default = serve + open
  }

  switch (first) {
    case 'serve':
      return serveCommand(argv.slice(1), { open: false });
    case 'scan':
      return run(argv.slice(1));
    case 'doctor':
      return doctorCommand(argv.slice(1));
    case 'purge':
      return purgeCommand(argv.slice(1));
    default:
      process.stderr.write(`error: unknown command '${first}'\nRun \`orc-camp --help\` for usage.\n`);
      return 2;
  }
}

// Self-invoke when run directly (`tsx src/main.ts ...` or `node dist/main.js`).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
