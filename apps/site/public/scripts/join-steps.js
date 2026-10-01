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

  function run() {
    const form = document.querySelector('form[action="/join/member/"][data-enhance]');
    const progress = document.querySelector('[data-join-progress]');
    if (!form || !progress || form.dataset.joinSteps) return;

    const first = form.querySelector('[data-join-stage="1"]');
    const second = form.querySelector('[data-join-stage="2"]');
    const continueButton = form.querySelector('[data-join-continue]');
    const backButton = form.querySelector('[data-join-back]');
    const email = form.querySelector('[name="email"]');
    const consent = form.querySelector('[name="consent"]');
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
        consent,
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
      if (!email.reportValidity()) return;
      if (!consent.reportValidity()) return;
      show(2);
    }

    second.hidden = true;
    continueButton.addEventListener('click', continueToInterests);
    backButton.addEventListener('click', () => show(1));
    form.querySelector('#transport_options')?.addEventListener('change', (event) => {
      const changed = event.target;
      if (!changed?.matches?.('input[name="transport_options"]') || !changed.checked) return;
      const options = form.querySelectorAll('input[name="transport_options"]');
      if (changed.value === 'none') {
        options.forEach((option) => {
          if (option.value !== 'none') option.checked = false;
        });
      } else {
        const none = form.querySelector('input[name="transport_options"][value="none"]');
        if (none) none.checked = false;
      }
    });
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
