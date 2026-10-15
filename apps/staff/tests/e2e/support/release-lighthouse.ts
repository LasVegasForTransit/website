import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { assertAuthenticatedReport, type LighthouseReport } from '../../../scripts/audit/budgets';
import { ORIGIN, type startRuntime } from '../../support/runtime';

function redactError(error: unknown, redact: (value: string) => string) {
  if (!(error instanceof Error)) return;
  error.message = redact(error.message);
  if (error.stack) error.stack = redact(error.stack);
  const output = error as Error & { stdout?: string; stderr?: string };
  if (output.stdout) output.stdout = redact(output.stdout);
  if (output.stderr) output.stderr = redact(output.stderr);
}

/** Use only local synthetic credentials; never publish a report to an external Lighthouse service. */
export async function auditStaffLighthouse(
  fixture: Awaited<ReturnType<typeof startRuntime>>,
  output: string,
) {
  const data = await mkdtemp(join(tmpdir(), 'lvbt-staff-lighthouse-'));
  const url = `${ORIGIN}/people/`;
  const credentials = [fixture.admin.assertion, fixture.admin.session.token];
  const redact = (value: string) =>
    credentials.reduce(
      (result, credential) => result.replaceAll(credential, '[synthetic credential removed]'),
      value,
    );
  try {
    const config = join(data, 'lighthouserc.cjs');
    await writeFile(
      config,
      `module.exports = ${JSON.stringify({
        ci: {
          collect: {
            url: [url],
            numberOfRuns: 1,
            chromePath: chromium.executablePath(),
            settings: {
              onlyCategories: ['performance', 'accessibility', 'best-practices'],
              extraHeaders: {
                Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
                'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
              },
              // The CI exception is limited to the isolated local Linux fixture.
              chromeFlags: `${process.platform === 'linux' && process.env.CI === 'true' ? '--no-sandbox ' : ''}--ignore-certificate-errors --no-proxy-server --host-resolver-rules="MAP ${new URL(ORIGIN).hostname} 127.0.0.1:${fixture.port}, MAP * ~NOTFOUND"`,
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
      { cwd: data, maxBuffer: 2_000_000 },
    );
    process.stdout.write(redact(stdout));
    process.stderr.write(redact(stderr));
    const reports = [];
    for (const file of await readdir(join(data, '.lighthouseci'))) {
      if (!file.endsWith('.json')) continue;
      const report = JSON.parse(
        await readFile(join(data, '.lighthouseci', file), 'utf8'),
      ) as LighthouseReport;
      if (!report.requestedUrl) continue;
      assertAuthenticatedReport(report, url);
      reports.push({
        path: '/people/',
        categories: Object.fromEntries(
          Object.entries(report.categories ?? {}).map(([name, category]) => [name, category.score]),
        ),
        lcp: report.audits['largest-contentful-paint']?.numericValue,
        tbt: report.audits['total-blocking-time']?.numericValue,
        cls: report.audits['cumulative-layout-shift']?.numericValue,
      });
    }
    assert.equal(reports.length, 1, 'one authenticated Members page must be audited');
    return reports;
  } catch (error) {
    // execFile errors can contain subprocess output; never print its synthetic auth headers.
    redactError(error, redact);
    throw new Error('Authenticated staff Lighthouse failed', { cause: error });
  } finally {
    try {
      for (const file of await readdir(output)) {
        if (!/\.(?:json|html)$/.test(file)) continue;
        const path = join(output, file);
        await writeFile(path, redact(await readFile(path, 'utf8')));
      }
    } finally {
      await rm(data, { recursive: true, force: true });
    }
  }
}
