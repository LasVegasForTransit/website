import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RosterD1 } from './roster-d1';
import { printRosterReport, rosterPlan, runDatabaseRoster } from './roster-database';
import type { Db } from '@lasvegasfortransit/platform-storage/db';
interface Options {
  input: string;
  account: string;
  database: string;
  plan: string;
  apply: boolean;
  retryHeld?: boolean;
}
function argumentsFor(args: string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  let retryHeld = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--retry-held') {
      if (retryHeld) throw new Error('Duplicate --retry-held');
      retryHeld = true;
      continue;
    }
    if (flag === '--apply') {
      if (apply) throw new Error('Duplicate --apply');
      apply = true;
      continue;
    }
    if (
      !flag ||
      !['--input', '--account', '--database', '--plan'].includes(flag) ||
      values.has(flag) ||
      !args[i + 1] ||
      args[i + 1]?.startsWith('--')
    )
      throw new Error('Invalid roster command options');
    values.set(flag, args[++i] ?? '');
  }
  const get = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`Missing ${name}`);
    return value;
  };
  return {
    input: get('--input'),
    account: get('--account'),
    database: get('--database'),
    plan: get('--plan'),
    apply,
    retryHeld,
  };
}
export async function executeRosterCommand(options: Options, db: Db): Promise<string> {
  const records: unknown = JSON.parse(await readFile(options.input, 'utf8'));
  if (!Array.isArray(records)) throw new Error('Roster input must be a reviewed JSON array');
  const clock = new Date();
  const plan = await rosterPlan(db, records, {
    runId: 'dry-run',
    now: clock,
    retryHeld: options.retryHeld === true,
  });
  const target = { account: options.account, database: options.database };
  if (!options.apply) {
    await writeFile(
      options.plan,
      JSON.stringify({ ...plan, target, createdAt: clock.toISOString() }, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    return printRosterReport(plan.report, true);
  }
  const saved: unknown = JSON.parse(await readFile(options.plan, 'utf8'));
  if (
    !saved ||
    typeof saved !== 'object' ||
    !('inputHash' in saved) ||
    saved.inputHash !== plan.inputHash ||
    !('databaseHash' in saved) ||
    saved.databaseHash !== plan.databaseHash ||
    !('target' in saved) ||
    JSON.stringify(saved.target) !== JSON.stringify(target) ||
    !('report' in saved) ||
    JSON.stringify(saved.report) !== JSON.stringify(plan.report)
  )
    throw new Error('Input or database changed since review; create and review a new dry run');
  const report = await runDatabaseRoster(db, records, {
    runId: crypto.randomUUID(),
    now: clock,
    retryHeld: options.retryHeld === true,
  });
  return printRosterReport(report, false);
}
export async function runRosterCommand(args: string[]): Promise<number> {
  try {
    const options = argumentsFor(args);
    const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
    const db = new RosterD1({
      accountId: options.account,
      databaseId: options.database,
      token,
      write: options.apply,
    });
    process.stdout.write((await executeRosterCommand(options, db)) + '\n');
    return 0;
  } catch (error) {
    // Provider response bodies, input contents and credential values stay private.
    const safe =
      error instanceof Error &&
      /^(Missing --|Invalid roster command|Duplicate --|D1 import |Dry-run connection|Input or database changed|Roster input must)/.test(
        error.message,
      )
        ? error.message
        : 'Roster import failed; inspect the private input and database setup, then repeat the dry run';
    process.stderr.write(safe + '\n');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runRosterCommand(process.argv.slice(2));
