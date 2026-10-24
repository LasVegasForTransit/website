# Staff authentication and gate screens

## Intent

Staff should recognize the same LVBT experience while signing in, confirming membership, setting up
initial access, or recovering from a refusal or outage. Each screen explains the current step and
offers a clear next action.

## Design

Use a compact, centered, left-aligned panel with the approved LVBT mark and Staff identity, warm
surfaces, an orange top rule, a single heading, and a quiet organization footer. Stack content
naturally on small screens and use the existing light and dark brand tokens. Google sign-in has a
recognizable Google mark and neutral treatment; subsequent form actions use LVBT's primary action
treatment. Account identity, notices, help, and recovery references each have a consistent
hierarchy. All controls have visible keyboard focus and 44-pixel targets.

## Approaches

The shared gate layout replaces both the full application shell on sign-in screens and the separate
centered recovery design. A split branded layout adds little value to these short flows. Styling
each route independently would allow the same inconsistencies to recur.

## Constraints

Preserve authentication, authorization, redirects, cookies, HTTP status codes, form contracts, and
privacy headers. Recovery pages must remain usable without scripts, database access, fonts, or image
requests. Keep the inline recovery style hash synchronized with the shared layout. Use ordinary HTML
forms and avoid animation or new dependencies.

## Acceptance

Review sign-in, errors, membership email and code entry, initial setup, refusals, missing pages, and
outages at mobile and desktop widths in both themes. Verify keyboard access, long addresses, native
form submission, private response headers, and self-contained recovery.
