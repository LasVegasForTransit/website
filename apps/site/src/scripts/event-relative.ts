// Relative event labels — "Live now" / "Today" / "Tomorrow" / "In N days" /
// "Next week" — are time-relative, so computing them at build time freezes
// them to the day the site was built (a Thursday meeting keeps reading
// "Today" until the next deploy). This recomputes them in the browser at view
// time, and every minute after, so the badge is always accurate.
//
// The server still renders a build-time best guess as the no-JS fallback;
// this only corrects it. Each event surface marks a container with
// `data-event-when` + `data-start` (ISO) and optional `data-end`, and exposes
// the slots this script drives:
//   [data-event-badge]        urgent badge wrapper (shown for live/today)
//     [data-event-badge-pill]   inner pill — carries the live/today colors
//     [data-event-badge-dot]    pulse dot — shown only when live
//     [data-event-badge-text]   badge label text
//   [data-event-fallback]     non-urgent top slot (format pill / "Next event")
//   [data-event-inline]       inline relative next to the date (soft kinds)
//     [data-event-inline-text]  inline label text
import { relativeLabel } from '../lib/event-time';

function apply(root: HTMLElement, now: Date): void {
  const startIso = root.dataset.start;
  if (!startIso) return;
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) return;
  const endIso = root.dataset.end;
  const endDate = endIso ? new Date(endIso) : undefined;

  const relative = relativeLabel({ date, endDate }, now);
  const urgent = relative?.kind === 'live' || relative?.kind === 'today';

  const badge = root.querySelector<HTMLElement>('[data-event-badge]');
  if (badge) {
    badge.hidden = !urgent;
    if (urgent && relative) {
      const live = relative.kind === 'live';
      const pill = badge.querySelector<HTMLElement>('[data-event-badge-pill]');
      if (pill) {
        pill.classList.toggle('bg-primary', live);
        pill.classList.toggle('text-on-primary', live);
        pill.classList.toggle('bg-primary-container', !live);
        pill.classList.toggle('text-on-primary-container', !live);
      }
      const dot = badge.querySelector<HTMLElement>('[data-event-badge-dot]');
      if (dot) dot.hidden = !live;
      const text = badge.querySelector<HTMLElement>('[data-event-badge-text]');
      if (text) text.textContent = relative.text;
    }
  }

  const fallback = root.querySelector<HTMLElement>('[data-event-fallback]');
  if (fallback) fallback.hidden = urgent;

  const inline = root.querySelector<HTMLElement>('[data-event-inline]');
  if (inline) {
    const soft = relative != null && !urgent;
    inline.hidden = !soft;
    if (soft) {
      const text = inline.querySelector<HTMLElement>('[data-event-inline-text]');
      if (text) text.textContent = relative.text;
    }
  }
}

function render(): void {
  const now = new Date();
  document.querySelectorAll<HTMLElement>('[data-event-when]').forEach((root) => apply(root, now));
}

render();
// Flip to "Live now" / "Today" as the day or session crosses a boundary.
window.setInterval(render, 60_000);
// Astro view transitions swap the DOM without a full reload.
document.addEventListener('astro:page-load', render);
