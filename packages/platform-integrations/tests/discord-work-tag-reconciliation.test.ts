import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planManagedForumTags,
  resolveMappedForumTag,
} from '../src/discord-work-tag-reconciliation';

void test('tag reconciliation preserves human tags and only owns tags it applied', () => {
  const result = planManagedForumTags({
    current: ['human', 'old'],
    managed: ['old'],
    desired: ['new', 'human'],
    available: ['human', 'old', 'new'],
    required: false,
  });
  assert.deepEqual(result, { kind: 'update', tags: ['human', 'new'], managed: ['new'] });
  const next = planManagedForumTags({
    current: ['human', 'new'],
    managed: ['new'],
    desired: [],
    available: ['human', 'old', 'new'],
    required: false,
  });
  assert.deepEqual(next, { kind: 'update', tags: ['human'], managed: [] });
});

void test('a Notion selection maps only to one matching tag in the destination forum', () => {
  const mapping = {
    property: 'stage-id',
    mappings: [
      { value: 'Planning', tagName: 'Planning' },
      { value: 'Ready', tagName: 'Ready' },
    ],
  };
  const page = {
    properties: { Stage: { id: 'stage-id', type: 'status', status: { name: 'Ready' } } },
  };
  const tags = [
    { id: 'tag-a', name: 'Planning' },
    { id: 'tag-b', name: 'Ready' },
  ];
  assert.deepEqual(resolveMappedForumTag(page, mapping, tags), { kind: 'ready', tagId: 'tag-b' });
  assert.equal(
    resolveMappedForumTag(page, mapping, [...tags, { id: 'tag-c', name: 'Ready' }]).kind,
    'review',
  );
  assert.ok(tags[0]);
  assert.equal(resolveMappedForumTag(page, mapping, [tags[0]]).kind, 'review');
  assert.equal(
    resolveMappedForumTag(
      { properties: { Stage: { id: 'stage-id', type: 'status', status: { name: 'Other' } } } },
      mapping,
      tags,
    ).kind,
    'review',
  );
  assert.equal(
    resolveMappedForumTag(
      { properties: { Stage: { id: 'stage-id', type: 'status', status: null } } },
      mapping,
      tags,
    ).kind,
    'review',
  );
});

void test('tag reconciliation stops on human removal, unavailable tags, or Discord limits', () => {
  assert.equal(
    planManagedForumTags({
      current: [],
      managed: ['old'],
      desired: ['new'],
      available: ['old', 'new'],
      required: false,
    }).kind,
    'review',
  );
  assert.equal(
    planManagedForumTags({
      current: ['human'],
      managed: [],
      desired: ['missing'],
      available: ['human'],
      required: false,
    }).kind,
    'review',
  );
  assert.equal(
    planManagedForumTags({
      current: ['a', 'b', 'c', 'd', 'e'],
      managed: [],
      desired: ['f'],
      available: ['a', 'b', 'c', 'd', 'e', 'f'],
      required: false,
    }).kind,
    'review',
  );
  assert.equal(
    planManagedForumTags({
      current: ['old'],
      managed: ['old'],
      desired: [],
      available: ['old'],
      required: true,
    }).kind,
    'review',
  );
});
