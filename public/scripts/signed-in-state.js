/* global document -- a browser script served as-is from public/scripts */
// Shows the header's signed-in links ("Your account", "Sign out") in place of
// "Sign in" when the non-secret lvbt_signed_in cookie is present. The session
// itself lives in an HttpOnly cookie this script cannot read.
(() => {
  if (!/(?:^|;\s*)lvbt_signed_in=1(?:;|$)/.test(document.cookie)) return;
  for (const element of document.querySelectorAll('[data-auth]')) {
    element.hidden = element.getAttribute('data-auth') !== 'signed-in';
  }
})();
