// Tags cross-document view transitions with a type so navigations into and out
// of the QR presenter (/qr) can animate differently — see the
// `:active-view-transition-type(...)` rules in global.css.
//
//   to-qr   : the footer Scan-cards glyph container-transforms into the live
//             first code on /qr.
//   from-qr : the presenter sinks away while the destination rises back in,
//             without morphing toward the (usually off-screen) footer glyph.
//
// Pure progressive enhancement: browsers without the View Transitions types
// API simply skip this and fall back to the default fade + rise.
(() => {
  const QR_PATH = '/qr';
  const isQr = (pathname) => pathname === QR_PATH || pathname.startsWith(QR_PATH + '/');

  function typeFor(fromPath, toPath) {
    if (!fromPath || !toPath) return null;
    if (!isQr(fromPath) && isQr(toPath)) return 'to-qr';
    if (isQr(fromPath) && !isQr(toPath)) return 'from-qr';
    return null;
  }

  const pathOf = (url) => {
    try {
      return new URL(url).pathname;
    } catch {
      return null;
    }
  };

  // Outbound side: fires on the page being navigated away from.
  window.addEventListener('pageswap', (event) => {
    const activation = event.activation;
    if (!event.viewTransition || !activation || !activation.entry) return;
    const type = typeFor(location.pathname, pathOf(activation.entry.url));
    if (type) event.viewTransition.types.add(type);
  });

  // Inbound side: fires on the freshly loaded destination page.
  window.addEventListener('pagereveal', (event) => {
    if (!event.viewTransition) return;
    const activation = window.navigation && window.navigation.activation;
    const fromPath = activation && activation.from ? pathOf(activation.from.url) : null;
    const type = typeFor(fromPath, location.pathname);
    if (type) event.viewTransition.types.add(type);
  });
})();
