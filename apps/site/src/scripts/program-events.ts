import {
  programEventFeature,
  programEventPanel,
  selectProgramEvent,
  type ProgramEvent,
  type ProgramParticipation,
} from '../lib/program-events';

interface PanelData {
  program: ProgramParticipation;
  events: ProgramEvent[];
}
interface SerializedEvent {
  id: string;
  data: Omit<ProgramEvent['data'], 'date' | 'endDate'> & { date: string; endDate?: string };
}

const panels = new WeakMap<HTMLElement, PanelData>();

function panelData(root: HTMLElement): PanelData | undefined {
  const cached = panels.get(root);
  if (cached) return cached;
  const json = root.querySelector('[data-program-events]')?.textContent;
  if (!json) return undefined;
  const raw = JSON.parse(json) as { program: ProgramParticipation; events: SerializedEvent[] };
  const data = {
    program: raw.program,
    events: raw.events.map(({ id, data }) => ({
      id,
      data: {
        ...data,
        date: new Date(data.date),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    })),
  };
  panels.set(root, data);
  return data;
}

function text(root: HTMLElement, slot: string, value?: string): void {
  const element = root.querySelector(`[data-program-event-${slot}]`);
  if (element) element.textContent = value ?? '';
}

function show(root: HTMLElement, slot: string, visible: boolean): void {
  const element = root.querySelector<HTMLElement>(`[data-program-event-${slot}]`);
  if (element) element.hidden = !visible;
}

function attribute(root: HTMLElement, slot: string, name: string, value?: string): void {
  const element = root.querySelector(`[data-program-event-${slot}]`);
  if (!element) return;
  if (value) element.setAttribute(name, value);
  else element.removeAttribute(name);
}

function applyFeature(
  root: HTMLElement,
  data: PanelData,
  event: ProgramEvent | undefined,
  now: Date,
): void {
  const feature = programEventFeature(data.program, event, now);
  text(root, 'heading', feature.heading);
  text(root, 'topic', feature.headline);
  show(root, 'date-group', !!feature.dateLabel);
  text(root, 'feature-date', feature.dateLabel);
  attribute(root, 'date', 'datetime', feature.dateIso);
  text(root, 'time', feature.timeLabel);
  show(root, 'separator', !!feature.timeLabel && !!feature.venue);
  text(
    root,
    'venue-name',
    feature.venue
      ? `${feature.venue.name}${feature.venue.tentative ? ' (tentative)' : ''}`
      : undefined,
  );
  show(root, 'action-group', !!feature.action);
  text(root, 'action-label', feature.action?.label);
  attribute(root, 'action', 'href', feature.action?.href);
  attribute(root, 'action', 'data-print-url', feature.action?.href);
  text(root, 'print-url', feature.printUrl);
}

function apply(root: HTMLElement, now: Date): void {
  const data = panelData(root);
  if (!data) return;
  const event = selectProgramEvent(data.events, data.program.calendarSeriesUid, now);
  if (root.hasAttribute('data-program-event-feature')) {
    applyFeature(root, data, event, now);
    return;
  }
  const panel = programEventPanel(data.program, event, now);
  text(root, 'heading', panel.heading);
  show(root, 'date-group', !!panel.eventHref);
  show(root, 'schedule', !panel.eventHref);
  text(root, 'schedule', panel.schedule);
  text(root, 'link', panel.dateLabel);
  attribute(root, 'link', 'href', panel.eventHref);
  attribute(root, 'date', 'datetime', panel.dateIso);
  text(root, 'time', panel.timeLabel);
  show(root, 'venue', !!panel.venue);
  show(root, 'venue-link-group', !!panel.venue?.mapUrl);
  show(root, 'venue-name', !panel.venue?.mapUrl);
  text(root, 'venue-link', panel.venue?.name);
  text(root, 'venue-name', panel.venue?.name);
  attribute(root, 'venue-link', 'href', panel.venue?.mapUrl);
  text(
    root,
    'venue-address',
    [panel.venue?.address, panel.venue?.tentative ? '(tentative)' : undefined]
      .filter(Boolean)
      .join(' '),
  );
  show(root, 'action-group', !!panel.action);
  text(root, 'action-label', panel.action?.label);
  attribute(root, 'action', 'href', panel.action?.href);
}

function render(): void {
  const now = new Date();
  document
    .querySelectorAll<HTMLElement>('[data-program-event-panel]')
    .forEach((root) => apply(root, now));
}

render();
window.setInterval(render, 60_000);
document.addEventListener('astro:page-load', render);
