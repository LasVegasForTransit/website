/** Optional local enhancement; the native POST remains the fallback. */
function enhancePaperEntry() {
  const form = document.querySelector<HTMLFormElement>('[data-paper-form]');
  const rows = form?.querySelector<HTMLElement>('[data-paper-rows]');
  const template = form?.querySelector<HTMLTemplateElement>('#paper-row-template');
  const count = form?.querySelector<HTMLInputElement>('input[name="row_count"]');
  const button = form?.querySelector<HTMLButtonElement>('[data-add-paper-row]');
  if (!form || !rows || !template || !count || !button) return;
  const maximum = Number(form.dataset.maxRows);
  const label = form.dataset.rowLabel;
  if (!Number.isInteger(maximum) || !label) return;
  button.addEventListener('click', (event) => {
    const index = rows.querySelectorAll('fieldset.staff-paper-row').length;
    const row = template.content.querySelector('fieldset')?.cloneNode(true);
    if (!(row instanceof HTMLFieldSetElement) || index >= maximum) return;
    event.preventDefault();
    for (const element of row.querySelectorAll('[id],[for],[name]')) {
      for (const attribute of element.getAttributeNames()) {
        const value = element.getAttribute(attribute);
        if (value !== null)
          element.setAttribute(
            attribute,
            value
              .replaceAll(`row-${maximum}-`, `row-${index}-`)
              .replaceAll(`rows.${maximum}.`, `rows.${index}.`),
          );
      }
    }
    const legend = row.querySelector('legend');
    if (legend) legend.textContent = label.replace('{number}', String(index + 1));
    rows.appendChild(row);
    count.value = String(index + 1);
    button.hidden = index + 1 >= maximum;
    row.querySelector<HTMLInputElement>('input')?.focus();
  });
}
enhancePaperEntry();
export {};
