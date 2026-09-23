# Copy for app screens

This is how to write the short text on LVBT's app screens: buttons, labels, hints, errors, empty states and confirmations. The [voice and tone guide](./voice-and-tone.md) covers how LVBT sounds in articles and on public pages; this page covers the words people read while they are doing something, often on a phone, often in a hurry, sometimes with a screen reader or in a second language.

These are rules, not suggestions. If a rule doesn't fit a case, change the rule here first.

Every string goes in the [message catalog](../../platform/messages/README.md), never straight into a page.

## Buttons

Start with a verb that says what will happen.

- Do: "Send my code", "Join LVBT", "Remove my email"
- Don't: "Submit", "OK", "Continue" when something specific happens next

## Case

Use sentence case everywhere: capitalize only the first word and names.

- Do: "Contact preferences"
- Don't: "Contact Preferences"

## Errors

Say what went wrong and how to fix it. Don't blame the person, and never use the word "invalid".

- Do: "Enter an email address like name@example.com"
- Don't: "Invalid email" or "You entered the wrong email"

Show each error twice: in the summary at the top of the form, as a link to the field, and next to the field itself. Use the same words in both places.

## Hints

Add a hint only when the label isn't enough. Keep it to one short sentence, under the label.

- Do: "We'll send a 6-digit code to this address"
- Don't: "Please enter your email address in the field below so that we can contact you."

## Empty states

Say what would be here and how it gets here.

- Do: "No events yet. Events you check in to will show here."
- Don't: "No data."

## Confirmations

Say what happened, then what happens next.

- Do: "You're in. We've sent a confirmation to ana@example.org."
- Don't: "Success!"

## Dates

Weekday, month and day. Add the year only when it isn't this year. Format dates with `formatDate` from the message catalog, which always uses Pacific Time.

- Do: "Sat, Oct 5", "Tue, Jan 6, 2027"
- Don't: "10/5", "October 5th, 2026"

## Times

12-hour clock, lowercase am and pm, Pacific Time, and no ":00" on the hour. Use `formatTime`.

- Do: "6:30 pm", "7 pm"
- Don't: "18:30", "7:00 PM"

## Numbers

Use numerals, except "one" in running text.

- Do: "3 events", "one more step"
- Don't: "three events"

## Links

Link text says where the link goes. It still makes sense read on its own, because screen readers list links by their text.

- Do: "Change your email address"
- Don't: "Click here", "Learn more"

## Personal data

Next to any field that asks for personal information, say in one sentence why LVBT asks and what it does with it.

- Do: "We use your address once to find your districts, then delete it."
- Don't: ask for an address with no explanation.

## Reading level

Aim for grade 6 to 8. Check with the free [Hemingway Editor](https://hemingwayapp.com/): paste the text in and read the grade it shows. Short words and short sentences are the fastest fix.

## Terms

Use the same word for the same thing on every screen, as the [glossary](../reference/glossary.md) defines it. Spell out an acronym the first time it appears on a screen.

- Do: "RTC (the Regional Transportation Commission)"
- Don't: "RTC" on first use, or "member" on one screen and "subscriber" on the next for the same person

## Checklist before testing a prototype

Every "Prototype, test and build" task runs through this before real people try the prototype:

1. Every button starts with a verb that says what happens.
2. Everything is in sentence case.
3. Every error says how to fix it, doesn't blame, and never says "invalid".
4. Each error appears in the summary and next to its field, in the same words.
5. Every field that asks for personal information says why, in one sentence.
6. Every empty state says what would be here and how it gets here.
7. Every confirmation says what happened and what happens next.
8. Dates and times use `formatDate` and `formatTime`.
9. Link text makes sense on its own.
10. The screen's text scores grade 8 or below in Hemingway Editor.
11. Every string is in the message catalog.
