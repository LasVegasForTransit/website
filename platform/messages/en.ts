// English messages for member-facing screens. Keys are grouped by screen.
// `{name}` fills in a value. A message that depends on a count is an object
// of plural forms chosen by Intl.PluralRules ("one", "other").
// How to add a message: platform/messages/README.md.

export const en = {
  join: {
    title: 'Join LVBT',
    description:
      'Become an LVBT member in a minute. Members get updates, invitations to events and a say in what we work on.',
    heading: 'Join LVBT',
    intro:
      "Members get LVBT's updates, invitations to events and a say in what we work on. It's free.",
    emailLabel: 'Email address',
    givenNameLabel: 'First name (optional)',
    familyNameLabel: 'Last name (optional)',
    zipLabel: 'ZIP code (optional)',
    zipHint: 'Helps us invite you to things near you.',
    reachHeading: 'Help us reach you (optional)',
    phoneLabel: 'Phone number (optional)',
    addressLabel: 'Home address (optional)',
    addressHint:
      'For your exact city ward and districts. We use it once, then delete it. We never keep your street address.',
    interestsHeading: 'What are you interested in? (optional)',
    interestEvents: 'Coming to events',
    interestMeetings: 'Speaking up at public meetings',
    interestVolunteering: 'Volunteering on a team',
    interestNews: 'Transit news',
    consentLabel:
      "Add me to LVBT's mailing list. This makes me an LVBT member. I can unsubscribe at any time.",
    submit: 'Join LVBT',
    honeypotLabel: 'Leave this field empty',
    errorSummaryHeading: 'There is a problem',
    consentError: "To become a member, tick the box to join LVBT's mailing list.",
    emailError: 'Enter an email address like name@example.com',
    zipError: 'Enter a 5-digit ZIP code, like 89104',
    phoneError: 'Enter a phone number with its area code, like 702 555 0123',
    rateLimited:
      "We've had a lot of sign-ups from your connection in the last hour. Please try again later, or email hello@lasvegasfortransit.org and we'll add you.",
    unavailable:
      "We couldn't finish joining you just now. Your details are still here. Please try again in a minute.",
  },
  region: {
    title: 'Your part of the valley',
    question: 'Which part of the valley do you live in?',
    hint: 'This helps us invite you to things near you. We never share it outside LVBT.',
    ratherNotSay: "I'd rather not say",
    submit: 'Continue',
  },
  welcome: {
    title: "You're in",
    headingNamed: "You're in, {name}.",
    heading: "You're in.",
    sentTo: "We've sent a confirmation to {email}.",
    nextStepsHeading: 'What next',
    nextEvents: 'See upcoming events',
    nextDiscord: "Join LVBT's Discord",
    addressNotPlaced:
      "We couldn't find that address, so we kept only your ZIP code. You can add it later from your account.",
    addressUnavailable:
      "We couldn't check your address just now, so we kept only your ZIP code. You can add it later from your account.",
  },
  newsletterBox: {
    memberNote: 'Joining the mailing list makes you an LVBT member.',
    submit: 'Subscribe',
    sending: 'Joining…',
    success: "You're in. Welcome to LVBT.",
    error: 'Something went wrong. Please try again.',
    invalidEmail: 'Enter an email address like name@example.com',
  },
  remove: {
    title: 'Remove your email',
    heading: 'Remove your email from LVBT?',
    body: '{email} was added to LVBT. If that was not you, or you have changed your mind, remove it here.',
    submit: 'Remove my email',
    done: 'Your email has been removed from LVBT.',
    invalid:
      'This link has expired or is not valid. Email hello@lasvegasfortransit.org and we will remove you.',
  },
  email: {
    joinSubject: 'Welcome to LVBT',
    joinGreetingNamed: 'Hi {name},',
    joinGreeting: 'Hi,',
    joinBody:
      "You're now an LVBT member and on our mailing list. We'll send updates and invitations, usually no more than twice a week. You can change what we send or leave at any time from your account.",
    joinRemove: 'Not you? Remove this email',
    signOff: 'Las Vegans for Better Transit',
  },
} as const;

export type Catalog = typeof en;
