import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAdoptedThread } from '../src/discord-work-adopt-destination';

void test('an existing event thread must stay in its configured destination and audience', () => {
  const parentId = '333333333333333333';
  const thread = {
    isCategory: false,
    privateThread: false,
    destination: { kind: 'thread' as const, channelId: '555555555555555555', parentId },
    audienceFingerprint: 'approved',
    archived: false,
    locked: false,
    canRead: true,
    canSend: true,
    canCreateThreads: false,
    canManageChannels: false,
    requiredTag: false,
    tags: [],
  };
  const input = { thread, expectedParentId: parentId, approvedAudience: 'approved' };
  assert.equal(validateAdoptedThread(input), true);
  assert.equal(
    validateAdoptedThread({ ...input, thread: { ...thread, privateThread: true } }),
    false,
  );
  assert.equal(
    validateAdoptedThread({ ...input, thread: { ...thread, privateThread: undefined } }),
    false,
  );
  assert.equal(validateAdoptedThread({ ...input, expectedParentId: '777777777777777777' }), false);
  assert.equal(validateAdoptedThread({ ...input, approvedAudience: 'different' }), false);
  assert.equal(validateAdoptedThread({ ...input, thread: { ...thread, archived: true } }), false);
  assert.equal(validateAdoptedThread({ ...input, thread: { ...thread, locked: true } }), false);
  assert.equal(validateAdoptedThread({ ...input, thread: { ...thread, canRead: false } }), false);
  assert.equal(validateAdoptedThread({ ...input, thread: { ...thread, canSend: false } }), false);
});
