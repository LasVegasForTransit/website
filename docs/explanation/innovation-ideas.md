# Innovation ideas registry

A living list of media, tools, and content formats LVBT could publish. Captured during the comms strategy brainstorm; reference when planning new work.

This file is a memory aid, not a roadmap. Don't delete entries — promote/demote as priorities shift.

**Status legend:**

- 🎯 **Pillar** — committed strategic direction; URL slot reserved in v0. See [comms-strategy.md](./comms-strategy.md).
- 📋 **Planned** — credible build target, post-v0
- 💭 **Considered** — worth doing eventually; no commitment yet
- ❄️ **Deferred** — not now; might never; flagged for revisit

## Personalized civic engagement tools 🎯 (pillar 2 — `/tools/`)

Most advocacy CTAs are generic. LVBT's are personal — they know your address, commute, and reps. This is the most distinctive angle vs. typical advocacy orgs.

- 📋 **Find-your-reps + take action** — ZIP → RTC (Regional Transportation Commission of Southern Nevada, the agency that runs Las Vegas's buses — see [glossary](../reference/glossary.md#rtc)) board rep, county commissioner, state legislator + current transit voting record + pre-drafted email/call template. First tool to build. Becomes the anchor for every newsletter CTA.
- 💭 **Comment-period mobilizer** — when NDOT (the Nevada Department of Transportation, the state's road and highway agency), RTC, or the county opens public input, drafts a personalized comment from the user's stance and submits it.
- 💭 **Route-impact calculator** — input home + work → see your commute today vs. post-route-cut scenario. Personal stakes via personalization.
- 💭 **"Build your transit budget" simulator** — slider/allocation tool. See what $X M does for routes/frequency/coverage. Educational and persuasive.
- 💭 **Commute time compare** — your trip by car vs. transit, today and 10 years from now if X happens. Visceral.
- 💭 **RTC meeting tracker** — upcoming agenda items, past votes, calendar export, comment-period alerts, reminder signup.
- 💭 **Petition / pledge tools** — built into the site; one-click sign; share back to social.
- ❄️ **AI-assisted civic engagement** — LLM-powered "help me write to my council member about the RTC funding bill" generator, grounded in LVBT's fact sheets, with transparency about what's auto vs. manually edited. (An LLM, or large language model, is the kind of AI behind tools like ChatGPT.) Risks if it goes wrong — **hallucination** (the model confidently states facts that aren't true) and **misrepresentation** (it puts words in a constituent's mouth or distorts LVBT's position); revisit when grounding/citation tooling is more mature.

## Public data infrastructure 🎯 (pillar 3 — `/data/`)

Build the dashboards and data access RTC should have built. Become the citation reflex for journalists. Open-source so other small-city advocates can fork.

- 📋 **Live RTC ridership dashboard** — updated nightly via Cloudflare Worker cron pulling GTFS (General Transit Feed Specification, the standard format agencies publish routes and schedules in — see [glossary](../reference/glossary.md#gtfs)) / RTC public data into D1. First dashboard to build.
- 💭 **On-time performance tracker** — by route, by stop, with historical trend.
- 💭 **Funding visualizer** — where transit dollars come from (federal, state, local, fares), where they go. Comparison to highway spending.
- 💭 **Scorecards** — RTC board members, state legislators, council members, with voting records on transit. Updated regularly.
- 💭 **GTFS data exposure** — for researchers, civic tech enthusiasts, journalists. Make our cleaned/normalized version queryable.
- 💭 **Synthesis-of-journalism page** — everything published about Vegas transit this month, summarized. Sticky resource for journalists and decision-makers.

## Data journalism / scrollytelling 🎯 (pillar 1 — `/explainers/`)

Pudding-style narrative explainers. Define LVBT's editorial voice. Big-bang shareable; press magnets; canonical explainer pieces journalists cite.

- 📋 **"The Valley We Could Build"** — first piece, defines the editorial voice. Paint urgency for the LVBT vision; show how transformative real transit could be for the region. Story arc: Valley today (sprawl, transit-dependence) → the threat (42% RTC route cuts looming without 2027 NV funding action) → what we lose → what's possible (Maryland Pkwy BRT, Charleston LRT, Brightline West, valley-wide network) → comparisons (Phoenix, Denver, Portland transformation timelines) → the ask.
- 💭 **"Where Nevada transit dollars actually go"** — funding flow explainer. Federal vs. state vs. local; transit vs. highway; what the 2027 session could change.
- 💭 **"Why Las Vegas became car-dependent (and how it could change)"** — historical narrative. Postwar planning, casino lobby, federal highway dollars; comparison to peer Sun Belt metros that pivoted.
- 💭 **Time-lapse / before-after scenarios** — what 10 more BRT corridors does for valley access; coverage maps over time.
- 💭 **Interactive transit map of the valley** — current network, planned BRT, proposed light rail, ridership heatmap, demographic transit-dependence layers. Toggle-driven exploration.

## Multimedia

- 💭 **Audio essays / mini-podcast** — "10-minute deep-dive" format. Listenable on commutes. Distinct from text.
- 💭 **Photo essays** — riders' stories, corridor before/after, RTC meeting documentation.
- 💭 **Short visual videos for Bluesky/IG** — commute portraits, route walkthroughs, council member soundbites. Drives social → site → newsletter conversion.

## Community / participatory

- 💭 **Reader-submitted "Transit diaries"** — riders' commute logs, hardships, why they care. Curated and published as a series.
- 💭 **Annotated maps** — "tell us where transit fails you" — user submissions on a public map. Crowdsourced ground truth.
- 💭 **Op-ed templates** — supporters can adapt and submit to the Sun, R-J, etc. Pre-written, cite-ready.

## Movement infrastructure (long-term)

- ❄️ **Open-source the toolkit** — package the route impact calculator, comment mobilizer, scorecard scaffold, dashboard for transit advocates in Phoenix, OKC, Sacramento, Tampa. Network effect for the broader movement; LVBT becomes the standard-bearer brand. Quietly the most powerful long-term lever. Revisit once 1–2 of LVBT's own tools are stable.

## Reference / canonical content (always-on, table stakes)

Not "innovation" — listed for completeness so future planning doesn't reinvent the baseline.

- Project pages: Maryland Pkwy BRT, Charleston LRT, Brightline West, RTC funding fight (2027 session)
- About / Mission / Vision / Board / Get involved / Press kit
- Fact sheets and glossary (Transit 101)
- Privacy policy

## How to use this file

- **Adding ideas:** add to the appropriate category with status `💭 Considered`. Brief description; one sentence on why it'd matter.
- **Promoting:** when a 💭 becomes a credible build target, change to `📋 Planned` and add detail (effort estimate, dependencies).
- **Picking a build target:** pull from `📋 Planned`; demote `💭` items only if they're concretely overruled.
- **Don't delete.** Even ❄️ Deferred items stay — future contributors should see what was considered and why.

## Related

- [Comms strategy](./comms-strategy.md) — pillar framing and surface model
