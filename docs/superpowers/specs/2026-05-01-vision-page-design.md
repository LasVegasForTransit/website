---
title: /vision page redesign — content design
date: 2026-05-01
status: implemented · 2026-05-01
---

## Implementation outcome

Implemented as a custom Astro page. `src/pages/vision.astro` is a thin orchestrator (~52 lines) that
imports a page-level stylesheet at `src/styles/vision.css` and composes 16 section components from
`src/components/vision/sections/`:

| Order | Component           | §                                    | Band    |
| ----: | ------------------- | ------------------------------------ | ------- |
|     0 | `Frame.astro`       | Frame                                | cream   |
|     1 | `Walk.astro`        | Walk to milk.                        | cream   |
|     2 | `Bike.astro`        | The kid in the protected lane.       | cream   |
|     3 | `Frequency.astro`   | Twelve minutes.                      | ink     |
|     4 | `Region.astro`      | Vegas as a node…                     | ink     |
|     5 | `Strip.astro`       | The Strip is a rehearsal.            | cream   |
|     6 | `Maryland.astro`    | Maryland, after.                     | ink     |
|     7 | `PublicSpace.astro` | Beyond the living room.              | cream   |
|     8 | `Shrinks.astro`     | When the Valley shrinks.             | ink     |
|     9 | `Cost.astro`        | Twenty-four thousand a year.         | cream   |
|    10 | `Shift.astro`       | The shift change.                    | cream   |
|    11 | `Recreation.astro`  | We didn't move here for the traffic. | ink     |
|    12 | `Bowl.astro`        | Bowl country.                        | cream   |
|    13 | `Health.astro`      | What the doctors stop seeing.        | cream   |
|    14 | `Riders.astro`      | The dishwasher and the dean.         | ink     |
|    15 | `Close.astro`       | Close                                | primary |

Shared utility components in `src/components/vision/`:

- `SectionHead.astro` — heading pattern, supports `as: 'h1' | 'h2'` and
  `variant: 'section' | 'hero'`
- `PhotoPlaceholder.astro` — dashed-border placeholder, supports `variant: 'cream' | 'ink'`
- `VisionFigure.astro` — figure wrapper with label + slot + named caption slot

### Resolved open questions

1. **MDX vs custom Astro** — custom Astro page. The visual complexity (custom SVGs, banded sections,
   photo placeholders, varied per-section composition) is incompatible with `DocLayout`'s prose
   column.
2. **`vision.mdx` disposition** — left on disk under `src/content/docs/vision.mdx`, no longer
   routed. To rehome at `/vision/long` or fold into `/problems` and `/about` in a follow-up;
   non-destructive for now.
3. **Section count** — 14 + frame + close, as specified in v7 outline.
4. **Length** — ~3,800 words across the page.
5. **Structure** — five section shapes per the v2 mockup (Type A photo→prose→figure→prose; Type B
   figure-led; Type C photo+prose; Type D photo+prose+pullquote; Type E photo with explanatory long
   caption).

### Design-system additions

`src/styles/vision.css` (loaded via `import` in `vision.astro`) defines:

- `.container-narrow` (max 42rem, vision-page-scoped)
- `.section`, `.section-bordered` (padding rhythm + frame divider)
- `.band-cream`, `.band-ink`, `.band-primary` (band backgrounds + custom-property flips)
- `--vp-text`, `--vp-text-muted`, `--vp-text-subtle`, `--vp-prose`, `--vp-link`, `--vp-cite`,
  `--vp-rule` (band-flipping custom properties — eliminates per-section `.band-ink` overrides)
- `.section-heading`, `.hero-heading`, `.hero-lede`
- `.vision-prose`, `.vision-tail`, `.reader-note`, `.inline-highlight` (renamed from `.prose` and
  `.tail` to avoid future collision with `.prose-doc`)
- `.close-pointers`

### Reused existing utilities (post-simplify pass)

- `PullQuote.astro` (existing component) for § 14 instead of inline blockquote.
- Global `.container-page` class (existing) for full-width bands.
- `--color-ink`, `--color-paper`, `--color-primary`, `--color-primary-soft`, and
  `--color-on-surface-variant` color tokens.
- `text-display-lg` / `text-headline-*` token sizes via `clamp()` patterns.

### Skipped (after simplify-skill review)

- `.reveal` scroll animations on each section — UX cost on long-form content outweighs the
  consistency-with-homepage benefit.
- Coercing `num: string` → `number` in `VisionFigure` — cosmetic.
- Rebasing `.vision-prose` on `.prose-doc` — would change line-height and color tuning the vision
  page deliberately set.

### Verification

- `pnpm astro check` — 0 errors, 0 warnings, 0 hints (79 files).
- `pnpm build` — 1.00s, 15 pages generated, `/vision/index.html` (80 KB).
- Bundle: `dist/_astro/vision@_@astro.<hash>.css` contains both the global `.vision-page` design
  system and per-section scoped figure CSS (`[data-astro-cid-*]` selectors).
- Heading order: one `h1` (frame) followed by 14 `h2`s and a final `h2` for the close. Verified by
  section component prop discipline (`SectionHead` defaults to `h2`; only frame passes `as="h1"`).
- A11y: figures use `<figure>` + `<figcaption>`; meaningful SVGs have `role="img"` + `aria-label`;
  decorative SVGs (typology, archetypes) marked `aria-hidden="true"` with the visible text label
  carrying meaning. The Playwright + axe-core suite at `tests/a11y.spec.ts` will diff the page once
  snapshots are regenerated.
- Visual regression: existing committed snapshots under `tests/snapshots/*/vision-*.png` will fail
  on the next run (intentional). Run `pnpm test:update` after visual review.

### Follow-ups (deferred)

- Decide what to do with the orphaned `src/content/docs/vision.mdx` (rehome at `/vision/long`, fold
  into `/problems` and `/about`, or delete).
- Source or commission real photography to replace the 12 in-page placeholders.
- Consider promoting `--vp-*` band-flipping custom properties to `global.css` if `/problems`,
  `/why-now`, and `/strategy` adopt the same banded layout.
- Add the `pillars` and `acceptance-criteria` framing (from this spec's later sections) into the
  vision page itself, e.g. as an expandable summary in the frame or as a compact appendix block
  before the close.

---

# /vision page — design spec

## Context

Today `/vision` renders `src/content/docs/vision.mdx` through `DocLayout` — a single narrow prose
column, six themed sections of dense argumentative essay (cheaper / safer / healthier / connected /
economic / what others built). Read top-to-bottom, it reads as a position paper. Most sections are
framed as deficit-and-rebuttal: cars cost X, transit is cheaper; streets kill X, transit reduces it.

That framing belongs on `/problems`, not `/vision`. The page redesign reframes `/vision` as a
**reference for LVBT's end-game vision of the Las Vegas Valley** — what the won Valley actually
looks like as a place. The political moment, the obstacles, and the path live on sibling pages. This
page is the picture.

The redesign is also a content-density expansion. Previous mockup iterations (visual companion,
v1–v4) collapsed the page to ~250–450 words of impressionistic copy. That was wrong: the user's
brief is a comprehensive reference, not a marketing slab. Target ~2,500–3,500 words across 14
sections plus frame and close.

## Audience

Normal Las Vegans — drivers, parents, hospitality workers, students, retirees — most of whom have
never thought hard about transit or land use. The page must do real explanatory work:

- Define terms a non-expert wouldn't know (BRT, missing-middle housing, fixed-guideway transit,
  Vision Zero, mixed-use zoning).
- Frame stakes in everyday language (the household budget, the after-school kid, getting groceries,
  getting to Red Rock).
- Avoid advocacy-insider voice and stats-only argumentation.

The reader is not in the choir. The page is part of LVBT's **public education** mandate.

## Mission alignment

LVBT's mission is to _advocate for world-class public transportation and supportive land use
policies in the Las Vegas metropolitan area through public education, community outreach, and
coalition building._

Every section ties to one or more of:

- **Reliable, safe, efficient public transportation** (the transit half of the mission)
- **Supportive land use policies** (the land-use half)
- **Public good · serving residents and businesses alike** (the framing from the canonical vision
  text)
- **Public education** (the outreach arm of the mission — explanatory work)

## Boundaries — what lives where

| Page        | Job                                                                   |
| ----------- | --------------------------------------------------------------------- |
| `/vision`   | What the won Valley looks like. End state. (This page.)               |
| `/problems` | Why we don't have it yet — the obstacles.                             |
| `/why-now`  | Why this fight is urgent — 2027 session, 2028 cliff.                  |
| `/strategy` | How we get from here to there — coalition, advocacy, projects.        |
| `/projects` | What's already in motion — Maryland Pkwy BRT, Charleston, Brightline. |

The vision page does not lead with the 2027 legislative session, the 42% cliff, the $378M BRT spec,
or any other politically-anchored hook. Those are pointers in the close, at most.

## Frame

Open with the canonical vision text near-verbatim:

> _In short: our vision is a Las Vegas Valley where every resident has access to reliable, safe, and
> efficient public transportation that helps people get to work, enjoy recreation, and build
> community._

Second paragraph elaborates with the concrete pictures from the source vision:
groceries-without-driving, the after-school kid, the household budget, the daily injury crashes, the
hundred deaths a year, "not just for people who can't afford a car," the sustainable-oasis frame.

Third paragraph: a short reader's note. _This page is a reference for the Valley we're working
toward; why we don't have it yet lives on /problems, how we get there on /strategy, why now on
/why-now._

## Outline — fourteen sections

### Mobility — the modes

**1. A Valley you can walk.** Sidewalks that are continuous, shaded, wide enough for two strollers.
The 5-minute-walk neighborhood — corner store, school, transit stop, park within reach. The "drive a
quarter-mile to buy milk" picture, inverted. Walking as the first and last mile of every transit
trip and the whole trip for short errands.

**2. A Valley you can bike.** Protected lanes (concrete, not paint) on the major arterials and
side-street networks. E-bikes that work in 110°. Bike-share that lets a tourist or non-owner make a
real trip. Routes connecting neighborhoods, schools, transit, and recreation (Red Rock, Lake Mead).
Why infrastructure shapes who actually rides.

**3. A Valley with real public transit.** Frequent bus service (under 15-minute headways on core
routes, 24-hour service on Strip and major corridors). What BRT is and why it's the next step.
Eventual rail along corridors that justify it. Reliability as the foundation. Cars still in the
picture for trips that need them — vision is choice, not abolition.

**4. A Valley connected to its region.** Brightline West to Southern California. The
airport-to-Strip rail connection the casinos killed in the '90s, finally built. Future intercity
links — Phoenix, Reno, Salt Lake. Vegas as a node in a Western network, not an island.

### Place — the built environment

**5. Neighborhoods designed for living.** Mixed-use blocks: ground-floor shops, apartments above,
neighborhood schools, transit on the corner. Missing-middle housing legalized: duplexes, fourplexes,
courtyard apartments, ADUs. Polycentric metro: real town centers in Henderson, Summerlin, North LV,
downtown, around UNLV — not one Strip surrounded by cul-de-sacs. Infill over greenfield. _(Explain:
most of the Valley is single-family-only zoning by policy. Missing-middle is a recent term for an
old idea.)_

**6. Streets that don't kill or maim.** Arterials redesigned: narrower drive lanes, dedicated bus
lanes, protected bike lanes, frequent crosswalks, shaded sidewalks, posted speeds matched to
context. Vision Zero as a target, not a slogan. _(Explain: Clark County's arterials are 6–8 lanes
wide, designed for 45+ mph. That isn't normal. The size is the design choice making them lethal. Use
the canonical numbers: 100+ deaths a year, dozens of injury crashes a day, both as policy
outcomes.)_

**7. Public space and third places.** Parks, plazas, libraries, community centers, festivals — all
reachable on foot or by transit. Shaded streets that double as social space. Public realm worthy of
a 2.3M-resident metro.

### People — who the Valley serves

**8. Mobility for every age and ability.** The 14-year-old who gets home from after-school club
without a parent in the car. The 78-year-old who stopped driving and didn't lose her Valley. The
disabled rider with paratransit that actually works, plus level-boarding stations and real ADA
compliance. Kids and seniors as the canary on every transit decision: if it works for them, it works
for everyone.

**9. A Valley families can afford.** Household budget framing:
$12K+/year per car all-in; a two-car family runs $24K — a quarter of the median paycheck, most of it
leaving Nevada. The family that drops the second car keeps the rest. Housing affordability through
transit-adjacent supply: missing-middle near transit means rent that doesn't have to include parking
and a second car. _(Explain: people don't realize what cars actually cost because the costs are
spread across categories.)_

### Context — systems and frames

**10. An economy that runs on transit.** The Strip's hospitality workforce — tens of thousands —
getting to work reliably, year over year. Healthcare workers along BRT corridors. UNLV and CSN
students who don't need a car for a degree. Downtown employers who stop losing hires to parking.
Real estate value uplift along high-quality transit corridors. Tourism that doesn't end at the
Strip's edge.

**11. A Valley you can play in.** Recreation as a real use case, not an afterthought: Red Rock,
Mount Charleston, Lake Mead, Floyd Lamb Park, Springs Preserve, downtown's First Friday, sports
venues. Outdoor and cultural assets reachable without an SUV in Saturday traffic. Tourists arriving
by Brightline who can experience more than the Strip.

**12. A sustainable oasis in the desert.** Climate-fit infrastructure: shaded shelters, AC vehicles,
hydrogen and electric fleets, water-wise public space, lighter pavement. Basin geography
acknowledged: the Valley is a literal bowl in the Mojave; pollutants and heat get trapped. Hot
cities can run great transit — Phoenix, Salt Lake, Dubai prove it. Heat is a design constraint, not
a reason to give up.

**13. A healthier Valley.** Public health framing: air quality, ozone exceedance, particulate,
asthma rates. Physical activity baked into daily life through walking and biking. Traffic violence
as a public-health crisis we can solve. Mental-health benefits of the third places walkable
neighborhoods provide.

### Civic frame

**14. Transit as a normal part of Vegas life.** The cultural pivot — the canonical "not just for
people who can't afford a car" line as its own beat. A casino exec, a high-school teacher, and a
line cook on the same BRT car. A teenager whose first taste of independence is the bus, same as kids
in NYC, Chicago, SF. Tourism that uses RTC like locals because it's actually good. _(Explain: the
14th-busiest bus system in the country is already in the Valley; the stigma doesn't match the
ridership reality.)_

## Close

Three or four short pointers, no big CTA:

- _Why the Valley doesn't have this yet_ → `/problems`
- _How we get there_ → `/strategy`
- _What's already being built_ → `/projects`
- _Why it has to happen now_ → `/why-now`

Final line: _A sustainable oasis in the desert, made possible through public transportation._

## Voice & style

- **Editorial-essay register** at the section level. Each section opens with concrete imagery or a
  scene, then explanatory prose, then ties back to the section's claim.
- **No listicle scaffolding.** Section headings are sentences, not numbered pre-heading labels. The
  `§ 01 / § 02 / § 06` pattern from earlier iterations is dead.
- **Explain the technical vocabulary** (BRT, missing-middle housing, Vision Zero, fixed-guideway
  transit, mixed-use zoning) in the section that introduces it. Don't assume the reader knows.
- **Vary composition** across sections — don't templatize. Some sections lean on a paragraph or two;
  some include a short list of concrete pictures; some end on a tail line. No two sections should
  read the same shape.
- **Source-first.** Pull from the canonical vision text and existing repo docs (mission.mdx,
  problems.mdx, why-now.mdx, strategy.mdx) before inventing. Use the user's actual phrasing where it
  lands.
- **Ground-truth, not deficit.** Describe the won Valley, present-tense or near-future-present.
  Don't lead any section with what's broken today; that's `/problems`.
- **Don't recycle the same five stats.** $24K, 57.9M, 42%, $378M, 100 deaths — useful evidence, but
  each section needs its own substance, not a stat parade.

## Length budget

| Region              | Target                 |
| ------------------- | ---------------------- |
| Frame               | ~150–200 words         |
| Each of 14 sections | ~200–300 words         |
| Close               | ~50–80 words           |
| **Total**           | **~3,000–4,500 words** |

Closer to a Wikipedia-section length than to a marketing page. This is a reference.

## Open questions (defer to implementation)

1. Final cuts on the 14 sections — should missing-middle housing be split out from neighborhoods?
   Should "regional cooperation across municipalities" become a 15th section? Should public health
   fold back into climate?
2. Anything missing — faith communities, immigrant and language access,
   schools-as-civic-infrastructure, downtown culture, water and grid resilience.
3. Section order — current arc is mobility → place → people → context → civic. Alternative:
   people-first opens with seniors/kids/workers.
4. Frame paragraph tone — declarative manifesto vs. invitational scene-setting.
5. Whether `vision.mdx` is rewritten in place (preserving the route) or replaced by a custom
   `.astro` page (matching `/index.astro` rhythm). The existing MDX-through-DocLayout setup is fine
   for the editorial-essay register; only switch if visual treatment demands it.

## Process

This spec is the result of seven iterations across one session — a listicle (v1), a ground-truth
framing (v2), a narrative essay (v3), a depth-and-rigor pass (v4), a topic-decomposed outline
(v5/v6), and the reference-shaped 14-section structure (v7). The progression is recorded in the
visual-companion HTML files at `.superpowers/brainstorm/<session>/content/`.

## Next step

Writing-plans skill — turn this spec into an implementation plan that decides:

- Whether `/vision` stays MDX-through-DocLayout or becomes custom Astro
- Which existing components are reused (StatBlock, PullQuote, SectionHeader)
- Whether any new MDX components are needed (e.g., `<Section>` with a chapter-style heading)
- The migration path from the current `vision.mdx` to the new content
- The verification gates (a11y, SEO, link integrity, type checks)
