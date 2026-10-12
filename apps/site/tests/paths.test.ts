import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalUrl, paths } from '../src/lib/paths';
import { navMain } from '../src/lib/site';

void test('links directly to canonical page routes', () => {
  for (const path of [
    ...navMain.map((item) => item.href),
    paths.programs,
    paths.program('vegas-urbanists'),
    paths.projects,
    paths.project('riders-council'),
    paths.letters,
    paths.letter('2026-04-23-letter-from-the-founder'),
    paths.events,
    paths.event('2026-07-16-lvbt-general-member-meeting'),
    paths.join,
    paths.role('events-coordinator'),
  ]) {
    assert.ok(path.endsWith('/'), `expected a canonical trailing slash: ${path}`);
  }
  assert.equal(paths.initiative('education'), '/projects/#education');
});

void test('canonical page URLs keep queries and fragments after the trailing slash', () => {
  assert.equal(canonicalUrl('/join/member'), 'https://lasvegasfortransit.org/join/member/');
  assert.equal(canonicalUrl('/'), 'https://lasvegasfortransit.org/');
  assert.equal(
    canonicalUrl('/projects?view=all#education'),
    'https://lasvegasfortransit.org/projects/?view=all#education',
  );
  assert.equal(
    canonicalUrl('/events/example.ics'),
    'https://lasvegasfortransit.org/events/example.ics',
  );
});
