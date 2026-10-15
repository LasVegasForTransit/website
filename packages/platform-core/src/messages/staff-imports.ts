export const staffImports = {
  imports: {
    title: 'Signups to check',
    description: 'Review signups that need a match or a clearer mailing-list choice.',
    match: 'Compare this signup with the member record below.',
    possibleMember: 'Possible member',
    confirm: 'This is the same person',
    confirmed: 'Signup matched. Its original answers have been saved.',
    linked: 'Ready to finish adding this signup.',
    stale:
      'This signup or member record changed. Return to signups to check and compare them again.',
    expired: 'This form expired or was already used. Return to signups to check and try again.',
    duplicate:
      'Check whether these entries belong to the same person before changing the member record.',
    withdrawal:
      'Confirm whether they left the mailing list and when they made that choice. The date we checked the list may be later.',
    missing:
      'Clarify this response before changing their mailing-list preferences. Keep any missing dates blank.',
    newsletter: 'Newsletter signup',
    form: 'Membership form',
    question: 'Original question: {question}',
    answer: 'Original answer: {answer}',
    referral: 'How they heard about LVBT: {referral}',
    discord: 'Discord name from their form: {name}',
    submitted: 'Form submitted {date}',
    sourceTime: 'Original submission time: {date}',
    correct: 'Correct their details',
    empty: 'No signups to check',
    emptyHelp: 'Signups that need confirmation will appear here.',
    next: 'Next page',
    back: '← Members',
  },
} as const;
