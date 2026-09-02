# Membership program

**Status: proposed.** This is a program design, not a built system. It specs the membership _ladder_
— how someone goes from an email address to an organizer who runs part of LVBT — so a future
contributor can implement it without re-deriving the model. The intake plumbing it sits on top of
already exists; see [membership-intake.md](../../operations/reference/membership-intake.md).

Read [voice-and-tone.md](./voice-and-tone.md) first if you're writing any member-facing copy off
this.

---

## What this is, and what it isn't

This document is about **engagement** — turning supporters into participants and participants into
leaders. It is the answer to two questions:

1. How do we get members to actually show up — to events, to comment periods, to the work?
2. How does a member become a lead, with real ownership of a slice of LVBT?

It is **not** the donation/perks system. Money and engagement are deliberately **separate axes**
(see [The donation axis](#the-donation-axis-keep-it-separate)). A broke college student can be our
best organizer; a generous donor may never attend a thing. Conflating the two corrupts both.

---

## Principles

These constrain every design choice below. When a mechanic violates one, cut it.

- **The ladder rewards contribution, not consumption.** Status comes from showing up and doing the
  work, never from paying for it.
- **Don't instrumentalize people.** Members are organizers and neighbors, not "conversion funnel"
  units. Every mechanic should make sense to the person it's applied to and read as recognition, not
  extraction.
- **Every rung is a real door, not a label.** Advancing should unlock something concrete — access,
  responsibility, belonging — or it's just a badge.
- **Recognition is opt-in and public; tracking is quiet.** We celebrate people by name only with
  their say-so. Internal participation records stay internal.
- **Leadership is sustainable or it's a liability.** A lead who burns out is worse than no lead.
  Build in support, check-ins, and graceful off-ramps from day one.
- **No cringe, no leaderboards.** This is organizing, not a loyalty punch card. Milestones can be
  warm; gamification that feels manipulative fails the "would this read well in a union hall" test.

---

## The ladder

LVBT membership is a **ladder of engagement** (the standard organizing model: each rung is a deeper
commitment, and the program's job is to make the next rung easy to step onto). Five rungs:

| Rung               | Who they are             | How they got here                             | What it unlocks                                                                                        |
| ------------------ | ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **0 · Subscriber** | Gave an email only       | Newsletter box                                | Updates. Not yet a member.                                                                             |
| **1 · Member**     | Opted in, in our roster  | Membership form                               | Welcome flow, Discord (the chat platform where the community organizes), event invites, a name we know |
| **2 · Regular**    | Shows up repeatedly      | Attended events / took actions over time      | Recognition, input on priorities, first call for limited opportunities                                 |
| **3 · Lead**       | Owns a slice of the work | Promoted (see [criteria](#promotion-to-lead)) | Responsibility, access, a defined role, a say in direction                                             |
| **4 · Core**       | Ongoing leadership       | Sustained lead + invited                      | Steering the org; cross-team direction                                                                 |

The whole program is the **machinery that moves people up a rung** — and that catches them when they
drift down one (see [Lifecycle](#lifecycle-and-states)).

Most orgs have a fat rung 0–1 and almost nobody above. The design goal here is a healthy **flow
rate** from Member → Regular → Lead, because leads are what let LVBT do more than one founder can.

---

## Incentivizing attendance

Event attendance is the hinge of the whole ladder: it's both the main thing we want Members to do
_and_ the main signal that someone is ready to be a Regular, then a Lead. So the attendance
incentives and the promotion criteria are the same flywheel viewed from two angles.

What actually gets people to show up, roughly in order of power:

1. **Belonging.** People come back for people. A named cohort, familiar faces, a Discord where the
   planning happens, an in-person community that's genuinely warm. This is the strongest lever and
   the cheapest. Everything else is secondary.
2. **A clear, personal ask.** "Come to the RTC meeting Thursday, we need bodies in the room and I
   saved you a seat" beats a calendar blast. Leads making direct asks is the single highest-yield
   tactic; the system's job is to _enable_ those asks (who to ask, who's lapsing), not replace them.
3. **Visible impact.** People attend when showing up obviously matters — a comment period that
   swings a vote, a turnout number that makes the paper. Tie events to stakes, and report back what
   the turnout _did_.
4. **Recognition.** Member spotlights, a shout-out in the newsletter, a thank-you that uses their
   name. Opt-in, never a leaderboard.
5. **Milestones.** Light, warm markers — "first event," "showed up all quarter." A Discord role, not
   a points balance. Optional; skip if it ever feels gamey.
6. **Progression itself.** Becoming a Regular, then being asked to lead, is the real reward. The
   ladder _is_ the incentive system.

**Anti-patterns to avoid:** paid-tier line-skipping (corrupts the contribution principle), public
attendance scoreboards (shames the busy), and any mechanic that makes a newcomer feel behind on day
one.

---

## Promotion to lead

This is the part most orgs never systematize, and it's where the leverage is. Promotion should feel
like an _invitation earned_, not an application processed.

### Criteria

A Member is ready to be offered a lead role when, roughly, all of these hold. Treat them as signals
for a human judgment call, not a scoring rubric:

- **Shows up.** A track record of attendance over a sustained window — they're a Regular, not a
  one-timer.
- **Takes initiative.** Has already done something unprompted: brought a friend, spoke at a meeting,
  fixed a thing, started a conversation.
- **Values fit.** Coalition-minded, accurate, not in it to grind an unrelated axe. (See
  voice-and-tone: pointed when warranted, never impossible to work with.)
- **Capacity, honestly assessed.** Has the time and isn't already overextended elsewhere. A yes here
  is consent, not pressure.

The promotion itself is **a conversation, not a notification.** Someone — a Core member or existing
Lead — asks them directly, names the specific role, and is explicit about scope and expected time.
They can say no and stay a Regular with no penalty.

### What a "lead" actually is

A lead **owns a defined slice** with real authority over it. The slices map to LVBT's actual work —
examples, not a fixed list:

- **Event lead** — hosts a recurring event or owns turnout for a campaign moment.
- **Working-group lead** — runs a team (events, comms, data/tools, coalition, research). See
  [Roles and teams](#roles-and-teams).
- **Corridor/campaign lead** — owns a specific fight (e.g. a BRT corridor, the 2027 funding push),
  end to end.

A role isn't real unless it has: a **scope** (what's yours), a **mandate** (what you can decide
without asking), and an **ask** (the recurring commitment).

### Onboarding a lead

Stepping up should come with a real handoff, not just a new title:

- A short orientation: how LVBT works, who does what, where the docs are.
- The **access** the role needs (Discord role, shared docs, calendar, whatever tooling — granted on
  promotion, revoked gracefully on step-down).
- A named **point of contact** they can go to when stuck.
- Written **expectations**: the commitment, and explicitly what is _not_ expected (so they don't
  infer infinite obligation).

### Keeping leads (the part that's actually hard)

Recruiting leads is easy; keeping them is the whole game.

- **Regular low-stakes check-ins.** Catch overload before it becomes a quiet disappearance.
- **Distribute load.** No single hero role. If a slice needs 20 hrs/week, it's two roles.
- **A real off-ramp.** "I need to step back" is always an acceptable sentence. Leads can drop to
  Regular or pause without it being a failure — and we want them able to come _back_, which only
  happens if leaving was graceful.
- **Alumni stay warm.** A former lead is a future lead and a current ally.

---

## Lifecycle and states

A member isn't a fixed rung; they move. The system tracks a current **state** and the program
responds to transitions:

```text
Prospective → Member → Regular → Lead → Core
                 │         │        │
                 └─────────┴────────┴──→ Lapsing → Lapsed → (re-engage) → Member
```

- **Lapsing** — was active, hasn't shown up in a while. The trigger for a personal re-engagement ask
  (from a lead, ideally), _before_ they're gone.
- **Lapsed** — disengaged. Stays on the roster; gets occasional warm re-entry invites, never guilt.
- **Re-engagement** is a first-class path, not an afterthought. Winning back a former Regular is
  cheaper than a cold signup and they ramp faster.

The single most valuable operational habit this enables: **someone notices when a Regular goes
quiet, and reaches out as a person.** That's the whole point of tracking state — not metrics for
their own sake.

---

## Roles and teams

Leadership has somewhere to _go_ only if there are slices to own. The likely teams (again,
illustrative — let them form around real work and real people):

- **Events** — meetups, RTC-meeting turnout, tabling, social.
- **Comms** — newsletter, social, press, the editorial voice.
- **Data & tools** — the dashboards and civic-engagement tools (see
  [innovation-ideas.md](./innovation-ideas.md)).
- **Coalition** — relationships with labor, faith, business, RTC staff, legislators.
- **Research / policy** — fact sheets, the objection-rebuttal reference, testimony.

A Member can volunteer into a team without being a Lead; a Lead _runs_ one. Teams are how the org
scales past the founder.

---

## The donation axis (keep it separate)

LVBT also wants donor recognition and perks. **That is a different system and this doc is not it.**
Track it as an independent attribute, not a rung on this ladder:

- **Engagement rung** (Member → Lead) answers _"how involved are they?"_
- **Donor status** answers _"have they given, and how much?"_

They're orthogonal. A person can be high on one and zero on the other. Donor perks (recognition
wall, donor newsletter segment, etc.) attach to the donor attribute; ladder unlocks attach to the
rung. The one hard rule: **donating never buys a rung.** Money can earn thanks and perks; it cannot
earn organizer status, because the moment it does, leadership stops meaning what we need it to mean.

(The technical pipeline for detecting donations and tiering perks is a separate build; it's sketched
in the membership-intake reference's neighborhood, not here.)

---

## What we'd measure

Organizer-PM metrics, not vanity numbers. The point of each is a decision it would drive:

- **Activation rate** — Subscriber → Member. Is the front door working?
- **Attendance rate** — share of Members who attend in a given window. Is the community alive?
- **Repeat rate** — Member → Regular. Are first-timers coming back? (The flywheel's health check.)
- **Ladder conversion** — Regular → Lead. Are we growing leaders or hoarding work?
- **Active leads** — count, and trend. The real capacity number.
- **Member-led events** — events not run by the founder/Core. The leverage metric.
- **Lead retention / lapse** — are we keeping leaders or burning them?

If a metric wouldn't change a decision, don't track it.

---

## How this maps to what we already have

Deliberately thin — this is a PM spec, not an implementation plan. But for grounding: the systems
exist to back rungs 0–2 today.

- **The roster already lives in Notion** (the app the team uses for shared databases and notes — see
  [glossary](../../development/reference/glossary.md#notion)), created per-member by the intake
  pipeline ([membership-intake.md](../../operations/reference/membership-intake.md)). Adding
  `Stage`, `Role`, an events-attended signal, and a `Lapsing` flag to that record covers most of
  this spec's state model.
- **Events already flow through a public calendar** ([events-pipeline.md](./events-pipeline.md)).
  The missing primitive is **attendance capture** — a check-in (QR at the door, a form, an RSVP
  reconciliation) that writes back to the member record. That single signal powers attendance
  metrics, Regular detection, and lapse alerts.
- **Discord** is the natural home for roles/belonging; roles can mirror rungs and teams.
- **Newsletter segments** (Beehiiv, our newsletter-sending platform — see
  [glossary](../../development/reference/glossary.md#beehiiv)) can carry recognition and
  re-engagement flows.

Nothing here requires the gated-content/auth system. Rungs 3–4 (lead access, private planning
spaces) are where login starts to matter — defer that until there are enough leads to need it.

---

## Open questions for the implementer

Decisions intentionally left open — resolve with whoever owns the program:

- **How is attendance captured?** QR check-in, manual, RSVP-based? This is the load-bearing
  primitive; pick the lowest-friction option people will actually use.
- **What are the rung thresholds?** "Regular" = how many events, over what window? Start loose and
  human; tighten only if it needs automating.
- **Who owns promotions?** Founder-only at first, or any Core/Lead can nominate?
- **Milestones — yes or no?** Decide deliberately; they're easy to overdo.
- **How public is recognition by default?** Opt-in is the principle; pick the exact consent moment
  (at signup? at first spotlight?).

---

## Phasing

Don't build it all. Crawl, then walk:

1. **Crawl** — Add `Stage`/`Role` to the member record and capture attendance. Manually mark
   Regulars. Make direct asks. No automation. This alone unlocks the most important behavior:
   noticing who's active and who's lapsing.
2. **Walk** — Define the lead role(s) and run one real promotion end to end. Stand up one team. Add
   lapse alerts.
3. **Run** — Automate state transitions, milestones, re-engagement flows, and lead-facing dashboards
   once the manual version has proven the model.

---

## Related

- [membership-intake.md](../../operations/reference/membership-intake.md) — the roster pipeline this
  sits on
- [events-pipeline.md](./events-pipeline.md) — where attendance capture would hook in
- [voice-and-tone.md](./voice-and-tone.md) — for any member-facing copy
- [innovation-ideas.md](./innovation-ideas.md) — the tools/teams a lead could own
- [comms-strategy.md](./comms-strategy.md) — how members hear from us
