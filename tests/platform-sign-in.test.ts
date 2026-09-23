import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCode,
  createSession,
  readSession,
  requestCode,
  useLink,
  type AuthEnv,
} from '../platform/auth';
import {
  askForCode,
  currentMember,
  fromThisSite,
  safeNext,
  sessionCookies,
  signInWithCode,
  signInWithLink,
  signOut,
  type SignInEnv,
} from '../platform/sign-in';
import type { Db, Statement } from '../platform/storage/db';
import { PersonService } from '../platform/storage/person-service';
import { everyStoredText, memoryDb, type MemoryDb } from './platform-db';

const CALLER = '203.0.113.9';
const DAY = 24 * 60 * 60 * 1000;

function env(db: Db): SignInEnv {
  return {
    PLATFORM_DB: db,
    LVBT_SIGN_IN_SECRET: 'test-sign-in-secret',
    LVBT_RESEND_API_KEY: 're_test',
  };
}

async function member(db: MemoryDb, email = 'ana@example.org'): Promise<string> {
  const { person } = await new PersonService(db).upsertFromSource({
    source: 'join_form',
    fields: { email, given_name: 'Ana' },
  });
  return person.id;
}

function fakeResend() {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) => {
    sent.push(
      JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        to: string[];
        subject: string;
        text: string;
      },
    );
    return Promise.resolve(Response.json({ id: 'email_1' }));
  }) as typeof fetch;
  return { sent, fetcher };
}

function withCookie(cookies: string[]): Request {
  const pairs = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  return new Request('https://lasvegasfortransit.org/account/', { headers: { Cookie: pairs } });
}

void test('a member gets one code email; an unknown address gets the same answer', async () => {
  const db = memoryDb();
  await member(db);
  const { sent, fetcher } = fakeResend();

  const known = await askForCode(
    env(db),
    { email: ' Ana@Example.org ', callerAddress: CALLER },
    fetcher,
  );
  const unknown = await askForCode(
    env(db),
    { email: 'nobody@example.org', callerAddress: CALLER },
    fetcher,
  );
  assert.equal(known.kind, 'sent');
  assert.equal(unknown.kind, 'sent');
  assert.deepEqual(Object.keys(known.step).sort(), Object.keys(unknown.step).sort());

  await known.send?.();
  assert.equal(sent.length, 1);
  const [email] = sent;
  assert.ok(email);
  assert.deepEqual(email.to, ['ana@example.org']);
  const code = /^(\d{6}) is your LVBT sign-in code$/.exec(email.subject)?.[1];
  assert.ok(code, 'the code is in the subject');
  assert.match(email.text, new RegExp(`Your LVBT sign-in code is ${code}\\.`));
  assert.match(email.text, /\/sign-in\/link\/[\w-]{40,}/);
});

void test('an unknown address is invited to join by email, at most once a day, with no code', async () => {
  const db = memoryDb();
  const { sent, fetcher } = fakeResend();
  const ask = () =>
    askForCode(env(db), { email: 'Nobody@Example.org', callerAddress: CALLER }, fetcher);

  const first = await ask();
  assert.equal(first.kind, 'sent');
  await first.send?.();
  const second = await ask();
  assert.equal(second.kind, 'sent');
  assert.equal(second.send, undefined, 'a second ask the same day sends nothing');

  assert.equal(sent.length, 1);
  const [email] = sent;
  assert.ok(email);
  assert.deepEqual(email.to, ['nobody@example.org']);
  assert.equal(email.subject, 'Join LVBT to sign in');
  assert.match(email.text, /\/join\/member\//);
  assert.doesNotMatch(email.text, /\d{6}|\/sign-in\/link\//);
});

void test('a correct code signs in once, with exactly the cookie attributes', async () => {
  const db = memoryDb();
  await member(db);
  const { sent, fetcher } = fakeResend();
  const asked = await askForCode(
    env(db),
    { email: 'ana@example.org', callerAddress: CALLER },
    fetcher,
  );
  assert.equal(asked.kind, 'sent');
  await asked.send?.();
  const code = sent[0]?.subject.slice(0, 6) ?? '';

  const signedIn = await signInWithCode(env(db), asked.step, code);
  assert.equal(signedIn.kind, 'signed_in');
  assert.match(
    signedIn.cookies[0] ?? '',
    /^__Host-lvbt_session=[\w-]{40,}; Expires=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
  );
  assert.match(
    signedIn.cookies[1] ?? '',
    /^lvbt_signed_in=1; Expires=[^;]+; Path=\/; Secure; SameSite=Lax$/,
  );

  const again = await signInWithCode(env(db), asked.step, code);
  assert.equal(again.kind, 'expired');
});

void test('codes and session identifiers are never stored in plain text', async () => {
  const db = memoryDb();
  const personId = await member(db);
  const outcome = await requestCode(env(db), {
    email: 'ana@example.org',
    purpose: 'sign_in',
    callerAddress: CALLER,
  });
  assert.equal(outcome.kind, 'issued');
  const session = await createSession(env(db), personId, 'member');
  const stored = everyStoredText(db);
  assert.ok(!stored.includes(outcome.issued.linkToken));
  assert.ok(!stored.includes(session.token));
  assert.ok(!new RegExp(`"code_hash":"${outcome.issued.code}"`).test(stored));
});

void test('a code older than 15 minutes does not work', async () => {
  const db = memoryDb();
  await member(db);
  const now = new Date('2026-10-05T17:00:00Z');
  const outcome = await requestCode(env(db), {
    email: 'ana@example.org',
    purpose: 'sign_in',
    callerAddress: CALLER,
    now,
  });
  if (outcome.kind !== 'issued') return assert.fail('no code issued');
  const late = await checkCode(env(db), {
    email: 'ana@example.org',
    code: outcome.issued.code,
    purpose: 'sign_in',
    requestId: 'r',
    now: new Date(now.getTime() + 16 * 60 * 1000),
  });
  assert.equal(late.kind, 'expired');
});

void test('after five wrong tries the right code is refused', async () => {
  const db = memoryDb();
  await member(db);
  const outcome = await requestCode(env(db), {
    email: 'ana@example.org',
    purpose: 'sign_in',
    callerAddress: CALLER,
  });
  if (outcome.kind !== 'issued') return assert.fail('no code issued');
  const wrong = outcome.issued.code === '000000' ? '111111' : '000000';
  const answers = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await checkCode(env(db), {
      email: 'ana@example.org',
      code: wrong,
      purpose: 'sign_in',
      requestId: 'r',
    });
    answers.push(result.kind === 'wrong' ? result.triesLeft : result.kind);
  }
  assert.deepEqual(answers, [4, 3, 2, 1, 'too_many']);
  const right = await checkCode(env(db), {
    email: 'ana@example.org',
    code: outcome.issued.code,
    purpose: 'sign_in',
    requestId: 'r',
  });
  assert.equal(right.kind, 'too_many');
});

void test('an unknown address answers wrong codes exactly like a member', async () => {
  const db = memoryDb();
  const answers = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await checkCode(env(db), {
      email: 'nobody@example.org',
      code: '123456',
      purpose: 'sign_in',
      requestId: 'request-1',
    });
    answers.push(result.kind === 'wrong' ? result.triesLeft : result.kind);
  }
  assert.deepEqual(answers, [4, 3, 2, 1, 'too_many']);
  const fresh = await checkCode(env(db), {
    email: 'nobody@example.org',
    code: '123456',
    purpose: 'sign_in',
    requestId: 'request-2',
  });
  assert.deepEqual(fresh, { kind: 'wrong', triesLeft: 4 });
});

void test('a sixth code for the same email within an hour is refused with a time', async () => {
  const db = memoryDb();
  await member(db);
  const kinds = [];
  for (let request = 0; request < 6; request += 1) {
    const outcome = await askForCode(env(db), {
      email: 'ana@example.org',
      callerAddress: `198.51.100.${request}`,
    });
    kinds.push(outcome.kind);
    if (outcome.kind === 'rate_limited')
      assert.match(outcome.retryAfter, /^\d{1,2}:\d{2} (am|pm)$/);
  }
  assert.deepEqual(kinds, ['sent', 'sent', 'sent', 'sent', 'sent', 'rate_limited']);
});

void test('the link signs in another browser, and its code then stops working', async () => {
  const db = memoryDb();
  await member(db);
  const outcome = await requestCode(env(db), {
    email: 'ana@example.org',
    purpose: 'sign_in',
    callerAddress: CALLER,
  });
  if (outcome.kind !== 'issued') return assert.fail('no code issued');
  const linked = await signInWithLink(env(db), outcome.issued.linkToken);
  assert.equal(linked.kind, 'signed_in');
  assert.equal((await useLink(env(db), outcome.issued.linkToken, 'sign_in')).kind, 'expired');
  const code = await checkCode(env(db), {
    email: 'ana@example.org',
    code: outcome.issued.code,
    purpose: 'sign_in',
    requestId: 'r',
  });
  assert.equal(code.kind, 'expired');
});

void test('a member session lasts 30 days from its last use', async () => {
  const db = memoryDb();
  const personId = await member(db);
  const start = new Date('2026-10-01T12:00:00Z');
  const auth: AuthEnv = env(db);
  const { token } = await createSession(auth, personId, 'member', start);
  assert.ok(await readSession(auth, token, new Date(start.getTime() + 29 * DAY)));
  assert.ok(await readSession(auth, token, new Date(start.getTime() + 58 * DAY)));

  const idle = await createSession(auth, personId, 'member', start);
  assert.equal(await readSession(auth, idle.token, new Date(start.getTime() + 31 * DAY)), null);
});

void test('signing out deletes the session, so the old cookie signs nobody in', async () => {
  const db = memoryDb();
  const personId = await member(db);
  const session = await createSession(env(db), personId, 'member');
  const cookies = sessionCookies(session.token, session.expiresAt);
  assert.equal((await currentMember(env(db), withCookie(cookies))).signedIn, true);
  await signOut(env(db), withCookie(cookies));
  assert.equal((await currentMember(env(db), withCookie(cookies))).signedIn, false);
});

void test('deleting a person ends their sessions', async () => {
  const db = memoryDb();
  const personId = await member(db);
  const session = await createSession(env(db), personId, 'member');
  await new PersonService(db).deletePerson(personId);
  assert.equal(await readSession(env(db), session.token), null);
});

function countingDb(db: MemoryDb): { db: Db; queries: () => number } {
  let count = 0;
  const wrap = (statement: Statement): Statement => ({
    bind: (...values) => wrap(statement.bind(...values)),
    first: () => {
      count += 1;
      return statement.first();
    },
    all: () => {
      count += 1;
      return statement.all();
    },
    run: () => {
      count += 1;
      return statement.run();
    },
  });
  return {
    db: { prepare: (sql) => wrap(db.prepare(sql)), batch: (statements) => db.batch(statements) },
    queries: () => count,
  };
}

void test('the current member is looked up once per request, and not at all without a cookie', async () => {
  const memory = memoryDb();
  const personId = await member(memory);
  const session = await createSession(env(memory), personId, 'member');
  const counted = countingDb(memory);

  const anonymous = new Request('https://lasvegasfortransit.org/account/');
  assert.equal((await currentMember(env(counted.db), anonymous)).signedIn, false);
  assert.equal(counted.queries(), 0);

  const request = withCookie(sessionCookies(session.token, session.expiresAt));
  const answers = await Promise.all(
    Array.from({ length: 5 }, () => currentMember(env(counted.db), request)),
  );
  assert.ok(answers.every((answer) => answer.signedIn));
  const [first] = answers;
  assert.ok(first.signedIn);
  assert.deepEqual(Object.keys(first.person).sort(), [
    'email',
    'givenName',
    'id',
    'membershipStatus',
    'preferredLanguage',
  ]);
  assert.equal(counted.queries(), 1);
});

void test('forms accept POSTs only from this site', () => {
  const post = (headers: Record<string, string>) =>
    new Request('https://lasvegasfortransit.org/sign-in/', { method: 'POST', headers });
  assert.equal(fromThisSite(post({ Origin: 'https://lasvegasfortransit.org' })), true);
  assert.equal(fromThisSite(post({ Origin: 'https://evil.example' })), false);
  assert.equal(fromThisSite(post({ Referer: 'https://evil.example/form' })), false);
});

void test('after signing in, only paths on this site are followed', () => {
  assert.equal(safeNext('/events/?when=soon'), '/events/?when=soon');
  assert.equal(safeNext('//evil.example/'), '/account/');
  assert.equal(safeNext('https://evil.example/'), '/account/');
  assert.equal(safeNext('/\\evil.example'), '/account/');
  assert.equal(safeNext(null), '/account/');
});
