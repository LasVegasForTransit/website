/** Small conventions shared by the `scripts/notion/*` command-line entry points. */
import process from 'node:process';

/** Print a failure and exit non-zero. */
export function die(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Read a required value from process.env (call loadEnvLocal first), or die with the hint. */
export function requireEnv(key: string, hint: string): string {
  const value = process.env[key]?.trim();
  if (!value) die(`${key} is not set in .env.local.\n  ${hint}`);
  return value;
}
