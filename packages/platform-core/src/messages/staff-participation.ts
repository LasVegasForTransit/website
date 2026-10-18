export const staffParticipation = {
  participation: {
    title: 'Events',
    attendedTotal: { one: '{count} event attended', other: '{count} events attended' },
    rsvpTotal: { one: '{count} RSVP recorded', other: '{count} RSVPs recorded' },
    recent: 'Showing the {count} most recent records.',
    empty: 'No attendance or RSVPs recorded for this person.',
    unknownName: 'Event name not recorded',
    unknownDate: 'Date not recorded',
    attended: 'Attended',
    rsvp: 'RSVP recorded',
    record: 'Record attendance',
    eventName: 'Event name',
    eventDate: 'Event date',
    recordHelp:
      'Record an event this person attended. This does not change their membership or mailing-list choice.',
    nameError: 'Enter an event name of up to 160 characters on one line.',
    dateError: 'Enter a valid event date.',
    futureError: 'Choose today or an earlier date.',
    invalid: 'Check the marked fields and save again.',
    conflict:
      'This attendance could not be saved. Reload the form and check the person’s Events before retrying.',
    expired:
      'This form expired or was already submitted. Check the person’s Events before retrying.',
    unavailable:
      'Attendance could not be saved. Your entries are still here; try again when the service recovers.',
  },
} as const;
