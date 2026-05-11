#!/usr/bin/env tsx
/*
 * validate-commit-scope.ts
 *
 * Validates a commit message against the LVBT website commit standard:
 *   - conventional-commits format (type(scope)?[!]?: description)
 *   - type in ALLOWED_TYPES (style is retired -> chore)
 *   - scope (if present) in allowed-scopes.txt
 *   - feat/fix always require a body
 *   - other types require a body when staged change density > 10
 *   - body lines <= 72 chars (trailers and blank lines exempt)
 *
 * Adapted from lovelace/scripts/validation/git/validate-commit-scope.ts.
 * Auto-discovery (apps/packages/crates) is dropped — LVBT has no monorepo.
 *
 * Usage:
 *   tsx validate-commit-scope.ts --file <path>     # commit-msg hook entry
 *   tsx validate-commit-scope.ts "feat: subject"   # ad-hoc check
 *   tsx validate-commit-scope.ts --print-scopes    # debug
 *
 * Exit codes:
 *   0 — valid
 *   1 — invalid (with explanation written to stderr)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../..');
const SCOPES_FILE = resolve(REPO_ROOT, 'allowed-scopes.txt');

// ---------------------------------------------------------------------------
// Conventional commit format & types
// ---------------------------------------------------------------------------

const ALLOWED_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'perf'] as const;

type RetiredEntry = { replacement: string; reason: string };
const RETIRED_TYPES: ReadonlyMap<string, RetiredEntry> = new Map([
  [
    'style',
    {
      replacement: 'chore',
      reason:
        'Prettier and the pre-commit hook enforce formatting automatically, so dedicated style commits are unnecessary.',
    },
  ],
  [
    'diag',
    {
      replacement: 'chore',
      reason:
        'Diagnostic / probe commits are still maintenance work; use chore with a clear subject.',
    },
  ],
]);

// Named groups let TS narrow without bracket-indexing the match array.
const CONVENTIONAL_REGEX = /^[a-z]+(?:\([a-z0-9._-]+\))?!?: .+/;
const HEADER_REGEX = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9._-]+)\))?!?:/;

const MAX_BODY_LINE_LENGTH = 72;
const FILE_WEIGHT = 2;
const LINE_WEIGHT = 0.1;
const DENSITY_THRESHOLD = 10;
const TRAILER_PREFIXES = ['Co-Authored-By:', 'Signed-off-by:', 'Reviewed-by:', 'Acked-by:'];

// ---------------------------------------------------------------------------
// Small string helpers — avoid indexed access so noUncheckedIndexedAccess
// doesn't push us into a forest of non-null assertions.
// ---------------------------------------------------------------------------

function firstLineOf(message: string): string {
  const newlineIdx = message.indexOf('\n');
  return newlineIdx === -1 ? message : message.slice(0, newlineIdx);
}

function stripInlineComment(line: string): string {
  const hashIdx = line.indexOf('#');
  return hashIdx === -1 ? line : line.slice(0, hashIdx);
}

// ---------------------------------------------------------------------------
// Scope loading
// ---------------------------------------------------------------------------

function loadAllowedScopes(): string[] {
  let raw: string;
  try {
    raw = readFileSync(SCOPES_FILE, 'utf-8');
  } catch (err) {
    console.error(`Failed to read ${SCOPES_FILE}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const scopes = new Set<string>();
  for (const line of raw.split('\n')) {
    const trimmed = stripInlineComment(line).trim();
    if (trimmed.length === 0) continue;
    scopes.add(trimmed);
  }
  return [...scopes].sort();
}

// ---------------------------------------------------------------------------
// Levenshtein distance for fuzzy scope suggestions.
//
// This is the one place we use non-null assertions: the matrix is fully
// pre-filled before any read, so every `m[i][j]` for i,j in [0..rows)x[0..cols)
// is a defined number by construction. Refactoring this with explicit guards
// would only add noise to a hot inner loop.
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const rows = b.length + 1;
  const cols = a.length + 1;
  const m: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  const top = m[0]!;
  for (let j = 0; j < cols; j++) top[j] = j;

  for (let i = 1; i < rows; i++) {
    const prev = m[i - 1]!;
    const curr = m[i]!;
    for (let j = 1; j < cols; j++) {
      curr[j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? prev[j - 1]!
          : Math.min(prev[j - 1]! + 1, curr[j - 1]! + 1, prev[j]! + 1);
    }
  }
  return m[rows - 1]![cols - 1]!;
}

function suggestScopes(invalid: string, allowed: string[], limit = 3): string[] {
  const threshold = Math.ceil(invalid.length / 2);
  return allowed
    .map((s) => ({ s, d: levenshtein(invalid, s) }))
    .filter((x) => x.d <= threshold)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.s);
}

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

function getStagedChangeDensity(): number {
  try {
    const result = execSync('git diff --cached --numstat', { encoding: 'utf-8' });
    let files = 0;
    let lines = 0;
    // numstat format: `<added>\t<deleted>\t<path>`. Binary files emit `-\t-`,
    // which parseInt rejects -> 0 contribution (intentional).
    for (const row of result.trim().split('\n').filter(Boolean)) {
      const added = row.slice(0, row.indexOf('\t'));
      const afterAdded = row.slice(row.indexOf('\t') + 1);
      const deleted = afterAdded.slice(0, afterAdded.indexOf('\t'));
      if (added.length === 0 || deleted.length === 0) continue;
      const a = parseInt(added, 10);
      const d = parseInt(deleted, 10);
      files++;
      lines += (Number.isFinite(a) ? a : 0) + (Number.isFinite(d) ? d : 0);
    }
    return files * FILE_WEIGHT + lines * LINE_WEIGHT;
  } catch {
    return 0;
  }
}

function hasBlankSeparatorAndBody(messageLines: string[]): boolean {
  // We need at least: title, blank, body. Iterate from index 1 onward so the
  // loop variable types itself as `string` (entries() preserves element type).
  let sawBlankAfterTitle = false;
  let sawNonTrailerBody = false;
  for (const [i, line] of messageLines.entries()) {
    if (i === 0) continue;
    if (i === 1) {
      sawBlankAfterTitle = line.trim().length === 0;
      continue;
    }
    if (line.trim().length === 0) continue;
    if (TRAILER_PREFIXES.some((p) => line.startsWith(p))) continue;
    sawNonTrailerBody = true;
  }
  return sawBlankAfterTitle && sawNonTrailerBody;
}

function validateBodyPresent(message: string, commitType: string): void {
  const requiresAlways = commitType === 'feat' || commitType === 'fix';
  const required = requiresAlways || getStagedChangeDensity() > DENSITY_THRESHOLD;
  if (!required) return;

  if (hasBlankSeparatorAndBody(message.split('\n'))) return;

  console.error('Commit blocked -- this commit needs a body explaining why.');
  console.error('');
  console.error('Add a blank line after the title, then 1-3 sentences:');
  console.error('');
  console.error('  feat: add Beehiiv newsletter subscribe Pages Function');
  console.error('');
  console.error('  Visitors can join the newsletter without leaving the site.');
  console.error('  A serverless function forwards email + name to Beehiiv and');
  console.error('  surfaces API errors inline.');
  console.error('');
  console.error('See: docs/standards/commit-messages.md');
  process.exit(1);
}

function validateBodyLineLength(message: string): void {
  const violations: { lineNum: number; length: number; text: string }[] = [];
  for (const [i, line] of message.split('\n').entries()) {
    if (i === 0) continue; // title is exempt from the length cap
    if (line.trim().length === 0) continue;
    if (TRAILER_PREFIXES.some((p) => line.startsWith(p))) continue;
    if (line.length > MAX_BODY_LINE_LENGTH) {
      violations.push({ lineNum: i + 1, length: line.length, text: line });
    }
  }
  if (violations.length === 0) return;

  console.error(`Commit blocked -- body lines must be <= ${MAX_BODY_LINE_LENGTH} characters`);
  console.error('');
  for (const v of violations) {
    console.error(`  Line ${v.lineNum} (${v.length} chars): ${v.text}`);
  }
  console.error('');
  console.error('  Title (line 1) is exempt. Wrap long body lines.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Header parsing — named groups keep TS happy without indexed access.
// ---------------------------------------------------------------------------

interface ParsedHeader {
  type: string;
  scope: string | null;
}

function parseHeader(firstLine: string): ParsedHeader | null {
  const match = firstLine.match(HEADER_REGEX);
  const type = match?.groups?.type;
  if (type === undefined) return null;
  const scope = match?.groups?.scope;
  return { type, scope: scope ?? null };
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

function validate(message: string): void {
  const firstLine = firstLineOf(message).trim();

  if (!CONVENTIONAL_REGEX.test(firstLine)) {
    console.error('Commit blocked -- invalid commit message format');
    console.error('');
    console.error(`  Got: ${firstLine}`);
    console.error('');
    console.error('  Required: type(scope)?: description');
    console.error('');
    console.error(`  Valid types: ${ALLOWED_TYPES.join(', ')}`);
    console.error('');
    console.error('  Examples:');
    console.error('    feat: add newsletter form');
    console.error('    fix(ci): pin pnpm-action-setup');
    console.error('    docs(docs): add commit-messages standard');
    console.error('');
    console.error('See: docs/standards/commit-messages.md');
    process.exit(1);
  }

  const header = parseHeader(firstLine);
  if (header === null) {
    // The CONVENTIONAL_REGEX passed but the named-group regex didn't —
    // this should never happen, but if it does, fail loudly.
    console.error('Commit blocked -- could not parse commit type');
    console.error(`  Got: ${firstLine}`);
    process.exit(1);
  }

  const retired = RETIRED_TYPES.get(header.type);
  if (retired !== undefined) {
    console.error(`Commit blocked -- "${header.type}" is not a valid commit type`);
    console.error('');
    console.error(`  ${retired.reason}`);
    console.error('');
    console.error(`  Use "${retired.replacement}" instead:`);
    console.error(`  ${firstLine.replace(new RegExp(`^${header.type}`), retired.replacement)}`);
    console.error('');
    console.error('  Fix this commit:');
    console.error('    git commit --amend');
    console.error('');
    console.error('See: docs/standards/commit-messages.md');
    process.exit(1);
  }

  if (!(ALLOWED_TYPES as readonly string[]).includes(header.type)) {
    console.error(`Commit blocked -- "${header.type}" is not a recognized type`);
    console.error('');
    console.error(`  Valid types: ${ALLOWED_TYPES.join(', ')}`);
    console.error('');
    console.error('See: docs/standards/commit-messages.md');
    process.exit(1);
  }

  // Body checks (before scope so missing-body is always surfaced)
  validateBodyPresent(message, header.type);
  validateBodyLineLength(message);

  if (header.scope === null) {
    process.exit(0); // scopeless is valid for cross-cutting changes
  }

  const allowed = loadAllowedScopes();
  if (allowed.includes(header.scope)) {
    process.exit(0);
  }

  console.error(`Commit blocked -- "${header.scope}" is not a recognized scope`);
  console.error('');
  console.error(`  Commit: ${firstLine}`);
  console.error('');

  const suggestions = suggestScopes(header.scope, allowed);
  if (suggestions.length > 0) {
    console.error('  Did you mean:');
    for (const s of suggestions) console.error(`    - ${s}`);
    console.error('');
  }

  console.error(`  Valid scopes: ${allowed.join(', ')}`);
  console.error('');
  console.error('  Or omit the scope for cross-cutting changes:');
  console.error('    type: description');
  console.error('');
  console.error('  Fix this commit:');
  console.error('    git commit --amend');
  console.error('');
  console.error('See: docs/standards/commit-scopes.md');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function readMessageFromFlag(args: string[]): string | null {
  const fileIdx = args.indexOf('--file');
  if (fileIdx === -1) return null;
  const path = args[fileIdx + 1];
  if (path === undefined) {
    console.error('--file requires a path argument');
    process.exit(1);
  }
  try {
    return readFileSync(resolve(path), 'utf-8');
  } catch (err) {
    console.error(`Failed to read commit message file: ${path}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: validate-commit-scope.ts --file <path>\n' +
        '       validate-commit-scope.ts "type(scope): subject"\n' +
        '       validate-commit-scope.ts --print-scopes',
    );
    process.exit(0);
  }

  if (args.includes('--print-scopes')) {
    process.stdout.write(`${loadAllowedScopes().join('\n')}\n`);
    return;
  }

  const fromFile = readMessageFromFlag(args);
  if (fromFile !== null) {
    validate(fromFile);
    return;
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length === 0) {
    console.error('Usage: validate-commit-scope.ts --file <path>');
    console.error('   or: validate-commit-scope.ts "type(scope): subject"');
    process.exit(1);
  }
  validate(positional.join(' '));
}

main();
