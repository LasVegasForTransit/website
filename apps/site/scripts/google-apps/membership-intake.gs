/**
 * Google Forms -> LVBT membership intake.
 *
 * Paste this into the Apps Script project bound to the membership Google Form.
 * Then set the script properties below and install `onMembershipFormSubmit`
 * as an installable "On form submit" trigger.
 *
 * Required script properties:
 * - LVBT_MEMBERSHIP_INTAKE_URL: https://lasvegasfortransit.org/api/membership-intake
 * - LVBT_MEMBERSHIP_INTAKE_SECRET: same value as the Cloudflare Pages secret
 */

// Email is NOT a question — the form collects it via "Collect email addresses",
// so it comes from getRespondentEmail(), not from these titles. These must match
// the form's question titles exactly.
const FIELD_TITLES = {
  name: 'What is your preferred name?',
  discord: "What's your Discord username?",
};

function onMembershipFormSubmit(event) {
  postFormResponse(event.response, intakeConfig());
}

/**
 * Replay every stored response through the endpoint. Run by hand from the
 * editor (select this function, press Run) after an outage — e.g. the
 * endpoint was returning 503 while a secret was missing — so the people who
 * submitted during it get subscribed and get their Notion intake page.
 *
 * Safe to run repeatedly: the endpoint sends no email when it adds someone,
 * Beehiiv treats an already-subscribed address as a no-op, and a response
 * that already has an intake page (matched by Response ID) is skipped rather
 * than duplicated. To limit the replay, call backfillIntakeSince with the
 * timestamp of the last response that went through.
 */
function backfillMembershipIntake() {
  backfillIntakeSince(null);
}

function backfillIntakeSince(after) {
  const config = intakeConfig();
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  FormApp.getActiveForm()
    .getResponses()
    .forEach(function (formResponse) {
      if (after && formResponse.getTimestamp() <= after) {
        skipped += 1;
        return;
      }
      const label =
        formResponse.getTimestamp().toISOString() + ' ' + formResponse.getRespondentEmail();
      try {
        postFormResponse(formResponse, config);
        ok += 1;
        console.log('ok       ' + label);
      } catch (err) {
        failed += 1;
        console.error('failed   ' + label + ' — ' + err.message);
      }
    });

  console.log('Backfill done: ' + ok + ' ok, ' + skipped + ' skipped, ' + failed + ' failed');
}

// Everything that is the same for every response: script properties plus the
// form-level values, read once rather than per submission.
function intakeConfig() {
  const properties = PropertiesService.getScriptProperties();
  const intakeUrl = properties.getProperty('LVBT_MEMBERSHIP_INTAKE_URL');
  const intakeSecret = properties.getProperty('LVBT_MEMBERSHIP_INTAKE_SECRET');

  const missingProperties = [];
  if (!intakeUrl) missingProperties.push('LVBT_MEMBERSHIP_INTAKE_URL');
  if (!intakeSecret) missingProperties.push('LVBT_MEMBERSHIP_INTAKE_SECRET');
  if (missingProperties.length > 0) {
    const message =
      'Missing LVBT membership intake Apps Script property(ies): ' +
      missingProperties.join(', ') +
      '. Set them in Project Settings → Script properties.';
    console.error(message);
    throw new Error(message);
  }

  const form = FormApp.getActiveForm();
  return {
    intakeUrl: intakeUrl,
    intakeSecret: intakeSecret,
    sourceForm: form.getTitle(),
    rawResponseUrl: spreadsheetUrl(form),
  };
}

function postFormResponse(formResponse, config) {
  const answers = answersByQuestionTitle(formResponse);
  const payload = {
    email: String(formResponse.getRespondentEmail() || '').trim(),
    name: stringAnswer(answers, FIELD_TITLES.name),
    discord: stringAnswer(answers, FIELD_TITLES.discord),
    sourceForm: config.sourceForm,
    submittedAt: formResponse.getTimestamp().toISOString(),
    responseId: formResponse.getId(),
    rawResponseUrl: config.rawResponseUrl,
    answers,
  };

  const response = UrlFetchApp.fetch(config.intakeUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + config.intakeSecret,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    const responseText = response.getContentText();
    const message = 'LVBT membership intake failed with HTTP ' + status + ': ' + responseText;
    console.error(message);
    throw new Error(message);
  }
}

function answersByQuestionTitle(formResponse) {
  const answers = {};

  formResponse.getItemResponses().forEach(function (itemResponse) {
    const title = itemResponse.getItem().getTitle();
    const response = itemResponse.getResponse();
    answers[title] = Array.isArray(response) ? response.join(', ') : String(response || '');
  });

  return answers;
}

function stringAnswer(answers, title) {
  return String(answers[title] || '').trim();
}

function spreadsheetUrl(form) {
  // getDestinationId() throws ("The form currently has no response
  // destination") when the form isn't linked to a spreadsheet, so we can't
  // call it speculatively — treat "no destination" as an empty URL.
  try {
    const destinationId = form.getDestinationId();
    return destinationId ? 'https://docs.google.com/spreadsheets/d/' + destinationId : '';
  } catch (err) {
    return '';
  }
}
