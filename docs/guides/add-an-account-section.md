# Add an account section

Use an account section when a member needs to view or change something about their LVBT account.
Keep the heading, explanation and actions focused on that person's choices. Connection processing,
role assignment and other implementation details belong in developer documentation.

## Before you start

Complete [local setup](../tutorials/first-time-setup.md), create a branch, and identify the member
action this section supports. Use test members when checking personal values or forms.

## Create the section

Add an Astro component under `apps/site/src/components/account/`. It contains the heading and
content; the account layout supplies its outer section and anchor. Use the shared app components and
named theme colors so the section works with the rest of the account page. Put all visible text in
the [message catalog](../../packages/platform-core/src/messages/en.ts).

The account is built as a template and filled on each signed-in request. For personal values, mark
the place where each value belongs with a `data-slot` attribute, then fill it through
[`functions/account/index.ts`](../../apps/site/functions/account/index.ts). Derive those values from
the current session. Never put a member record in a build-time component or public asset.

## Register it

Import the component in
[`components/account/AccountSections.astro`](../../apps/site/src/components/account/AccountSections.astro)
and add one registration:

```ts
const section = {
  id: 'preferences',
  position: 40,
  component: Preferences,
  navigationLabel: t('account.preferencesNav'),
  slot: null,
  className: '',
};
```

This example assumes a `Preferences.astro` component and a catalog entry for its navigation label.
The registration creates both the section and its navigation link. You do not edit the account
page's layout. Use a unique, short anchor and position. Membership occupies 10, details 20, the
mailing list 30, Discord 60, and personal data 90. New sections normally go between 30 and 90.

For an optional section, set `slot` to a unique name. Its section and navigation link start hidden.
The request handler reveals both `[data-slot="name"]` and `[data-slot="name-nav"]` only when the
section applies to the signed-in person. Discord's
[profile renderer](../../apps/site/platform/discord-profile-page.ts) demonstrates this pattern.

## Check the result

Run `pnpm check`, then inspect the account with JavaScript disabled at phone and desktop widths.
Confirm that the new section and navigation link appear in the same order, the link reaches its
heading, and an unavailable optional section leaves no visible link. Check sign-in and response
privacy through the compiled Worker, as well as any personal values or forms you add.
