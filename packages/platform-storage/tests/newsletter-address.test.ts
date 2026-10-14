import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';
import { confirmNewsletterAddress } from '../src/newsletter-address';
import { loadNewsletterPlan } from '../src/newsletter-plan';

void test('verified address changes carry historical active preferences without rewriting consent evidence', async () => {
  for (const source of ['import', 'join_form'] as const) {
    const db = memoryDb();
    try {
      const people = new PersonService(db);
      const { person } = await people.upsertFromSource({
        source: 'staff',
        fields: { email: 'old@example.invalid' },
      });
      await people.recordConsent(person.id, {
        scope: 'newsletter',
        source,
        method: 'unknown',
        wordingVersion: 'fixture',
        givenAt: '2026-01-01T00:00:00.000Z',
      });
      const original = db.raw.prepare('SELECT * FROM consent_records').all();
      await people.updateFields(person.id, {
        source: 'member',
        fields: { email: 'new@example.invalid' },
      });
      const verifiedAt = new Date().toISOString();
      await confirmNewsletterAddress(db, {
        personId: person.id,
        email: 'new@example.invalid',
        verifiedAt,
      });
      assert.equal((await loadNewsletterPlan(db, person.id))?.allowActivation, true);
      assert.deepEqual(db.raw.prepare('SELECT * FROM consent_records').all(), original);
      await people.linkIdentity(person.id, {
        platform: 'beehiiv',
        externalId: 'sub_address',
        externalEmail: 'new@example.invalid',
        linkMethod: 'created_by_platform',
      });
      assert.equal(
        (await loadNewsletterPlan(db, person.id))?.allowActivation,
        true,
        'identity readback must preserve the current verified move',
      );
      await people.updateFields(person.id, {
        source: 'staff',
        fields: { email: 'unverified@example.invalid' },
      });
      assert.equal(
        (await loadNewsletterPlan(db, person.id))?.allowActivation,
        false,
        'an unrelated address edit cannot reuse that permission',
      );
      await people.recordConsent(person.id, {
        scope: 'newsletter',
        source: 'account',
        method: 'checkbox',
        wordingVersion: 'fixture',
        givenAt: new Date().toISOString(),
        renew: true,
      });
      assert.equal(
        (await loadNewsletterPlan(db, person.id))?.allowActivation,
        true,
        'a later explicit preference must not inherit the old destination restriction',
      );
    } finally {
      db.raw.close();
    }
  }
});

void test('confirming an address cannot rejoin someone who has withdrawn their preference', async () => {
  const db = memoryDb();
  try {
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'left@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
      },
    });
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: new Date().toISOString(),
    });
    await people.updateFields(person.id, {
      source: 'member',
      fields: { email: 'left-new@example.invalid' },
    });
    await confirmNewsletterAddress(db, {
      personId: person.id,
      email: 'left-new@example.invalid',
      verifiedAt: new Date().toISOString(),
    });
    assert.equal((await loadNewsletterPlan(db, person.id))?.allowActivation, false);
    assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
  } finally {
    db.raw.close();
  }
});
