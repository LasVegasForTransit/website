import assert from 'node:assert/strict';

/** Synthetic guild page, including an unlinked account staff must be able to recognize. */
export function rosterFixture(
  linkedId: string,
  reviewId: string,
  linkedRoles: string[],
  reviewRoles: string[],
) {
  return [
    { user: { id: linkedId, bot: false }, roles: linkedRoles, pending: false },
    {
      user: {
        id: reviewId,
        bot: false,
        username: 'review.rider',
        global_name: 'Review Rider',
      },
      nick: 'Server Rider',
      roles: reviewRoles,
      pending: false,
    },
  ];
}

export function assertReviewAccount(row: unknown, accountId: string, memberRoleId: string): void {
  assert.deepEqual(
    row,
    {
      discord_user_id: accountId,
      managed_role_ids: JSON.stringify([memberRoleId]),
      username: 'review.rider',
      display_name: 'Review Rider',
      nickname: 'Server Rider',
    },
    'an unlinked account retains recognizable names and managed roles without role changes',
  );
}
