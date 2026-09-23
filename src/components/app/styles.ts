// Class lists shared by the app patterns, so every screen looks and behaves
// the same. Colors, sizes and spacing come only from the brand tokens that
// Tailwind exposes (see docs/reference/design-tokens.md).

export const labelClass = 'block font-bold';
export const hintClass = 'mt-1 text-sm max-w-prose';
export const errorClass = 'mt-2 font-bold text-primary-ink';
export const inputClass =
  'mt-2 block w-full px-4 py-3 border-2 border-on-surface bg-surface text-on-surface disabled:opacity-60 aria-[invalid=true]:border-primary-ink';
export const choiceClass = 'mt-1 size-5 shrink-0 accent-primary';

const buttonBase =
  'press inline-flex items-center justify-center gap-1.5 px-6 py-3 font-bold border-2 disabled:opacity-60 aria-disabled:opacity-60';

export const buttonClass = {
  primary: `${buttonBase} bg-on-surface text-surface border-on-surface hover:bg-primary hover:border-primary hover:text-on-primary focus-visible:bg-primary focus-visible:text-on-primary`,
  secondary: `${buttonBase} bg-transparent text-on-surface border-on-surface hover:bg-surface-container`,
  destructive: `${buttonBase} bg-primary-ink text-on-primary border-primary-ink hover:bg-on-surface hover:border-on-surface`,
} as const;

export const linkClass = 'font-bold underline underline-offset-4 decoration-2 decoration-primary';
