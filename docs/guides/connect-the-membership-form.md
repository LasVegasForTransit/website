# Connect the membership form to the intake pipeline

The membership Google Form feeds new members into Beehiiv and Notion through a
small Apps Script attached to the form (Apps Script is Google's built-in
JavaScript automation; see [glossary](../reference/glossary.md#apps-script)).
This guide wires that script up. Do it once per form, or again if the form is
recreated. How the rest of the pipeline works, and what to do when a
submission fails, is in
[membership-intake.md](../reference/membership-intake.md).

> **Before you start.** You need edit access to the form and the value of
> `LVBT_MEMBERSHIP_INTAKE_SECRET` from whoever set up the Cloudflare Pages
> secrets (or run `pnpm bootstrap --phase env`, which mints and echoes it).

---

1. Open the membership Google Form. In its settings, confirm **Collect email addresses** is on — the email is read via `getRespondentEmail()`, not a form question, so without this the pipeline has no email to subscribe.
2. Open Extensions → Apps Script.
3. Paste [`scripts/google-apps/membership-intake.gs`](../../scripts/google-apps/membership-intake.gs) into the Apps Script editor and **save** (Cmd/Ctrl+S). The trigger setup below only lists functions from _saved_ code.
4. Edit `FIELD_TITLES` so the values exactly match the form's question titles. The defaults match the current "Membership Sign-Up" form: name is `What is your preferred name?` and discord is `What's your Discord username?`. (Email is not listed here — it comes from the collected-email setting above.)
5. In Apps Script, open Project Settings → Script properties and set:

   | Property                        | Value                                                  |
   | ------------------------------- | ------------------------------------------------------ |
   | `LVBT_MEMBERSHIP_INTAKE_URL`    | `https://lasvegasfortransit.org/api/membership-intake` |
   | `LVBT_MEMBERSHIP_INTAKE_SECRET` | same value as the Cloudflare Pages secret              |

6. Open **Triggers** (clock icon) → **Add Trigger** and set:

   | Field                              | Value                                                                     |
   | ---------------------------------- | ------------------------------------------------------------------------- |
   | Choose which function to run       | `onMembershipFormSubmit`                                                  |
   | Choose which deployment should run | **Head** — runs your latest saved code; no published deployment is needed |
   | Select event source                | **From form**                                                             |
   | Select event type                  | **On form submit** — the dialog defaults to "On open", so change it       |
   | Failure notification settings      | **Notify me immediately**, so a broken submission surfaces fast           |

7. **Save**, then authorize when prompted — review the scopes (external request + forms access) and allow.

> If "Choose which function to run" is empty and Apps Script says it "cannot create a trigger without a target function," the script wasn't saved — save it in the editor (step 3) and reopen the dialog.

> Use this installable trigger, not a _simple_ trigger (a function named `onFormSubmit`). The script makes an external request and reads the respondent's email — actions a simple trigger isn't authorized to do, so it would silently fail.

If the endpoint returns a non-2xx response, the script throws. Apps Script records the failed execution and sends the trigger owner the standard failure email.

## Check it works

Submit a test response from the live form, then confirm in **Executions**
(the list icon in the Apps Script sidebar) that `onMembershipFormSubmit`
completed. A failed execution shows the endpoint's status and body; the
[recovery section](../reference/membership-intake.md#failure-handling-and-recovery)
of the reference explains what each one means.
