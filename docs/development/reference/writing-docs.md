# Writing docs

Our docs are read by college students and first-time volunteers, not just senior engineers. Write so
that someone with basic coding ability and no knowledge of our specific tools can follow along. This
page is the bar; it's also the checklist a reviewer (or an AI assistant) uses when editing docs.

## The audience, stated plainly

Assume the reader:

- Can edit a file and run a command, but may not know our stack.
- Has **not** memorized our tools (Astro, Notion, Cloudflare, Wrangler, pnpm).
- Does **not** know transit acronyms (RTC, BRT, FTA) or email/DNS jargon (SPF, DKIM, CNAME).
- Will give up or break something if a prerequisite is missing.

When unsure whether to explain something, explain it. We'd rather over-explain than lose a
volunteer.

## The checklist

Every doc should:

1. **Open with what + why.** First sentence: what this doc is. Second: why it exists / when you'd
   need it. Don't start with mechanics.
2. **List prerequisites up front.** If a task needs an account, an API key, calendar access, or a
   prior setup step, say so in a "Before you start" block — before step 1, not halfway through.
3. **Define jargon on first use.** The first time a term appears, add a short parenthetical and link
   the [glossary](../reference/glossary.md), e.g. "a Pages Function (a small backend that runs on
   Cloudflare — see [glossary](../reference/glossary.md#pages-function))." Define it once per doc;
   after that, just use it. If the term isn't in the glossary, add it there.
4. **Expand every acronym on first use.** "RTC (the Regional Transportation Commission)" — even ones
   that feel obvious.
5. **Show concrete examples.** A real command, a real snippet, a sample of the expected output.
   "Copy the template" → show what the result looks like.
6. **Explain errors, don't just list them.** For each common failure, give _what it means_ and _how
   to fix it_, not only the error text.
7. **Prefer inline summaries over "go read the code."** A one-line explanation in the doc beats a
   bare link to a `.ts` file a beginner can't parse. Link the code too, for those who want it.
8. **Say which option to pick.** When a doc offers several paths, add a short "which one should I
   use?" note.

## Style

- Plain words over clever ones. Short sentences.
- Active voice and second person ("you run", not "one runs").
- Link generously — but a link is not a substitute for a one-line explanation of what's behind it.
- Don't hedge into vagueness. "Usually do X; do Y only when Z" beats "you might consider X."
- Follow [Diátaxis](https://diataxis.fr): tutorials teach, guides solve one task, reference is
  looked-up, explanation gives the why. Put content in the right quadrant (see the
  [docs index](../../README.md)).

## When you add or edit a doc

- Add it to the [docs index](../../README.md) so people can find it.
- Run `pnpm check:docs` to confirm every link resolves (including glossary anchors).
- New jargon → add it to the [glossary](../reference/glossary.md).

## Out of scope

Internal design specs under `docs/superpowers/specs/` are historical records of how a feature was
built, not contributor docs — they don't have to meet this bar. Everything else does.
