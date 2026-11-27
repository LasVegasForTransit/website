/* global document, window, history, location -- browser-only prototype; no data is saved or sent */
(() => {
  const root = document.querySelector('[data-join-vision]');
  if (!root) return;
  const screens = [...root.querySelectorAll('[data-screen]')];
  const stepPanels = [...root.querySelectorAll('[data-step]')];
  const nav = [...root.querySelectorAll('.screen-nav button')];
  const next = root.querySelector('[data-step-next]');
  const back = root.querySelector('[data-step-back]');
  const overlay = root.querySelector('[data-sample-overlay]');
  const params = new URLSearchParams(location.search);
  const initial = location.hash.slice(1);
  const requestForm = root.querySelector('[data-request-interest-form]');
  const requestDialog = root.querySelector('[data-request-interest-dialog]');
  const resumeInput = root.querySelector('#interest-resume');
  const resumeError = root.querySelector('[data-resume-error]');
  const roleDialog = root.querySelector('[data-role-dialog]');
  const roleForm = root.querySelector('[data-role-form]');
  const roleResume = root.querySelector('#role-resume');
  const roleResumeError = root.querySelector('[data-role-resume-error]');
  const requestScreen = root.querySelector('[data-screen="request"]');
  let step = 1;
  let interest = '';
  let pace = '';
  const sessionIndicatesMember = /(?:^|;\s*)lvbt_signed_in=1(?:;|$)/.test(document.cookie);
  let memberContext =
    params.has('member') || initial === 'member' || initial === 'finder' || sessionIndicatesMember;
  let previousFocus;
  let requestDialogOpener;
  let roleDialogOpener;
  let selectedOpportunity = '';

  if (params.has('presentation')) root.dataset.presentation = '';

  root.querySelectorAll('[data-request-link]').forEach((link) => {
    link.addEventListener('click', () => {
      const url = new URL(link.href);
      if (params.has('presentation')) url.searchParams.set('presentation', '1');
      if (memberContext) url.searchParams.set('member', '1');
      link.href = url.toString();
    });
  });

  const opportunities = {
    meet: {
      kind: 'Event',
      title: 'Vegas Urbanists meetups',
      description: 'Meet other people who care about transit and how the Valley grows.',
      sourceLabel: 'Find it under',
      source: 'Events',
      href: '/events',
      action: 'See events',
    },
    learn: {
      kind: 'Program',
      title: 'Urbanist Book Club',
      description: 'Take part in a discussion about transit, housing, and streets in the Valley.',
      sourceLabel: 'Find it under',
      source: 'Urbanist Book Club',
      href: '/programs',
      action: 'See programs',
    },
    speak: {
      kind: 'Public action',
      title: 'Speak up at a public meeting',
      description: 'Find the next LVBT event where residents can discuss a transit decision.',
      sourceLabel: 'Find it under',
      source: 'Events',
      href: '/events',
      action: 'See events',
    },
    build: {
      kind: 'Contributor request',
      title: requestScreen.querySelector('h1').textContent,
      description: requestScreen.dataset.requestListing,
      sourceLabel: 'Project',
      source: requestScreen.dataset.requestProject,
      screen: 'request',
    },
    membership: {
      kind: 'Committee',
      title: 'Membership Committee',
      description: 'Help improve how new members join and find work they can do.',
      sourceLabel: 'Area of work',
      source: 'Membership',
      screen: 'membership',
    },
  };

  function showScreen(name) {
    if (name === 'member' || name === 'finder') memberContext = true;
    if (name === 'join' && !params.has('member') && !sessionIndicatesMember) memberContext = false;
    screens.forEach((screen) => {
      screen.hidden = screen.dataset.screen !== name;
    });
    nav.forEach((button) => {
      if (button.dataset.showScreen === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-auth]').forEach((element) => {
      element.hidden =
        element.getAttribute('data-auth') !==
        (memberContext || sessionIndicatesMember ? 'signed-in' : 'signed-out');
    });
    history.replaceState(null, '', `${location.search}#${name}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function showRequestContact() {
    root.querySelector('[data-public-interest-note]').hidden = memberContext;
    root.querySelector('[data-public-contact]').hidden = memberContext;
    root.querySelector('[data-member-contact]').hidden = !memberContext;
    root.querySelectorAll('[data-public-contact] input').forEach((input) => {
      input.disabled = memberContext;
    });
  }

  function openRequestInterest(opener) {
    requestDialogOpener =
      opener || root.querySelector('.request-actions [data-open-request-interest]');
    if (screens.find((screen) => !screen.hidden)?.dataset.screen !== 'request') {
      showScreen('request');
    }
    if (!root.querySelector('[data-request-interest-confirmation]').hidden) {
      requestForm.reset();
      updateResumeName(resumeInput);
    }
    root.querySelector('[data-request-interest-entry]').hidden = false;
    root.querySelector('[data-request-interest-confirmation]').hidden = true;
    requestDialog.removeAttribute('data-confirmed');
    resumeError.hidden = true;
    clearContactErrors(requestForm);
    root.querySelector('[data-work-error]').hidden = true;
    showRequestContact();
    requestDialog.showModal();
    history.replaceState(null, '', `${location.search}#interest`);
    root.querySelector('#interest-heading').focus();
  }

  function validateResume(input, error) {
    const file = input.files?.[0];
    const valid = !file || (/\.(pdf|doc|docx)$/i.test(file.name) && file.size <= 10 * 1024 * 1024);
    error.hidden = valid;
    error.textContent = valid ? '' : 'Choose a PDF or Word document under 10 MB.';
    if (!valid) input.value = '';
    updateResumeName(input);
    return valid;
  }

  function setContactError(input, message) {
    const error = input.closest('label').querySelector('.field-error');
    error.textContent = message;
    error.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function clearContactErrors(form) {
    form
      .querySelectorAll('input[name="name"], input[name="email"], input[name="phone"]')
      .forEach((input) => {
        setContactError(input, '');
      });
  }

  function validateContact(form) {
    if (memberContext) return true;
    const name = form.elements.namedItem('name');
    const email = form.elements.namedItem('email');
    const phone = form.elements.namedItem('phone');
    name.value = name.value.trim();
    email.value = email.value.trim();
    phone.value = phone.value.trim();

    setContactError(name, name.value ? '' : 'Enter your name.');
    setContactError(
      email,
      email.value && email.validity.valid ? '' : 'Enter a valid email address.',
    );
    const phoneBase = phone.value.replace(/\s*(?:ext(?:ension)?\.?|x)\s*\d{1,6}$/i, '');
    const digits = phoneBase.replace(/\D/g, '');
    const phoneValid =
      !phone.value ||
      (/^[+\d\s().-]+$/.test(phoneBase) && digits.length >= 7 && digits.length <= 15);
    setContactError(phone, phoneValid ? '' : 'Use 7–15 digits, or leave this blank.');

    const firstInvalid = [name, email, phone].find((input) => input.hasAttribute('aria-invalid'));
    firstInvalid?.focus();
    return !firstInvalid;
  }

  function validateWork() {
    const chosen = requestForm.querySelector('[name="work"]:checked');
    root.querySelector('[data-work-error]').hidden = Boolean(chosen);
    if (!chosen) requestForm.querySelector('[name="work"]').focus();
    return Boolean(chosen);
  }

  function updateResumeName(input) {
    const selected = input.closest('.interest-resume').querySelector('[data-resume-filename]');
    const file = input.files?.[0];
    selected.hidden = !file;
    selected.textContent = file ? `Selected: ${file.name}` : '';
  }

  function openRoleApplication(opener) {
    roleDialogOpener = opener;
    if (!root.querySelector('[data-role-confirmation]').hidden) {
      roleForm.reset();
      updateResumeName(roleResume);
    }
    root.querySelector('[data-role-entry]').hidden = false;
    root.querySelector('[data-role-confirmation]').hidden = true;
    roleDialog.removeAttribute('data-confirmed');
    roleResumeError.hidden = true;
    clearContactErrors(roleForm);
    root.querySelector('[data-role-public-contact]').hidden = memberContext;
    root.querySelector('[data-role-member-contact]').hidden = !memberContext;
    root.querySelectorAll('[data-role-public-contact] input').forEach((input) => {
      input.disabled = memberContext;
    });
    roleDialog.showModal();
    root.querySelector('#role-apply-heading').focus();
  }

  function showStep(number) {
    step = number;
    stepPanels.forEach((panel) => {
      panel.hidden = Number(panel.dataset.step) !== step;
    });
    root.querySelector('[data-progress-label]').textContent =
      `${step} of 3 · ${['Interests', 'Time', 'Suggestion'][step - 1]}`;
    back.hidden = step === 1;
    next.hidden = step === 3;
    next.disabled = step === 1 ? !interest : !pace;
    if (step === 3) {
      const item = opportunities[interest] || opportunities.meet;
      root.querySelector('[data-result-kind]').textContent = item.kind;
      root.querySelector('[data-result-title]').textContent = item.title;
      root.querySelector('[data-result-description]').textContent = item.description;
      root.querySelector('[data-result-source-label]').textContent = item.sourceLabel;
      root.querySelector('[data-result-source]').textContent = item.source;
      root.querySelector('[data-result-commitment]').textContent = {
        once: 'One event or small task',
        sometimes: 'Occasionally',
        regular: 'Regular work',
      }[pace];
      const action = root.querySelector('[data-result-action]');
      action.textContent = item.action || 'Read the details';
      if (item.screen) action.dataset.showScreen = item.screen;
      else delete action.dataset.showScreen;
      if (item.href) action.dataset.href = item.href;
      else delete action.dataset.href;
    }
  }

  function setChoice(attribute, value) {
    root.querySelectorAll(`[data-${attribute}]`).forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset[attribute] === value));
    });
    if (attribute === 'interest') interest = value;
    else pace = value;
    next.disabled = false;
  }

  function openExample(button) {
    previousFocus = button;
    const screen = screens.find((item) => !item.hidden)?.dataset.screen;
    selectedOpportunity = screen;
    const copy =
      {
        group: [
          'Ask about the Public Engagement Team',
          'Tell the team which part of public meeting work interests you.',
          'I would like to help with',
          ['Planning meetings', 'Preparing public comment guidance', 'Hosting events'],
        ],
        membership: [
          'Ask about the Membership Committee',
          'Tell the committee which part of membership work interests you.',
          'I would like to help with',
          ['Website membership experience', 'Member portal', 'Welcoming new members'],
        ],
      }[screen] || [];
    root.querySelector('[data-sample-title]').textContent = copy[0];
    root.querySelector('[data-sample-intro]').textContent = copy[1];
    root.querySelector('[data-sample-legend]').textContent = copy[2];
    root.querySelectorAll('[data-sample-option]').forEach((option, index) => {
      option.textContent = copy[3][index];
    });
    root.querySelectorAll('[name="sample-availability"]').forEach((input) => {
      input.checked = false;
    });
    overlay.hidden = false;
    root.querySelector('.sample-close').focus();
  }

  function closeExample() {
    overlay.hidden = true;
    previousFocus?.focus();
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.interest) setChoice('interest', button.dataset.interest);
    if (button.dataset.pace) setChoice('pace', button.dataset.pace);
    if (button.hasAttribute('data-step-next')) showStep(Math.min(3, step + 1));
    if (button.hasAttribute('data-step-back')) showStep(Math.max(1, step - 1));
    if (button.dataset.href) window.location.assign(button.dataset.href);
    if (button.dataset.showScreen) showScreen(button.dataset.showScreen);
    if (button.hasAttribute('data-open-request-interest')) openRequestInterest(button);
    if (button.hasAttribute('data-close-request-interest')) requestDialog.close();
    if (button.hasAttribute('data-open-role')) openRoleApplication(button);
    if (button.hasAttribute('data-close-role')) roleDialog.close();
    if (button.hasAttribute('data-open-sample')) openExample(button);
    if (button.hasAttribute('data-close-sample')) closeExample();
  });
  root.querySelector('[data-interest-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = root.querySelector('[name="sample-availability"]:checked');
    if (!chosen) return;
    const opportunity = {
      group: 'Public Engagement Team',
      membership: 'Membership Committee',
    }[selectedOpportunity];
    const interest = root.querySelector(`[data-sample-option="${chosen.value}"]`).textContent;
    const subject = encodeURIComponent(`Interested in ${opportunity}`);
    const body = encodeURIComponent(
      `Hi LVBT,\n\nI'd like to help with ${opportunity}. I'm interested in: ${interest}.\n\nThanks!`,
    );
    window.location.assign(`mailto:hello@lasvegasfortransit.org?subject=${subject}&body=${body}`);
  });
  requestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateContact(requestForm) || !validateWork()) return;
    if (!validateResume(resumeInput, resumeError)) {
      resumeInput.focus();
      return;
    }
    const email = memberContext
      ? root.querySelector('[data-member-contact] input[type="email"]').value
      : requestForm.elements.email.value.trim();
    root.querySelector('[data-interest-confirm-email]').textContent = email;
    root.querySelector('[data-public-join-invitation]').hidden = memberContext;
    root.querySelector('[data-request-interest-entry]').hidden = true;
    root.querySelector('[data-request-interest-confirmation]').hidden = false;
    requestDialog.setAttribute('data-confirmed', '');
    root.querySelector('[data-interest-confirm-heading]').focus();
    requestDialog.scrollTop = 0;
  });
  resumeInput.addEventListener('change', () => validateResume(resumeInput, resumeError));
  roleResume.addEventListener('change', () => validateResume(roleResume, roleResumeError));
  for (const form of [requestForm, roleForm]) {
    form
      .querySelectorAll('input[name="name"], input[name="email"], input[name="phone"]')
      .forEach((input) => {
        input.addEventListener('input', () => setContactError(input, ''));
      });
  }
  requestForm.querySelectorAll('[name="work"]').forEach((input) => {
    input.addEventListener('change', () => {
      root.querySelector('[data-work-error]').hidden = true;
    });
  });
  roleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateContact(roleForm)) return;
    if (!validateResume(roleResume, roleResumeError)) {
      roleResume.focus();
      return;
    }
    const email = memberContext
      ? root.querySelector('[data-role-member-contact] input[type="email"]').value
      : roleForm.elements.email.value.trim();
    root.querySelector('[data-role-confirm-email]').textContent = email;
    root.querySelector('[data-role-entry]').hidden = true;
    root.querySelector('[data-role-confirmation]').hidden = false;
    roleDialog.setAttribute('data-confirmed', '');
    root.querySelector('[data-role-confirm-heading]').focus();
    roleDialog.scrollTop = 0;
  });
  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        dialog.close();
      }
    });
  }
  closeOnBackdrop(requestDialog);
  closeOnBackdrop(roleDialog);
  requestDialog.addEventListener('close', () => {
    history.replaceState(null, '', `${location.search}#request`);
    requestDialogOpener?.focus();
  });
  roleDialog.addEventListener('close', () => roleDialogOpener?.focus());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) closeExample();
  });
  showScreen(screens.some((screen) => screen.dataset.screen === initial) ? initial : 'join');
  if (initial === 'interest') openRequestInterest();
  if (opportunities[params.get('interest')]) setChoice('interest', params.get('interest'));
  if (['once', 'sometimes', 'regular'].includes(params.get('pace')))
    setChoice('pace', params.get('pace'));
  const requestedStep = Number(params.get('step'));
  if (initial === 'finder' && requestedStep >= 1 && requestedStep <= 3) showStep(requestedStep);
})();
