/* Adds `.is-visible` to `.reveal` / `.reveal-stat` / `.reveal-quote`
 * the first time each element enters the viewport, then unobserves
 * it. Paired with the opacity/transform rules in global.css that key
 * off `.is-visible`.
 *
 * Lives in public/scripts/ rather than as an inline <script> in
 * BaseLayout because the site's CSP is `script-src 'self'` (see
 * public/_headers) — inline blocks are rejected in production, which
 * left every reveal element stuck at its initial hidden state. Same
 * pattern as header-stuck.js / share-button.js / newsletter-subscribe.js.
 */
(() => {
  const targets = document.querySelectorAll('.reveal, .reveal-stat, .reveal-quote');
  if (!targets.length) return;
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );
  targets.forEach((el) => obs.observe(el));
})();
