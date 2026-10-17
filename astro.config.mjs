// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// SITE_URL e BASE_PATH: indirizzo e cartella del sito pubblicato. Per Aruba li imposta scripts/dist-aruba.ts
// (https://www.giacomorabaglia.com + /classifiche); in locale (npm run dev) si possono lasciare vuote.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  vite: { plugins: [tailwindcss()] },
});
