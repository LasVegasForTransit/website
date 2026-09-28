/* Mobile navigation overlay toggle.
 *
 * Lives in public/scripts/ (same-origin static file) so it satisfies the
 * site's CSP `script-src 'self'` — see public/_headers. An inline <script>
 * in the component would silently fail in production.
 *
 * State is driven entirely by attributes on the header element:
 *   [data-nav-open]  — present while the overlay is visible
 * CSS handles the visual transition; this file only manages focus, scroll
 * lock, keyboard handling, and the aria-expanded label swap.
 */
(() => {
  const header = document.querySelector('[data-site-header]');
  const toggle = document.querySelector('[data-nav-toggle]');
  const overlay = document.querySelector('[data-nav-overlay]');

  if (!header || !toggle || !overlay) return;

  const focusable = () => [...overlay.querySelectorAll('a[href], button:not([disabled])')];

  function open() {
    header.dataset.navOpen = '';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    overlay.removeAttribute('inert');
    document.body.style.overflow = 'hidden';
    focusable()[0]?.focus();
  }

  function close() {
    delete header.dataset.navOpen;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    overlay.setAttribute('inert', '');
    document.body.style.overflow = '';
    toggle.focus();
  }

  toggle.addEventListener('click', () => {
    'navOpen' in header.dataset ? close() : open();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && 'navOpen' in header.dataset) close();
  });

  overlay.querySelectorAll('a[href]').forEach((a) => {
    a.addEventListener('click', close);
  });

  // Focus trap: cycle Tab/Shift-Tab within the overlay while it is open.
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = focusable();
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
})();
