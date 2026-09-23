// The pattern gallery: one page per app pattern, showing every state with
// usage, accessibility and copy notes. It is built only in local development
// and in builds that set PUBLIC_LVBT_PATTERN_GALLERY=1 (pull request previews
// and the CI audit), never in production.

export const galleryEnabled =
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- Astro's own development flag, not a build input.
  import.meta.env.DEV || import.meta.env.PUBLIC_LVBT_PATTERN_GALLERY === '1';

export interface PatternDoc {
  slug: string;
  title: string;
  use: string;
  avoid: string;
  accessibility: string;
  /** Sections of docs/explanation/app-copy.md that apply. */
  copy: { anchor: string; label: string }[];
}

export const PATTERNS: PatternDoc[] = [
  {
    slug: 'text-field',
    title: 'Text field',
    use: 'For a single answer the person types: an email address, a name, a phone number or a one-time code.',
    avoid: 'For a choice from a known list; use a choice group or a select.',
    accessibility:
      'The label is always visible and tied to the field. The hint and, after a failed submit, the error are read with the field. One-time code fields are never saved as drafts.',
    copy: [
      { anchor: 'hints', label: 'Hints' },
      { anchor: 'errors', label: 'Errors' },
      { anchor: 'personal-data', label: 'Personal data' },
    ],
  },
  {
    slug: 'choice-group',
    title: 'Choice group',
    use: 'For five or fewer related choices: radio buttons for one answer, checkboxes for several.',
    avoid: 'For long lists; use a select.',
    accessibility:
      'Choices sit in a fieldset whose legend is the question, so a screen reader reads the question with each choice.',
    copy: [
      { anchor: 'case', label: 'Case' },
      { anchor: 'errors', label: 'Errors' },
    ],
  },
  {
    slug: 'select',
    title: 'Select',
    use: 'For one choice from a long list, such as a district.',
    avoid: 'For five or fewer choices, which people should see all at once.',
    accessibility: 'A native select, so it works with every screen reader and keyboard.',
    copy: [{ anchor: 'case', label: 'Case' }],
  },
  {
    slug: 'error-summary',
    title: 'Error summary',
    use: 'At the top of every form, after a submit that found problems.',
    avoid: 'For problems that are not about a field; use an error notice.',
    accessibility:
      'It receives focus when shown, is announced at once, and links each error to its field.',
    copy: [{ anchor: 'errors', label: 'Errors' }],
  },
  {
    slug: 'button',
    title: 'Button',
    use: 'To submit a form or take an action on the page.',
    avoid: 'To go somewhere; use a link.',
    accessibility:
      'A real button element. While a form is sending, it says so and a second press does nothing.',
    copy: [{ anchor: 'buttons', label: 'Buttons' }],
  },
  {
    slug: 'notice',
    title: 'Notice',
    use: 'To tell someone something about the whole page: success, information, a warning or an error.',
    avoid: 'For a problem with one field; use the field error.',
    accessibility: 'Warnings and errors are announced at once; success and information politely.',
    copy: [{ anchor: 'confirmations', label: 'Confirmations' }],
  },
  {
    slug: 'offline-notice',
    title: 'Offline notice',
    use: 'On every enhanced form, so someone on a dropping connection keeps what they typed.',
    avoid: 'As a general status bar.',
    accessibility: 'Hidden until the browser reports it is offline, then announced as a warning.',
    copy: [{ anchor: 'errors', label: 'Errors' }],
  },
  {
    slug: 'step-header',
    title: 'Multi-step flow header',
    use: 'On each step of a flow with more than one page.',
    avoid: 'On a single-page form.',
    accessibility: 'The current step is marked for screen readers with aria-current="step".',
    copy: [{ anchor: 'numbers', label: 'Numbers' }],
  },
  {
    slug: 'confirmation',
    title: 'Confirmation page',
    use: 'After a form succeeds.',
    avoid: 'For a partial success; say what still needs doing instead.',
    accessibility:
      'The heading says what happened, so it is the first thing a screen reader reads.',
    copy: [{ anchor: 'confirmations', label: 'Confirmations' }],
  },
  {
    slug: 'destructive-confirmation',
    title: 'Destructive confirmation',
    use: 'Before anything that cannot be undone, such as deleting an account.',
    avoid: 'For actions that can be undone; just do them and offer an undo.',
    accessibility: 'Its own section or page, never a pop-up dialog.',
    copy: [{ anchor: 'buttons', label: 'Buttons' }],
  },
  {
    slug: 'empty-state',
    title: 'Empty state',
    use: 'Where a list has nothing in it yet, or a search found nothing.',
    avoid: 'For errors; use a notice.',
    accessibility: 'Plain text in the place the list would be.',
    copy: [{ anchor: 'empty-states', label: 'Empty states' }],
  },
  {
    slug: 'data-table',
    title: 'Data table',
    use: 'For rows of records with the same columns.',
    avoid: 'For layout, or for a single record; use a key-value summary.',
    accessibility:
      'A real table with a caption and column headers. On narrow screens each row stacks into labeled lines instead of scrolling sideways.',
    copy: [{ anchor: 'dates', label: 'Dates' }],
  },
  {
    slug: 'search-filters',
    title: 'Search and filters',
    use: 'Above a list people need to narrow down.',
    avoid: 'For fewer than about 20 items.',
    accessibility: 'A plain GET form with a search landmark, so results can be bookmarked.',
    copy: [{ anchor: 'buttons', label: 'Buttons' }],
  },
  {
    slug: 'pagination',
    title: 'Pagination',
    use: 'Below a list split across pages.',
    avoid: 'For fewer than two pages.',
    accessibility: 'A labeled navigation landmark; each page is an ordinary link.',
    copy: [{ anchor: 'links', label: 'Links' }],
  },
  {
    slug: 'signed-in-header',
    title: 'Signed-in header',
    use: 'At the top of every page for someone signed in.',
    avoid: 'On public pages for people who are not signed in.',
    accessibility: 'A labeled list of links; signing out is a form button.',
    copy: [{ anchor: 'links', label: 'Links' }],
  },
  {
    slug: 'key-value-summary',
    title: 'Key-value summary',
    use: "To show a person's details, each with a way to change it.",
    avoid: 'For many records; use a data table.',
    accessibility: 'A description list; each change link says what it changes.',
    copy: [{ anchor: 'links', label: 'Links' }],
  },
];
