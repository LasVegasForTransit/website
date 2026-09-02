/**
 * Throw a self-diagnostic error when a required content entry is missing.
 *
 * The most common reason in practice isn't that the file is actually gone —
 * it's that the dev server's content-collection cache is stale (e.g. after a
 * rename or a `.astro/` clear). The hint below tells the user exactly how to
 * fix it without bouncing back to me.
 */
export function requireEntry<T>(
  entry: T | undefined,
  collection: string,
  id: string,
): asserts entry is T {
  if (entry) return;
  throw new Error(
    `Missing ${collection}/${id}. ` +
      `Expected file at src/content/${collection}/${id}.mdx (or .md). ` +
      `If the file exists, the dev server's content-collection cache is stale — ` +
      `Ctrl+C the running \`pnpm dev\` and start it again. Production builds are unaffected.`,
  );
}
