const CONTENTS = `LVBT member records
Exported: {{exportedAt}}
Format: 2

Keep this download somewhere only authorized LVBT staff can open. It contains personal contact information. Delete extra copies when you finish using them.

FILES
people.csv: One row for each person who has not been deleted.
consent_records.csv: Each person's recorded permissions and withdrawals, including the evidence behind them.
identities.csv: Accounts connected to each person; a connection does not prove current access to another service.
engagement_events.csv: Recorded activity and corrections to earlier activity.
export.json: The same original values grouped by person, with consent_records, identities and engagement_events inside each entry in people.
README.txt: This guide to the files, columns and two ways to use the download.

All CSV files use UTF-8, comma separators, a header row and double-quoted cells. Times use ISO 8601 in UTC. Empty CSV cells can mean null or empty text; JSON preserves the distinction. The filename uses the date in Las Vegas.
Keep id, person_id, external_id, zip and census_block as text when importing. Automatic number conversion can remove leading zeros or round long account numbers. Text that could run as a spreadsheet formula has an added leading apostrophe in CSV; JSON preserves its original value.
Sign-in codes, sessions, OAuth state and credentials are excluded. Deleted people and their related records are excluded from every file.

PEOPLE COLUMNS
id: The permanent identifier used to match this person across files.
given_name: The person's first or given name.
family_name: The person's last or family name.
email: Their recorded email address, if known.
email_verified_at: When ownership of the email address was confirmed.
phone: Their recorded phone number, if known.
zip: Their five-digit ZIP code, stored as text.
census_block: Their fifteen-digit census block identifier, stored as text.
census_block_vintage: The census dataset used to identify that block.
place_name: Their recorded community or place name.
preferred_language: Their preferred language code, such as en.
membership_status: member, former_member or not_member, based on the recorded membership evidence.
membership_rules_version: The version of LVBT's membership definition used for the status.
region_id: The identifier of their assigned region, if any.
region_source: How their region was determined or chosen.
region_set_at: When the region was last assigned.
member_since: The start of their current unbroken newsletter subscription, when recorded.
created_at: When LVBT first created this record; this is not proof of when they joined.
updated_at: When the person record was last changed.

CONSENT COLUMNS
id: The permanent identifier of this consent record.
person_id: The matching id in people.csv.
scope: What permission was given, such as newsletter, event_reminders or volunteer_contact.
given_at: When the permission was originally given.
source: Where the permission was recorded, such as join_form, paper or beehiiv.
method: How it was confirmed, such as checkbox, double_opt_in, paper_signature or unknown.
wording_version: Which permission wording the person saw or signed.
withdrawn_at: The recorded withdrawal timestamp; check withdrawn_time_basis before comparing it with a signup.
withdrawn_source: Where the withdrawal was recorded.
withdrawn_time_basis: choice means the actual withdrawal time is known; observed means LVBT learned the inactive status then and the person's actual choice time is unknown.
created_at: When this evidence was added to LVBT's records.
updated_at: When this consent record was last changed.
origin_identity_id: The connected account that supplied imported consent evidence, if any.
import_run_id: The import that brought in this evidence, if any.

CONNECTED ACCOUNT COLUMNS
id: The permanent identifier of this account connection.
person_id: The matching id in people.csv.
platform: The service holding the account, such as discord or google_workspace.
external_id: The service's account identifier, kept as text.
external_email: The email address reported by that service, if available.
linked_at: When the account was connected to LVBT's person record.
link_method: How the connection was confirmed.
created_at: When the connection record was created.
updated_at: When the connection record was last changed.

ACTIVITY COLUMNS
id: The permanent identifier of this activity entry.
person_id: The matching id in people.csv.
type: What happened, such as subscribed, unsubscribed, attended or welcomed.
occurred_at: When it happened, which can be earlier than when it was recorded.
source: Where the activity was reported.
reference: Its source identifier, or the earlier entry being corrected.
details: Additional activity information encoded as JSON, if available.
created_at: When LVBT recorded the activity.

ADDITIONAL JSON RECORDS
Each person also has field_sources (where details came from), committee_assignments (their committee memberships), consent_withdrawals (recorded requests to withdraw), person_corrections (attributed corrections), discord_identity_profiles (confirmed account details) and discord_profiles (observed server details). Profile observations belong to the connected account identified by identity_record_id. Their original field names and values are preserved.
Format 2 groups related records inside people. Older format 1 downloads stored separate top-level arrays; migration software must check formatVersion before reading either format.

EXAMPLE 1: OPEN PEOPLE IN GOOGLE SHEETS
1. In a new private Google Sheet, choose File, Import, then Upload, and select people.csv from this download.
2. Import into a new sheet with comma as the separator. Turn off automatic conversion of text to numbers, dates and formulas so identifiers and ZIP codes remain text.
3. Confirm the first row contains column names, with one value beneath each heading. For example, Zoë García remains in the given_name and family_name columns with both accents intact.
4. Match another CSV to a person using person_id and id, rather than assuming the files have the same row order. Keep the original download until you finish checking the import, then remove copies you no longer need.

EXAMPLE 2: MOVE CONTACTS AND SUBSCRIPTIONS INTO A CRM
1. Map people.id to the CRM's external contact identifier, given_name and family_name to name fields, email to email, phone to phone, and zip to a text postal-code field. Keep membership_status and member_since in separate membership fields.
2. Match consent_records.person_id to that external contact identifier. Preserve scope, given_at, method, source, wording_version, withdrawn_at and withdrawn_time_basis as subscription evidence.
3. For example, a newsletter permission given on January 1 and withdrawn on May 1 with time basis choice maps to an unsubscribed newsletter contact. Importing the contact must not subscribe them again.
4. A separate, confirmed permission given on June 1 can establish a later subscription when the earlier withdrawal's actual time is known. If time basis is observed, do not assume the observation happened when the person chose to unsubscribe; hold a conflict with a recent signup for review. Preserve both records and their dates; a contact creation date or an unknown confirmation method is not proof of permission.
5. Hold missing or conflicting evidence for staff review. Do not guess a choice, substitute the import time, or send email until the person's preference is established.
`;

export function exportReadme(exportedAt: string): string {
  return CONTENTS.replace('{{exportedAt}}', exportedAt);
}
