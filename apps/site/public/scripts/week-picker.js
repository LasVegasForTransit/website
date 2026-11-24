/* global window, document -- a browser script served as-is from public/scripts */
/* Enhances a [data-week-picker] grid of hours. Without it every hour is a
 * plain "free" checkbox. With it:
 *  - "Mark hours as" picks Free or If needed; a click, tap or Space sets an
 *    hour to that mark, or clears it when it already has it. An hour marked
 *    If needed shows as a mixed checkbox and ticks its hidden if_needed box,
 *  - quick fill ([data-preset] lists hours) marks a block of hours, or clears
 *    it again when the whole block already has the mark,
 *  - a mouse or pen can drag across hours (touch keeps tapping so the page
 *    still scrolls), and arrow keys move between hours in one tab stop.
 * Changes fire `change` on the form so app-enhance.js saves the draft.
 */
(() => {
  function cellsOf(root) {
    return [...root.querySelectorAll('.week-cell')].map((label) => ({
      free: label.querySelector('input[name="hours"]'),
      maybe: label.querySelector('input[name="if_needed"]'),
    }));
  }
  const stateOf = (cell) => (cell.free.checked ? 'free' : cell.maybe.checked ? 'if_needed' : '');
  function setState(cell, state) {
    cell.free.checked = state === 'free';
    cell.maybe.checked = state === 'if_needed';
    cell.free.indeterminate = state === 'if_needed';
  }

  function wire(root) {
    if (root.dataset.wired) return;
    root.dataset.wired = 'true';
    const cells = cellsOf(root);
    const byValue = new Map(cells.map((cell) => [cell.free.value, cell]));
    const presets = [...root.querySelectorAll('[data-preset]')];
    const brush = () => root.querySelector('input[name="brush"]:checked')?.value ?? 'free';
    const slotsOf = (button) => button.dataset.preset.split(' ').map((value) => byValue.get(value));

    function sync() {
      for (const cell of cells) cell.free.indeterminate = cell.maybe.checked;
      for (const button of presets) {
        const on = slotsOf(button).every((cell) => cell && stateOf(cell) === brush());
        button.setAttribute('aria-pressed', String(on));
      }
    }
    function changed() {
      sync();
      root.closest('form')?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const toggled = (cell) => (stateOf(cell) === brush() ? '' : brush());

    for (const button of presets) {
      button.addEventListener('click', () => {
        const state = button.getAttribute('aria-pressed') === 'true' ? '' : brush();
        for (const cell of slotsOf(button)) if (cell) setState(cell, state);
        changed();
      });
    }
    for (const button of root.querySelectorAll('[data-clear]')) {
      button.addEventListener('click', () => {
        for (const cell of cells) setState(cell, '');
        changed();
      });
    }
    for (const radio of root.querySelectorAll('input[name="brush"]')) {
      radio.addEventListener('change', sync);
    }
    root.querySelector('[data-tools]').hidden = false;
    paint(root, byValue, toggled, changed);
    keys(root, cells);
    // app-enhance.js may restore a saved draft after this runs.
    window.setTimeout(sync);
  }

  function paint(root, byValue, toggled, changed) {
    // A click or Space on an hour sets it to the chosen mark. The browser's
    // own toggle is cancelled, so the state is set after the event ends.
    let painting = null;
    let cancelClick = false;
    const cellAt = (target) =>
      byValue.get(target.closest?.('.week-cell')?.querySelector('input[name="hours"]')?.value);
    root.addEventListener(
      'click',
      (event) => {
        const cell = cellAt(event.target);
        if (!cell) return;
        event.preventDefault();
        if (cancelClick) return;
        const state = toggled(cell);
        cell.free.focus({ preventScroll: true });
        window.setTimeout(() => {
          setState(cell, state);
          changed();
        });
      },
      true,
    );
    // Drag to paint: the first hour decides the state for the whole drag.
    root.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      const cell = cellAt(event.target);
      if (!cell) return;
      event.preventDefault();
      painting = toggled(cell);
      setState(cell, painting);
      cell.free.focus({ preventScroll: true });
      cancelClick = true;
      changed();
    });
    root.addEventListener('pointerover', (event) => {
      if (painting === null) return;
      const cell = cellAt(event.target);
      if (cell) {
        setState(cell, painting);
        changed();
      }
    });
    window.addEventListener('pointerup', () => {
      painting = null;
      window.setTimeout(() => (cancelClick = false));
    });
  }

  function keys(root, cells) {
    // One tab stop for the grid; arrow keys move within it.
    const boxes = cells.map((cell) => cell.free);
    const columns = root.querySelectorAll('thead th').length || 7;
    const rove = (current) => {
      for (const box of boxes) box.tabIndex = box === current ? 0 : -1;
    };
    rove(boxes.find((box) => box.checked) ?? boxes[0]);
    root.addEventListener('focusin', (event) => {
      if (boxes.includes(event.target)) rove(event.target);
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
