# Run a usability test

This guide is LVBT's kit for testing a new screen with real people before it is built: how to find testers, what to say, how to run a session and how to record what you learn. Every prototype goes through it before it is built. Test each flow with at least three people from its real audience, including at least one person who uses assistive technology.

A **usability test** is a short session where someone tries a task with a prototype, thinking aloud, while you watch and take notes without helping. **Assistive technology** means the tools some disabled people use to operate a phone or computer, such as screen readers (VoiceOver on iPhone, TalkBack on Android), screen magnifiers, switch access or voice control.

> **Before you start.** You need the prototype's preview link (see [add a prototype](./add-a-prototype.md)), edit access to the tester roster in LVBT's shared drive (staff only), and 30 minutes per session.

## 1. Recruit testers

Send this message through the newsletter, on Discord and in person at events, with a link to the sign-up form.

> **Help us make LVBT's website easier to use**
>
> We're building new tools for LVBT members, and we want to try them with real people before they go live. A session takes 20 to 30 minutes, on your own phone or computer, in person or on a video call. You're testing our design, not being tested: if something is confusing, that's our problem to fix.
>
> We especially want to hear from people who use a screen reader or other assistive technology, people over 65, and people who mostly use their phone on the bus.
>
> Sign up: <link to the form>

### The sign-up form

Make a Google Form with only these questions, and send its answers to the roster sheet:

1. First name
2. Email address
3. Which devices would you use? (iPhone, Android phone, tablet, laptop or desktop)
4. Do you use assistive technology? If so, which? (optional)
5. Age range: under 25, 25 to 44, 45 to 64, 65 and over
6. Would you rather meet in person or on a video call?
7. "LVBT may contact me about testing new tools." (a required checkbox)

Don't ask anything else.

### The roster

The roster is a Google Sheet in LVBT's shared drive that only staff can open. Its columns are: first name, email, devices, assistive technology (if any), age range, preferred session type, consent to be contacted (yes, with the date), sessions done and last session date.

The first recruiting target is 8 testers, including at least 2 who use assistive technology, at least 2 aged 65 or over and at least 2 who mostly use their phone on transit. One person can count toward more than one group.

Testers aren't paid; LVBT has no budget for it. Thank each tester personally, and mention them in the newsletter only if they say yes.

## 2. Run the session

Read this script aloud. Keep this prototype's tester tasks ready — the things you'll ask a tester to
do, such as "Join LVBT."

**Welcome.** "Thanks for helping. We're testing a new part of LVBT's website, and we want to see where it's confusing. You can't do anything wrong: if something is hard, that's what we need to fix. Please think out loud as you go. It's a test version, so nothing you type is saved."

**Consent.** "I'll take written notes about what happens, but I won't record video or audio, and your name won't appear in our notes. You can stop at any time. Is that OK?" Continue only if they say yes.

**Warm-up.** "How do you usually hear about things LVBT is doing?"

**Tasks.** Read each task you prepared, one at a time, for example "Join LVBT." Then watch. Don't help unless they have been stuck for two minutes; if you do help, note it.

**Closing.** "What was confusing?"

**Thank you.** "Thank you. This makes a real difference."

## 3. Record the findings

Record the findings in this format and share them with whoever is building the prototype. Use session numbers, never names or emails.

```
## Usability findings: <flow name>, <date>

| Session | Device and assistive technology | Task 1 | Task 2 | Task 3 |
| --- | --- | --- | --- | --- |
| 1 | iPhone SE, VoiceOver | Done | Stuck: code field not announced | Done |

### Problems
- <problem> (severity: blocks / slows / cosmetic), seen in sessions <n>

### Changes made
- <change>
```

Severity means: **blocks** — the tester couldn't finish the task; **slows** — they finished, but it took longer or they hesitated; **cosmetic** — it looked wrong but didn't get in their way.

Fix everything that blocks before building. When the fixes are in, set the prototype's status to "tested".

## Further reading

- W3C, [involving users with disabilities in evaluating accessibility](https://www.w3.org/WAI/test-evaluate/involving-users/)
- Nielsen Norman Group, [why you only need to test with 5 users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/)
- LVBT's [copy standard for app screens](../explanation/app-copy.md), whose checklist every prototype passes before testing
