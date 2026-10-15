# Review and promote a website release

Use the permanent preview site to review changes, then publish a selected saved release. A merge
into `main` updates staging and leaves the public website on its last promoted release.

## Check locally

Use the pinned Node and pnpm versions, then run:

```sh
pnpm bootstrap
pnpm -C apps/site test:install
pnpm check
```

For interactive local inspection, run `pnpm -C apps/site worker:dev`. Local requests use local
storage. Missing integration secrets intentionally return `503 service_unavailable`.

`pnpm check` runs the exhaustive `ui-contracts` browser project against its own local compiled
Worker. It overrides any remote `PLAYWRIGHT_BASE_URL`; a local check never traverses protected
staging. To repeat just those contracts after a build, run `pnpm -C apps/site test:ui-contracts`.

## Configure protected staging

1. Open the `lvbt-website-preview` Worker in Cloudflare, then **Access**.
2. Configure Worker-specific protection with scope **All traffic** and the existing LVBT staff
   Access policy. Do not enable an account-wide policy.
3. Create a dedicated preview verification service token. Add a **Service Auth** policy including
   that exact token, and attach it to this Worker alongside the staff policy.
4. Save its client ID and secret in the website repository's `worker-preview` GitHub environment as
   `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. Use secret input prompts; never place
   credentials in command arguments, documentation, or release artifacts.
5. Confirm the existing `CLOUDFLARE_WORKERS_API_TOKEN` environment secret and repository-level
   `CLOUDFLARE_ACCOUNT_ID` variable are present.
6. After Access is configured, attach `preview.lasvegasfortransit.org` as a custom domain of
   `lvbt-website-preview`. The matching configuration is in `apps/site/wrangler.jsonc`.

Anonymous requests must reach Access rather than the website. Staff should see the site after
signing in. Automation uses the service token; it does not require an interactive browser login.
Preview integrations use separate test credentials and the preview database.

## Review a pull request

Open the Worker URL in the pull request comment and sign in through Access. The URL represents that
PR's uploaded version after the separate trusted `Publish Worker preview` workflow finishes. The PR
build receives no deployment credentials; the publisher uses only configuration and acceptance tools
from `main`. It does not move the permanent preview site. Fork PRs receive no deployment secrets.

Inspect phone and desktop layouts, navigation, nested routes, event calendars, and the branded 404
page. Use test data for preview APIs. A representative browser check runs automatically through
Access. Visual and accessibility audits also remain available through the ordinary audit workflow.

## Review staging

After `Deploy staging` succeeds, open [the preview site](https://preview.lasvegasfortransit.org).
Record the commit and release ID from its Actions summary. `/lvbt-release.json` shows which release
the domain currently serves; record its originating Actions run ID for promotion.

A new main build can replace this domain while review is ongoing. Review the version URL recorded in
that run's upload step when you need to return to the selected build.

Publication verification has fixed request allowances: 20 for candidate smoke, 64 for the
representative browser test, and 32 for activated-origin smoke, totaling at most 116. Pull request
publication omits activation, so its maximum is 84. The production workflow has four additional
fixed precondition reads, giving a maximum of 120; `pnpm promote` adds one completion-marker read
outside that workflow. Provider administration API calls are separate from Worker requests.

The representative test checks the marker, loaded styles/scripts/fonts/images, mobile navigation, a
nested page and the branded missing-page response. Test and network retries are disabled. Candidate
smoke reads the marker once. Activated smoke allows at most five explicit marker reads over 20
seconds, included in its 32-request allowance. Every browser resource and direct HTTP check uses the
same counter for its stage. Unexpected browser redirects stop before another request.

The required artifact-validation job downloads the single saved main or PR release and checks its
identity and file hashes. It runs exhaustive local contracts against a byte-identical disposable
copy of the packaged Worker, preview configuration and retained pages, then verifies both copies are
unchanged. Main attestation waits for this check; the trusted PR publisher requires the entire PR
build workflow to pass. This final gate rebuilds and repackages nothing.

If acceptance reports an exceeded request ceiling, inspect the request counts in its Actions log
(also saved as `hosted-request-budget` in the local browser report). Download and extract the
selected retained release, then start its Worker in one terminal:

```sh
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false pnpm -C apps/site exec wrangler dev \
  --config /absolute/path/to/retained-release/wrangler.jsonc --env preview --local --no-bundle --port 8787
```

Replace the example absolute path with the extracted release directory. In another terminal, run:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8787 pnpm -C apps/site test:e2e --project=hosted-acceptance
```

This uses local bindings and sends no acceptance traffic to Cloudflare. Stop the local Worker with
Ctrl-C when finished. Fix the unexpected requests or broken asset; do not increase retries or weaken
Access, cache protection or indexing protection. An exhausted shared Workers request allowance can
also block the staff portal. Stop hosted checks until the allowance resets or the account's capacity
is deliberately changed, then rerun only the failed publication job. Do not rebuild an already
retained release or dispatch repeated publication attempts. If activation already happened, inspect
the publication receipt and current marker before retrying; see the
[production publication reference](../reference/deployment-pipeline.md#production-promotion).

## Publish the reviewed release

1. Open **Actions → Promote website release → Run workflow** in the website repository.
2. Select the `main` branch.
3. Enter the successful **Deploy staging Actions run ID** you reviewed.
4. Run the workflow and satisfy any GitHub environment approval required by the repository.

The workflow rejects invalid source runs, downloads the saved artifact, verifies every file, uploads
a candidate with production bindings, and runs browser checks. It activates the candidate's exact
version ID only after those checks pass. It does not rebuild or promote preview data.

After success, verify [the public site](https://lasvegasfortransit.org), a nested page, an event
calendar, and the `www` redirect. Check `/lvbt-release.json` against the selected release and the
recorded production version in the workflow summary.

## Refresh calendar content or roll back

For a calendar correction, run **Deploy staging**, review the refreshed events, then promote its
run. Scheduled calendar refreshes also stop at staging.

To republish an older release, select its successful staging run while its artifact is retained. For
urgent recovery using a recorded Worker version, follow the
[rollback reference](../reference/deployment-pipeline.md#rollback). Never rebuild an expired
artifact and treat the new output as the previously reviewed release.
