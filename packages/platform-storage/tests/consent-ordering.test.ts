import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDb } from './support/db';
import { PersonService } from '../src/person-service';

void test('late opt-in evidence cannot override a newer withdrawal', async () => {
  const db = memoryDb();
  try {
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'ordered@example.invalid' },
    });
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-01-01T00:00:00Z',
    });
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-01-03T00:00:00Z',
    });
    await people.upsertFromSource({
      source: 'join_form',
      fields: { email: 'ordered@example.invalid' },
      consent: {
        scope: 'newsletter',
        source: 'join_form',
        method: 'checkbox',
        wordingVersion: 'fixture',
        givenAt: '2026-01-02T00:00:00Z',
      },
    });
    assert.equal((await people.getPerson(person.id))?.membership_status, 'former_member');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE withdrawn_at IS NULL').get()
        ?.n,
      0,
    );
    assert.equal(
      db.raw.prepare('SELECT activation_consent_id FROM newsletter_sync_jobs').get()
        ?.activation_consent_id,
      null,
    );
  } finally {
    db.raw.close();
  }
});

void test('late withdrawal evidence preserves a later explicit opt-in', async () => {
  const db = memoryDb();
  try {
    const people = new PersonService(db);
    const { person } = await people.upsertFromSource({
      source: 'staff',
      fields: { email: 'later@example.invalid' },
    });
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-01-01T00:00:00Z',
    });
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      withdrawnAt: '2026-01-02T00:00:00Z',
    });
    await people.recordConsent(person.id, {
      scope: 'newsletter',
      source: 'account',
      method: 'checkbox',
      wordingVersion: 'fixture',
      givenAt: '2026-01-04T00:00:00Z',
    });
    await people.withdrawConsent(person.id, {
      scope: 'newsletter',
      source: 'beehiiv',
      withdrawnAt: '2026-01-03T00:00:00Z',
    });
    assert.equal((await people.getPerson(person.id))?.membership_status, 'member');
    assert.equal(
      db.raw.prepare('SELECT count(*) AS n FROM consent_records WHERE withdrawn_at IS NULL').get()
        ?.n,
      1,
    );
  } finally {
    db.raw.close();
  }
});
