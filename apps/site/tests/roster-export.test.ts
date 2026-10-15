import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession } from '@lasvegasfortransit/platform-storage/auth';
import { hashWithSecret } from '@lasvegasfortransit/platform-core/signing';
import { collectFullExport } from '@lasvegasfortransit/platform-storage/full-export';
import { collectPersonExport } from '@lasvegasfortransit/platform-storage/person-export';
import { nestedExport } from '../../../packages/platform-integrations/src/export-json';
import { mergeFixture } from '../../../packages/platform-storage/tests/support/merge-fixture';
import { applyRosterImport } from '../platform/roster-import';

void test('administrator export retains owned and unlinked source evidence while member download excludes unconfirmed and operational evidence', async (context) => {
  const f = await mergeFixture();
  context.after(() => f.db.raw.close());
  const now = new Date(),
    observedAt = now.toISOString();
  const current = {
    source: 'beehiiv',
    sourceId: 'sub_export_roll',
    email: 'export-roll@example.invalid',
    beehiiv: { status: 'active', campaign: 'private-acquisition' },
    newsletter: {
      state: 'active',
      affirmative: false,
      givenAt: null,
      observedAt,
      evidenceReference: 'private-reference',
    },
  };
  const held = {
    source: 'notion_intake',
    sourceId: '00000000-0000-4000-8000-000000000003',
    email: current.email,
    newsletter: { state: 'unknown', givenAt: null },
    form: {
      fullName: 'Unconfirmed original response',
      rawResponseUrl: 'https://example.invalid/private-sheet',
    },
  };
  const result = await applyRosterImport(f.db, [current, held], { runId: 'export', now });
  const personId = result.records[0]?.personId;
  assert.ok(personId);
  const exported = await collectFullExport(f.db, f.actor, now);
  assert.ok(exported);
  const nested = nestedExport(exported);
  const person = nested.people.find((row) => row.id === personId);
  assert.ok(person);
  assert.equal(person.member_since, null);
  assert.equal(person.consent_records.length, 0);
  assert.equal(person.membership_roll.length, 1);
  assert.equal(person.roster_import_records.length, 1);
  assert.equal(nested.unassigned_roster_import_records.length, 1);
  assert.equal(nested.unassigned_roster_import_records[0]?.suggested_person_id, personId);
  assert.match(String(person.roster_import_records[0]?.evidence), /private-acquisition/);
  const env = { PLATFORM_DB: f.db, LVBT_SIGN_IN_SECRET: 'roster-export-fixture' };
  const session = await createSession(env, personId, 'member');
  const downloaded = await collectPersonExport(
    f.db,
    personId,
    {
      kind: 'member',
      personId,
      sessionHash: await hashWithSecret(env.LVBT_SIGN_IN_SECRET, `session:${session.token}`),
    },
    now,
  );
  assert.ok(downloaded);
  const text = JSON.stringify(downloaded);
  assert.equal(text.includes('private-acquisition'), false);
  assert.equal(text.includes('private-reference'), false);
  assert.equal(text.includes('Unconfirmed original response'), false);
  assert.equal(text.includes('private-sheet'), false);
  assert.equal(text.includes('revision_token'), false);
  assert.equal(text.includes('current_membership_evidence'), true);
  assert.equal(text.includes('imported_signup_evidence'), true);
});
