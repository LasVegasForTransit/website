import { FORMAT_LABEL, PENDING_FORMAT_LABEL, whereLabel, type EventFormat } from './event-format';
import type { LiveEventEntry } from './events-live';
import { formatEventTime, relativeLabel, TIMEZONE, type RelativeLabel } from './event-time';
import { paths } from './paths';
import { site } from './site';
import { breadcrumbSchema } from './structured-data';

const ICON_BODY = {
  virtual:
    '<path fill="currentColor" d="M15 8v8H5V8zm1-2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4V7a1 1 0 0 0-1-1"/>',
  'in-person':
    '<path fill="currentColor" d="M12 6.5A2.5 2.5 0 0 1 14.5 9a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 9.5 9A2.5 2.5 0 0 1 12 6.5M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7m0 2a5 5 0 0 0-5 5c0 1 0 3 5 9.71C17 12 17 10 17 9a5 5 0 0 0-5-5"/>',
  hybrid:
    '<path fill="currentColor" d="M12 5a3.5 3.5 0 0 0-3.5 3.5A3.5 3.5 0 0 0 12 12a3.5 3.5 0 0 0 3.5-3.5A3.5 3.5 0 0 0 12 5m0 2a1.5 1.5 0 0 1 1.5 1.5A1.5 1.5 0 0 1 12 10a1.5 1.5 0 0 1-1.5-1.5A1.5 1.5 0 0 1 12 7M5.5 8A2.5 2.5 0 0 0 3 10.5c0 .94.53 1.75 1.29 2.18c.36.2.77.32 1.21.32s.85-.12 1.21-.32c.37-.21.68-.51.91-.87A5.42 5.42 0 0 1 6.5 8.5v-.28c-.3-.14-.64-.22-1-.22m13 0c-.36 0-.7.08-1 .22v.28c0 1.2-.39 2.36-1.12 3.31c.12.19.25.34.4.49a2.48 2.48 0 0 0 1.72.7c.44 0 .85-.12 1.21-.32c.76-.43 1.29-1.24 1.29-2.18A2.5 2.5 0 0 0 18.5 8M12 14c-2.34 0-7 1.17-7 3.5V19h14v-1.5c0-2.33-4.66-3.5-7-3.5m-7.29.55C2.78 14.78 0 15.76 0 17.5V19h3v-1.93c0-1.01.69-1.85 1.71-2.52m14.58 0c1.02.67 1.71 1.51 1.71 2.52V19h3v-1.5c0-1.74-2.78-2.72-4.71-2.95M12 16c1.53 0 3.24.5 4.23 1H7.77c.99-.5 2.7-1 4.23-1"/>',
  pending:
    '<path fill="currentColor" d="M12 2a10 10 0 0 1 10 10a10 10 0 0 1-10 10A10 10 0 0 1 2 12A10 10 0 0 1 12 2m0 2a8 8 0 0 0-8 8a8 8 0 0 0 8 8a8 8 0 0 0 8-8a8 8 0 0 0-8-8m0 6.5a1.5 1.5 0 0 1 1.5 1.5a1.5 1.5 0 0 1-1.5 1.5a1.5 1.5 0 0 1-1.5-1.5a1.5 1.5 0 0 1 1.5-1.5m-4.5 0A1.5 1.5 0 0 1 9 12a1.5 1.5 0 0 1-1.5 1.5A1.5 1.5 0 0 1 6 12a1.5 1.5 0 0 1 1.5-1.5m9 0A1.5 1.5 0 0 1 18 12a1.5 1.5 0 0 1-1.5 1.5A1.5 1.5 0 0 1 15 12a1.5 1.5 0 0 1 1.5-1.5"/>',
  calendar:
    '<path fill="currentColor" d="M7 11h2v2H7zm14-6v14c0 1.11-.89 2-2 2H5a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h1V1h2v2h8V1h2v2h1a2 2 0 0 1 2 2M5 7h14V5H5zm14 12V9H5v10zm-4-6v-2h2v2zm-4 0v-2h2v2zm-4 2h2v2H7zm8 2v-2h2v2zm-4 0v-2h2v2z"/>',
} as const;

const cardDateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const pastDateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const detailDateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: TIMEZONE,
});

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPill(format: EventFormat | undefined): string {
  const key = format ?? 'pending';
  const label = format ? FORMAT_LABEL[format] : PENDING_FORMAT_LABEL;
  return `<span class="inline-flex items-center gap-1.5 self-start rounded-full font-bold bg-primary-container text-on-primary-container px-2.5 py-1 text-xs"><svg viewBox="0 0 24 24" class="size-3.5 text-primary-ink" aria-hidden="true" focusable="false">${ICON_BODY[key]}</svg><span>${escapeHtml(label)}</span></span>`;
}

function badgePill(relative: RelativeLabel): string {
  const isUrgent = relative?.kind === 'live' || relative?.kind === 'today';
  const toneClass =
    relative?.kind === 'live'
      ? 'bg-primary text-on-primary'
      : 'bg-primary-container text-on-primary-container';
  const dotHidden = relative?.kind !== 'live' ? ' hidden' : '';
  const text = isUrgent ? escapeHtml(relative.text) : '';
  return `<span data-event-badge-pill class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${toneClass}"><span data-event-badge-dot aria-hidden="true"${dotHidden} class="size-1.5 rounded-full bg-on-primary animate-pulse"></span><span data-event-badge-text>${text}</span></span>`;
}

function cardFooterHtml(entry: LiveEventEntry, featured: boolean): string {
  const { location } = entry.data;
  const format = location?.format;
  if (!featured && (!format || format === 'virtual')) return '';
  const tone = featured
    ? 'text-on-slab/70'
    : 'text-on-surface-variant group-hover:text-surface/70 group-focus-visible:text-surface/70';
  return `<p class="mt-6 text-body-sm ${tone}">${escapeHtml(whereLabel(location))}</p>`;
}

function cardClasses(featured: boolean) {
  return featured
    ? {
        surface: 'bg-slab p-6 text-on-slab md:p-8 lg:p-10',
        time: 'mt-4 text-title-md md:mt-5',
        inline: 'text-on-slab/70',
        title: 'mt-3 break-words text-headline-lg text-primary-soft md:mt-4 md:text-display-sm',
        summary: 'mt-5 max-w-prose flex-1 text-body-lg leading-relaxed text-on-slab/85 md:mt-6',
      }
    : {
        surface:
          'bg-surface-container p-5 text-on-surface hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface md:p-6',
        time: 'mt-4 text-title-sm',
        inline: 'text-on-surface-variant',
        title: 'mt-2 text-title-lg',
        summary:
          'mt-4 flex-1 text-body-md leading-relaxed text-on-surface-variant group-hover:text-surface/75 group-focus-visible:text-surface/75',
      };
}

function renderEventCard(entry: LiveEventEntry, featured: boolean, now: Date): string {
  const { title, date, endDate, summary, location } = entry.data;
  const format = location?.format;
  const href = paths.event(entry.slug);
  const relative = relativeLabel(entry.data, now);
  const isUrgent = relative?.kind === 'live' || relative?.kind === 'today';
  const inlineRelative = relative && !isUrgent ? relative.text : null;
  const classes = cardClasses(featured);

  const dataFormat = format ? ` data-format="${escapeHtml(format)}"` : '';
  const dataEnd = endDate ? ` data-end="${escapeHtml(endDate.toISOString())}"` : '';
  const fallbackHtml = featured
    ? `<p data-event-fallback${isUrgent ? ' hidden' : ''} class="text-title-sm text-primary-soft">Next event</p>`
    : `<span data-event-fallback${isUrgent ? ' hidden' : ''}>${formatPill(format)}</span>`;

  return `<a href="${escapeHtml(href)}" data-event-when${dataFormat} data-start="${escapeHtml(date.toISOString())}"${dataEnd} class="lift group flex h-full flex-col border border-outline-variant/25 no-underline transition-colors ${classes.surface}"><span data-event-badge${!isUrgent ? ' hidden' : ''} class="self-start">${badgePill(relative)}</span>${fallbackHtml}<p class="${classes.time}"><time datetime="${escapeHtml(date.toISOString())}">${escapeHtml(cardDateFmt.format(date))} · ${escapeHtml(formatEventTime(date))}</time><span data-event-inline${!inlineRelative ? ' hidden' : ''} class="ml-2 font-normal ${classes.inline}">· <span data-event-inline-text>${escapeHtml(inlineRelative ?? '')}</span></span></p><h3 class="${classes.title}">${escapeHtml(title)}</h3><p class="${classes.summary}">${escapeHtml(summary)}</p>${cardFooterHtml(entry, featured)}</a>`;
}

export function renderEventsIndexBody(
  entries: readonly LiveEventEntry[],
  now: Date = new Date(),
): string {
  const nowMs = now.getTime();
  const upcoming = entries
    .filter((entry) => entry.data.date.getTime() >= nowMs)
    .sort((a, b) => a.data.date.getTime() - b.data.date.getTime());
  const past = entries
    .filter((entry) => entry.data.date.getTime() < nowMs)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const featured = upcoming.find((entry) => entry.data.featured) ?? upcoming[0] ?? null;
  const otherUpcoming = featured ? upcoming.filter((entry) => entry.slug !== featured.slug) : [];

  const cadencesHtml =
    upcoming.length > 0
      ? '<p class="mt-4 text-body-md leading-relaxed text-on-surface-variant">Member meetings are usually the second Thursday of the month at 6:00 PM PT.</p>'
      : '';

  const calendarCard = `<div><a href="${escapeHtml(site.calendar.url)}" rel="noopener" target="_blank" class="group flex min-w-0 max-w-sm items-start gap-3 bg-primary-container p-5 text-on-primary-container no-underline transition-colors hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface"><svg viewBox="0 0 24 24" class="mt-1 size-5 shrink-0" aria-hidden="true" focusable="false">${ICON_BODY.calendar}</svg><span><span class="block text-title-md">Subscribe in Google Calendar</span><span class="mt-2 block text-body-sm leading-relaxed text-on-primary-container/80 group-hover:text-surface/75 group-focus-visible:text-surface/75">Event details are kept there first when plans change.</span></span></a></div>`;

  const upcomingBody =
    upcoming.length === 0
      ? '<div class="mt-10 max-w-2xl"><p class="text-body-lg leading-relaxed text-pretty">We\'re scheduling our first public events. Coalition meetings, neighborhood walks, organizing teach-ins, and Carson&nbsp;City delegations will all land here.</p><p class="mt-5 text-body-md leading-relaxed text-on-surface-variant">Subscribe and we\'ll send the first one to your inbox before it goes anywhere else. If you\'d like to host a meeting for your community — a faith group, labor local, school, neighborhood — email <a href="mailto:hello@lasvegasfortransit.org">hello@lasvegasfortransit.org</a>.</p><a href="/go/#newsletter" class="press mt-6 inline-flex items-center bg-on-surface px-6 py-3 text-title-sm text-surface no-underline hover:bg-primary hover:text-on-primary focus-visible:bg-primary focus-visible:text-on-primary">Subscribe →</a></div>'
      : `<div class="mt-10 space-y-8 md:mt-12 md:space-y-10">${featured ? renderEventCard(featured, true, now) : ''}${
          otherUpcoming.length > 0
            ? `<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">${otherUpcoming
                .map((entry) => renderEventCard(entry, false, now))
                .join('')}</div>`
            : ''
        }</div>`;

  const pastHtml =
    past.length > 0
      ? `<section class="pt-16 md:pt-20"><h2 class="text-headline-lg">Past events</h2><ul class="mt-8 border-y border-outline-variant/20">${past
          .map(
            (entry) =>
              `<li><a href="${escapeHtml(paths.event(entry.slug))}" class="press group -mx-4 grid gap-2 border-b border-outline-variant/20 px-4 py-5 no-underline transition-colors last:border-b-0 hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface md:grid-cols-[9rem_minmax(0,1fr)_minmax(10rem,auto)] md:items-baseline md:gap-6"><span class="text-body-sm text-on-surface-variant">${escapeHtml(pastDateFmt.format(entry.data.date))}</span><span class="text-title-md">${escapeHtml(entry.data.title)}</span><span class="text-body-sm text-on-surface-variant md:text-right">${escapeHtml(whereLabel(entry.data.location))}</span></a></li>`,
          )
          .join('')}</ul></section>`
      : '';

  return `<section><div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-start"><div class="max-w-3xl"><h2 class="text-headline-lg">Upcoming events</h2><p class="mt-4 text-body-lg leading-relaxed text-on-surface-variant text-pretty">Show up to meet other riders, learn what decisions are moving, and help turn transit advocacy into public pressure.</p>${cadencesHtml}</div>${calendarCard}</div>${upcomingBody}</section>${pastHtml}`;
}

function renderDetailActions(entry: LiveEventEntry, canonical: string): string {
  const { location, admissionUrl, rsvpUrl, title, summary } = entry.data;
  const joinUrl =
    location?.format === 'virtual' || location?.format === 'hybrid' ? location.joinUrl : undefined;
  const admissionLabel = entry.data.admissionLabel ?? 'Admission';
  const icsHref = `/events/${entry.slug}.ics`;
  const outlined =
    'press inline-flex items-center border-2 border-outline px-5 py-3 text-sm font-bold no-underline hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface';

  return [
    joinUrl
      ? `<a href="${escapeHtml(joinUrl)}" data-print-url="${escapeHtml(joinUrl)}" class="press inline-flex items-center bg-primary text-on-primary px-5 py-3 text-sm font-bold no-underline hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface" rel="noopener">Join</a>`
      : '',
    admissionUrl
      ? `<a href="${escapeHtml(admissionUrl)}" data-print-url="${escapeHtml(admissionUrl)}" class="${outlined}" rel="noopener">${escapeHtml(admissionLabel)}</a>`
      : '',
    rsvpUrl
      ? `<a href="${escapeHtml(rsvpUrl)}" data-print-url="${escapeHtml(rsvpUrl)}" class="${outlined}" rel="noopener">RSVP</a>`
      : '',
    `<a href="${escapeHtml(icsHref)}" data-print-url="${escapeHtml(icsHref)}" class="${outlined}">Add to calendar →</a>`,
    `<button type="button" data-share-button data-share-url="${escapeHtml(canonical)}" data-share-title="${escapeHtml(title)}" data-share-text="${escapeHtml(summary)}" class="inline-flex items-center px-5 py-3 text-sm font-bold no-underline border-2 border-outline hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface press"><span data-share-label>Share →</span></button>`,
  ]
    .filter(Boolean)
    .join('');
}

export function renderEventDetail(
  entry: LiveEventEntry,
  bodyHtml: string | null,
  canonical: string,
  now: Date = new Date(),
): string {
  const { title, date, endDate, summary, location } = entry.data;
  const relative = relativeLabel(entry.data, now);
  const isUrgent = relative?.kind === 'live' || relative?.kind === 'today';
  const inlineRelative = relative && !isUrgent ? relative.text : null;

  const breadcrumbJson = JSON.stringify(
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Events', url: paths.events },
      { name: title },
    ]),
  );
  const breadcrumbsHtml = `<script type="application/ld+json">${breadcrumbJson}</script><nav aria-label="Breadcrumb" class="mb-6 text-body-sm font-semibold"><ol class="flex flex-wrap items-center gap-2"><li><a href="/" class="nav-link no-underline hover:text-primary">Home</a></li><li aria-hidden="true" class="text-on-surface-variant">/</li><li><a href="${escapeHtml(paths.events)}" class="nav-link no-underline hover:text-primary">Events</a></li><li aria-hidden="true" class="text-on-surface-variant">/</li><li aria-current="page" class="text-on-surface-variant">${escapeHtml(title)}</li></ol></nav>`;

  const dataFormat = location?.format ? ` data-format="${escapeHtml(location.format)}"` : '';
  const dataEnd = endDate ? ` data-end="${escapeHtml(endDate.toISOString())}"` : '';

  const headerHtml = `<header class="container-page pt-6 pb-8 md:pt-14 md:pb-10" data-event-when${dataFormat} data-start="${escapeHtml(date.toISOString())}"${dataEnd}>${breadcrumbsHtml}<p data-event-badge${!isUrgent ? ' hidden' : ''} class="mt-4 md:mt-5">${badgePill(relative)}</p><h1 class="text-headline-lg md:text-display-md ${isUrgent ? 'mt-3 md:mt-4' : 'mt-4 md:mt-5'}">${escapeHtml(title)}</h1><p class="lede mt-4 md:mt-6 max-w-2xl">${escapeHtml(summary)}</p><dl class="mt-8 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 md:mt-10 md:gap-y-6"><div><dt class="text-title-sm text-on-surface-variant">When</dt><dd class="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base font-semibold"><time datetime="${escapeHtml(date.toISOString())}" class="min-w-0">${escapeHtml(detailDateFmt.format(date))} · ${escapeHtml(formatEventTime(date))}</time><span data-event-inline${!inlineRelative ? ' hidden' : ''} class="inline-flex whitespace-nowrap font-normal text-on-surface-variant"><span data-event-inline-text>${escapeHtml(inlineRelative ?? '')}</span></span></dd></div><div><dt class="text-title-sm text-on-surface-variant">Where</dt><dd class="mt-1 text-base font-semibold">${escapeHtml(whereLabel(location))}</dd></div></dl><div class="mt-8 md:mt-10 flex flex-wrap items-center gap-3">${renderDetailActions(entry, canonical)}</div></header>`;

  const detailBody = bodyHtml
    ? `<hr class="rule-thick container-page" /><div class="container-prose pt-8 pb-16 md:pt-10 md:pb-16 prose-doc">${bodyHtml}</div>`
    : '';

  return `${headerHtml}${detailBody}`;
}

export function renderEventRemoved(): string {
  return `<section class="container-page py-16 md:py-24"><div class="max-w-2xl"><h1 class="text-headline-lg md:text-display-md">This event is no longer on LVBT's calendar.</h1><p class="mt-4 text-body-lg leading-relaxed text-on-surface-variant">Scheduled dates sometimes change or wrap up before an announcement stays live. Current meetings, walks, and actions are listed on the main calendar.</p><a href="${escapeHtml(paths.events)}" class="press mt-8 inline-flex items-center bg-on-surface px-6 py-3 text-title-sm text-surface no-underline hover:bg-primary hover:text-on-primary focus-visible:bg-primary focus-visible:text-on-primary">See upcoming events</a></div></section>`;
}

export function renderEventsUnavailable(): string {
  return `<section class="max-w-2xl py-6"><h2 class="text-headline-lg">Events are taking a moment to load.</h2><p class="mt-4 text-body-lg leading-relaxed text-on-surface-variant">Events are taking a moment to load. Try again in a few minutes, or open our public calendar directly.</p><div class="mt-6 flex flex-wrap gap-3"><a href="${escapeHtml(site.calendar.url)}" rel="noopener" target="_blank" class="press inline-flex items-center bg-on-surface px-6 py-3 text-title-sm text-surface no-underline hover:bg-primary hover:text-on-primary focus-visible:bg-primary focus-visible:text-on-primary">Open Google Calendar</a><a href="${escapeHtml(paths.events)}" class="press inline-flex items-center border-2 border-outline px-6 py-3 text-title-sm no-underline hover:bg-on-surface hover:text-surface focus-visible:bg-on-surface focus-visible:text-surface">Try again</a></div></section>`;
}
