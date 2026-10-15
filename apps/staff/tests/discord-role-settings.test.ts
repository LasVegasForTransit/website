import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from '@lasvegasfortransit/platform-storage/test-db';
import { PersonService } from '@lasvegasfortransit/platform-storage/person-service';
import { loadActor } from '@lasvegasfortransit/platform-storage/staff-roles';
import { issueFormToken } from '@lasvegasfortransit/platform-storage/form-tokens';
import { getCommitteeView } from '@lasvegasfortransit/platform-storage/committee-views';
import type { StaffContext } from '../src/lib/context';
import { submitSettings } from '../src/lib/committee-settings';

const roleId = '666666666666666666';
async function fixture() {
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'settings-admin@example.invalid' },
    consent: {
      scope: 'newsletter',
      source: 'join_form',
      method: 'checkbox',
      wordingVersion: 'fixture',
    },
  });
  db.raw
    .prepare('INSERT INTO staff_administrators VALUES(?,?,?)')
    .run(person.id, 'fixture', new Date().toISOString());
  db.raw.prepare("UPDATE committees SET discord_role_id=? WHERE id='events'").run(roleId);
  const actor = await loadActor(db, person.id);
  assert.ok(actor);
  const staff: StaffContext = { db, actor, requestId: 'fixture' };
  const committee = (await getCommitteeView(db, actor, 'events'))?.committee;
  assert.ok(committee);
  const request = async (patch: Record<string, string> = {}) =>
    new Request('https://staff.lasvegasfortransit.org/committees/events/settings/', {
      method: 'POST',
      body: new URLSearchParams({
        token: await issueFormToken(db, actor, 'committee:settings:events'),
        description: 'Events for everyone.',
        time_commitment: '',
        accepting_members: 'yes',
        workspace_group_email: '',
        expected_version: '1',
        operation_id: 'save',
        ...patch,
      }),
    });
  return { db, staff, committee, request };
}
void test('disabled Discord selectors preserve existing connections during a metadata-only save', async () => {
  const f = await fixture();
  try {
    const result = await submitSettings(await f.request(), f.staff, 'events');
    assert.ok(result instanceof Response);
    assert.equal(result.status, 303);
    assert.equal(
      f.db.raw.prepare("SELECT discord_role_id FROM committees WHERE id='events'").get()
        ?.discord_role_id,
      roleId,
    );
  } finally {
    f.db.raw.close();
  }
});
void test('staff sends changed role selections to the private validator and cannot bypass its rejection', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    f.staff.accessConfiguration = {
      discord: { configured: true, contextId: '111111111111111111' },
    };
    f.staff.newsletterJobs = {
      fetch: async (request) => {
        calls++;
        assert.equal(request.url, 'https://jobs.internal/discord/committee-roles');
        const body: unknown = await request.json();
        assert.ok(body && typeof body === 'object' && 'actorId' in body && 'action' in body);
        assert.equal(body.actorId, f.staff.actor.personId);
        assert.equal(body.action, 'save');
        return Response.json({ kind: 'invalid_role' }, { status: 400 });
      },
    };
    const result = await submitSettings(
      await f.request({ discord_role_id: '777777777777777777', discord_lead_role_id: '' }),
      f.staff,
      'events',
    );
    assert.ok(!(result instanceof Response));
    assert.equal(result.status, 400);
    assert.equal(calls, 1);
    assert.equal(
      f.db.raw.prepare("SELECT settings_version FROM committees WHERE id='events'").get()
        ?.settings_version,
      1,
    );
  } finally {
    f.db.raw.close();
  }
});
