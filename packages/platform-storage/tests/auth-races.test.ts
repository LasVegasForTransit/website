import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCode, createSession, requestCode, useLink } from '../src/auth';
import { PersonService } from '../src/person-service';
import { memoryDb } from './support/db';

const now = new Date('2026-10-04T12:00:00Z');
async function fixture() {
  const db = memoryDb();
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email: 'ana@example.org' },
  });
  const env = { PLATFORM_DB: db, LVBT_SIGN_IN_SECRET: 'fixture-only-secret' };
  const issued = await requestCode(env, {
    email: 'ana@example.org',
    purpose: 'sign_in',
    callerAddress: 'fixture',
    now,
  });
  assert.equal(issued.kind, 'issued');
  return { db, env, person, issued: issued.issued };
}
void test('concurrent correct code checks consume the code exactly once', async () => {
  const { db, env, issued } = await fixture();
  const input = {
    email: 'ana@example.org',
    purpose: 'sign_in' as const,
    code: issued.code,
    requestId: 'fixture',
    now,
  };
  const results = await Promise.all([checkCode(env, input), checkCode(env, input)]);
  assert.equal(results.filter((r) => r.kind === 'ok').length, 1);
  db.raw.close();
});
void test('concurrent email-link checks consume the token exactly once', async () => {
  const { db, env, issued } = await fixture();
  const results = await Promise.all([
    useLink(env, issued.linkToken, 'sign_in', now),
    useLink(env, issued.linkToken, 'sign_in', now),
  ]);
  assert.equal(results.filter((r) => r.kind === 'ok').length, 1);
  db.raw.close();
});
void test('concurrent guesses cannot lose attempts', async () => {
  const { db, env, issued } = await fixture();
  const wrong = issued.code === '000000' ? '000001' : '000000';
  const input = {
    email: 'ana@example.org',
    purpose: 'sign_in' as const,
    code: wrong,
    requestId: 'fixture',
    now,
  };
  await Promise.all(Array.from({ length: 5 }, () => checkCode(env, input)));
  assert.equal(db.raw.prepare('SELECT attempts FROM sign_in_codes').get()?.attempts, 5);
  assert.equal((await checkCode(env, { ...input, code: issued.code })).kind, 'too_many');
  db.raw.close();
});
void test('a staff session does not verify an unproven personal email', async () => {
  const { db, env, person } = await fixture();
  await createSession(env, person.id, 'staff', now);
  assert.equal(
    db.raw.prepare('SELECT email_verified_at FROM people').get()?.email_verified_at,
    null,
  );
  db.raw.close();
});
