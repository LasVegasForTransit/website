/* Wires up [data-newsletter-form] forms: intercepts submit, posts the form
 * to the join handler (/join/member/) asking for JSON, and shows the result
 * in the adjacent [data-form-status] element. Subscribing makes someone an
 * LVBT member. The status texts come from the message catalog through data
 * attributes on the status element. Without this script the form still
 * works: it posts normally and lands on the welcome page. Idempotent —
 * re-wires after astro:page-load view-transition swaps without
 * double-binding.
 *
 * Lives in public/scripts/ rather than as a hoisted <script> in the
 * component because the site's CSP is `script-src 'self'` (see
 * public/_headers). Same pattern as header-stuck.js / share-button.js.
 */
(() => {
  function wire() {
    const forms = document.querySelectorAll('[data-newsletter-form]');
    for (const form of forms) {
      if (form.dataset.bound === 'true') continue;
      form.dataset.bound = 'true';

      const btn = form.querySelector('[data-submit-btn]');
      // [data-form-status] is a sibling of the form, not a descendant —
      // walk up to the embed wrapper to find it.
      const status = form.parentElement?.querySelector('[data-form-status]') ?? null;
      const text = (name, fallback) => status?.dataset[name] || fallback;
      const originalLabel = btn ? btn.textContent : '';

      const restore = () => {
        if (!btn) return;
        btn.disabled = false;
        btn.textContent = originalLabel;
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btn) {
          btn.disabled = true;
          btn.textContent = text('sending', originalLabel);
        }
        if (status) status.textContent = '';

        try {
          const res = await fetch(form.action, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: new FormData(form),
          });
          const data = await res.json().catch(() => ({}));

          if (data && data.status === 'joined') {
            form.reset();
            restore();
            if (status) status.textContent = text('success', '');
            return;
          }
          if (status) {
            status.textContent =
              data && data.status === 'invalid' ? text('invalidEmail', '') : text('error', '');
          }
          restore();
        } catch {
          if (status) status.textContent = text('error', '');
          restore();
        }
      });
    }
  }

  wire();
  document.addEventListener('astro:page-load', wire);
})();
