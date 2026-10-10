/** Independent RFC 4180 reader for comparing the downloadable files to their JSON records. */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? '';
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(value);
      value = '';
    } else if (!quoted && char === '\r' && text[index + 1] === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      index++;
    } else value += char;
  }
  if (quoted) throw new Error('Unclosed CSV value');
  if (row.length || value) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
