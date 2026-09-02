# Key facts

These numbers anchor the home page, the vision, the why-now case, and the objection-rebuttal
reference. **Verify them before changing.** They're time-sensitive — they will drift.

Acronyms used below: **RTC** (Regional Transportation Commission of Southern Nevada — the agency
that runs Las Vegas's buses; see [glossary](../../development/reference/glossary.md#rtc)), **APTA**
(American Public Transportation Association, an industry group that publishes ridership rankings;
see [glossary](../../development/reference/glossary.md#apta)), **FTA** (Federal Transit
Administration, the U.S. agency that funds transit projects; see
[glossary](../../development/reference/glossary.md#fta)), and **BRT** (Bus Rapid Transit — faster
bus service with dedicated lanes and fewer stops; see
[glossary](../../development/reference/glossary.md#brt)).

Fact discipline matters because these figures appear on public-facing pages and in advocacy
materials: a single wrong number, repeated across files, undermines the case and is hard to chase
down later. So treat this table as the single source, verify against the cited source, and update
every place the fact appears (below) in the same change.

| Fact                                       | Value                            | Source                                            |
| ------------------------------------------ | -------------------------------- | ------------------------------------------------- |
| RTC of Southern Nevada annual bus trips    | ~57.9M                           | RTC ridership reports                             |
| RTC ranking among US bus systems           | 14th-busiest                     | APTA                                              |
| 2028 service cuts                          | ~42% / 15 routes                 | RTC's March 2026 letter to the Nevada Legislature |
| Maryland Parkway BRT total cost            | $378M                            | RTC                                               |
| Maryland Parkway BRT FTA grant             | $150M                            | FTA                                               |
| Maryland Parkway BRT stations              | 29                               | RTC                                               |
| Maryland Parkway BRT opening               | fall 2026                        | RTC                                               |
| Charleston Boulevard study corridor length | 17 miles                         | "Let's Go Charleston"                             |
| Charleston Boulevard daily transit trips   | 12,000+                          | "Let's Go Charleston"                             |
| Brightline West expected service           | 2029                             | Brightline West                                   |
| Las Vegas Valley population                | ~2.2–2.3M                        | US Census                                         |
| Nevada Legislature cadence                 | every two years (next: Feb 2027) | NV Constitution                                   |

## Where each fact appears

When you change a fact here, update every file below that mentions it:

- `src/pages/index.astro` (Home hero, "the reality" stats, "the cliff" quote,
  BRT/Charleston/Brightline cards)
- `src/content/docs/why-now.mdx`
- `src/content/docs/problems.mdx`
- `src/content/docs/vision.mdx`
- `docs/reference/transit-objection-rebuttals.md`

A change-log entry — a short note in your commit message saying which fact changed and to what, e.g.
"updated RTC ridership to FY26 figures" — helps future maintainers trace when and why a number
moved.
