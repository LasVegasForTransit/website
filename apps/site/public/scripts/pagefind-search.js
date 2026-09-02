(() => {
  const roots = document.querySelectorAll('[data-site-search]');
  if (roots.length === 0) return;

  let pagefindPromise;

  const getPagefind = () => {
    pagefindPromise ??= import('/pagefind/pagefind.js');
    return pagefindPromise;
  };

  const setStatus = (root, message) => {
    const status = root.querySelector('[data-site-search-status]');
    if (status) status.textContent = message;
  };

  const clearResults = (root) => {
    const results = root.querySelector('[data-site-search-results]');
    if (results) results.replaceChildren();
  };

  const renderResults = async (root, query) => {
    const results = root.querySelector('[data-site-search-results]');
    if (!results) return;

    if (query.length < 2) {
      clearResults(root);
      setStatus(root, query.length === 0 ? '' : 'Type at least two characters.');
      return;
    }

    setStatus(root, 'Checking the map...');

    try {
      const pagefind = await getPagefind();
      const search = await pagefind.search(query);
      const items = await Promise.all(search.results.slice(0, 5).map((result) => result.data()));

      results.replaceChildren(
        ...items.map((item) => {
          const listItem = document.createElement('li');
          listItem.className = 'site-search__result';

          const link = document.createElement('a');
          link.href = item.url;
          link.textContent = item.meta?.title || item.url;

          const excerpt = document.createElement('p');
          excerpt.className = 'text-body-sm';
          excerpt.innerHTML = item.excerpt || item.meta?.description || item.url;

          listItem.append(link, excerpt);
          return listItem;
        }),
      );

      setStatus(
        root,
        items.length === 0
          ? 'No matching stops yet.'
          : `${items.length} stop${items.length === 1 ? '' : 's'} found.`,
      );
    } catch {
      clearResults(root);
      setStatus(root, 'Search is available after the site is built. Use the links below for now.');
    }
  };

  roots.forEach((root) => {
    const form = root.querySelector('[data-site-search-form]');
    const input = root.querySelector('[data-site-search-input]');
    if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) return;

    let timer;

    const queueSearch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void renderResults(root, input.value.trim());
      }, 180);
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void renderResults(root, input.value.trim());
    });

    input.addEventListener('input', queueSearch);
  });
})();
