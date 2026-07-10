const siteOrigin = 'https://lasvegasfortransit.org';
const siteHost = 'lasvegasfortransit.org';

function printLinkParts(value, href) {
  const candidate = value || href;
  if (!candidate) return undefined;

  if (
    !candidate.includes('://') &&
    !candidate.startsWith('/') &&
    !candidate.startsWith('mailto:')
  ) {
    return { label: candidate };
  }

  try {
    const url = new URL(candidate, siteOrigin);

    if (url.protocol === 'mailto:') {
      return { label: url.pathname };
    }

    const domain = url.hostname.replace(/^www\./, '');
    const path = `${url.pathname}${url.search}${url.hash}` || '/';

    if (domain === siteHost) {
      return {
        domain: siteHost,
        path: path === '/' ? '/' : path.replace(/\/$/, ''),
      };
    }

    return { label: `${domain}${path === '/' ? '' : path}` };
  } catch {
    return { label: candidate };
  }
}

function decoratePrintLinks() {
  for (const link of document.querySelectorAll('a[data-print-url]')) {
    if (link.querySelector('[data-print-link]')) continue;

    const parts = printLinkParts(link.getAttribute('data-print-url'), link.getAttribute('href'));
    if (!parts) continue;

    const wrapper = document.createElement('span');
    wrapper.dataset.printLink = '';
    wrapper.setAttribute('aria-hidden', 'true');

    if ('domain' in parts) {
      const domain = document.createElement('span');
      domain.dataset.printLinkDomain = '';
      domain.textContent = parts.domain;

      const path = document.createElement('span');
      path.dataset.printLinkPath = '';
      path.textContent = parts.path;

      wrapper.append(domain, path);
    } else {
      wrapper.textContent = parts.label;
    }

    link.append(wrapper);
  }
}

decoratePrintLinks();
