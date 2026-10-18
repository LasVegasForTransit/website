import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, Response as RuntimeResponse, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { recordCurrentMembershipRoll } from '@lasvegasfortransit/platform-storage/membership-roll';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { SESSION_COOKIE } from '@lasvegasfortransit/platform-core/web-auth';

const origin = 'https://preview.lasvegasfortransit.org';
const template = `<main>
  <span data-slot="member-check" hidden></span>
  <span data-slot="member-since" hidden></span>
  <span data-slot="membership-inactive" hidden>Not on the mailing list</span>
  <div data-slot="mailing-list" hidden>On the mailing list</div>
  <div data-slot="rejoin" hidden><button>Rejoin the mailing list</button></div>
</main>`;

function slot(html: string, name: string): string {
  const match = new RegExp(`<[^>]+data-slot="${name}"[^>]*>`).exec(html);
  assert.ok(match, `The account response includes ${name}`);
  return match[0];
}

void test('the account renders recognized members without requiring a historical signup date', async () => {
  const data = await mkdtemp(join(tmpdir(), 'lvbt-membership-render-'));
  const bundled = await build({
    stdin: {
      contents: `import { onRequestGet } from './functions/account/index.ts';
        export default { fetch(request, env) { return onRequestGet({request, env}); } };`,
      resolveDir: new URL('../', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const script = bundled.outputFiles[0]?.text;
  assert.ok(script);
  const simulator = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: '2026-09-04',
      compatibilityFlags: ['nodejs_compat'],
      resourcePersistencePath: data,
      cf: false,
      telemetry: { enabled: false },
      bindings: { LVBT_SIGN_IN_SECRET: 'membership-render-fixture' },
      d1Databases: { PLATFORM_DB: 'membership-render-fixture' },
      serviceBindings: {
        ASSETS: () => new RuntimeResponse(template, { headers: { 'Content-Type': 'text/html' } }),
      },
      outboundService: () => {
        assert.fail('Account membership rendering must not contact a provider');
      },
    }),
  );
  try {
    const db = await simulator.getD1Database('PLATFORM_DB');
    await db.prepare('SELECT 1').first();
    const file = (await readdir(data, { recursive: true })).find(
      (name) => name.includes('d1') && name.endsWith('.sqlite'),
    );
    assert.ok(file);
    const raw = new DatabaseSync(join(data, file));
    try {
      applyMigrations(raw);
    } finally {
      raw.close();
    }
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'recognized-member@example.invalid' },
    });
    await people.linkIdentity(person.id, {
      platform: 'beehiiv',
      externalId: 'sub_recognized_member',
      externalEmail: 'recognized-member@example.invalid',
      linkMethod: 'created_by_platform',
    });
    assert.equal(
      await recordCurrentMembershipRoll(db, {
        personId: person.id,
        externalId: 'sub_recognized_member',
        status: 'active',
        observedAt: '2026-10-14T10:00:00.000Z',
      }),
      'applied',
    );
    const session = await createSession(
      { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'membership-render-fixture' },
      person.id,
      'member',
    );
    const response = await simulator.dispatchFetch(`${origin}/account/`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session.token}` },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(slot(html, 'mailing-list'), /\bhidden\b/);
    assert.doesNotMatch(slot(html, 'member-check'), /\bhidden\b/);
    assert.doesNotMatch(slot(html, 'member-since'), /\bhidden\b/);
    assert.match(html, />LVBT member<\/span>/);
    assert.match(slot(html, 'rejoin'), /\bhidden\b/);
    assert.match(slot(html, 'membership-inactive'), /\bhidden\b/);
    assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
    assert.equal(
      (await db.prepare('SELECT count(*) AS count FROM consent_records').first())?.count,
      0,
      'Rendering must not invent historical consent',
    );
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-10-14T10:00:00.000Z',
    });
    const datedResponse = await simulator.dispatchFetch(`${origin}/account/`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session.token}` },
    });
    assert.equal(datedResponse.status, 200);
    const datedHtml = await datedResponse.text();
    assert.match(datedHtml, />LVBT member since Oct 14, 2026<\/span>/);
    assert.doesNotMatch(slot(datedHtml, 'mailing-list'), /\bhidden\b/);
    assert.match(slot(datedHtml, 'rejoin'), /\bhidden\b/);

    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-10-15T10:00:00.000Z',
    });
    const formerResponse = await simulator.dispatchFetch(`${origin}/account/`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session.token}` },
    });
    assert.equal(formerResponse.status, 200);
    const formerHtml = await formerResponse.text();
    assert.doesNotMatch(slot(formerHtml, 'rejoin'), /\bhidden\b/);
    assert.doesNotMatch(slot(formerHtml, 'membership-inactive'), /\bhidden\b/);
    assert.match(slot(formerHtml, 'mailing-list'), /\bhidden\b/);
    assert.match(slot(formerHtml, 'member-check'), /\bhidden\b/);
    assert.match(slot(formerHtml, 'member-since'), /\bhidden\b/);
  } finally {
    await simulator.dispose();
    await rm(data, { recursive: true, force: true });
  }
});
