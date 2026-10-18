import assert from 'node:assert/strict';
import { ORIGIN, startRuntime } from '../support/runtime';

const fixture = await startRuntime();
try {
  const review = await fixture.db
    .prepare('SELECT id FROM review_queue WHERE candidate_person_id=? LIMIT 1')
    .bind(fixture.reviewPerson.id)
    .first<{ id: string }>();
  assert.ok(review);
  const headers = {
    'Cf-Access-Jwt-Assertion': fixture.admin.assertion,
    Cookie: `__Host-lvbt_session=${fixture.admin.session.token}`,
  };
  async function comparisons() {
    const response = await fixture.simulator.dispatchFetch(`${ORIGIN}/review/${review?.id}/`, {
      headers,
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    const list = /<dl class="staff-review-fields">([\s\S]*?)<\/dl>/.exec(html)?.[1];
    assert.ok(list, 'The comparison has one ordered field list');
    const pairs = [...list.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/g)].map((match) => match[0]);
    assert.equal(pairs.length, 5);
    return pairs;
  }
  const labels = ['First name', 'Last name', 'Email', 'Phone', 'ZIP code'];
  for (const [index, pair] of (await comparisons()).entries()) {
    assert.equal(
      (pair.match(/<dd>/g) ?? []).length,
      2,
      'Each field contains both adjacent record values',
    );
    assert.ok(pair.includes(labels[index] ?? ''));
    assert.ok(pair.indexOf('New entry, ') < pair.indexOf('Already on our list, '));
    assert.ok(pair.includes('New entry, '));
    assert.ok(pair.includes('Already on our list, '));
    assert.equal(pair.includes('>Different<'), index === 2);
    assert.equal(pair.includes('staff-review-field-different'), index === 2);
  }
  await fixture.db
    .prepare('UPDATE people SET given_name=?,family_name=?,phone=?,zip=? WHERE id=?')
    .bind('  COMMITTEE  ', 'rider', '(702) 555-0200', '89104', fixture.reviewPerson.id)
    .run();
  assert.equal(
    (await comparisons()).filter((pair) => pair.includes('>Different<')).length,
    1,
    'Formatting is not a difference',
  );
  await fixture.db
    .prepare('UPDATE people SET given_name=?,family_name=?,phone=?,zip=? WHERE id=?')
    .bind('<b>Other</b>', null, null, '89101', fixture.reviewPerson.id)
    .run();
  for (const pair of await comparisons()) {
    assert.equal((pair.match(/>Different</g) ?? []).length, 1);
    assert.equal(pair.includes('<b>Other</b>'), false, 'Values remain escaped text');
  }
  const denied = await fixture.simulator.dispatchFetch(`${ORIGIN}/review/${review.id}/`, {
    headers: {
      'Cf-Access-Jwt-Assertion': fixture.lead.assertion,
      Cookie: `__Host-lvbt_session=${fixture.lead.session.token}`,
    },
  });
  assert.equal(denied.status, 404);
  console.log(
    'Compiled comparison differences, normalized values, record labels and authorization passed.',
  );
} finally {
  await fixture.dispose();
}
