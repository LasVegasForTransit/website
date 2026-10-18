export const staffAdministrators = {
  administrators: {
    title: 'Staff administrators',
    description: 'Choose who can manage LVBT’s member records.',
    current: 'Current administrators',
    empty: 'No administrators are listed.',
    add: 'Add administrator',
    find: 'Find a current member by name or membership email.',
    search: 'Find a member',
    noMatches: 'No current members match that name or email.',
    tryAnother: 'Try another name or membership email.',
    connectGoogle:
      'They need to sign in once with their LVBT Google account before you can make them an administrator.',
    alreadyAdministrator: 'Already an administrator',
    currentMemberRequired: 'Only current LVBT members can become administrators.',
    noLongerAdministrator: 'This person is no longer an administrator.',
    grantQuestion: 'Make {name} an administrator?',
    revokeQuestion: 'Remove {name} as administrator?',
    grantImpact:
      'Administrators can view and change all member records, manage committees and staff administrators, and download member data.',
    revokeImpact:
      'They will lose access to all member records and administrator tools. Any access from their committee roles remains.',
    selfImpact: 'This is your own administrator access. You will be signed out after confirming.',
    grant: 'Make administrator',
    revoke: 'Remove administrator',
    added: 'Administrator added.',
    removed: 'Administrator removed.',
    selfRemoved: 'Your administrator access was removed. You have been signed out.',
    invalid: 'Open the confirmation page again and review this administrator change.',
    expired: 'This confirmation expired or was already submitted. Review the change again.',
    changed: 'This member’s details or administrator access changed. Review the change again.',
    reviewAgain: 'Review administrator change',
    back: 'Back to staff administrators',
    lastAdmin:
      'Make another current member an administrator before removing this access. LVBT needs an active administrator.',
  },
} as const;
