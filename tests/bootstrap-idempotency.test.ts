// Runs the whole bootstrap against a pretend GitHub and Cloudflare (see
// bootstrap-fake-world.ts): once from nothing, then again. The second run on
// a finished setup must change nothing, ask for no secret, and report ready.
// A run after a partial one must do only what is left.

import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PLATFORM_SECRETS, isSensitive } from '../scripts/bootstrap/config/platform-secrets.js';
import { mergeEnvFile } from '../scripts/bootstrap/lib/env-file.js';
import { withRuntime } from '../scripts/bootstrap/lib/runtime.js';
import {
  parseArgs,
  runBootstrap,
  UsageError,
  type BootstrapOutcome,
} from '../scripts/bootstrap/run.js';
import { FakeWorld, fakeValueFor, type Answer } from './bootstrap-fake-world.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILES = ['.env.local', '.env.example', 'wrangler.jsonc', 'package.json'];
const ENV_KEYS = [
  'LVBT_BEEHIIV_API_KEY',
  'LVBT_BEEHIIV_PUBLICATION_ID',
  'LVBT_NOTION_API_KEY',
  'LVBT_NOTION_PARENT_PAGE_ID',
  'PUBLIC_LVBT_DONATE_URL',
];

let scratch = '';
const baselineEnv = { ...process.env };

before(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), 'lvbt-bootstrap-'));
});

after(() => {
  restoreEnv();
  rmSync(scratch, { recursive: true, force: true });
});

// Each run starts like a new process: nothing from an earlier run is left in
// process.env except what the bootstrap reads back from .env.local itself.
function restoreEnv(home?: string): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) Reflect.deleteProperty(process.env, key);
  }
  for (const [key, value] of Object.entries(baselineEnv)) {
    const isBootstrapKey = /^(CLOUDFLARE_|LVBT_|PUBLIC_LVBT_)/.test(key);
    if (isBootstrapKey) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- a throwaway home, so the Playwright cache check sees a fresh machine.
  if (home) process.env.HOME = home;
}

interface Setup {
  root: string;
  home: string;
  world: FakeWorld;
}

// A fresh checkout: the tracked config files, no .env.local, no git remote,
// nothing in GitHub or Cloudflare except the Worker that CI uploads.
function freshSetup(name: string): Setup {
  const base = path.join(scratch, name);
  const root = path.join(base, 'LasVegasForTransit', 'website');
  const home = path.join(base, 'home');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  for (const file of ['.env.example', 'wrangler.jsonc', 'package.json']) {
    copyFileSync(path.join(repoRoot, file), path.join(root, file));
  }
  return { root, home, world: new FakeWorld(root, home) };
}

/** Answers a person would give on a first run: fill everything in. */
function firstRunAnswers(): Record<string, Answer> {
  const answers: Record<string, Answer> = {
    'env.fill': true,
    'secrets.scope': 'later',
    'staff-console-google-group': true,
    'LVBT_TRANSIT_NEWS_INTAKE_SECRET.show-generated': false,
    CLOUDFLARE_API_TOKEN: fakeValueFor('CLOUDFLARE_API_TOKEN'),
  };
  for (const key of ENV_KEYS) answers[key] = fakeValueFor(key);
  for (const secret of PLATFORM_SECRETS) answers[secret.name] = fakeValueFor(secret.name);
  return answers;
}

interface RunResult extends BootstrapOutcome {
  /** Everything the bootstrap printed to the terminal. */
  printed: string;
}

// Keeps the bootstrap's terminal output out of the test report and hands it
// back, so a test can check that no secret was ever printed. Only text is
// captured; the test runner's own binary messages pass straight through.
async function capturePrinted<T>(fn: () => Promise<T>): Promise<{ value: T; printed: string }> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  const capture = (chunk: string | Uint8Array, ...rest: never[]): boolean => {
    if (typeof chunk === 'string') {
      chunks.push(chunk);
      return true;
    }
    return write(chunk, ...rest);
  };
  process.stdout.write = capture;
  try {
    const value = await fn();
    return { value, printed: chunks.join('') };
  } finally {
    process.stdout.write = write;
  }
}

async function runOnce(
  setup: Setup,
  argv: string[] = [],
  answers?: Record<string, Answer>,
): Promise<RunResult> {
  restoreEnv(setup.home);
  setup.world.beginRun(answers);
  const { value, printed } = await capturePrinted(() =>
    withRuntime(setup.world.runtime(), () => runBootstrap(parseArgs(argv), setup.root)),
  );
  return { ...value, printed };
}

// Terminal output with colors, box borders and line breaks removed, so a
// value wrapped across lines inside a box still matches.
function flatten(text: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI color codes start with the ESC character.
  return text.replace(/\x1b\[[\d;]*[a-zA-Z]/g, '').replace(/[│┃|\s]/g, '');
}

function secretValues(setup: Setup): string[] {
  const localIntake = /^LVBT_MEMBERSHIP_INTAKE_SECRET=(.+)$/m.exec(
    readFileSync(path.join(setup.root, '.env.local'), 'utf8'),
  )?.[1];
  return [...setup.world.secretValues(), ...(localIntake ? [localIntake] : [])];
}

function assertNoSecretPrinted(setup: Setup, printed: string): void {
  const values = secretValues(setup);
  assert.ok(values.length > 0);
  const shown = flatten(printed);
  for (const value of values) {
    assert.equal(shown.includes(flatten(value)), false, 'a secret value was printed');
  }
}

function snapshot(root: string): Map<string, { bytes: string; mtimeMs: number }> {
  const files = new Map<string, { bytes: string; mtimeMs: number }>();
  for (const file of CONFIG_FILES) {
    const full = path.join(root, file);
    files.set(file, { bytes: readFileSync(full, 'utf8'), mtimeMs: statSync(full).mtimeMs });
  }
  return files;
}

function assertReady(outcome: BootstrapOutcome): void {
  for (const [phase, result] of Object.entries(outcome.results)) {
    assert.equal(result.success, true, `${phase} should report ready`);
  }
  for (const [phase, state] of Object.entries(outcome.state.phases)) {
    assert.equal(state.status, 'complete', `${phase} should be complete`);
  }
}

void test('a second run of the whole bootstrap changes nothing and reports ready', async () => {
  const setup = freshSetup('twice');

  const first = await runOnce(setup, [], firstRunAnswers());
  assertReady(first);
  assertNoSecretPrinted(setup, first.printed);
  assert.ok(setup.world.mutations.length > 0, 'the first run should set things up');
  for (const secret of PLATFORM_SECRETS) {
    for (const target of secret.targets) {
      const stored =
        target === 'worker'
          ? setup.world.workerSecrets
          : target === 'pages'
            ? setup.world.pagesSecrets
            : setup.world.githubSecrets;
      assert.equal(
        stored.has(secret.name),
        secret.listOnly !== true,
        `${secret.name} on ${target}: stored unless no feature uses it yet`,
      );
    }
  }
  const listOnly = PLATFORM_SECRETS.filter((s) => s.listOnly === true).map((s) => s.name);
  assert.ok(listOnly.length > 0);
  for (const name of listOnly) {
    assert.equal(setup.world.valuePrompts().includes(name), false, `${name} is never asked for`);
  }

  const before = snapshot(setup.root);
  const second = await runOnce(setup);

  assert.deepEqual(setup.world.mutations, [], 'the second run should change nothing remote');
  assert.deepEqual(setup.world.secretPrompts(), [], 'the second run should ask for no secret');
  assert.deepEqual(
    setup.world.prompts.filter((p) => p.kind === 'text'),
    [],
    'the second run should ask for no value',
  );
  assert.deepEqual(snapshot(setup.root), before, 'config files should be untouched');
  assertNoSecretPrinted(setup, second.printed);
  assertReady(second);
});

void test('values that are not secret are asked for in plain view and shown back; secrets never are', async () => {
  const setup = freshSetup('visible-values');
  const asked = PLATFORM_SECRETS.filter((s) => s.listOnly !== true && s.generate !== true);
  assert.ok(asked.some((s) => isSensitive(s)) && asked.some((s) => !isSensitive(s)));

  const first = await runOnce(setup, [], firstRunAnswers());
  for (const secret of asked) {
    const kinds = setup.world.promptKinds(secret.name);
    const expected = isSensitive(secret) ? 'password' : 'text';
    assert.ok(kinds.length > 0, `${secret.name} is asked for`);
    assert.ok(
      kinds.every((kind) => kind === expected),
      `${secret.name} is asked for with ${expected} input`,
    );
  }

  const second = await runOnce(setup);
  const shown = flatten(second.printed);
  for (const secret of asked.filter((s) => !isSensitive(s))) {
    assert.ok(shown.includes(flatten(fakeValueFor(secret.name))), `${secret.name} is shown`);
  }
  assertNoSecretPrinted(setup, first.printed);
  assertNoSecretPrinted(setup, second.printed);

  const stateFile = readFileSync(path.join(setup.root, '.lvbt', 'dev-readiness.json'), 'utf8');
  for (const value of secretValues(setup)) {
    assert.equal(stateFile.includes(value), false, 'no credential is kept in the state file');
  }
});

void test('a run while a domain waits for its certificate attaches and writes nothing', async () => {
  const setup = freshSetup('pending-domain');
  await runOnce(setup, [], firstRunAnswers());
  setup.world.pendingHosts.add('lasvegasfortransit.org');

  await runOnce(setup);

  assert.deepEqual(setup.world.mutations, []);
  assert.deepEqual(setup.world.secretPrompts(), [], 'no DNS token is needed');
});

void test('a run after a skipped secret asks only for that secret', async () => {
  const setup = freshSetup('skipped-secret');
  const answers = { ...firstRunAnswers(), LVBT_ACCESS_AUD: '' };

  const first = await runOnce(setup, [], answers);
  assert.equal(first.results.secrets?.success, false);
  assert.equal(setup.world.pagesSecrets.has('LVBT_ACCESS_AUD'), false);

  await runOnce(setup, [], { ...answers, LVBT_ACCESS_AUD: fakeValueFor('LVBT_ACCESS_AUD') });

  assert.deepEqual(setup.world.valuePrompts(), ['LVBT_ACCESS_AUD']);
  assert.deepEqual([...setup.world.mutations].sort(), [
    'pages secret LVBT_ACCESS_AUD',
    'worker secret LVBT_ACCESS_AUD',
  ]);
  assert.equal(
    setup.world.prompts.some((p) => p.id === 'staff-console-google-group'),
    false,
    'a confirmed setup step is not asked about again',
  );
});

void test('a run after a failed deploy deploys once and creates nothing twice', async () => {
  const setup = freshSetup('failed-deploy');
  setup.world.failOnce.add('wrangler pages deploy');

  const first = await runOnce(setup, [], firstRunAnswers());
  assert.equal(first.results.deploy?.success, false);

  const second = await runOnce(setup);
  assert.deepEqual(setup.world.mutations, ['pages deploy lvbt-website']);
  assertReady(second);
});

void test('--redeploy pushes the site again and changes nothing else', async () => {
  const setup = freshSetup('redeploy');
  await runOnce(setup, [], firstRunAnswers());

  const before = snapshot(setup.root);
  await runOnce(setup, ['--phase', 'deploy', '--redeploy']);

  assert.deepEqual(setup.world.mutations, ['pages deploy lvbt-website']);
  assert.deepEqual(snapshot(setup.root), before);
});

void test('--rotate replaces only the named secrets, everywhere they are stored', async () => {
  const setup = freshSetup('rotate');
  await runOnce(setup, [], firstRunAnswers());

  await runOnce(
    setup,
    ['--phase', 'secrets', '--rotate', 'LVBT_SIGN_IN_SECRET,LVBT_RESEND_API_KEY'],
    {
      LVBT_RESEND_API_KEY: 're_fake_rotated_0123456789abcdef',
    },
  );

  assert.deepEqual(setup.world.secretPrompts(), ['LVBT_RESEND_API_KEY']);
  assert.deepEqual([...setup.world.mutations].sort(), [
    'pages secret LVBT_RESEND_API_KEY',
    'pages secret LVBT_SIGN_IN_SECRET',
    'worker secret LVBT_RESEND_API_KEY',
    'worker secret LVBT_SIGN_IN_SECRET',
  ]);
});

void test('--rotate refuses unknown names and values no feature uses', () => {
  assert.throws(() => parseArgs(['--rotate', 'NOT_A_SECRET']), UsageError);
  assert.throws(() => parseArgs(['--rotate']), UsageError);
  assert.throws(() => parseArgs(['--rotate', 'LVBT_GOOGLE_SERVICE_ACCOUNT_KEY']), UsageError);
  assert.deepEqual(parseArgs(['--rotate=LVBT_SIGN_IN_SECRET']).rotate, ['LVBT_SIGN_IN_SECRET']);
});

void test('.env.local is not rewritten when a saved value is unchanged', () => {
  const file = path.join(mkdtempSync(path.join(scratch, 'env-')), '.env.local');
  writeFileSync(file, '# comment\nCLOUDFLARE_ACCOUNT_ID=abc\nOTHER="a b"\n');
  const mtime = statSync(file).mtimeMs;

  assert.equal(
    mergeEnvFile(
      file,
      new Map([
        ['CLOUDFLARE_ACCOUNT_ID', 'abc'],
        ['OTHER', 'a b'],
      ]),
    ),
    false,
  );
  assert.equal(statSync(file).mtimeMs, mtime);

  assert.equal(mergeEnvFile(file, new Map([['CLOUDFLARE_ACCOUNT_ID', 'def']])), true);
  assert.match(readFileSync(file, 'utf8'), /^CLOUDFLARE_ACCOUNT_ID=def$/m);
  assert.match(readFileSync(file, 'utf8'), /^OTHER="a b"$/m);
});
