import type { DestinationInspection } from './discord-work-provider';

/** Reject an existing thread unless it is in the explicitly approved destination and audience. */
export function validateAdoptedThread(input: {
  thread: DestinationInspection;
  expectedParentId: string;
  approvedAudience: string;
}): boolean {
  const { thread, expectedParentId, approvedAudience } = input;
  return (
    !thread.isCategory &&
    thread.destination.kind === 'thread' &&
    thread.privateThread === false &&
    thread.destination.parentId === expectedParentId &&
    thread.audienceFingerprint === approvedAudience &&
    thread.canRead &&
    thread.canSend &&
    !thread.archived &&
    !thread.locked
  );
}
