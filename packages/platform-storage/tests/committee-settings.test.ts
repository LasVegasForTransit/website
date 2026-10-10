import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFixture } from './support/merge-fixture';
import { loadActor } from '../src/staff-roles';
const discordSnowflake = (suffix: number) => `${'7'.repeat(17)}${suffix}`;
async function fixture() {
  const base = await mergeFixture();
  const settings = await import('../src/committee-settings').catch(() => null);
  assert.ok(
    settings,
    'committee settings must save atomically with current administrator authority',
  );
  const input = {
    description: 'Help organize events.',
    timeCommitment: 'Two hours a month',
    acceptingMembers: true,
    workspaceGroupEmail: 'events@lasvegasfortransit.org',
    discordRoleId: discordSnowflake(1),
    interestIds: ['events' as const],
    expectedVersion: 1,
    operationId: 'settings',
  };
  return { ...base, ...settings, input };
}
void test('settings normalize valid mappings, audit one retried write, preserve mapping history and queue current work', async () => {
  const { db, actor, admin, survivor, merged, committees, updateCommitteeSettings, input } =
    await fixture();
  try {
    const assigned = await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'grant',
    });
    assert.equal(assigned.kind, 'ok');
    const ended = await committees.assign({
      personId: merged.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'ended-grant',
    });
    assert.equal(ended.kind, 'ok');
    await committees.endAssignment(ended.value.id, 'stepped_back', admin.id, 'ended');
    const saved = await updateCommitteeSettings(db, actor, 'events', {
      ...input,
      workspaceGroupEmail: ' EVENTS@LASVEGASFORTRANSIT.ORG ',
    });
    assert.equal(saved.kind, 'ok');
    assert.equal(saved.value.workspaceGroupEmail, input.workspaceGroupEmail);
    assert.equal(saved.value.settingsVersion, 2);
    assert.equal((await updateCommitteeSettings(db, actor, 'events', input)).kind, 'ok');
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM staff_audits WHERE action='committee.settings'")
        .get()?.n,
      1,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM committee_account_mappings').get()?.n,
      2,
    );
    const jobs = db.raw
      .prepare(
        "SELECT person_id,generation FROM integration_outbox WHERE id LIKE 'settings:%' ORDER BY person_id",
      )
      .all();
    assert.deepEqual(jobs.map((row) => row.person_id).sort(), [survivor.id, merged.id].sort());
    assert.equal(
      db.raw.prepare("SELECT state FROM integration_outbox WHERE id='grant'").get()?.state,
      'superseded',
    );
    const newer = {
      ...input,
      expectedVersion: 2,
      operationId: 'new-mapping',
      workspaceGroupEmail: 'events-new@lasvegasfortransit.org',
      discordRoleId: discordSnowflake(2),
    };
    assert.equal((await updateCommitteeSettings(db, actor, 'events', newer)).kind, 'ok');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM committee_account_mappings').get()?.n,
      4,
    );
    const { operationIsCurrent } = await import('../src/outbox');
    assert.equal(await operationIsCurrent(db, `settings:${survivor.id}`), false);
    assert.equal(await operationIsCurrent(db, `new-mapping:${survivor.id}`), true);
    assert.equal(
      (await updateCommitteeSettings(db, actor, 'events', { ...input, operationId: 'stale' })).kind,
      'conflict',
    );
  } finally {
    db.raw.close();
  }
});
void test('settings reject unknown interests, foreign groups, invalid role IDs, reused mappings and lead writes', async () => {
  const { db, actor, admin, survivor, committees, updateCommitteeSettings, input } =
    await fixture();
  try {
    for (const patch of [
      { interestIds: ['invented'] },
      { workspaceGroupEmail: 'events@other.org' },
      { discordRoleId: '18446744073709551616' },
      { acceptingMembers: 'yes' },
      { timeCommitment: 'x'.repeat(151) },
    ])
      assert.equal(
        (await updateCommitteeSettings(db, actor, 'events', { ...input, ...patch } as typeof input))
          .kind,
        'invalid',
      );
    await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'lead',
      actorId: admin.id,
      operationId: 'lead',
    });
    const lead = await loadActor(db, survivor.id);
    assert.ok(lead);
    assert.equal((await updateCommitteeSettings(db, lead, 'events', input)).kind, 'forbidden');
    assert.equal((await updateCommitteeSettings(db, actor, 'events', input)).kind, 'ok');
    assert.equal(
      (await updateCommitteeSettings(db, actor, 'advocacy', { ...input, operationId: 'reuse' }))
        .kind,
      'conflict',
    );
    assert.equal(
      db.raw.prepare("SELECT workspace_group_email FROM committees WHERE id='advocacy'").get()
        ?.workspace_group_email,
      null,
    );
  } finally {
    db.raw.close();
  }
});
void test('paused committees retain their people and allow departures, while refusing new assignments', async () => {
  const { db, actor, admin, survivor, merged, committees, updateCommitteeSettings, input } =
    await fixture();
  try {
    const current = await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'assigned',
    });
    assert.equal(current.kind, 'ok');
    assert.equal(
      (await updateCommitteeSettings(db, actor, 'events', { ...input, acceptingMembers: false }))
        .kind,
      'ok',
    );
    assert.equal(
      (
        await committees.assign({
          personId: merged.id,
          committeeId: 'events',
          role: 'member',
          actorId: admin.id,
          operationId: 'paused',
        })
      ).kind,
      'conflict',
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT count(*) AS n FROM committee_assignments WHERE committee_id='events' AND ended_at IS NULL",
        )
        .get()?.n,
      1,
    );
    assert.equal(
      (await committees.endAssignment(current.value.id, 'stepped_back', admin.id, 'end-paused'))
        .kind,
      'ok',
    );
  } finally {
    db.raw.close();
  }
});
void test('mid-write revocation and injected audit failure cannot partially save settings or enqueue access', async () => {
  const { db, actor, admin, survivor, committees, updateCommitteeSettings, input } =
    await fixture();
  try {
    const revoked = {
      ...db,
      batch: (statements: Parameters<typeof db.batch>[0]) => {
        db.raw
          .prepare("UPDATE people SET membership_status='former_member' WHERE id=?")
          .run(admin.id);
        return db.batch(statements);
      },
    };
    assert.notEqual((await updateCommitteeSettings(revoked, actor, 'events', input)).kind, 'ok');
    assert.equal(
      db.raw.prepare("SELECT settings_version FROM committees WHERE id='events'").get()
        ?.settings_version,
      1,
    );
    db.raw.prepare("UPDATE people SET membership_status='member' WHERE id=?").run(admin.id);
    await committees.assign({
      personId: survivor.id,
      committeeId: 'events',
      role: 'member',
      actorId: admin.id,
      operationId: 'existing-grant',
    });
    db.raw.exec(
      "CREATE TRIGGER reject_settings_audit BEFORE INSERT ON staff_audits WHEN NEW.action='committee.settings' BEGIN SELECT RAISE(ABORT,'fixture-audit-failure'); END",
    );
    await assert.rejects(
      updateCommitteeSettings(db, actor, 'events', input),
      /fixture-audit-failure/,
    );
    assert.equal(
      db.raw.prepare("SELECT settings_version FROM committees WHERE id='events'").get()
        ?.settings_version,
      1,
    );
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM committee_account_mappings').get()?.n,
      0,
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM staff_operations WHERE operation_id='settings'")
        .get()?.n,
      0,
    );
    assert.equal(
      db.raw
        .prepare(
          "SELECT generation FROM reconcile_generations WHERE person_id=? AND target_id='events'",
        )
        .get(survivor.id)?.generation,
      1,
    );
    assert.equal(
      db.raw.prepare("SELECT state FROM integration_outbox WHERE id='existing-grant'").get()?.state,
      'queued',
    );
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM integration_outbox WHERE id LIKE 'settings:%'")
        .get()?.n,
      0,
    );
  } finally {
    db.raw.close();
  }
});

void test('cleared mappings remain reserved for cleanup, and metadata-only changes do not queue access', async () => {
  const { db, actor, updateCommitteeSettings, input } = await fixture();
  try {
    assert.equal((await updateCommitteeSettings(db, actor, 'events', input)).kind, 'ok');
    const clear = {
      ...input,
      expectedVersion: 2,
      operationId: 'clear',
      workspaceGroupEmail: null,
      discordRoleId: null,
    };
    assert.equal((await updateCommitteeSettings(db, actor, 'events', clear)).kind, 'ok');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM committee_account_mappings').get()?.n,
      2,
    );
    assert.equal(
      (
        await updateCommitteeSettings(db, actor, 'advocacy', {
          ...input,
          operationId: 'reuse-cleared',
        })
      ).kind,
      'conflict',
    );
    const metadata = {
      ...clear,
      expectedVersion: 3,
      operationId: 'metadata',
      description: 'A new description.',
    };
    assert.equal((await updateCommitteeSettings(db, actor, 'events', metadata)).kind, 'ok');
    assert.equal(
      db.raw
        .prepare("SELECT count(*) AS n FROM integration_outbox WHERE id LIKE 'metadata:%'")
        .get()?.n,
      0,
    );
    assert.equal(
      (
        await updateCommitteeSettings(db, actor, 'events', {
          ...metadata,
          description: 'Changed payload.',
        })
      ).kind,
      'conflict',
    );
    assert.equal(
      db.raw.prepare("SELECT description FROM committees WHERE id='events'").get()?.description,
      metadata.description,
    );
    assert.equal((await updateCommitteeSettings(db, actor, 'events', metadata)).kind, 'ok');
    assert.equal(
      db.raw.prepare("SELECT settings_version FROM committees WHERE id='events'").get()
        ?.settings_version,
      4,
    );
  } finally {
    db.raw.close();
  }
});
