# Review and promote a website release

Use the permanent preview site to review changes, then publish a selected saved release. A merge
into `main` updates staging and leaves the public website on its last promoted release.

## Check locally

Use the pinned Node and pnpm versions, then run:

```sh
pnpm bootstrap
pnpm check
```

For interactive local inspection, run `pnpm -C apps/site worker:dev`. Local requests use local
storage. Missing integration secrets intentionally return `503 service_unavailable`.

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
PR's uploaded version; it does not move the permanent preview site. Fork PRs receive no deployment
secrets.

Inspect phone and desktop layouts, navigation, nested routes, event calendars, and the branded 404
page. Use test data for preview APIs. Browser contract checks run automatically through Access.
Visual and accessibility audits also remain available through the ordinary audit workflow.

## Review staging

After `Deploy staging` succeeds, open [the preview site](https://preview.lasvegasfortransit.org).
Record the commit and release ID from its Actions summary. `/lvbt-release.json` shows which release
the domain currently serves; record its originating Actions run ID for promotion.

A new main build can replace this domain while review is ongoing. Review the version URL recorded in
that run's upload step when you need to return to the selected build.

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
