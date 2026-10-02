# Website staging and release promotion

## Purpose

Give maintainers a persistent, protected website at `preview.lasvegasfortransit.org` and an explicit
way to publish the release they reviewed to `lasvegasfortransit.org`.

## Release contract

- Successful builds of `main` update staging after repository validation.
- Each release records its commit, originating Actions run, file inventory, and SHA-256 digest.
- Store the production-shaped static assets and compiled Worker together. Promotion verifies and
  reuses those files, even after a newer release updates staging.
- Staging uses the existing preview database and Cloudflare Access. Production uses its own database
  and secrets. Test data and Access settings never travel with the release.
- Suppress analytics and indexing through staging runtime settings, keeping release files identical.
- Production deployment requires an explicit Actions dispatch naming a successful staging run.
- Validate the production candidate before activating its exact Worker version; verify afterward.
- PR previews continue independently. Automated HTTP and browser checks authenticate only to their
  intended preview origin, never forwarding Access credentials to external links or redirects.
- Existing production rollback remains available. Database migrations require separate review.

## Delivery boundaries

Configure Access before exposing staging. Reuse the organization's existing identity provider and
reviewer policy where available. Keep service credentials out of source, artifacts, and logs.

## Acceptance

Tests reject modified or incomplete artifacts, unsafe paths, untrusted workflow runs, and unpinned
promotion. Live staging denies anonymous access and serves the recorded release to authorized
reviewers and automated checks. Production remains public and changes only through explicit
promotion. The approved production version is recorded for verification and rollback.
