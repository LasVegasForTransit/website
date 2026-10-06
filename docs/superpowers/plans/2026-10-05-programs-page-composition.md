# Programs Page Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task by task after design review. Steps use checkbox syntax for tracking. Work inline;
> delegate only when the user requests it.

**Goal:** Present each named LVBT program as a substantial, recognizable page section that leads
visitors to its own page.

**Architecture:** Keep the existing program collection and detail pages. One directory component
owns a consistent editorial composition, with a complete layout for programs with or without
imagery. Section scale and placement belong to the component, not program metadata.

**Tech Stack:** Existing Astro components, content collections, shared CSS tokens, and responsive
utilities. No new dependencies.

**Spec:** [Named programs design](../specs/2026-09-30-named-programs-design.md) supplies the
information hierarchy and capabilities. The visual requirements below supersede its directory layout
guidance and capture the latest user feedback. The refined prototype was approved on October 6;
shared-component integration is in verification.

## Global Constraints

- Named programs are visitor-facing identities; projects are concrete work; work areas are enduring
  categories.
- The directory provides a short introduction and a direct link to each program page.
- Retain Vegas Urbanist Social Club, Week Without Driving, and LVBT Labs in that order.
- Retain Ongoing work and Project roadmap, their content, and their links.
- Keep the shared page container: maximum width 80rem with its existing responsive page padding.
- Keep the shared header at 4.5rem; retain its responsive navigation and wordmark fixes.
- Use the existing Public Sans type roles and semantic colors. Do not change brand tokens to solve
  this page.
- No cards enclosing whole programs, browser-wide program bands, tile grid, decorative bullet
  markers, overlines, designation labels, or added hairlines.
- Photographs are unframed. Product screenshots can use the restrained border requested during
  review. Images have no visible explanatory captions. Required attribution belongs in the colophon.
- Program details retain their existing event selection, RSVP, and external participation behavior.
- The user subsequently authorized rebasing onto main and shipping the approved result to preview.
  Production promotion requires a separate request.

## Baseline and Design Decision

At a 1440 × 900 viewport, with the 72px header, the current sections measure:

| Program                    | Section height | Share of available viewport |
| -------------------------- | -------------: | --------------------------: |
| Vegas Urbanist Social Club |          266px |                         32% |
| Week Without Driving       |          579px |                         70% |
| LVBT Labs                  |          426px |                         51% |

The large gaps between them do not give the sections themselves a coherent composition. Width,
surface fills, and image padding have been changed independently without first settling section
scale and hierarchy.

Use a two-column editorial composition based on the site's section hierarchy. For programs with
images, the name, introduction, and navigation link form one text column; the unframed image
occupies a larger adjacent column. The image is a peer of the text, not an attachment beneath the
description. For the Social Club, the larger column presents the actual next conversation rather
than leaving an empty text-only viewport. The refined conversation feature was approved on
October 6.

### Desktop: one program per usable viewport

- At widths of 1024px and above, programs with images use columns of `1.1fr` and `2.2fr`, with a gap
  of `clamp(2rem, 4vw, 4rem)`. The text column groups the identity, introduction, and link. The
  image is a sibling of that group, outside the description container. Apply this through image
  presence; no slug-specific layout rule.
- Standardize all three sections to the same minimum block size:
  `calc(100svh - var(--lvbt-header-h))`. At a 900px viewport with the 72px header, each section is
  828px. Remove additional desktop gaps between these viewport-sized sections; their internal
  spacing provides the separation. Content that needs more room expands the section normally.
- Give every section the same responsive vertical padding: `clamp(3rem, 8svh, 5rem)`. Align the top
  of the program name with the top of the actual image, with the icon above that shared edge. Center
  the complete composition within the section. Use 32px between the identity and introduction, and
  24px between the introduction and link. Content that is taller than the minimum expands normally.
- Use `text-display-sm` for program names and `text-body-lg` for the introduction. These are
  existing type roles; do not add extra bold weights or a bespoke display scale.
- Keep a small, unboxed 32px program icon in the identity column. It supports the name and has no
  visible label.
- Render `About {program title} →` as a standard text navigation link, with the existing program
  route. Give it its own space beneath the introduction rather than making the whole section a link.
- Give all program images the same 8:5 media area. Cap the shared area's width using the section's
  usable height after subtracting padding and the icon's size and gap, with a 15rem minimum height
  budget. Both images shrink together on short viewports. Derive the top offset from the same icon
  size and gap used by the identity, and align the right edge with the page container. Photos fill
  the area with a centered crop; screenshots fit completely without distortion. There are no text
  overlays, background mats, or captions. The Labs tool screenshot uses a 2px muted ink border
  directly on the image, without padding or an enclosing card.
- Use the page's cream canvas, ink typography, and restrained existing link accent. Section
  composition establishes program identity; no enclosing background block is needed.

### Scroll snapping

- At desktop widths, use the normal document scroller with native `scroll-snap-type: y proximity`.
  Apply this only to the Programs directory, using the existing `BaseLayout` `mainClass` prop and
  page-scoped CSS targeting `html:has(.programs-directory)`. No nested scroller or wheel handler.
- Set `scroll-padding-block-start: var(--lvbt-header-h)` so snap positions begin below the fixed
  header. Each program section uses `scroll-snap-align: start` and the default snap-stop behavior.
- Give the page opening and the transition into Ongoing work their own start positions, so entering
  and leaving the program sequence is straightforward. Ongoing work and Project roadmap retain
  normal continuous scrolling.
- Use proximity snapping so the browser can settle on a nearby section while visitors can still stop
  within content. Do not require stopping at every program or override normal keyboard input.
- Disable snapping below 1024px and when reduced motion is requested. Section content remains
  accessible independently of snapping, including when enlarged text exceeds a viewport.
- Each program ends with a link naming the destination and a downward arrow on the secondary surface
  background. The last program links to Ongoing work. Use native fragment navigation and a 44px
  minimum target; the link works with pointer and keyboard input. On desktop, align it to the right
  edge 24px above the section bottom. Reserve at least 80px of bottom padding so expanded content
  stays clear of it. On stacked layouts, right-align the link in normal flow after the program
  entrypoint.
- At widths of at least 1360px, add a compact program index in the right page gutter. Generate its
  links from the displayed program order. Each 44px target has a small marker; the active marker is
  longer and uses the existing accent. Keep program names as accessible link labels. Mark the active
  link with `aria-current="location"`. Track the program containing the usable viewport's midpoint
  and hide the index outside the program sequence. Below this width, the labeled downward links
  provide navigation without overlapping content.
- Reference: [CSS Scroll Snap specification](https://drafts.csswg.org/css-scroll-snap-1/#examples),
  including the native proximity example and the header-offset scroll padding.

### Imagery and the text-only case

- Week Without Driving can use the existing Deuce photograph; its credit remains in metadata and
  renders in the colophon.
- LVBT Labs should use a clear view of the working TransitMapper map rather than the onboarding
  modal currently shown. Capture the real public tool during the prototype phase; do not fabricate
  product UI.
- Vegas Urbanist Social Club has no current image asset. Use a concise next-meetup feature alongside
  the program introduction: the actual discussion topic, date and time, venue name, and RSVP link to
  its LVBT event page. Keep the Next meetup heading outside the secondary surface. Use the same
  desktop footprint as the media column, without an enclosing card around the program. An approved
  venue or gathering photo can later occupy that position; do not invent a gathering photo.
- For integration, select the occurrence through the existing calendar series selector. Date, venue,
  and action come from that occurrence. An authored discussion topic belongs to occurrence content,
  not evergreen program copy. Use an optional topic; do not fabricate one for later dates. The
  prototype's October fixture is only for design review and cannot ship as hardcoded event data.
  Keep the existing fallback behavior for completed or unscheduled series.
- The text-only case is part of the review, not an exception to skip. If its composition still feels
  like a short list entry surrounded by padding, the prototype has failed and needs revision before
  integration.

### Tablet and mobile

- Below 1024px, stack identity, image, introduction, then link. Keep the same hierarchy and order
  across all programs.
- Use natural content height on these widths. Do not force a viewport height that creates a blank
  screen on phones or short landscape viewports.
- Do not carry the desktop media height cap onto stacked layouts. Images retain the shared 8:5 media
  area within the same page width.
- Let program titles and navigation text wrap naturally. Only the shared header retains its fixed
  height and no-wrap wordmark behavior.
- Keep 24px between content groups and a clear 64px separation between completed program sections.
- A visitor should encounter a program's name, purpose, and entrypoint together before the next
  program takes over the page.
- On stacked layouts, give program anchors a header-sized scroll margin so their icons and names
  remain visible after following a fragment link.

## Review Focus

1. Program without imagery: the actual next conversation gives the section a useful focal point,
   while the introduction and program entrypoint remain brief.
2. Long program names: wrap cleanly without competing with the page title or pushing the navigation
   link out of reach.
3. Photography and product screenshots: share the same media dimensions, with useful photo crops and
   complete screenshots, without captions or distortion.
4. Short viewports and enlarged text: section content expands normally; no fixed-height clipping,
   overflow, or hidden action.
5. Future programs: collection-driven order, identity, summary, link, and optional image work
   without hardcoded slugs or layout designations.

## Single-Viewport Inspection

The existing page was inspected at 1440 × 900, with each program heading positioned at approximately
96px below the top of the viewport:

- Social Club: the next program heading begins at y=505px. Two program introductions compete within
  the same screen, and the Social Club's content ends near the top third.
- Week Without Driving: its image gives it more presence, but the Labs heading still begins at
  y=819px. Text and image do not share a complete viewport composition.
- LVBT Labs: Ongoing work begins at y=590px. Its image emphasizes a welcome modal rather than the
  actual civic tech tool, and the lower-page section competes for attention within the same screen.

These are baseline observations, not verification of the proposed layout or snapping. The prototype
must be judged in individual viewport screenshots and through normal scrolling. A scaled full-page
capture alone is insufficient.

### Initial prototype findings

The full-page prototype was then inspected in separate viewports. At 1440 × 900, all three sections
are 828px tall, start at y=72px after snapping, and share title and introduction anchors. At 1024 ×
768, all three are 696px tall. Native scrolling moved through the three sections and into Ongoing
work; Page Up returned to Labs below the fixed header.

- **Social Club fails the visual review.** Its name, introduction, and link occupy only the upper
  quarter of the desktop viewport. Enlarging the section has made the empty space more obvious. Do
  not integrate this text-only composition as finished. Revise its visual composition or obtain
  suitable imagery before the full-height design is accepted; do not compensate with more copy.
- **Week Without Driving is the strongest of the three.** The photo gives its viewport an actual
  subject. It retains its full aspect ratio, has no frame or caption, and fits at both desktop
  sizes.
- **Labs needed an asset replacement.** The welcome modal obscured the original image. The prototype
  now uses an actual capture of TransitMapper with a sample route drawn in the live tool, without
  the modal. Source: `https://labs.lasvegasfortransit.org/transit-mapper/`. The sample is a local
  route study, not an existing agency network. The live agency importer returned unavailable, so the
  capture uses the working street map and drawing tools.

At 768 × 1024 and 390 × 844, the layout stacks naturally, snapping is disabled, and there is no
horizontal overflow. The mobile fragment offset was corrected after inspection revealed the icon
could otherwise be hidden by the header.

Emulating reduced motion at 1440 × 900 disables snapping while retaining the 72px header offset.

Prototype: `http://127.0.0.1:4326/viewport-programs.html`. Individual viewport captures are saved in
the local `program-section-studies/captures/` artifact. Equal section sizing is verified; the visual
review remains open because the Social Club composition fails.

### Revised image hierarchy

The image now occupies its own column alongside the complete text group on desktop. This removes the
large empty area under the Labs name and gives the map substantially more room. At 1440 × 900, its
image is approximately 799 × 500px, compared with the initial 624 × 390px capture. Week Without
Driving follows the same composition and displays its photograph at approximately 799 × 614px.

All three section heights remain 828px at 1440 × 900 and 696px at 1024 × 768. Both image-bearing
programs were inspected at those widths. At 390 × 844, the Labs visual now appears between the name
and introduction; the complete image, introduction, and program link are visible together. There is
no horizontal overflow, and snapping remains disabled on mobile.

Current captures: `captures/labs-paired-desktop.jpg` and `captures/labs-paired-mobile.jpg` in the
prototype artifact. This supersedes the initial placement of images beneath descriptions.

### Alignment review, October 6

Centering the two columns independently placed the Labs name well below the map's top edge. The
prototype now gives the program name and image a shared top edge, while the icon sits above that
edge. The text column is slightly wider to reduce short line breaks. At 1440 × 900, the rendered
name and image top positions both measure 275.72px; section heights remain 828px. The rule also
aligns the Week Without Driving name with its photograph.

Screenshot capture initially timed out in the in-app browser. A separate Chrome capture succeeded:
`captures/labs-latest-desktop.jpg` shows the shared top edge at 1440 × 900. This supersedes the
prior paired screenshots' centering treatment.

### Screenshot border and scroll affordance, October 6

The Labs image now has the requested 2px muted border. Photographs retain their unframed treatment.
Every program has a downward link to the next section, including the transition from Labs into
Ongoing work. Following further review, the visible destination text and downward arrow are restored
on the secondary surface background. The links follow the displayed program order and use ordinary
fragment navigation.

The Labs-to-Ongoing-work link was followed in the browser; the destination settled at y=72.39px,
below the fixed header. The Week Without Driving link also reached Labs. At 1024 × 600, expanded
image-bearing sections keep at least 12px between their content and the downward link, without
horizontal overflow. At 390 × 844, the cue follows the description and program link in normal flow,
with 24px of separation; snapping stays disabled.

The gutter index was added as a second navigation prototype. Direct jumps selected all three
programs, and keyboard Tab exposed the focused program name; Enter reached Labs at y=72.39px. The
active marker followed the destination, and the index hid on reaching Ongoing work. At 1360px, the
index's hit area clears the photo by 24.52px. It is hidden at 1280px and 390px, where the labeled
buttons remain available and there is no horizontal overflow.

The floating program names overlapped the Labs image on hover or keyboard focus: the Week Without
Driving label extended 108.25px across the image at 1440 × 900. The labels were removed from the
visual index; accessible program names remain on the links. The controls, including focus outlines,
now stay inside the gutter. Clearance is 64.52px at 1440px and 24.52px at the 1360px minimum,
without horizontal overflow. Enter still jumps to the selected program and updates the active
marker.

Current capture: `captures/gutter-focus-contained-desktop.jpg` in the prototype artifact shows the
corrected keyboard focus state. The preceding overlapping label is recorded in
`captures/gutter-overlap-before.jpg`. The previous button-only design is saved as
`captures/labs-labeled-surface-desktop.jpg`. These are prototype changes; the Social Club's
text-only composition remains open before integration.

### Consistent image sizing, October 6

The different intrinsic proportions made the Week Without Driving photo taller than the Labs
screenshot. Both now use the same 8:5 area. The photo fills it with a centered crop; the complete
Labs screenshot fits inside its requested border. This supersedes the intrinsic media sizing in
earlier prototype reviews.

Rendered image dimensions match exactly for both programs:

| Viewport   |    Width |   Height |
| ---------- | -------: | -------: |
| 1440 × 900 | 750.94px | 469.33px |
| 1024 × 600 | 590.75px | 369.22px |
| 390 × 844  |    335px | 209.38px |

At 1440 × 900, both names align exactly with their image tops, and both sections remain 828px tall.
At 1024 × 600, content expands the sections to 545.22px and retains 12px of clearance above the
downward links. All three inspected viewports have zero horizontal overflow. Desktop and phone
captures are saved as `captures/wwd-uniform-media-desktop.jpg`,
`captures/labs-uniform-media-desktop.jpg`, `captures/wwd-uniform-media-mobile.jpg`, and
`captures/labs-uniform-media-mobile.jpg` in the prototype artifact. The Social Club composition
remains unresolved; these changes have not been integrated into production routes.

### Social Club content revision, October 6

The preview request was withdrawn after the user identified the still-empty Social Club section. No
rebase, commit, push, or preview deployment took place. The revised prototype groups its brief
introduction and program link in the same text column as the other programs. Its adjacent column now
contains the actual October discussion question, October 15 at 6:30 p.m., Tous Les Jours Cafe, and
an RSVP link to the LVBT occurrence. The Next meetup heading sits outside the secondary surface.

At 1440 × 900, all three sections remain 828px tall and their adjacent columns measure 750.94 ×
469.33px. At 1024 × 600, all three sections expand to 545.22px, with at least 12px above the
downward links. At 390 × 844, the program introduction precedes the event feature and the complete
RSVP is visible after navigating to the section. These viewports have no horizontal overflow. The
RSVP was followed to the actual locally rendered October event page, which retains its Meetup
registration link and authored discussion body.

Current captures: `captures/social-club-event-desktop.jpg` and
`captures/social-club-event-mobile.jpg`. This is a revised design prototype awaiting review, not an
integrated or deployed release. Its event facts still need the shared occurrence-driven wiring
described above before shipping.

### Social Club refinement, October 6

The user accepted the content direction and requested refinement. The topic now uses a balanced
30-character line measure with a 1.25 line height and regular weight. The date includes Thursday;
time and venue share the supporting line. RSVP uses the site's ink action treatment with a 44px
minimum target. Below 640px, details and RSVP stack on one left edge rather than leaving the action
isolated at the right.

At 1440 × 900, all three adjacent columns still measure 750.94 × 469.33px, with equal 828px
sections. At 1024 × 600, all sections are 545.22px and retain 12px above the downward links. At 390
× 844, the full RSVP button is visible when the section is reached; content flows naturally and the
downward link follows below the first screen. There is no horizontal overflow in these three
viewports. Current captures are `captures/social-club-refined-desktop.jpg` and
`captures/social-club-refined-mobile.jpg`. The user approved this refined prototype on October 6.
Its occurrence-driven integration is now complete and preview publication is authorized.

## Task 1: Build and Review One Complete Prototype

**Files:**

- Prototype: the existing local `program-section-studies` artifact, outside production routes.
- Reference: `apps/site/src/pages/programs.astro`,
  `apps/site/src/components/programs/ProgramFeature.astro`, and `apps/site/src/styles/global.css`.

**Interfaces:** Consume the actual three program entries and shared site styling. Produce one
full-page prototype showing all three named programs and the transition into Ongoing work.

- [x] Build the proposed composition for all three programs together, including the text-only Social
      Club.
- [x] Capture an actual TransitMapper map view for the Labs visual; keep a record of the source.
- [x] Show the prototype with the real header, page opening, and existing lower-page sections.
- [x] Review at 1440 × 900, 1024 × 768, 768 × 1024, and 390 × 844.
- [x] Record each program's section height relative to the viewport. Inspect the composition at
      actual viewing scale, not just a reduced full-page screenshot.
- [x] Confirm the three sections have equal usable-viewport footprints at normal desktop text size,
      with shared identity, introduction, action, and media sizing rules.
- [ ] Scroll through the prototype using wheel or trackpad input and Page Down / Page Up. Verify
      snapping settles program starts below the header and permits leaving the sequence for Ongoing
      work.
- [ ] Verify reduced motion, stacked layouts, and keyboard focus work without forced snapping or
      clipping.
- [ ] Capture individual viewport screenshots for each program, plus one full-page desktop and
      mobile view.
- [ ] Review against the five conditions above and the user constraints. Revise this single
      composition coherently if it fails.
- [ ] Present the concrete prototype for design review before changing the production layout.

## Task 2: Integrate the Reviewed Composition

**Files:**

- Modify: `apps/site/src/components/programs/ProgramFeature.astro` — identity, introduction,
  navigation, media, and responsive section composition.
- Modify: `apps/site/src/pages/programs.astro` — section sequencing and transition to the existing
  lower-page content, page-scoped document snapping, and the directory's `mainClass` marker.
- Modify: `apps/site/src/content/programs/lvbt-labs.mdx` and `apps/site/public/programs/` only if
  the reviewed prototype replaces the Labs image.
- Update: `docs/reference/content-collections.md` and
  `docs/superpowers/specs/2026-09-30-named-programs-design.md` to match the reviewed directory
  behavior.

**Interfaces:** Retain the program collection and `paths.program(program.id)`. The shared directory
component also receives the series occurrences and onward destination. Calendar selection remains
shared with the detail panel; authored topics are optional occurrence metadata. No program-specific
layout selectors or viewport settings belong in content.

- [x] Implement the reviewed prototype in the shared directory component and page.
- [x] Verify all three directory links lead to their actual program pages; follow the Social Club
      RSVP to its LVBT event page.
- [x] Confirm zero directory image captions, unframed images, retained colophon attribution, and no
      new dividers or overlines.
- [x] Run `pnpm check` and confirm a successful exit.
- [ ] Repeat the four viewport reviews on the rendered site; include 200% text sizing and a short
      landscape viewport for clipping risk.
- [x] Repeat wheel/trackpad and keyboard scrolling. Confirm equal desktop section footprints,
      header-aligned snap positions, free access to the lower page, and the reduced-motion fallback.
- [x] Show desktop and mobile screenshots with the actual page context and individual program views.
      State any remaining visual or asset limitation explicitly.

## Approved integration, October 6

The user approved the refined Social Club feature after reviewing desktop and mobile screenshots.
Its topic uses a balanced 30-character measure, with actual date, time, venue, and a standard RSVP
button below. The topic belongs to the calendar occurrence, so it cannot linger when the next meetup
is selected. Missing topics use the selected date; missing occurrences use the recurring schedule
and Events calendar destination. The detail page keeps its basic attendance panel.

The approved composition is now integrated into the shared directory component and page-scoped
styles. All three focal areas share 8:5 proportions; the Labs screenshot shows the working map
without the welcome modal. The directory index retains accessible program names without floating
labels that can overlap images. The branch was rebased cleanly onto main before integration.

Local verification passed: `pnpm check` completed all 12 tasks, including 200 unit tests. The built
Worker passed 556 browser contract checks, with two existing conditional skips. The print attendance
regression was reproduced before repair and now passes; its printed destination follows the selected
occurrence. Directory links were followed to all three program pages, and RSVP reached the actual
October 15 LVBT event. Desktop image areas both measure 750.94 × 469.33px at 1440 × 900. At 1024 ×
600, every section expands to 545.22px and leaves 12px above its onward link. Mobile fragment
navigation now uses one header offset, placing the section at y=72px with the full RSVP visible.
Reduced motion disables snapping; Page Down leaves the sequence and Page Up returns to Labs.

The fresh whole-branch review found no other concrete correctness or maintainability issues. Preview
publication remains in progress.
