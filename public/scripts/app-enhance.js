/* global window, document, location -- a browser script served as-is from public/scripts */
/* The one enhancement script for app screens. Every form works without it;
 * with it, a form marked [data-enhance]:
 *  - saves what someone types to session storage and restores it after a
 *    reload (never password or one-time-code fields, or [data-no-draft]),
 *  - offers to retry instead of losing input when the browser is offline,
 *  - blocks a second submit while the first is on its way.
 * On any page it moves focus to a shown error summary, and on a page marked
 * [data-clear-drafts] it discards that form's saved draft. Lives in
 * public/scripts because the site's CSP allows only same-origin scripts.
 * Budget: under 3 KB gzipped.
 */
(() => {
  const PREFIX = 'lvbt-draft:';
  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();

  const keep = (field) =>
    field.name &&
    !['password', 'hidden', 'file', 'submit'].includes(field.type) &&
    field.autocomplete !== 'one-time-code' &&
    !field.hasAttribute('data-no-draft');

  function draftKey(form) {
    return PREFIX + new URL(form.action, location.href).pathname;
  }

  function save(form) {
    if (!storage) return;
    const draft = {};
    for (const field of form.elements) {
      if (!keep(field)) continue;
      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked) (draft[field.name] ||= []).push(field.value);
      } else {
        draft[field.name] = field.value;
      }
    }
    storage.setItem(draftKey(form), JSON.stringify(draft));
  }

  function restore(form) {
    const raw = storage?.getItem(draftKey(form));
    if (!raw) return;
    const draft = JSON.parse(raw);
    for (const field of form.elements) {
      if (!keep(field) || !(field.name in draft)) continue;
      const value = draft[field.name];
      if (field.type === 'checkbox' || field.type === 'radio') {
        field.checked = field.checked || value.includes(field.value);
      } else if (!field.value) {
        field.value = value;
      }
    }
  }

  const offlineNotice = () => document.querySelector('[data-offline-notice]');

  function wire(form) {
    if (form.dataset.enhanced) return;
    form.dataset.enhanced = '1';
    restore(form);
    form.addEventListener('input', () => save(form));
    form.addEventListener('change', () => save(form));
    form.addEventListener('submit', (event) => {
      save(form);
      if (!navigator.onLine) {
        event.preventDefault();
        const notice = offlineNotice();
        if (notice) notice.hidden = false;
        window.addEventListener('online', () => form.requestSubmit(), { once: true });
        return;
      }
      if (form.dataset.sending) {
        event.preventDefault();
        return;
      }
      form.dataset.sending = '1';
      const button = event.submitter;
      if (button?.dataset.busyLabel) {
        button.setAttribute('aria-disabled', 'true');
        button.textContent = button.dataset.busyLabel;
      }
      // If the response never comes, let them try again.
      setTimeout(() => delete form.dataset.sending, 15000);
    });
  }

  function run() {
    document.querySelectorAll('form[data-enhance]').forEach(wire);
    const clear = document.querySelector('[data-clear-drafts]');
    if (clear && storage) storage.removeItem(PREFIX + clear.dataset.clearDrafts);
    const summary = document.querySelector('[data-error-summary]:not([hidden])');
    if (summary) summary.focus();
    const notice = offlineNotice();
    if (notice) {
      const sync = () => (notice.hidden = navigator.onLine);
      window.addEventListener('online', sync);
      window.addEventListener('offline', sync);
    }
  }

  run();
  document.addEventListener('astro:page-load', run);
})();
