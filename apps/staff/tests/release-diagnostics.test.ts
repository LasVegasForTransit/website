import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { MetadataClient, object } from '../scripts/preflight-api';
import { deploymentStep } from '../scripts/release-failure';
import { uploadStaffRelease, inspectStaffRelease } from '../scripts/release-deploy';
import { deploymentFixture, versions } from './support/deployment';
import { releaseIdentity } from './support/release';
import { ReleaseDiagnosticError } from '../scripts/release-diagnostics';

const privateText = 'DO-NOT-PRINT-https://private.invalid/?token=credential';
function diagnostics(error: unknown): unknown {
  assert.ok(error instanceof Error);
  assert.equal(`${error.message}${JSON.stringify(error)}`.includes(privateText), false);
  return Reflect.get(error, 'diagnostics');
}

void test('unknown checks, invalid statuses and forged diagnostic properties cannot cross the boundary', async () => {
  const safe = new ReleaseDiagnosticError(
    [
      { id: privateText, status: 'failed' },
      { id: 'version.id', status: privateText },
      { id: 'version.annotation', status: 'failed' },
    ],
    { httpStatus: privateText, cloudflareCodes: [privateText, 10000] },
  );
  await assert.rejects(
    deploymentStep('staff.version', () => Promise.reject(safe)),
    (error) => {
      assert.deepEqual(diagnostics(error), {
        checks: [{ id: 'version.annotation', status: 'failed' }],
        cloudflareCodes: [10000],
      });
      return true;
    },
  );
  const forged = Object.assign(new Error(privateText), {
    diagnostics: { checks: [{ id: privateText, status: 'failed' }] },
  });
  await assert.rejects(
    deploymentStep('staff.version', () => Promise.reject(forged)),
    (error) => {
      assert.equal(diagnostics(error), undefined);
      return true;
    },
  );
});

void test('provider rejection reports only validated status and numeric codes without retrying', async () => {
  let requests = 0;
  const client = new MetadataClient({
    accountId: privateText,
    token: privateText,
    fetch: () => {
      requests += 1;
      return Promise.resolve(
        Response.json(
          {
            success: false,
            errors: [
              { code: 10000, message: privateText },
              { code: 10000 },
              { code: `10001-${privateText}` },
              { code: -1 },
              { code: 1.5 },
              { code: 1e20 },
            ],
            result: privateText,
          },
          { status: 403 },
        ),
      );
    },
  });
  await assert.rejects(
    deploymentStep('staff.version', () => client.get(`/${privateText}`)),
    (error) => {
      assert.deepEqual(diagnostics(error), {
        checks: [{ id: 'provider.metadata', status: 'unverified' }],
        httpStatus: 403,
        cloudflareCodes: [10000],
      });
      assert.ok(error instanceof Error);
      assert.match(error.message, /unverified provider\.metadata/);
      assert.match(error.message, /HTTP 403/);
      assert.match(error.message, /Cloudflare codes 10000/);
      return true;
    },
  );
  assert.equal(requests, 1);
});

void test('transport and malformed responses remain unverified without printing raw errors', async () => {
  for (const malformed of [false, true]) {
    const client = new MetadataClient({
      accountId: 'account',
      token: privateText,
      fetch: () => {
        if (!malformed) return Promise.reject(new Error(privateText));
        return Promise.resolve(new Response(privateText, { status: 502 }));
      },
    });
    await assert.rejects(
      deploymentStep('staff.version', () => client.get('/versions/selected')),
      (error) => {
        assert.deepEqual(diagnostics(error), {
          checks: [{ id: 'provider.metadata', status: 'unverified' }],
          ...(malformed ? { httpStatus: 502 } : {}),
        });
        return true;
      },
    );
  }
});

void test('uploaded variable mismatch names the approved check and stops before jobs upload', async () => {
  const f = await deploymentFixture();
  try {
    const fetcher: typeof fetch = async (input, init) => {
      const response = await f.options.fetch(input, init);
      const body = object(await response.json());
      if (
        new URL(input instanceof Request ? input.url : input).pathname.endsWith(
          `/versions/${versions.staff}`,
        )
      ) {
        const bindings = object(object(body.result).resources).bindings as Record<
          string,
          unknown
        >[];
        for (const binding of bindings)
          if (binding.name === 'LVBT_DISCORD_MEMBER_ROLE_ID') binding.text = privateText;
      }
      return Response.json(body);
    };
    await assert.rejects(
      uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
        ...f.options,
        fetch: fetcher,
      }),
      (error) => {
        assert.deepEqual(diagnostics(error), {
          checks: [{ id: 'version.variable.LVBT_DISCORD_MEMBER_ROLE_ID', status: 'failed' }],
        });
        return true;
      },
    );
    assert.equal(f.state.commands.length, 1);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('inspection retains the safe version predicate without changing deployment state', async () => {
  const f = await deploymentFixture();
  try {
    await uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, f.options);
    f.state.wrongVersion = true;
    const result = await inspectStaffRelease(
      f.destination,
      releaseIdentity,
      f.receiptFile,
      f.options,
    );
    const failed = result.checks.find((check) => check.stage === 'staff.version');
    assert.deepEqual(Reflect.get(failed ?? {}, 'diagnostics'), {
      checks: [{ id: 'version.annotation', status: 'failed' }],
    });
    assert.equal(result.ready, false);
    assert.equal(f.state.commands.length, 2);
    assert.equal(f.state.scheduleWrites, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

void test('setup distinguishes failed requirements from unreadable metadata before upload', async () => {
  for (const unavailable of [false, true]) {
    const f = await deploymentFixture(false, { setup: true });
    try {
      const fetcher: typeof fetch = async (input, init) => {
        if (
          new URL(input instanceof Request ? input.url : input).pathname.includes(
            '/lvbt-staff-preview/versions/',
          )
        ) {
          if (unavailable)
            return Response.json(
              { success: false, errors: [{ code: 10000, message: privateText }] },
              { status: 403 },
            );
          const response = await f.options.fetch(input, init);
          const body = object(await response.json());
          const resources = object(object(body.result).resources);
          resources.bindings = (resources.bindings as Record<string, unknown>[]).filter(
            (binding) => binding.name !== 'LVBT_SIGN_IN_SECRET',
          );
          return Response.json(body);
        }
        return f.options.fetch(input, init);
      };
      await assert.rejects(
        uploadStaffRelease(f.destination, releaseIdentity, f.receiptFile, {
          ...f.options,
          fetch: fetcher,
        }),
        (error) => {
          const detail = diagnostics(error) as {
            checks: { id: string; status: string }[];
            httpStatus?: number;
            cloudflareCodes?: number[];
          };
          assert.ok(
            detail.checks.some(
              (check) =>
                check.id ===
                  (unavailable ? 'staff.deployment' : 'staff.binding.LVBT_SIGN_IN_SECRET') &&
                check.status === (unavailable ? 'unverified' : 'failed'),
            ),
          );
          if (unavailable) {
            assert.equal(detail.httpStatus, 403);
            assert.deepEqual(detail.cloudflareCodes, [10000]);
          }
          return true;
        },
      );
      assert.equal(f.state.commands.length, 0);
      assert.equal(f.state.scheduleWrites, 0);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});
