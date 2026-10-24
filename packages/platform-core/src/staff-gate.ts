import { recoveryBrandStyles, recoveryLightLogo, recoveryDarkLogo } from './staff-gate-brand';

// Both Astro auth pages and standalone gateway responses use these exact bytes.
// Keeping the presentation self-contained also lets recovery work without assets.
export const gatePageStyles = `${recoveryBrandStyles}
* {
  box-sizing: border-box;
}
body,
h1,
p {
  margin: 0;
}
.staff-gate {
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: clamp(1rem, 4vw, 3rem);
  background: var(--color-surface-container);
  color: var(--color-on-surface);
  --gate-outline: color-mix(in srgb, var(--color-outline) 25%, transparent);
  font-size: 1rem;
  line-height: 1.55;
}
.staff-gate-frame {
  width: 100%;
  max-width: 30rem;
  min-width: 0;
}
.staff-gate-panel {
  padding: clamp(1.5rem, 5vw, 2.5rem);
  background: var(--color-surface);
  border: 1px solid var(--gate-outline);
  border-top: 4px solid var(--color-primary);
}
.staff-gate .staff-identity {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
  text-decoration: none;
  font-weight: 700;
  font-size: 1rem;
  min-height: 2.75rem;
}
.staff-gate .staff-identity-mark {
  display: block;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
}
.staff-gate .staff-identity-mark svg {
  display: block;
  width: 100%;
  height: 100%;
}
.staff-gate .staff-logo-dark {
  display: none;
}
.staff-gate h1 {
  font-size: clamp(1.625rem, 4vw, 2rem);
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -0.035em;
  text-wrap: balance;
  overflow-wrap: anywhere;
  margin-bottom: 1rem;
}
.staff-gate-body {
  display: grid;
  gap: 1.5rem;
  min-width: 0;
}
.staff-gate p {
  overflow-wrap: anywhere;
}
.staff-gate a {
  color: inherit;
  text-underline-offset: 0.2em;
}
.staff-gate a:focus-visible,
.staff-gate button:focus-visible,
.staff-gate input:focus-visible {
  outline: 3px solid var(--color-primary-ink);
  outline-offset: 4px;
}
.staff-gate-notice {
  padding: 0.875rem 1rem;
  border-left: 3px solid var(--color-primary);
  background: var(--color-surface);
  font-size: 0.9375rem;
}
.staff-gate-notice[role="alert"] {
  border-left-color: var(--color-primary-ink);
  color: var(--color-on-surface);
}
.staff-gate-account {
  padding: 1rem;
  border: 1px solid var(--gate-outline);
  border-radius: 0;
  background: var(--color-surface-container);
  font-size: 0.875rem;
  color: var(--color-on-surface-variant);
}
.staff-text-button {
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
}
.staff-gate-account strong {
  display: block;
  color: var(--color-on-surface);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.staff-gate-form,
.staff-gate-field {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.staff-gate-form {
  gap: 1.5rem;
}
.staff-gate label {
  font-weight: 650;
  font-size: 0.9375rem;
}
.staff-gate input {
  appearance: none;
  width: 100%;
  min-width: 0;
  min-height: 3rem;
  padding: 0.75rem;
  border: 1px solid var(--color-outline);
  border-radius: 0;
  background: var(--color-surface);
  color: var(--color-on-surface);
  font: inherit;
}
.staff-gate input[autocomplete="one-time-code"] {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.3em;
  font-size: 1.25rem;
}
.staff-gate-hint,
.staff-gate-help {
  font-size: 0.875rem;
  color: var(--color-on-surface-variant);
}
.staff-gate-help {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--gate-outline);
  text-align: center;
}
.staff-gate-help:empty {
  display: none;
}
.staff-gate .staff-action-link,
.staff-gate .staff-secondary-button,
.staff-gate .staff-google-button {
  display: flex;
  width: 100%;
  min-height: 3rem;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-primary);
  border-radius: 0;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: inherit;
  font-weight: 650;
  line-height: 1.4;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.staff-gate .staff-secondary-button,
.staff-gate .staff-google-button {
  border-color: var(--color-outline);
  background: var(--color-surface);
  color: var(--color-on-surface);
}
.staff-gate .staff-action-link:hover {
  background: var(--color-primary-warm);
  border-color: var(--color-primary-warm);
}
.staff-gate .staff-secondary-button:hover,
.staff-gate .staff-google-button:hover {
  background: var(--color-surface-container);
  border-color: var(--color-on-surface);
}
.staff-google-button svg {
  width: 1.25rem;
  height: 1.25rem;
  flex: none;
}
.staff-gate-link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  width: fit-content;
  font-size: 0.9375rem;
}
.staff-gate-actions {
  display: grid;
  gap: 0.75rem;
  margin-top: 1.5rem;
}
.staff-gate-report {
  margin-top: 1.5rem;
  padding: 0.875rem 1rem;
  background: var(--color-surface);
  border: 1px solid var(--gate-outline);
  font-size: 0.8125rem;
  color: var(--color-on-surface-variant);
}
.staff-gate-report strong {
  color: var(--color-on-surface);
  font-variant-numeric: tabular-nums;
}
.staff-gate-report time {
  display: block;
  margin-top: 0.25rem;
}
.staff-gate .skip-link {
  position: absolute;
  left: 1rem;
  top: 1rem;
  padding: 0.75rem;
  background: var(--color-surface);
  transform: translateY(-200%);
}
.staff-gate .skip-link:focus {
  transform: none;
}
@media (prefers-color-scheme: dark) {
  .staff-gate .staff-logo-light {
    display: none;
  }
  .staff-gate .staff-logo-dark {
    display: block;
  }
}
@media (max-width: 30rem) {
  .staff-gate {
    padding: 1rem;
  }
  .staff-gate-panel {
    padding: 1.5rem;
  }
  .staff-gate .staff-identity {
    margin-bottom: 1.5rem;
  }
}
`;

export const gateIdentity = `<a class="staff-identity" href="/" aria-label="LVBT Staff Portal home"><span class="staff-identity-mark staff-logo-light" aria-hidden="true">${recoveryLightLogo}</span><span class="staff-identity-mark staff-logo-dark" aria-hidden="true">${recoveryDarkLogo.replaceAll('clip0_1_687', 'dark_clip0_1_687').replaceAll('clip1_1_687', 'dark_clip1_1_687').replaceAll('clip2_1_687', 'dark_clip2_1_687')}</span><span>Staff Portal</span></a>`;
