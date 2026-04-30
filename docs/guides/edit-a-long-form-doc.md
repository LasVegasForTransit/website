# Edit a long-form doc

The org's canonical essays live in `src/content/docs/`:

- `vision.mdx` — full long-form vision, rendered at `/vision`
- `mission.mdx` — short mission statement, used on `/about`
- `why-now.mdx` — urgency case for the 2027 session
- `problems.mdx` — how Las Vegas got here
- `strategy.mdx` — how we plan to win, rendered at `/about/strategy`

The objection-rebuttal Q&A material lives at [`reference/transit-objection-rebuttals.md`](../reference/transit-objection-rebuttals.md) — design input, not a rendered page.

These are intentional, considered documents — not blog posts. Edit thoughtfully:

1. Read [explanation/voice-and-tone.md](../explanation/voice-and-tone.md) before drafting.
2. If you're updating numbers (ridership, dates, dollar amounts), cross-reference [reference/key-facts.md](../reference/key-facts.md) — the same numbers anchor multiple files.
3. Commit messages should explain **why** the change was made, not what changed.
4. Push to `main`. Cloudflare Pages deploys in ~60 seconds.
