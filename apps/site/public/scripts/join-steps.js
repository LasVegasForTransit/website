/* global document, window -- browser script served by the site's CSP */
// The basic details and optional questions share one form, so the join still
// works without JavaScript. With JavaScript, they become two short screens.
(() => {
  function updateProgress(items, step) {
    items.forEach((item, index) => {
      const current = index + 1 === step;
      if (current) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('border-primary', current);
      item.classList.toggle('border-outline/25', index + 1 > step);
      item.classList.toggle('border-on-surface', index + 1 < step);
      item.classList.toggle('text-on-surface', index + 1 <= step);
      item.classList.toggle('text-on-surface-variant', index + 1 > step);
      item.classList.toggle('font-bold', current);
    });
  }

  function validateBasicFields({ form, summary, email, givenName, phone, consent }) {
    function setFieldError(field, invalid) {
      const error = form.querySelector(`[data-error-for="${field.id}"]`);
      const item = summary.querySelector(`[data-summary-for="${field.id}"]`);
      if (!error || !item) return;
      error.hidden = !invalid;
      item.hidden = !invalid;
      field.toggleAttribute('aria-invalid', invalid);
      const describedBy = (field.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== error.id);
      if (invalid) describedBy.unshift(error.id);
      if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
      else field.removeAttribute('aria-describedby');
      summary.hidden = !summary.querySelector('[data-summary-for]:not([hidden])');
    }

    for (const field of [email, givenName, phone, consent]) {
      field.addEventListener(field === consent ? 'change' : 'input', () =>
        setFieldError(field, false),
      );
    }

    return () => {
      const digits = phone.value.replace(/\D/g, '');
      const invalid = [
        [email, !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())],
        [givenName, !givenName.value.trim()],
        [
          phone,
          Boolean(phone.value.trim()) &&
            !(digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))),
        ],
        [consent, !consent.checked],
      ];
      invalid.forEach(([field, failed]) => setFieldError(field, failed));
      if (!invalid.some(([, failed]) => failed)) return true;
      summary.focus();
      return false;
    };
  }

  function run() {
    const form = document.querySelector('form[action="/join/member/"][data-enhance]');
    const progress = document.querySelector('[data-join-progress]');
    if (!form || !progress || form.dataset.joinSteps) return;

    const first = form.querySelector('[data-join-stage="1"]');
    const second = form.querySelector('[data-join-stage="2"]');
    const continueButton = form.querySelector('[data-join-continue]');
    const backButton = form.querySelector('[data-join-back]');
    const email = form.querySelector('[name="email"]');
    const givenName = form.querySelector('[name="given_name"]');
    const phone = form.querySelector('[name="phone"]');
    const consent = form.querySelector('[name="consent"]');
    const errorSummary = document.querySelector('[data-error-summary]');
    const items = progress.querySelectorAll('li');
    const basicHeading = document.querySelector('[data-join-heading-basic]');
    const interestsHeading = document.querySelector('[data-join-heading-interests]');
    const intro = document.querySelector('[data-join-intro]');
    if (
      [
        first,
        second,
        continueButton,
        backButton,
        email,
        givenName,
        phone,
        consent,
        errorSummary,
        basicHeading,
        interestsHeading,
        intro,
      ].some((element) => !element)
    )
      return;

    form.dataset.joinSteps = '1';
    progress.style.display = '';
    continueButton.style.display = '';
    backButton.style.display = '';
    const basicFieldsValid = validateBasicFields({
      form,
      summary: errorSummary,
      email,
      givenName,
      phone,
      consent,
    });

    function show(step) {
      first.hidden = step !== 1;
      second.hidden = step !== 2;
      basicHeading.hidden = step !== 1;
      interestsHeading.hidden = step !== 2;
      intro.hidden = step !== 1;
      updateProgress(items, step);
      if (step === 2)
        second.querySelector('[data-join-stage-heading]')?.focus({ preventScroll: true });
      else email.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }

    function continueToInterests() {
      if (basicFieldsValid()) show(2);
    }

    second.hidden = true;
    continueButton.addEventListener('click', continueToInterests);
    backButton.addEventListener('click', () => show(1));
    form.addEventListener(
      'submit',
      (event) => {
        if (!first.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          continueToInterests();
        }
      },
      { capture: true },
    );
  }

  run();
  document.addEventListener('astro:page-load', run);
})();
