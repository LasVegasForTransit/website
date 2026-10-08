# Visual baseline review

The October 2026 tooling migration exposed stale macOS screenshots after the browser runner began
loading correctly. The Linux snapshots had already been updated with the merged website design. This
repair changes only macOS reference images; it does not change the design, screenshot policy, route
selection, or the 1% pixel-difference budget.

## Source and capture evidence

The reviewed application base is `eacbc6b17c4434a66be087f52172fa6ae4101ebc`. The homepage
participation layout was merged in `3426627`, named programs in `8c1d930`, and the press page in
`eb6ceed`. Linux references include the programs/header update `7b6527d` and press/footer update
`eb1df6e`. The macOS references still came from `63edeb2` and earlier homepage updates.

The fresh Linux seeding run
[37731375958](https://github.com/LasVegasForTransit/website/actions/runs/37731375958) used website
commit `cd6c2d4f3ff00724c424496b061d724e318eb337` and passed all 228 screenshot cases. Its artifact
`11529733933`, named `baselines-cd6c2d4f3ff00724c424496b061d724e318eb337`, contains exactly 38 PNGs
for each of the six device projects. All 228 downloaded files match the committed Linux references
byte for byte, so no Linux image needs replacement.

The independent comparison in
[Audit run 37731366088](https://github.com/LasVegasForTransit/website/actions/runs/37731366088), job
`113161375976`, also passed all 228 cases without updating snapshots or creating missing references.
The macOS references were captured from the same fresh English build configuration, including the
reviewed public URLs and preview-page setting, and then compared again without snapshot updates.

## Reviewed coverage

Every route below has both an initial viewport and a full-page reference in mobile portrait, mobile
landscape, tablet portrait, tablet landscape, desktop, and desktop XL:

- `/`, `/about/`, `/about/strategy/`, `/brand/`, and `/colophon/`
- `/campaigns/arts-district/`, `/contact/`, `/go/`, and `/join/`
- `/join/development-coordinator/`, `/letters/`, and the founder's April 23 letter
- `/press/`, `/programs/`, and `/programs/lvbt-labs/`
- `/projects/`, `/projects/2027-session-campaign/`, `/roadmap/`, and `/sitemap/`

The old and current images were reviewed against the merged source history. Differences include
homepage participation cards, named program cards, the Press footer link, current membership copy,
and the compact contact layout. Portrait, landscape, tablet, and desktop captures retain usable
headings, navigation, cards, and calls to action. The press reference shows the existing unavailable
coverage fallback; a screenshot does not establish live Notion integration readiness.

A separate fresh browser run passed 636 UI checks with two expected skips. These checks retain
color, typography, links, header, campaign, and program behavior coverage. The browser correction
also exposed a real Programs navigation failure under the existing strict CSP: small JavaScript
modules are now external, and the actual navigation regression passes. That functional fix was
reviewed separately before capturing these references.

No masks, routes, device projects, or quality thresholds were relaxed. Events and newsletter pages
retain their existing exclusion for external content; campaign screenshots retain their fixed
reference clock. Future calendar changes can still alter program cards and require a reviewed
reference update rather than an automatic acceptance of new pixels.
