# Writing docs

Write for a contributor who can edit a file and run a command but does not yet know this project.
After reading a page, they should know what to do, why it matters, and how to tell whether it
worked.

## The audience, stated plainly

Our contributors include students and first-time volunteers. Do not assume they know Astro,
Cloudflare, the membership database, or LVBT's internal terms. Explain what a tool does when the
reader first needs it. Link to the [glossary](../reference/glossary.md) for more detail.

Name the intended reader and task at the start. A contributor editing a page needs different
instructions from an administrator restoring a database. Keep those tasks in separate pages.

## The checklist

Before submitting a documentation change, check these points:

1. **Start with the reader's task.** Say who should use the page and what they can do with it. Avoid
   an opening that only repeats the title, such as “This document describes deployment.”
2. **Put prerequisites before steps.** Name the account, access, tools, and earlier setup required.
   Say whether a step affects local testing, protected preview, or production.
3. **Use ordinary words where they carry the same meaning.** Explain an unavoidable technical term
   on first use. Do not replace a precise term with a vague one just to shorten a sentence.
4. **Expand unfamiliar abbreviations.** Write “Regional Transportation Commission (RTC)” before
   using “RTC” alone. Keep exact API names, settings, commands, and identifiers unchanged.
5. **Give a concrete example and expected result.** Show a command someone can run, where to run it,
   and what success looks like. Explain placeholders before asking the reader to replace them.
6. **Explain failure and recovery.** Say what an error means and the next safe action. A partial
   deployment, failed backup, or missing permission needs more than “try again.”
7. **Keep the explanation where the reader needs it.** Explain the immediate step in the guide. Link
   to deeper design or reference material for readers who need it.
8. **Check facts against the implementation.** A source file, local test, GitHub check, and live
   service establish different facts. State which one supports a claim.

## Style

Use complete sentences, active voice, and one main idea per sentence. Name the person or program
that acts. Prefer “The worker checks Discord's response” to “Provider readback is performed.”

Avoid invented labels and compressed phrases. For example:

| Instead of…               | Explain what happens…                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| “Canonical person record” | “The membership database's record for this person”                       |
| “Retained artifact”       | “The saved build that the workflow will publish”                         |
| “Provider readback”       | “Fetch the result from Discord to confirm the role changed”              |
| “Generation fence”        | “Check the job's version so older work cannot overwrite a newer request” |
| “Bounded cleanup”         | “Delete at most 100 eligible records in one run”                         |
| “Unresolved review”       | Name the flagged record, the missing information, and who can resolve it |

These are examples, not automatic substitutions. An “artifact” can contain several files, and a
“review” can mean a code review or a decision about conflicting member data. Explain the specific
meaning. Never rewrite identifiers, quoted error text, or code samples with a global replacement.

Use technical detail when it helps the reader make a decision, perform a step, or verify a result.
For example, keep a database's row-read limit and explain that one query can read many rows. Do not
turn an implementation detail into a new contributor requirement.

## Keep the page focused

A README should help someone start: what the application does, how to work on it, which checks to
run, and where to find details. Put deployment credentials, database rules, and failure recovery in
focused operator references. Do not move an unreadable README into an equally unreadable appendix.

Use the [docs index](../README.md) to find the right kind of page:

- Tutorials teach a first task from the beginning.
- Guides help someone complete one task.
- References give exact settings, commands, and limits to look up.
- Explanations record the reasons behind a design or decision.

## When you add or edit a doc

Add a new contributor or operator page to the [docs index](../README.md). Preserve existing heading
links when reorganizing a page, or leave an explicit anchor that points to the replacement section.
Check the complete rendered page when the change affects public site content or layout.

Run `pnpm check`. Its Markdown checks cover repository documentation, and `check:docs` checks site
Markdown and MDX links. Add a glossary definition when a new term will appear across several pages.
A glossary link does not replace explaining a step in the page itself.

## Operator procedures are part of the software

Update the operator procedure whenever a change affects setup, access, credentials, database
changes, deployment, an outside service, or recovery. An operator must be able to follow it without
the original author or this chat.

Give steps in order. Name the service and account to select, the exact setting or supported command,
the environment it affects, the expected result, and recovery after partial failure. Distinguish
reading a service's state from changing it.

Preserve the conditions that protect people and data: consent, permissions, approval, isolation
between preview and production, deletion rules, and numeric limits. Explain them plainly; do not
remove them to make a page shorter. Do not imply that a newsletter subscription, LVBT membership,
volunteer role, and staff access are the same decision.

Document secret names and required permissions, never secret values or member data. Keep private
planning and detailed execution receipts in their private operational or build records. Label
proposed features and unverified operations clearly rather than presenting them as available.

## Out of scope

Dated design plans, past decisions, and audit results record what was known at the time. Preserve
their dates, findings, and proposal status. Clarify confusing prose when useful, but do not silently
rewrite historical claims as current facts. Current instructions must link to the current guide.
