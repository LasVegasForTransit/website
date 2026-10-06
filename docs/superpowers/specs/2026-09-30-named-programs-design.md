# Named public programs on the LVBT site

**Date:** 2026-09-30  
**Status:** Approved

This spec defines how the LVBT website will present named programs, including Vegas Urbanist Social
Club, Week Without Driving, and LVBT Labs. It exists so an ongoing meetup and an annual challenge
have stable public homes without turning every event or production task into a program.

## Intent and source of truth

LVBT wants `/programs` to help a visitor find a recognizable activity they can join. Vegas Urbanist
Social Club is a casual monthly gathering about better neighborhoods, transportation, and city life
in Southern Nevada. LVBT hopes to run Week Without Driving annually; its first, 2026 edition has a
separate participant site at `lvwwd.org`. LVBT Labs builds civic tech tools to support urbanism and
transit advocacy, with its catalog and contribution path at `labs.lasvegasfortransit.org`.

Vegas Urbanist Social Club is meant to be a continuing public program, not a one-off series of
meetups. The website should express the public invitation in the name **Vegas Urbanist Social Club**
and keep planning details and unconfirmed partnerships out of public copy.

The chosen recurring meetup time is the **third Thursday of each month at 6:30 p.m. Pacific Time**.
The site advertises that time and the standing venue, Tous les Jours Cafe on Spring Mountain Road.
Dated occurrences come from the public calendar; RSVP on the program page links to the selected LVBT
event page.

## Public information hierarchy

| Concept     | Meaning                                                                     | Example                                                     | Public treatment                                                                   |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Program     | A named activity with an identity that survives an individual event or year | Vegas Urbanist Social Club; Week Without Driving; LVBT Labs | Stable `/programs/<slug>` page and directory listing                               |
| Designation | A short editorial grouping for browsing programs                            | Community gatherings; annual challenges; civic technology   | Editorial metadata, not a visible label or parent URL                              |
| Edition     | A year's run of a recurring program                                         | Week Without Driving 2026                                   | Current participant site and dated material; a later archive can add edition pages |
| Event       | One dated occurrence with a venue and attendance details                    | October Vegas Urbanist Social Club meetup                   | Google Calendar powered `/events` detail once confirmed                            |
| Project     | Finite work with a deliverable and status                                   | Launch Vegas Urbanist Social Club; run the 2026 challenge   | `/projects` when public reporting is useful; may reference one program             |
| Initiative  | A strategic effort or cross-cutting theme                                   | Launch the urbanist community; public education             | Managed in planning tools; existing site initiative tags stay project facets       |

The relationship is not a strict tree. A project can serve a program and several strategic areas. A
program can have many events and future editions. A designation exists to help visitors scan the
directory; it does not determine where a page lives.

## Chosen approach

Use the existing Astro content collection for named program records and add a stable detail route.
Give each program one primary designation. Related public projects point back to their program.
Place the current broad portfolio entries in a separate collection for work-area explanations, so
the word “program” has one meaning in authoring and navigation. Keep the old copy accessible in a
secondary “How our work connects” section while named programs lead the page.

This is preferable to adding Vegas Urbanist Social Club to the current broad portfolio list: that
would leave `/programs` mixing named activities with categories. It is also preferable to pulling
live planning records into the public build: those records hold draft logistics, while public
program copy needs editorial review.

## Content model and routes

- `programs` holds one MDX entry per named program. Its validated frontmatter includes a title,
  short summary, designation key, order, and public status. An optional image includes alt text,
  intrinsic dimensions, and any caption or required credit. Cadence, venue, external participation
  URL and label, calendar series UID, and event noun are optional capabilities. The MDX body uses
  the content and structure appropriate to the program. A program's ID is its stable URL slug.
- Each program has an editorial designation. The directory gives each named program a substantial
  section within the standard page grid: an unboxed icon, name, short introduction, and explicit
  link to its detail page beside a larger focal area. On desktop, sections occupy at least the
  viewport below the fixed header; content can expand them. All focal areas use the same 8:5
  proportions. Photographs fill that area without frames; tool screenshots fit completely and can
  use a restrained border. Images have no visible captions. On mobile, content stacks naturally
  without forcing a viewport height.
- Programs with a calendar series can use the focal area for the selected occurrence's discussion
  topic, actual date, time, venue, and RSVP link. This directory feature is separate from the basic
  attendance panel on the program detail page. Topics belong to individual event bodies and follow
  their immutable calendar occurrence identity; an occurrence without a topic uses its date.
- Desktop proximity snapping helps each section settle below the header. Labeled onward links use
  the secondary surface; a compact gutter index appears only when there is enough space. Neither
  changes ordinary document scrolling. Disable snapping on mobile and with reduced motion. Do not
  use enclosing program cards, page-wide bands, tile grids, designation labels, or hairlines.
- Move the three currently published broad portfolio MDX entries to a `workAreas` collection, with
  only terminology updates in their bodies and no changes to project references. The hidden
  fellowship draft remains hidden. The work-area section is secondary on `/programs` and should not
  be presented as another list of programs.
- Add `/programs/[...slug]` for named program pages and use the same page, breadcrumb, metadata, and
  accessible link conventions as the rest of the site.
- Add an optional `program` slug to the existing project frontmatter. Assign the current Week
  Without Driving 2026 project to `week-without-driving`; retain its URL and dated status. Program
  pages can show related public projects from this single reference. Do not create public project
  pages solely for monthly meetup logistics.
- Keep the existing `/wwd`, `/wwd/`, and `/week-without-driving` redirects to `lvwwd.org`. The new
  `/programs/week-without-driving` URL is the evergreen LVBT overview, with a clear link to the live
  participant site.
- Continue sourcing dated events from the LVBT Google Calendar. An event panel is an optional
  capability enabled by a calendar series UID. Prefer an ongoing occurrence, then the nearest
  upcoming occurrence, then the most recent completed occurrence; exclude cancellations. The panel
  uses actual date, time, and venue. Clock-based selection updates on page load and every minute as
  well as at build time.
- Event bodies may use a stable calendar occurrence identity so authored topic copy or recaps
  survive renames and rescheduling. Routine event details stay in the calendar.
- Programs without a calendar series use their own MDX content and participation destination. Labs
  does not acquire a meetup card; Week Without Driving retains its dedicated participant site.

## Page behavior and copy boundaries

The Vegas Urbanist Social Club page describes a repeatable format: one local topic, a conversation,
then time to socialize. It is open to all ages and requires no planning background. Keep the header
free of icons and designation labels. Put the “Next meetup” label above and outside the information
card; the card contains only date, time, venue, and the action. Do not add host copy, marketing
text, or thin dividers. Use **RSVP** for ongoing or upcoming occurrences, linking to the LVBT event
page; use **View last meetup** for a completed occurrence. With no occurrence, show the recurring
schedule and an **Events calendar** link.

The LVBT Labs page leads with building civic tech tools for urbanism and transit advocacy. Use
actual examples from the Labs catalog (TransitMapper and tools supporting Week Without Driving), and
link to the catalog, source code, and contributing guide. Do not invent a recurring schedule or
imply that every project in Labs is its own program.

The Week Without Driving page should explain the annual challenge in evergreen language, name
America Walks as the national organizer, and point to `lvwwd.org` for current dates, rules,
registration, and resources. Put 2026-specific claims on the edition site or existing project page.
Do not imply LVBT owns the national challenge.

Neither page should publish internal conversion targets, volunteer staffing expectations, plans
concerning another organization, or prospective partnerships as established facts. A venue is
published only once it is the advertised meeting place.

## Navigation and compatibility

Keep “Programs” in the primary navigation. Make `/programs` visibly lead with named offerings and
link to all named program pages. Retain `/projects` and `/events` as separate visitor destinations.
Update the sitemap, text exports, and relevant content documentation so they use “program”
consistently. Existing project and Week Without Driving redirect URLs continue to work.

## Acceptance checks

- `/programs`, all three program pages, existing project pages, and the Week Without Driving
  redirects build and resolve.
- The directory gives each program a distinct, spacious feature section with a high-level
  description and a clear path to its detail page. Icons remain; category labels and decorative
  bullet markers do not.
- Vegas Urbanist Social Club shows the selected occurrence and an RSVP to its LVBT event page. The
  heading, date, venue, and destination roll together as occurrences begin and end.
- LVBT Labs explains the civic tech purpose and provides a catalog and contribution path without an
  event panel.
- Week Without Driving separates the evergreen program from the 2026 edition and links to the live
  participant site.
- No published program entry or related project points to a missing slug; content validation fails
  clearly when one does.
- Site metadata, sitemap, text exports, and responsive layouts reflect the new pages.
- `pnpm check` passes. Browser review covers mobile and desktop directory and detail pages.

## Later work

After the first Social Club meetup, add a recap to that event's record: the topic discussed, a few
useful links or observations, and any concrete next steps. A short program-level link can point to
that record when there is something to share. Add photos only once real photos are available. Annual
edition archives and multiple calendar series per program can wait for a concrete need.
