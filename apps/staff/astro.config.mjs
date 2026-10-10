import { copyFile, mkdir } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { normalizeBuildPaths } from './scripts/portable-build.ts';
export default defineConfig({
  site: 'https://staff.lasvegasfortransit.org',
  output: 'server',
  session: false,
  integrations: [
    {
      name: 'lvbt-staff-build',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          // Astro injects its manifest after bundling; normalize the completed Worker too.
          await normalizeBuildPaths(new URL('../server/', dir), new URL('../../', import.meta.url));
          const fonts = new URL('fonts/', dir);
          await mkdir(fonts, { recursive: true });
          await copyFile(
            new URL('../site/public/fonts/public-sans-latin.woff2', import.meta.url),
            new URL('public-sans-latin.woff2', fonts),
          );
        },
      },
    },
  ],
  adapter: cloudflare({ imageService: 'passthrough' }),
  vite: { plugins: [tailwindcss()] },
  devToolbar: { enabled: false },
});
