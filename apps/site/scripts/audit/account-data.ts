import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';
import {
  ACCOUNT_ORIGIN,
  type accountDataRuntime,
} from '../../tests/runtime/support/account-data-runtime';

interface AccountLighthouseResult {
  requestedUrl: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  runtimeError?: unknown;
  categories: Record<'performance' | 'accessibility' | 'best-practices', { score: number }>;
}
/** Audit authenticated compiled GETs; code requests and deletion remain explicit POSTs. */
export async function auditAccountData(fixture: Awaited<ReturnType<typeof accountDataRuntime>>) {
  const paths = ['/account/data/', '/account/delete/', '/account/delete/code/'];
  const config = join(fixture.data, 'lighthouse-account-data.cjs');
  const output = join(fixture.root, 'test-results/account-data/lighthouse');
  await writeFile(
    config,
    `module.exports = ${JSON.stringify({
      ci: {
        collect: {
          url: paths.map((path) => ACCOUNT_ORIGIN + path),
          numberOfRuns: 1,
          chromePath: chromium.executablePath(),
          settings: {
            onlyCategories: ['performance', 'accessibility', 'best-practices'],
            extraHeaders: { Cookie: `${SESSION_COOKIE}=${fixture.session.token}` },
            chromeFlags: `--ignore-certificate-errors --no-proxy-server --host-resolver-rules="MAP ${new URL(ACCOUNT_ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND"`,
          },
        },
        assert: {
          assertions: {
            'categories:accessibility': ['error', { minScore: 0.95 }],
            'categories:performance': ['error', { minScore: 0.85 }],
            'categories:best-practices': ['error', { minScore: 0.9 }],
            'largest-contentful-paint': ['error', { maxNumericValue: 4000 }],
            'total-blocking-time': ['error', { maxNumericValue: 300 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
          },
        },
        upload: { target: 'filesystem', outputDir: output },
      },
    })};\n`,
  );
  const cli = createRequire(import.meta.url).resolve('@lhci/cli/src/cli.js');
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [cli, 'autorun', '--config', config],
    { cwd: fixture.data, maxBuffer: 2_000_000 },
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  const reports = [];
  for (const file of await readdir(join(fixture.data, '.lighthouseci'))) {
    if (!file.endsWith('.json')) continue;
    const result = JSON.parse(
      await readFile(join(fixture.data, '.lighthouseci', file), 'utf8'),
    ) as AccountLighthouseResult;
    if (!result.requestedUrl) continue;
    assert.equal(result.runtimeError, undefined);
    const path = new URL(result.requestedUrl).pathname;
    assert.ok(paths.includes(path));
    assert.equal(
      new URL(result.finalDisplayedUrl ?? result.finalUrl ?? '').pathname,
      path,
      'the audit must render the authenticated route, not a sign-in redirect',
    );
    reports.push({
      path,
      performance: result.categories.performance.score,
      accessibility: result.categories.accessibility.score,
      bestPractices: result.categories['best-practices'].score,
    });
  }
  assert.equal(reports.length, paths.length);
  assert.equal(fixture.emails.length, 0, 'Lighthouse GETs must never request a deletion code');
  console.log(
    JSON.stringify({
      runtime: 'compiled authenticated website Worker',
      lighthouse: reports,
      reports: output,
    }),
  );
}
