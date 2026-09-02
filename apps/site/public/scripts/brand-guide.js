(() => {
  const colorButtons = document.querySelectorAll('[data-copy-color]');
  const colorStatus = document.querySelector('[data-brand-color-status]');

  colorButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const color = button.dataset.color;
      const colorText = button.dataset.colorText;
      if (!color || !colorText) return;

      try {
        await navigator.clipboard.writeText(color);
      } catch {
        // Clipboard can be blocked in tests or older browsers; the visible
        // token still confirms what was selected.
      }

      if (colorStatus) colorStatus.textContent = `${color} copied.`;
    });
  });

  const familyTabs = document.querySelectorAll('[data-logo-family-tab]');
  const themeTabs = document.querySelectorAll('[data-logo-tab]');
  const previews = document.querySelectorAll('[data-brand-logo-preview]');
  const panels = document.querySelectorAll('[data-brand-logo-panel]');
  let activeFamily = 'mark';
  let activeTheme = 'light';

  function syncLogoPanels() {
    familyTabs.forEach((tab) => {
      const selected = tab.dataset.logoFamilyTab === activeFamily;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      tab.setAttribute('aria-controls', `logos-${tab.dataset.logoFamilyTab}-${activeTheme}-panel`);
    });

    themeTabs.forEach((tab) => {
      const selected = tab.dataset.logoTab === activeTheme;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      tab.setAttribute('aria-controls', `logos-${activeFamily}-${tab.dataset.logoTab}-panel`);
    });

    previews.forEach((preview) => {
      const isActive =
        preview.dataset.logoFamily === activeFamily && preview.dataset.logoTheme === activeTheme;
      preview.hidden = !isActive;
    });

    panels.forEach((panel) => {
      const isActive =
        panel.dataset.logoFamily === activeFamily && panel.dataset.logoTheme === activeTheme;
      panel.hidden = !isActive;
    });
  }

  familyTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeFamily = tab.dataset.logoFamilyTab ?? activeFamily;
      syncLogoPanels();
    });
  });

  themeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeTheme = tab.dataset.logoTab ?? activeTheme;
      syncLogoPanels();
    });
  });

  function moveTabSelection(tabs, currentTab, direction) {
    const items = [...tabs];
    const currentIndex = items.indexOf(currentTab);
    if (currentIndex < 0) return;

    const nextIndex =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? items.length - 1
          : (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.click();
    items[nextIndex]?.focus();
  }

  function bindTabKeyboard(tabs) {
    tabs.forEach((tab) => {
      tab.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveTabSelection(tabs, tab, -1);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          moveTabSelection(tabs, tab, 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          moveTabSelection(tabs, tab, 'first');
        } else if (event.key === 'End') {
          event.preventDefault();
          moveTabSelection(tabs, tab, 'last');
        }
      });
    });
  }

  bindTabKeyboard(familyTabs);
  bindTabKeyboard(themeTabs);

  const copyButtons = document.querySelectorAll('[data-copy-logo]');
  const copyStatus = document.querySelector('[data-brand-copy-status]');

  copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const url = button.dataset.copyUrl;
      if (!url) return;

      const absoluteUrl = new URL(url, window.location.origin);
      const label = button.dataset.copyFormat ?? 'logo';

      try {
        const response = await fetch(absoluteUrl);
        const blob = await response.blob();

        if (url.endsWith('.svg')) {
          await navigator.clipboard.writeText(await blob.text());
        } else if ('ClipboardItem' in window && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob.type]: blob,
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(absoluteUrl.href);
        }

        if (copyStatus) copyStatus.textContent = `${label} copied.`;
      } catch {
        try {
          await navigator.clipboard.writeText(absoluteUrl.href);
          if (copyStatus) copyStatus.textContent = `${label} link copied.`;
        } catch {
          if (copyStatus) copyStatus.textContent = `Download ${label} instead.`;
        }
      }
    });
  });

  syncLogoPanels();

  // Table of contents: keep the sidebar open only once there is room for the
  // outside rail, and let it collapse below that point.
  const contents = document.querySelector('[data-brand-contents]');
  if (contents) {
    const wide = window.matchMedia('(min-width: 1400px)');
    const syncContents = () => {
      contents.open = wide.matches;
    };
    syncContents();
    wide.addEventListener('change', syncContents);
  }

  // Scroll-spy: highlight the contents link for the section nearest the top.
  const contentsLinks = [...document.querySelectorAll('[data-brand-contents-link]')];
  if (contentsLinks.length && 'IntersectionObserver' in window) {
    const targets = [];
    contentsLinks.forEach((link) => {
      const id = (link.getAttribute('href') || '').slice(1);
      const target = id && document.getElementById(id);
      if (target) targets.push(target);
    });

    const setActive = (id) => {
      contentsLinks.forEach((link) => {
        if (link.getAttribute('href') === `#${id}`) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    };

    if (targets.length) {
      const spy = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible[0]) setActive(visible[0].target.id);
        },
        { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
      );
      targets.forEach((target) => spy.observe(target));
    }
  }
})();
