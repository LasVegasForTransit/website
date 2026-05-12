/* Wires up [data-share-button] elements: prefers the native Web Share API
 * when available (mobile Safari, Android Chrome), falls back to
 * navigator.clipboard.writeText with a "Copied ✓" affordance, and
 * degrades one further step to window.prompt if clipboard access is
 * denied. Idempotent — re-wires after astro:page-load view-transition
 * swaps without double-binding.
 *
 * Lives in public/scripts/ rather than as a hoisted <script> in the
 * component because the site's CSP is `script-src 'self'` (see
 * public/_headers). Astro inlines short hoisted scripts, which the CSP
 * blocks in production. Same pattern as header-stuck.js.
 */
(() => {
  const COPIED_RESET_MS = 1800;
  const ORIGINAL_LABEL = 'Share →';
  const COPIED_LABEL = 'Copied ✓';

  function wire() {
    const buttons = document.querySelectorAll('[data-share-button]');
    for (const button of buttons) {
      if (button.dataset.bound === 'true') continue;
      button.dataset.bound = 'true';

      const label = button.querySelector('[data-share-label]');
      const url = button.dataset.shareUrl ?? location.href;
      const title = button.dataset.shareTitle ?? document.title;
      const text = button.dataset.shareText ?? title;

      button.addEventListener('click', async () => {
        if (navigator.share) {
          try {
            await navigator.share({ url, title, text });
            return;
          } catch (err) {
            // User dismissed the share sheet — not a failure.
            if (err && err.name === 'AbortError') return;
            // Anything else falls through to clipboard copy below.
          }
        }

        try {
          await navigator.clipboard.writeText(url);
          if (label) {
            label.textContent = COPIED_LABEL;
            setTimeout(() => {
              label.textContent = ORIGINAL_LABEL;
            }, COPIED_RESET_MS);
          }
        } catch {
          // Clipboard write was blocked (no user activation, ancient
          // browser, focus lost). Last-resort: surface the URL so the
          // user can copy it manually.
          window.prompt('Copy this link:', url);
        }
      });
    }
  }

  wire();
  // Re-wire after view-transition swaps.
  document.addEventListener('astro:page-load', wire);
})();
