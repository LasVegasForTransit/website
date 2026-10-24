import type { Db, Statement } from '../src/db';
import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { WorkspaceLinkService, readWorkspaceSession } from '../src/workspace-link';
import { SsoLinkService, readSsoSession, createSsoSession } from '../src/staff-sso';
import { PersonService } from '../src/person-service';
import { createSession } from '../src/auth';
import { loadActor } from '../src/staff-actor';
import { can } from '@lasvegasfortransit/platform-core/permissions';
const workspace = {
  subject: 'google-avery',
  email: 'avery@lasvegasfortransit.org',
  givenName: 'Avery',
  familyName: 'Rider',
};
const principal = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'access-avery',
  email: workspace.email,
  expiresAt: new Date(Date.now() + 3600000),
};
for (const mode of ['google', 'cloudflare-access'] as const) {
  void test(`${mode}: a new team account needs no personal email or newsletter consent and cannot grant admin`, async () => {
    const db = memoryDb();
    try {
      const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
      const service = mode === 'google' ? new WorkspaceLinkService(env) : new SsoLinkService(env);
      const pending = await service.begin(
        {
          ...workspace,
          ...principal,
          subject: mode === 'google' ? workspace.subject : principal.subject,
        },
        {
          returnTo: '/people/',
        },
      );
      assert.equal(typeof service.createAccount, 'function');
      const result = await service.createAccount(pending, {
        givenName: 'Avery',
        familyName: 'Rider',
      });
      assert.equal(result.kind, 'ok');
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
      assert.equal(
        db.raw.prepare('SELECT membership_status FROM people').get()?.membership_status,
        'not_member',
      );
      const actor = await loadActor(db, result.personId);
      assert.ok(actor);
      assert.equal(can(actor, 'attendance.record'), true);
      assert.equal(can(actor, 'console.enter'), false);
      assert.equal(can(actor, 'staff_admin.manage'), false);
      const session =
        mode === 'google'
          ? await readWorkspaceSession(env, result.session.token)
          : await readSsoSession(env, result.session.token, principal);
      assert.equal(session?.personId, result.personId);
      assert.notEqual(
        (await service.createAccount(pending, { givenName: 'Avery', familyName: 'Rider' })).kind,
        'ok',
      );
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
      await new PersonService(db).deletePerson(result.personId);
      const again = await service
        .begin(
          {
            ...workspace,
            ...principal,
            subject: mode === 'google' ? workspace.subject : principal.subject,
          },
          { returnTo: '/' },
        )
        .catch(() => null);
      if (again)
        assert.notEqual(
          (await service.createAccount(again, { givenName: 'Avery', familyName: 'Rider' })).kind,
          'ok',
        );
    } finally {
      db.raw.close();
    }
  });
  void test(`${mode}: a signed-in member can connect without another code`, async () => {
    const db = memoryDb();
    try {
      const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
      const { person } = await new PersonService(db).upsertFromSource({
        source: 'join_form',
        fields: { email: 'personal@example.org' },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'fixture',
        },
      });
      const member = await createSession(env, person.id, 'member');
      const service = mode === 'google' ? new WorkspaceLinkService(env) : new SsoLinkService(env);
      const pending = await service.begin(
        {
          ...workspace,
          ...principal,
          subject: mode === 'google' ? workspace.subject : principal.subject,
        },
        {
          returnTo: '/',
        },
      );
      assert.equal(typeof service.completeForMember, 'function');
      assert.equal((await service.completeForMember(pending, member.token)).kind, 'ok');
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM sign_in_codes').get()?.n, 0);
    } finally {
      db.raw.close();
    }
  });
}
void test('Access recognizes a provisioned Workspace account, but never matches an ordinary person email', async () => {
  const db = memoryDb();
  try {
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only' };
    const { person } = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: workspace.email },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    assert.equal(await createSsoSession(env, principal), null);
    db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) VALUES('provisioned',?,'google_workspace',?,?,?,'created_by_platform',?,?)",
      )
      .run(
        person.id,
        workspace.subject,
        workspace.email,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    assert.ok(await createSsoSession(env, principal));
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});
for (const mode of ['google', 'cloudflare-access'] as const) {
  void test(`${mode}: concurrent enrollment cannot create duplicate people and an expired proof cannot enroll`, async () => {
    const db = memoryDb();
    try {
      const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture' };
      const service = mode === 'google' ? new WorkspaceLinkService(env) : new SsoLinkService(env);
      const start = () =>
        mode === 'google'
          ? new WorkspaceLinkService(env).begin(workspace, { returnTo: '/' })
          : new SsoLinkService(env).begin(principal, { returnTo: '/' });
      const tokens = await Promise.all([start(), start()]);
      const results = await Promise.all(
        tokens.map((token) =>
          service.createAccount(token, { givenName: 'Avery', familyName: 'Rider' }),
        ),
      );
      assert.equal(results.filter((result) => result.kind === 'ok').length, 1);
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
      const stale =
        mode === 'google'
          ? await new WorkspaceLinkService(env).begin(
              { ...workspace, subject: 'stale', email: 'stale@lasvegasfortransit.org' },
              { returnTo: '/', now: new Date('2020-01-01') },
            )
          : await new SsoLinkService(env).begin(
              {
                ...principal,
                subject: 'stale',
                email: 'stale@lasvegasfortransit.org',
                expiresAt: new Date('2020-01-01T01:00:00Z'),
              },
              { returnTo: '/', now: new Date('2020-01-01') },
            );
      assert.equal(
        (await service.createAccount(stale, { givenName: 'Stale', familyName: '' })).kind,
        'expired',
      );
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
    } finally {
      db.raw.close();
    }
  });
  void test(`${mode}: an identity write failure rolls back the entire enrollment`, async () => {
    const db = memoryDb();
    try {
      const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture' };
      const service = mode === 'google' ? new WorkspaceLinkService(env) : new SsoLinkService(env);
      const pending =
        mode === 'google'
          ? await new WorkspaceLinkService(env).begin(workspace, { returnTo: '/' })
          : await new SsoLinkService(env).begin(principal, { returnTo: '/' });
      db.raw.exec(
        `CREATE TRIGGER reject_fixture BEFORE INSERT ON ${mode === 'google' ? 'identities' : 'staff_sso_links'} BEGIN SELECT RAISE(ABORT,'fixture'); END`,
      );
      await assert.rejects(service.createAccount(pending, { givenName: 'Avery', familyName: '' }));
      assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 0);
      assert.ok(await service.pending(pending));
    } finally {
      db.raw.close();
    }
  });
}
void test('a team account can recover across auth modes using its email code without newsletter membership', async () => {
  const db = memoryDb();
  try {
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture' };
    const access = new SsoLinkService(env),
      direct = new WorkspaceLinkService(env);
    const initial = await access.begin(principal, { returnTo: '/' });
    const created = await access.createAccount(initial, { givenName: 'Avery', familyName: '' });
    assert.equal(created.kind, 'ok');
    const pending = await direct.begin(workspace, { returnTo: '/' });
    const issued = await direct.requestCode(pending, {
      email: workspace.email,
      callerAddress: 'fixture',
    });
    assert.equal(issued.kind, 'issued');
    const result = await direct.complete(pending, {
      email: workspace.email,
      code: issued.issued.code,
    });
    assert.equal(result.kind, 'ok');
    assert.equal(result.personId, created.personId);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people').get()?.n, 1);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM consent_records').get()?.n, 0);
  } finally {
    db.raw.close();
  }
});
void test('an Access account change cannot leave a durable link when it wins pending consumption', async () => {
  const db = memoryDb();
  try {
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture' };
    const { person } = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: 'member@example.org' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    const member = await createSession(env, person.id, 'member');
    const service = new SsoLinkService(env),
      pending = await service.begin(principal, { returnTo: '/' });
    const cancellation = { beforeConsumption: false };
    const wrapper: Db = {
      prepare(sql) {
        function wrap(statement: Statement): Statement {
          return {
            bind: (...values) => wrap(statement.bind(...values)),
            first: () => statement.first(),
            all: () => statement.all(),
            run: () => {
              if (sql.includes('INSERT INTO staff_sso_links')) {
                cancellation.beforeConsumption =
                  Number(db.raw.prepare('SELECT count(*) AS n FROM staff_sso_pending').get()?.n) >
                  0;
                if (cancellation.beforeConsumption) db.raw.exec('DELETE FROM staff_sso_pending');
              }
              return statement.run();
            },
          };
        }
        return wrap(db.prepare(sql));
      },
      batch: (statements) => db.batch(statements),
    };
    const result = await new SsoLinkService({ ...env, PLATFORM_DB: wrapper }).completeForMember(
      pending,
      member.token,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM staff_sso_links').get()?.n,
      cancellation.beforeConsumption ? 0 : 1,
    );
    assert.equal(result.kind, cancellation.beforeConsumption ? 'expired' : 'ok');
  } finally {
    db.raw.close();
  }
});
void test('prepared Access matching cannot bypass an earlier principal binding or its revocation', async () => {
  const { revokeSsoPrincipal } = await import('../src/staff-sso');
  const db = memoryDb();
  try {
    const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture' };
    const { person } = await new PersonService(db).upsertFromSource({
      source: 'join_form',
      fields: { email: 'personal@example.org' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    db.raw
      .prepare(
        "INSERT INTO identities(id,person_id,platform,external_id,external_email,linked_at,link_method,created_at,updated_at) VALUES('prepared',?,'google_workspace',?,?,?,'created_by_platform',?,?)",
      )
      .run(
        person.id,
        workspace.subject,
        workspace.email,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
      );
    assert.ok(await createSsoSession(env, principal));
    const replacement = { ...principal, subject: 'another-principal' };
    assert.equal(await createSsoSession(env, replacement), null);
    await revokeSsoPrincipal(db, principal);
    assert.equal(await createSsoSession(env, replacement), null);
    assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_sso_links').get()?.n, 1);
  } finally {
    db.raw.close();
  }
});
