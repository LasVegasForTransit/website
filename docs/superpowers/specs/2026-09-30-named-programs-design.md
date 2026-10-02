# Named public programs on the LVBT site

**Date:** 2026-09-30  
**Status:** Approved

This spec defines how the LVBT website will present named programs, starting with Vegas Urbanists
and Week Without Driving. It exists so an ongoing meetup and an annual challenge have stable public
homes without turning every event or production task into a program.

## Intent and source of truth

LVBT wants `/programs` to help a visitor find a recognizable activity they can join. Vegas Urbanists
is a casual monthly gathering about better neighborhoods, transportation, and city life in Southern
Nevada. LVBT hopes to run Week Without Driving annually; its first, 2026 edition has a separate
participant site at `lvwwd.org`.

Vegas Urbanists is meant to be a continuing public program, not a one-off series of meetups. The
website should express the public invitation in the name **Vegas Urbanists** and keep planning
details and unconfirmed partnerships out of public copy.

The chosen recurring meetup time is the **third Thursday of each month at 6:30 p.m. Pacific Time**.
The site may state the recurring time. It must not name a venue as final or publish an RSVP until
the event details are confirmed.

## Public information hierarchy

| Concept     | Meaning                                                                     | Example                                         | Public treatment                                                                   |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Program     | A named activity with an identity that survives an individual event or year | Vegas Urbanists; Week Without Driving           | Stable `/programs/<slug>` page and directory listing                               |
| Designation | A short editorial grouping for browsing programs                            | Community gatherings; annual challenges         | Section or label on `/programs`, not a parent URL                                  |
| Edition     | A year's run of a recurring program                                         | Week Without Driving 2026                       | Current participant site and dated material; a later archive can add edition pages |
| Event       | One dated occurrence with a venue and attendance details                    | October Vegas Urbanists meetup                  | Google Calendar powered `/events` detail once confirmed                            |
| Project     | Finite work with a deliverable and status                                   | Launch Vegas Urbanists; run the 2026 challenge  | `/projects` when public reporting is useful; may reference one program             |
| Initiative  | A strategic effort or cross-cutting theme                                   | Launch the urbanist community; public education | Managed in planning tools; existing site initiative tags stay project facets       |

The relationship is not a strict tree. A project can serve a program and several strategic areas. A
program can have many events and future editions. A designation exists to help visitors scan the
directory; it does not determine where a page lives.

## Chosen approach

Use the existing Astro content collection for named program records and add a stable detail route.
Give each program one primary designation. Related public projects point back to their program.
Place the current broad portfolio entries in a separate collection for work-area explanations, so
the word “program” has one meaning in authoring and navigation. Keep the old copy accessible in a
secondary “How our work connects” section while named programs lead the page.

This is preferable to adding Vegas Urbanists to the current broad portfolio list: that would leave
`/programs` mixing named activities with categories. It is also preferable to pulling live planning
records into the public build: those records hold draft logistics, while public program copy needs
editorial review.

## Content model and routes

- `programs` holds one MDX entry per named program. Its validated frontmatter includes a title,
  short summary, designation key, order, cadence label, public status, and optional external
  participation URL. The body answers what happens, who can come, and how to take part. A program's
  ID is its stable URL slug.
- A small designation definition supplies the ordered directory headings and their one-sentence
  descriptions. Initially use **Community gatherings** for Vegas Urbanists and **Annual challenges**
  for Week Without Driving. The directory renders only designations that have public programs.
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
- Continue sourcing dated events from the LVBT Google Calendar. The Vegas Urbanists page can link to
  `/events` initially. A “next meetup” card appears only when an event can be explicitly associated
  with the program and has confirmed public details; matching by title text is insufficient.

## Page behavior and copy boundaries

The Vegas Urbanists page should lead with an easy invitation: meet neighbors, talk about the places
we share, and bring whatever experience or curiosity you have. It should describe the meetups as
relaxed and mostly unstructured, open to all generations, and organized by Las Vegans for Better
Transit. State “Third Thursdays at 6:30 p.m.” as the planned standing rhythm. Until a specific event
is confirmed, the action is “See upcoming events” rather than an RSVP to an unbooked venue.

The Week Without Driving page should explain the annual challenge in evergreen language, name
America Walks as the national organizer, and point to `lvwwd.org` for current dates, rules,
registration, and resources. Put 2026-specific claims on the edition site or existing project page.
Do not imply LVBT owns the national challenge.

Neither page should publish internal conversion targets, volunteer staffing expectations, plans
concerning another organization, or prospective partnerships as established facts. A proposed venue
stays out of public copy until it is confirmed.

## Navigation and compatibility

Keep “Programs” in the primary navigation. Make `/programs` visibly lead with named offerings and
link to both program pages. Retain `/projects` and `/events` as separate visitor destinations.
Update the sitemap, text exports, and relevant content documentation so they use “program”
consistently. Existing project and Week Without Driving redirect URLs continue to work.

## Acceptance checks

- `/programs`, both program pages, existing project pages, and the Week Without Driving redirects
  build and resolve.
- The directory groups named programs by designation and has a clear path to each detail page.
- Vegas Urbanists shows the third-Thursday 6:30 p.m. rhythm without asserting a confirmed October
  venue, reservation, or RSVP.
- Week Without Driving separates the evergreen program from the 2026 edition and links to the live
  participant site.
- No published program entry or related project points to a missing slug; content validation fails
  clearly when one does.
- Site metadata, sitemap, text exports, and responsive layouts reflect the new pages.
- `pnpm check` passes. Browser review covers mobile and desktop directory and detail pages.

## Later work

When the team and venue confirm an occurrence, publish it in the LVBT calendar with its actual date,
venue, transit information, and RSVP instructions. Add an explicit program association to the event
pipeline before showing automatic “next meetup” data. Annual edition archives can wait until a
second Week Without Driving edition exists.
