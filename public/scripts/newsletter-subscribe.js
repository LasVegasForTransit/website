/* Wires up [data-newsletter-form] forms: intercepts submit, POSTs JSON
 * to /api/subscribe (a Cloudflare Pages Function in functions/api/),
 * and surfaces success / invalid_email / generic-failure into the
 * adjacent [data-form-status] element. Idempotent — re-wires after
 * astro:page-load view-transition swaps without double-binding.
 *
 * Lives in public/scripts/ rather than as a hoisted <script> in the
 * component because the site's CSP is `script-src 'self'` (see
 * public/_headers). Astro inlines short hoisted scripts, which the CSP
 * blocks in production — without this script running, the form falls
 * back to native submission and the page "refreshes". Same pattern as
 * header-stuck.js / share-button.js.
 */
(() => {
  function wire() {
    const forms = document.querySelectorAll('[data-newsletter-form]');
    for (const form of forms) {
      if (form.dataset.bound === 'true') continue;
      form.dataset.bound = 'true';

      const btn = form.querySelector('[data-submit-btn]');
      const status = form.querySelector('[data-form-status]');
      const originalLabel = btn ? btn.textContent : 'Subscribe';

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.elements.namedItem('email');
        const email = input && 'value' in input ? input.value.trim() : '';

        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Subscribing…';
        }
        if (status) status.textContent = '';

        try {
          const res = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });

          const data = await res.json().catch(() => ({}));

          if (data && data.success) {
            form.reset();
            if (btn) btn.textContent = 'Done ✓';
            if (status)
              status.textContent = "You're subscribed. Check your inbox for a confirmation.";
            return;
          }

          if (status) {
            status.textContent =
              data && data.error === 'invalid_email'
                ? "That doesn't look like a valid email address."
                : 'Something went wrong. Please try again.';
          }
          if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        } catch {
          if (status) status.textContent = 'Something went wrong. Please try again.';
          if (btn) {
            btn.disabled = false;
            btn.textContent = originalLabel;
          }
        }
      });
    }
  }

  wire();
  document.addEventListener('astro:page-load', wire);
})();
