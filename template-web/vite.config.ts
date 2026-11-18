// Vite config. Leave `base` and `build.sourcemap` as they are: the builder needs relative paths
// (the app is served from a sub-folder) and never publishes source maps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app's name and slug come from anyapp.json (written by Kiwimake); the build number from the
// builder. The app reads them as import.meta.env.VITE_KIWI_NAME, VITE_KIWI_SLUG, VITE_KIWI_BUILD.
function appMeta(): { name: string; slug: string } {
  try {
    const meta = JSON.parse(readFileSync(new URL('./anyapp.json', import.meta.url), 'utf8'));
    return { name: String(meta.name ?? 'My App'), slug: String(meta.slug ?? 'my-app') };
  } catch {
    return { name: 'My App', slug: 'my-app' };
  }
}
const meta = appMeta();
process.env.VITE_KIWI_NAME ??= meta.name;
process.env.VITE_KIWI_SLUG ??= meta.slug;
process.env.VITE_KIWI_BUILD ??= '0';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      // %KIWI_NAME% in index.html: the app's name, safely escaped.
      name: 'kiwi-name',
      transformIndexHtml: (html) => html.replaceAll('%KIWI_NAME%', escapeHtml(process.env.VITE_KIWI_NAME ?? meta.name)),
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
