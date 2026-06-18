# Work with an AI assistant

This guide is about _using_ an AI coding assistant (a chat-based tool that edits the repo for you) to make changes to this site. Use it when you'd rather describe a change in plain English than write the files by hand.

Whether you're using Claude Code, Cursor, GPT, or another assistant, give it three things up front and the rest takes care of itself. Don't worry about getting the request perfect — if you leave something out, a good assistant will ask before guessing.

## Prompts that work

- _"Scaffold a body fragment for the May 28 general meeting — agenda below."_ (events themselves live in Google Calendar; the assistant can scaffold MDX bodies and update copy.)
- _"Edit the home page hero to lead with the Maryland Parkway BRT opening this fall."_
- _"Add a project for the State of Transit annual report under the research initiative."_
- _"Rewrite the 'But what about heat' section in the quick pitch — punchier, fewer words."_

## What to include in a request

1. **Which collection.** A collection is a folder of same-shaped content files (see [glossary](../reference/glossary.md#content-collection)) — one of `event-bodies`, `projects`, `docs`, `pages`, or `initiatives`. The schemas (the rules defining what fields each file must have) live in [reference/content-collections.md](../reference/content-collections.md). For event metadata (date/time/location/join URL), make the change in Google Calendar directly — the assistant can't.
2. **The slug or filename.** The slug is the URL-safe id of a piece of content (usually its filename without the extension). If you're adding new content, name it; if you're editing, point to it.
3. **The facts.** Dates, names, places, numbers. Let the assistant handle the schema and prose.

## When the result needs tone work

Point the assistant at [explanation/voice-and-tone.md](../explanation/voice-and-tone.md) and ask for a revision. Don't accept "empowering," "stakeholders," or "centering" copy without questioning it.
