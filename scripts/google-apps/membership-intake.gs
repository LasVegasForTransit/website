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
  const properties = PropertiesService.getScriptProperties();
  const intakeUrl = properties.getProperty('LVBT_MEMBERSHIP_INTAKE_URL');
  const intakeSecret = properties.getProperty('LVBT_MEMBERSHIP_INTAKE_SECRET');

  if (!intakeUrl || !intakeSecret) {
    throw new Error('Missing LVBT membership intake Apps Script properties.');
  }

  const answers = answersByQuestionTitle(event.response);
  const payload = {
    email: String(event.response.getRespondentEmail() || '').trim(),
    name: stringAnswer(answers, FIELD_TITLES.name),
    discord: stringAnswer(answers, FIELD_TITLES.discord),
    sourceForm: FormApp.getActiveForm().getTitle(),
    submittedAt: event.response.getTimestamp().toISOString(),
    responseId: event.response.getId(),
    rawResponseUrl: spreadsheetUrl(),
    answers,
  };

  const response = UrlFetchApp.fetch(intakeUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + intakeSecret,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(
      'LVBT membership intake failed with HTTP ' + status + ': ' + response.getContentText(),
    );
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

function spreadsheetUrl() {
  const destinationId = FormApp.getActiveForm().getDestinationId();
  return destinationId ? 'https://docs.google.com/spreadsheets/d/' + destinationId : '';
}
