import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
const now = new Date('2026-10-04T12:00:00Z');
const principal = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'access-user',
  email: 'ana@lasvegasfortransit.org',
  expiresAt: new Date('2026-10-04T13:00:00Z'),
};
void test('SSO requires bound member proof, scopes subjects by issuer, bounds sessions and tombstones revocation', async () => {
  const sso = await import('../src/staff-sso');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-secret' };
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'personal@example.org' },
    consent: { scope: 'newsletter', source: 'join_form', method: 'checkbox', wordingVersion: 'v1' },
  });
  const service = new sso.SsoLinkService(env);
  assert.equal(await sso.createSsoSession(env, principal, now), null);
  const token = await service.begin(principal, { returnTo: '/account/', now });
  const code = await service.requestCode(token, {
    email: 'personal@example.org',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(code.kind, 'issued');
  const result = await service.complete(token, {
    email: 'personal@example.org',
    code: code.issued.code,
    now,
  });
  assert.equal(result.kind, 'ok');
  assert.equal(result.personId, person.id);
  assert.ok(
    db.raw.prepare('SELECT email_verified_at FROM people WHERE id=?').get(person.id)
      ?.email_verified_at,
  );
  assert.equal(result.session.expiresAt.toISOString(), principal.expiresAt.toISOString());
  assert.equal(
    (await sso.readSsoSession(env, result.session.token, principal, now))?.personId,
    person.id,
  );
  assert.equal(
    await sso.readSsoSession(
      env,
      result.session.token,
      { ...principal, issuer: 'https://other.example' },
      now,
    ),
    null,
  );
  assert.equal(await sso.createSsoSession(env, { ...principal, expiresAt: now }, now), null);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM identities').get()?.n, 0);
  await sso.revokeSsoPrincipal(db, principal, now);
  assert.equal(await sso.readSsoSession(env, result.session.token, principal, now), null);
  assert.equal(await sso.createSsoSession(env, principal, now), null);
  await assert.rejects(service.begin(principal, { returnTo: '/account/', now }));
  db.raw.close();
});
void test('bootstrap accepts only a linked active president principal and is single use', async () => {
  const sso = await import('../src/staff-sso');
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'president@example.org' },
    consent: { scope: 'newsletter', source: 'join_form', method: 'checkbox', wordingVersion: 'v1' },
  });
  const president = { ...principal, email: 'president@lasvegasfortransit.org' };
  const input = {
    presidentPersonId: person.id,
    principal: president,
    performedBy: 'president',
    operationId: 'bootstrap',
  };
  assert.equal((await sso.bootstrapSsoStaffAdmin(db, input, now)).kind, 'invalid');
  db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'link',
      person.id,
      president.issuer,
      president.subject,
      president.email,
      now.toISOString(),
    );
  for (const [id, appliedAt, result] of [
    ['unrelated-pending', null, null],
    ['unrelated-applied', '2026-09-01T00:00:00.000Z', '{"kept":"result"}'],
  ] as const)
    db.raw
      .prepare(
        `INSERT INTO staff_operations(operation_id,actor_id,kind,target_id,payload,created_at,applied_at,result)
      VALUES(?,?,'person.correct',?,'{"kept":"payload"}','2026-09-01T00:00:00.000Z',?,?)`,
      )
      .run(id, person.id, person.id, appliedAt, result);
  const unrelatedBefore = db.raw
    .prepare(
      "SELECT * FROM staff_operations WHERE operation_id LIKE 'unrelated-%' ORDER BY operation_id",
    )
    .all();
  assert.equal((await sso.bootstrapSsoStaffAdmin(db, input, now)).kind, 'ok');
  assert.deepEqual(
    db.raw
      .prepare(
        "SELECT * FROM staff_operations WHERE operation_id LIKE 'unrelated-%' ORDER BY operation_id",
      )
      .all(),
    unrelatedBefore,
  );

  assert.equal(
    (await sso.bootstrapSsoStaffAdmin(db, { ...input, operationId: 'second' }, now)).kind,
    'conflict',
  );
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM staff_audits').get()?.n, 1);
  db.raw.close();
});
void test('merge and undo preserve provider ownership and erasure retains only a blocking tombstone', async () => {
  const { mergeFixture } = await import('./support/merge-fixture');
  const { createSsoSession, readSsoSession } = await import('../src/staff-sso');
  const f = await mergeFixture();
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'fixture-secret' };
  f.db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'sso',
      f.merged.id,
      principal.issuer,
      principal.subject,
      principal.email,
      now.toISOString(),
    );
  const session = await createSsoSession(env, principal, now);
  assert.ok(session);
  const merged = await f.mergePeople(f.db, f.actor, f.input);
  assert.equal(merged.kind, 'ok');
  assert.equal(
    f.db.raw.prepare('SELECT person_id FROM staff_sso_links').get()?.person_id,
    f.survivor.id,
  );
  assert.equal(await readSsoSession(env, session.token, principal, now), null);
  assert.equal(
    (
      await f.undoMerge(f.db, f.actor, {
        mergeId: merged.value.mergeId,
        reason: 'Wrong match',
        operationId: 'undo-sso',
      })
    ).kind,
    'ok',
  );
  assert.equal(
    f.db.raw.prepare('SELECT person_id FROM staff_sso_links').get()?.person_id,
    f.merged.id,
  );
  await f.people.deletePerson(f.merged.id);
  const link = f.db.raw.prepare('SELECT * FROM staff_sso_links').get();
  assert.equal(link?.email, null);
  assert.ok(link.revoked_at);
  assert.equal(await createSsoSession(env, principal, now), null);
  assert.equal(
    JSON.stringify(f.db.raw.prepare('SELECT moved_rows FROM merges').all()).includes(
      principal.email,
    ),
    false,
  );
  f.db.raw.close();
});
void test('principal status distinguishes unknown, linked, withdrawn and revoked ownership', async () => {
  const sso = await import('../src/staff-sso');
  const db = memoryDb();
  assert.equal(await sso.ssoPrincipalStatus(db, principal), 'unknown');
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'member@example.org' },
    consent: { scope: 'newsletter', source: 'join_form', method: 'checkbox', wordingVersion: 'v1' },
  });
  db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'link',
      person.id,
      principal.issuer,
      principal.subject,
      principal.email,
      now.toISOString(),
    );
  assert.equal(await sso.ssoPrincipalStatus(db, principal), 'linked');
  db.raw.prepare("UPDATE people SET membership_status='former_member' WHERE id=?").run(person.id);
  assert.equal(await sso.ssoPrincipalStatus(db, principal), 'unavailable');
  await sso.revokeSsoPrincipal(db, principal, now);
  assert.equal(await sso.ssoPrincipalStatus(db, principal), 'revoked');
  db.raw.close();
});
void test('erased SSO tombstones survive physical profile retention', async () => {
  const { runMaintenance } = await import('../src/retention');
  const sso = await import('../src/staff-sso');
  const db = memoryDb();
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'retain@example.org' },
    consent: { scope: 'newsletter', source: 'join_form', method: 'checkbox', wordingVersion: 'v1' },
  });
  db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'link',
      person.id,
      principal.issuer,
      principal.subject,
      principal.email,
      now.toISOString(),
    );
  await people.deletePerson(person.id);
  await runMaintenance(db, { category: 'profiles', now: new Date('2099-01-01T00:00:00Z') });
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM people WHERE id=?').get(person.id)?.n, 0);
  assert.equal(await sso.ssoPrincipalStatus(db, principal), 'revoked');
  db.raw.close();
});
void test('SSO email is presentation, proof is bound and cannot claim another owner', async () => {
  const sso = await import('../src/staff-sso');
  const { loadActor } = await import('../src/staff-roles');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-secret' };
  const service = new sso.SsoLinkService(env);
  const people = new PersonService(db);
  const create = async (email: string) =>
    (
      await people.upsertFromSource({
        source: 'join_form',
        fields: { email },
        consent: {
          scope: 'newsletter',
          source: 'join_form',
          method: 'checkbox',
          wordingVersion: 'v1',
        },
      })
    ).person;
  const first = await create('first@example.org');
  await create('other@example.org');
  db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run('link', first.id, principal.issuer, principal.subject, principal.email, now.toISOString());
  const actor = await loadActor(db, first.id);
  assert.equal(actor?.workspaceLinked, false);
  assert.equal(actor.organizationAuthenticated, true);
  const token = await service.begin(principal, { returnTo: '/account/', now });
  const code = await service.requestCode(token, {
    email: 'other@example.org',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(code.kind, 'issued');
  assert.equal(
    (await service.complete(token, { email: 'other@example.org', code: code.issued.code, now }))
      .kind,
    'conflict',
  );
  const second = await service.begin(
    { ...principal, issuer: 'https://other.example' },
    { returnTo: '/account/', now },
  );
  assert.equal(await service.pending(second, new Date('2026-10-04T12:16:00Z')), null);
  db.raw.close();
});
void test('administrator eligibility accepts SSO only while its organization binding remains active', async () => {
  const { mergeFixture } = await import('./support/merge-fixture');
  const { staffAdminManage } = await import('../src/staff-roles');
  const { searchStaffAdministratorCandidates } = await import('../src/staff-administrators');
  const { revokeSsoPrincipal } = await import('../src/staff-sso');
  const f = await mergeFixture();
  f.db.raw
    .prepare(
      'INSERT INTO staff_sso_links(id,person_id,issuer,subject,email,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'link',
      f.survivor.id,
      principal.issuer,
      principal.subject,
      principal.email,
      now.toISOString(),
    );
  const candidate = (await searchStaffAdministratorCandidates(f.db, f.actor, 'Survivor'))[0];
  assert.equal(candidate?.has_workspace, 0);
  assert.equal(candidate.has_organization_auth, 1);
  const input = {
    targetPersonId: f.survivor.id,
    enabled: true,
    operationId: 'grant-sso',
    requireOrganizationAuthentication: true,
  };
  assert.equal((await staffAdminManage(f.db, f.actor, input)).kind, 'ok');
  await staffAdminManage(f.db, f.actor, { ...input, enabled: false, operationId: 'remove-sso' });
  await revokeSsoPrincipal(f.db, principal, now);
  assert.equal(
    (await staffAdminManage(f.db, f.actor, { ...input, operationId: 'grant-revoked' })).kind,
    'invalid',
  );
  f.db.raw.close();
});
void test('erasure clears pending SSO credentials associated through membership email proof', async () => {
  const sso = await import('../src/staff-sso');
  const db = memoryDb();
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-secret' };
  const service = new sso.SsoLinkService(env);
  const people = new PersonService(db);
  const { person } = await people.upsertFromSource({
    source: 'join_form',
    fields: { email: 'pending@example.org' },
    consent: { scope: 'newsletter', source: 'join_form', method: 'checkbox', wordingVersion: 'v1' },
  });
  const token = await service.begin(principal, { returnTo: '/account/', now });
  const code = await service.requestCode(token, {
    email: 'pending@example.org',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(code.kind, 'issued');
  await people.deletePerson(person.id);
  assert.equal(await service.pending(token, now), null);
  db.raw.close();
});
