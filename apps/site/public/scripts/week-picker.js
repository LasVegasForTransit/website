/* global window, document -- a browser script served as-is from public/scripts */
/* Enhances a [data-week-picker] grid of hour checkboxes. Without it every
 * hour is an ordinary checkbox. With it:
 *  - quick-fill buttons ([data-preset] lists slot values) turn a block of
 *    hours on, or off again when the whole block is already on,
 *  - a mouse or pen can drag across hours to paint them on or off (touch
 *    keeps tapping so the page still scrolls),
 *  - arrow keys move between hours, and the grid is one tab stop.
 * Programmatic changes fire `change` on the form so app-enhance.js saves the
 * draft.
 */
(() => {
  function wire(root) {
    if (root.dataset.wired) return;
    root.dataset.wired = 'true';
    const boxes = [...root.querySelectorAll('input[type="checkbox"]')];
    const byValue = new Map(boxes.map((box) => [box.value, box]));
    const presets = [...root.querySelectorAll('[data-preset]')];
    const slotsOf = (button) => button.dataset.preset.split(' ').map((value) => byValue.get(value));

    function sync() {
      for (const button of presets) {
        const on = slotsOf(button).every((box) => box?.checked);
        button.setAttribute('aria-pressed', String(on));
      }
    }
    function changed() {
      sync();
      root.closest('form')?.dispatchEvent(new Event('change', { bubbles: true }));
    }

    for (const button of presets) {
      button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') !== 'true';
        for (const box of slotsOf(button)) if (box) box.checked = on;
        changed();
      });
    }
    root.querySelector('[data-clear]')?.addEventListener('click', () => {
      for (const box of boxes) box.checked = false;
      changed();
    });
    root.querySelector('[data-presets]').hidden = false;
    paint(root, byValue, changed);
    keys(root, boxes, byValue);
    root.addEventListener('change', (event) => {
      if (boxes.includes(event.target)) sync();
    });
    // app-enhance.js may restore a saved draft after this runs.
    window.setTimeout(sync);
  }

  function paint(root, byValue, changed) {
    // Drag to paint. The first hour pressed decides whether the drag turns
    // hours on or off. The click that follows is cancelled so it doesn't
    // undo the first hour.
    let painting = null;
    let cancelClick = false;
    const boxAt = (target) => target.closest?.('label')?.querySelector('input[type="checkbox"]');
    root.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      const box = boxAt(event.target);
      if (!box || !byValue.has(box.value)) return;
      event.preventDefault();
      painting = !box.checked;
      box.checked = painting;
      box.focus({ preventScroll: true });
      cancelClick = true;
      changed();
    });
    root.addEventListener('pointerover', (event) => {
      if (painting === null) return;
      const box = boxAt(event.target);
      if (box && byValue.has(box.value) && box.checked !== painting) {
        box.checked = painting;
        changed();
      }
    });
    window.addEventListener('pointerup', () => {
      painting = null;
      window.setTimeout(() => (cancelClick = false));
    });
    root.addEventListener(
      'click',
      (event) => {
        if (cancelClick && boxAt(event.target)) event.preventDefault();
      },
      true,
    );
  }

  function keys(root, boxes, byValue) {
    // One tab stop for the grid; arrow keys move within it.
    const columns = root.querySelectorAll('thead th').length || 7;
    const rove = (current) => {
      for (const box of boxes) box.tabIndex = box === current ? 0 : -1;
    };
    rove(boxes.find((box) => box.checked) ?? boxes[0]);
    root.addEventListener('focusin', (event) => {
      if (byValue.has(event.target.value) && boxes.includes(event.target)) rove(event.target);
    });
    root.addEventListener('keydown', (event) => {
      const index = boxes.indexOf(event.target);
      if (index < 0) return;
      const column = index % columns;
      const next = {
        ArrowLeft: column > 0 ? index - 1 : -1,
        ArrowRight: column < columns - 1 ? index + 1 : -1,
        ArrowUp: index - columns,
        ArrowDown: index + columns,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      boxes[next]?.focus();
    });
  }

  function run() {
    for (const root of document.querySelectorAll('[data-week-picker]')) wire(root);
  }
  run();
  document.addEventListener('astro:page-load', run);
})();
