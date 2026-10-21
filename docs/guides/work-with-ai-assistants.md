# Work with an AI assistant

This guide is about _using_ an AI coding assistant (a chat-based tool that edits the repo for you)
to make changes to this site. Use it when you'd rather describe a change in plain English than write
the files by hand.

Give Claude Code, Cursor, GPT, or another assistant the three details below. Review its changes and
preview the affected pages before sharing them. Keep credentials, member details, and private staff
records out of prompts.

## Before you start

Use a branch and complete [local setup](../tutorials/first-time-setup.md) if the assistant will edit
files. Tell it which work you authorize; asking it to draft a change does not authorize publication.

## Prompts that work

- _"Create the optional event body file for the May 28 general meeting — agenda below."_ (events
  themselves live in Google Calendar; the assistant can create MDX files for longer event
  descriptions and update copy.)
- _"Edit the home page introduction to explain the Maryland Parkway bus rapid transit project."_
- _"Add a project for the State of Transit annual report under the research initiative."_
- _"Rewrite the 'But what about heat' section in the quick pitch — punchier, fewer words."_

## What to include in a request

1. **Which collection.** A collection is a folder of same-shaped content files (see
   [glossary](../reference/glossary.md#content-collection)) — one of `event-bodies`, `projects`,
   `docs`, `pages`, or `initiatives`. The schemas (the rules defining what fields each file must
   have) live in [reference/content-collections.md](../reference/content-collections.md). For event
   metadata (date/time/location/join URL), make the change in Google Calendar directly — the
   assistant needs separate calendar access and authorization.
2. **The slug or filename.** The slug is the URL-safe id of a piece of content (usually its filename
   without the extension). If you're adding new content, name it; if you're editing, point to it.
3. **The facts.** Dates, names, places, numbers. Let the assistant handle the schema and prose.

## When the result needs tone work

Point the assistant at [explanation/voice-and-tone.md](../explanation/voice-and-tone.md) and ask for
a revision. Run `pnpm check` and fix its reported errors before opening a pull request. Don't accept
"empowering," "stakeholders," or "centering" copy without questioning it.
