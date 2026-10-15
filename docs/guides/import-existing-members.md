# Import existing member records

This guide brings LVBT's existing newsletter roll and membership form responses into the staff
portal. Use it for the initial import or to resume an interrupted import without creating duplicate
records.

## Before you start

You need a maintainer checkout, the president's approval for the target environment, and a current
[verified database backup](./back-up-membership-database.md). Apply the reviewed database migrations
through the [protected preview setup](./set-up-staff-preview.md) before using the new importer. Keep
provider jobs disabled during the first preview rehearsal. Production is a separate operation: the
president reviews its dry run before any production import.

Use an owner-only folder outside the repository on an encrypted disk. The original exports and
normalized input contain personal information. Never add them to Git, a public build artifact, an
issue description, or a shared terminal transcript. Set the folder permissions to `700` and files to
`600`; record who owns the copies and when they must be deleted in the private import record.

The importer uses the existing `CLOUDFLARE_API_TOKEN` environment variable. A dry run needs D1 Read
for the chosen database; applying needs authorized D1 Write. A read-only deployment key cannot apply
an import. Do not expand its permissions or create a replacement key as an incidental setup step.
Read the database identifier from the reviewed environment configuration and confirm the environment
name in Cloudflare before running any command. Never paste a credential into a command or report.

## Authorize one-time database access

Use an existing approved credential when available. Otherwise, prepare the following change and have
the maintainer authorize the exact account, permission, expiry and private destination before
creating a token:

1. In the signed-in LVBT Cloudflare profile, open **API Tokens → Create Token → Get started** under
   the custom-token option. Give the token a purpose and environment name; record its exact name
   privately so it can be revoked later.
2. Add only **Account → D1 → Read** for a dry run, or **Account → D1 → Edit** for an apply. Under
   account resources, choose **Include → only the LVBT account**. This is account-wide D1 access,
   including production databases; a preview-only operating instruction does not narrow the token's
   technical permissions.
3. Set **TTL Start** and **End**, checking the displayed time zone and choosing a short approved
   window. Select **Apply**, review the complete summary, and select **Create** only after the
   maintainer authorizes it. If the requested scope or expiry is unavailable, stop and revise the
   request instead of granting broader access.
4. Save the one-time secret directly into an owner-only environment file in the private import
   folder, with a single `CLOUDFLARE_API_TOKEN` assignment. Use a trusted local editor or the
   approved direct secret-transfer tool. Never put the value in chat, Git, command arguments or a
   shared log. Load that trusted file in the operator's shell using the commands below.
5. After the approved import and repeat verification, revoke the token by its exact recorded name in
   **API Tokens**. Remove the private credential file and unset `CLOUDFLARE_API_TOKEN` in the
   operator shell. Keep only the non-secret outcome in the private import record.

```sh
chmod 600 /private/lvbt-import/database.env
set -a
. /private/lvbt-import/database.env
set +a
```

The containing directory must remain owner-only. Check the file and directory permissions without
printing its contents. Repeat the dry run with the exact reviewed target after any credential
change.

## 1. Save complete original sources

When the existing provider credentials are available, export every Beehiiv status and every Notion
intake page, including paginated answer blocks:

```sh
pnpm --filter @lasvegasfortransit/site roster:export --directory /private/lvbt-import
```

The command reads `LVBT_BEEHIIV_API_KEY`, `LVBT_BEEHIIV_PUBLICATION_ID`, `LVBT_NOTION_API_KEY`, and
`LVBT_NOTION_DATA_SOURCE_ID` from the process environment. Use the site's existing credentials
through the approved secret-handling process. It creates `sources-original.json` privately and
refuses to overwrite an existing file. It does not change subscribers or Notion pages. A failed
cursor, repeated identifier, or provider error aborts the export; fix access or retry the entire
export before continuing.

If these keys are unavailable, use the existing signed-in LVBT browser. In Beehiiv, select the LVBT
publication, **Settings → Export data → Export all subscribers** (the full version). Download the
completed export. Include active, pending and inactive records, and preserve the original file.

In Notion, select the **Las Vegans for Better Transit** workspace, then **LVBT Team → Membership
Committee → Membership intake**. Check that the Default view has no filters. Open the top-right
**Actions → More → Export** menu. Choose **Markdown & CSV**, **Database views: Default view**,
**Page content: Everything**, **Include subpages**, and **Create folders for subpages**. Preserve
the ZIP file before extracting it. Confirm that the CSV row count matches the number of Markdown
response pages. Keep duplicate emails and apparent test records for explicit review.

For responses that link to an original Google response sheet, retain its native CSV and spreadsheet
metadata. In the linked spreadsheet, choose **File → Download → Comma-separated values** for the
original response tab. Read its time zone from **File → Settings → General**, or use the connected
Sheets metadata reader. Keep the native CSV unchanged and record the observed zone in a private JSON
file with this structure: `{"properties":{"timeZone":"America/Los_Angeles"}}`. Use that value only
when the actual sheet shows it; record another zone honestly and leave unsupported timing
unresolved. The sheet's documented time zone and original seconds can establish a precise submission
time. A date displayed in Notion at minute precision cannot supply missing seconds. Do not guess a
time zone, round a date, or treat a subscription's creation date as an affirmative choice.

Save the actual time you observed the Beehiiv export in the private source record. Reuse that same
observation time when normalizing the same export; it is different from a historical signup date.

## 2. Normalize without changing the originals

For an API export:

```sh
pnpm --filter @lasvegasfortransit/site roster:normalize \
  --sources-json /private/lvbt-import/sources-original.json \
  --output /private/lvbt-import/roster.json
```

For native exports, supply their exact paths and the saved observation time:

```sh
pnpm --filter @lasvegasfortransit/site roster:normalize \
  --beehiiv /private/lvbt-import/beehiiv-original.csv \
  --notion /private/lvbt-import/notion-original.csv \
  --pages /private/lvbt-import/notion-original \
  --google /private/lvbt-import/google-form-responses-original.csv \
  --google-metadata /private/lvbt-import/google-form-source-metadata.json \
  --observed-at 2026-01-01T12:00:00.000Z \
  --output /private/lvbt-import/roster.json
```

The observation time above is an example: replace it with the actual saved time. Omit both Google
arguments when no original sheet is available. Its absence leaves historical consent unresolved. The
normalizer preserves original identifiers and source values, refuses incomplete or ambiguous page
mappings, and never splits a full name into guessed first and last names. Discord names from forms
remain unverified response text, not connected Discord accounts.

Current active Beehiiv subscribers belong to LVBT's authoritative membership roll. This evidence is
stored separately from historical consent. It can establish current membership without inventing an
original signup date, answer, confirmation method, wording, or `member_since`. An existing opt-out,
pending withdrawal, or ambiguous identity remains held for review. The import does not resubscribe
anyone or send provider messages. Pending and inactive statuses do not become members by assumption.

Only an actual affirmative form answer and its original precise time create historical newsletter
consent. Preserve the exact wording and answer; use `unknown` when the original confirmation method
is unavailable. A newsletter answer alone does not establish a separate LVBT joining affirmation.
Form activity retains its available time precision. Missing fields remain empty.

## 3. Review a database-aware dry run

Run against preview first, using the reviewed account and database identifiers:

```sh
pnpm --filter @lasvegasfortransit/site roster:import \
  --input /private/lvbt-import/roster.json \
  --account <cloudflare-account-id> --database <preview-database-id> \
  --plan /private/lvbt-import/preview-plan.json
```

This reads the actual database into memory, including matching and replay state, then runs the same
person-service import on an isolated copy. It writes nothing to the target database. It saves an
owner-only plan containing counts and fingerprints, without names or email addresses. The terminal
report has this shape:

```text
Import report (dry run: yes)
Beehiiv subscriptions read: 0
Notion intake rows read: 0
People created: 0
Linked to existing people: 0
Review queue items created: 0
Consent records created: 0 (double opt-in: 0, unknown method: 0)
Current roll observations recorded: 0
Members recognized from the current roll: 0
Skipped (already imported): 0
Errors: 0
```

Errors list only the source, record identifier and reason. Held rows are retained for staff review;
their appearance in the report does not mean they were discarded. Compare the source totals with the
original exports. Review identity matches, recorded membership, unknown history and held choices.
The older `roster:preview --input ...` command is a file diagnostic; it does not inspect database
matches and cannot authorize an apply.

## 4. Apply only the reviewed plan

After approval, run the same command with `--apply`, using the authorized write credential and the
same input, target and plan. The command reruns the dry run and refuses to apply if the input,
matching database state, target or predicted report changed. Generate and review a new plan when it
refuses; never edit a plan to bypass this check.

Compare the actual report with the approved counts. Open **Members → Signups to check** for held
source evidence. When an original source email matches an unverified member record, the source stays
unlinked and no second profile is created. Compare the displayed original signup with the suggested
person, then select **This is the same person** only after confirming the match. This attaches the
source; it does not invent missing consent or alter mailing choices. Use the reviewed `--retry-held`
procedure below to apply its original history. A changed person or source requires another review.
Use **Check for duplicate members** when two existing profiles genuinely need review. Check real
member profiles and their original answers. Confirm current-roll members have no invented consent or
joining date. Keep the full report privately; record only a concise outcome in the task's comment or
update.

## 5. Verify repeats and recover safely

Create a new dry-run plan from the same unchanged input. Every previously handled record, including
held rows, should be skipped; no additional people, consent, activity or review entries should
appear. An interrupted apply may have completed earlier records. Preserve the input, obtain a fresh
plan, and resume through the same service. Do not delete records or run ad hoc SQL to make counts
agree.

After staff resolve an identity match or supply actual missing source evidence, prepare a fresh
reviewed input. To reconsider identical held evidence after a staff resolution, include
`--retry-held` in both its dry run and apply. This still uses current matching and choice guards; it
cannot invent missing answers or override an opt-out. Previously applied records stay skipped.

Personal evidence follows person erasure and retention. Unassigned evidence is cleared after 30
days. Member downloads omit unrelated acquisition metadata and internal source-sheet links; the
administrator's full export retains the bounded review evidence. Original provider exports are
separate private copies: honor their recorded owner, retention period and any deletion request there
too.

Repeat the backup, dry-run review and repeat verification separately for production. Preview results
alone do not authorize or prove a production import. If a provider permission, a source export or an
original answer is missing, keep that exact gap visible and leave the affected choice unresolved.
