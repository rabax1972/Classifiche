// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// SITE_URL e BASE_PATH: indirizzo e cartella del sito pubblicato. Per Aruba li imposta scripts/dist-aruba.ts
// (https://www.giacomorabaglia.com + /classifiche); in locale (npm run dev) si possono lasciare vuote.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
    // In locale l'API degli account (public/api/index.php) la esegue il server PHP di `npm run api:dev`.
    // L'host originale deve restare (changeOrigin: false): l'API lo confronta con l'Origin e lo usa per i link nelle email.
    server: {
      proxy: { [`${(process.env.BASE_PATH || '').replace(/\/$/, '')}/api/`]: { target: 'http://127.0.0.1:8787', changeOrigin: false } },
    },
  },
});
