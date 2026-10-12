// @ts-check
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// SITE_URL e BASE_PATH servono per GitHub Pages (es. https://utente.github.io + /classifiche-italia).
// Su Vercel/Netlify si possono lasciare vuote.
export default defineConfig({
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  vite: { plugins: [tailwindcss()] },
});
