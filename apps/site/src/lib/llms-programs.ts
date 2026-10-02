import type { CollectionEntry } from 'astro:content';

type Program = CollectionEntry<'programs'>;
type WorkArea = CollectionEntry<'workAreas'>;

export function programContentLines(
  programs: Program[],
  workAreas: WorkArea[],
  url: (path: string) => string,
): string[] {
  const lines = ['# Programs', `Source: ${url('/programs')}`, ''];
  for (const program of [...programs].sort((a, b) => a.data.order - b.data.order)) {
    lines.push(`## ${program.data.title}`, `Source: ${url(`/programs/${program.id}`)}`, '');
    lines.push(program.data.summary);
    if (program.body) lines.push('', program.body.trim());
    lines.push('');
  }
  lines.push('---', '', '# Areas of work', `Source: ${url('/programs')}`, '');
  for (const area of [...workAreas].sort((a, b) => a.data.order - b.data.order)) {
    lines.push(`## ${area.data.title}`, '', area.data.summary);
    if (area.body) lines.push('', area.body.trim());
    lines.push('');
  }
  lines.push('---', '');
  return lines;
}
