# Edit a long-form doc

This guide is for editing LVBT's core public essays — the pages that lay out who we are and what
we're arguing for. Use it when you need to change the words on one of those pages (not for events,
projects, or news, which have their own guides).

The org's canonical (official, single-source-of-truth) essays live in `src/content/docs/`. Each
covers a different question, so pick the one that matches what you're trying to say:

- `vision.mdx` — full long-form vision, rendered at `/vision`. The big-picture future we're working
  toward. Edit this when the _aspiration_ changes.
- `mission.mdx` — short mission statement, used on `/about`. One tight paragraph on what the org
  does. Edit when the _core purpose_ statement changes.
- `why-now.mdx` — urgency case for the 2027 session. Why this moment matters. Edit when the _timing
  argument_ changes.
- `problems.mdx` — how Las Vegas got here. The diagnosis of what's broken. Edit when describing the
  _problem_.
- `strategy.mdx` — how we plan to win, rendered at `/about/strategy`. The plan of action. Edit when
  the _approach_ changes.

These are `.mdx` files — Markdown with components (see
[glossary](../../development/reference/glossary.md#mdx)).

The objection-rebuttal Q&A material lives at
[`reference/transit-objection-rebuttals.md`](../reference/transit-objection-rebuttals.md) — design
input, not a rendered page (it informs the essays but isn't published as its own page).

These are intentional, considered documents — meaning each was deliberately written and weighed, not
dashed off like a blog post, so a wording change can shift the org's public message. Edit
thoughtfully:

1. **Required:** read [explanation/voice-and-tone.md](../explanation/voice-and-tone.md) before
   drafting, so your edit matches the house voice.
2. **Required when you touch numbers** (ridership, dates, dollar amounts): cross-reference
   [reference/key-facts.md](../reference/key-facts.md) — the same numbers anchor multiple files, so
   they must stay in sync.
3. Commit messages should explain **why** the change was made, not what changed.
4. Push to `main`. Cloudflare Pages deploys in ~60 seconds.
