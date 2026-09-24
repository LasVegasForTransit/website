#!/usr/bin/env tsx
/**
 * LVBT Website Bootstrap CLI
 *
 * Usage:
 *   pnpm bootstrap                    Full interactive setup
 *   pnpm bootstrap --doctor           Read-only readiness check
 *   pnpm bootstrap --resume           Skip phases that already completed
 *   pnpm bootstrap --local-only       Skip phases that need GitHub/Cloudflare
 *   pnpm bootstrap --phase env        Run a single phase by id
 *   pnpm bootstrap --phase deploy --redeploy
 *                                     Push ./dist to production even though
 *                                     a production deployment exists
 *   pnpm bootstrap --phase secrets --rotate NAME[,NAME]
 *                                     Replace secrets that are already set
 *
 * Phases (in order):
 *   install   — verify Node, pnpm, gh, wrangler; install missing
 *   auth      — ensure gh + wrangler are logged in
 *   workspace — pnpm install + pnpm build smoke
 *   env       — write .env.local; prompt for Beehiiv/donate/social URLs
 *   repo      — gh repo create + push (skipped if origin already set)
 *   deploy    — create the Pages project and first deploy, only if missing
 *   domain    — verify lasvegasfortransit.org points at the Pages project
 *   secrets   — report and set every server-side secret the site and platform need
 *
 * The flow itself lives in `run.ts`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '@clack/prompts';
import { parseArgs, runBootstrap, UsageError, type CliArgs } from './run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function readArgs(): CliArgs {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exit(2);
  }
}

runBootstrap(readArgs(), projectRoot).catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
