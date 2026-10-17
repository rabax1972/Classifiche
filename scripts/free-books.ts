// Edizioni gratuite dei libri di pubblico dominio, per il link "Scarica gratis" della modale del libro.
// In Italia i diritti d'autore durano fino al 31 dicembre del 70° anno dopo la morte dell'autore (L. 633/1941,
// art. 25): un libro è libero se tutti i suoi autori sono morti da più di 70 anni (anno di morte da Wikidata,
// scripts/author-info.ts). Le opere antiche senza autore (es. "Autori vari") valgono per l'anno di composizione.
// Cerca l'opera su Liber Liber e su Wikisource in italiano: pubblicano solo testi liberi da diritti, traduzioni
// comprese. Project Gutenberg è escluso perché dall'Italia non è raggiungibile.
// Lanciato da `npm run info:libri` dopo le schede degli autori; da solo: `npx tsx scripts/free-books.ts`.

import { pathToFileURL } from 'node:url';
import { artistKey, normalizeText, splitArtists } from '../src/lib/aggregate';
import type { AuthorInfo, FreeEdition } from '../src/lib/types';
import { fetchJson } from './lib/http';
import { stripParens } from './lib/match';
import { MetaCache, todayInItaly } from './lib/store';
import { AUTHOR_INFO_CACHE } from './author-info';
import { bookTargets, type BookTarget } from './book-info';

export const FREE_BOOKS_CACHE = 'free-books';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/** Ultimo anno di morte degli autori i cui libri sono liberi quest'anno (nel 2026: morti entro il 1955). */
export const lastFreeDeathYear = (today = todayInItaly()) => Number(today.slice(0, 4)) - 71;

/** Opere senza un autore con data di morte: libere se composte prima del 1800 ("VIII secolo a.C.", "1304-1321"). */
export function ancientWork(year: number | string | undefined): boolean {
  if (typeof year === 'number') return year < 1800;
  if (!year) return false;
  if (/\b(secol[oi]|millenni[oi])\b|a\.\s?C\./i.test(year)) return true;
  const first = year.match(/\d{3,4}/)?.[0];
  return first !== undefined && Number(first) < 1800;
}

/**
 * Anno di morte dell'ultimo autore se il libro è di pubblico dominio, null se è un'opera antica senza autore,
 * undefined se è ancora protetto (o se non sappiamo quando sono morti gli autori).
 */
export function publicDomain(e: BookTarget, authors: (key: string) => AuthorInfo | undefined, limit = lastFreeDeathYear()): number | null | undefined {
  const names = splitArtists(e.subtitle ?? '').filter((n, i) => i % 2 === 0 && n.trim() && !/^autori vari$/i.test(n.trim()));
  if (!names.length) return ancientWork(e.year) ? null : undefined;
  const years = names.map((n) => authors(artistKey(n))?.died);
  if (years.some((y) => typeof y !== 'number' || y > limit)) return undefined;
  return Math.max(...(years as number[]));
}

const surnameOf = (e: BookTarget) => normalizeText(splitArtists(e.subtitle ?? '')[0]!.trim().split(' ').at(-1));
const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/** Pagina dell'opera su Liber Liber: stesso titolo, nella cartella dell'autore (/autori/autori-p/luigi-pirandello/…). */
async function liberLiber(e: BookTarget): Promise<string | null> {
  const title = normalizeText(stripParens(e.title));
  const surname = surnameOf(e).replace(/ /g, '-');
  if (!title) return null;
  const res = await fetchJson<{ title: string; url: string }[]>(
    `https://liberliber.it/wp-json/wp/v2/search?search=${encodeURIComponent(stripParens(e.title))}&subtype=page&per_page=20`,
    CACHE,
  );
  const books = res
    .filter((r) => {
      const author = r.url.match(/\/autori\/autori-[^/]+\/([^/]+)\/[^/]+\/?$/)?.[1];
      return author && (!surname || author.includes(surname)) && !/\[audiolibro\]/i.test(r.title);
    })
    .map((r) => ({ url: r.url, title: normalizeText(decode(r.title)) }));
  // Titolo identico o, tra i libri dello stesso autore, uno contenuto nell'altro ("Pinocchio" / "Le avventure di Pinocchio").
  const contains = (a: string, b: string) => b.length >= 5 && ` ${a} `.includes(` ${b} `);
  const hit = books.find((b) => b.title === title) ?? books.find((b) => contains(b.title, title) || contains(title, b.title));
  return hit?.url ?? null;
}

interface WikisourceSearch {
  query?: { pages?: { title: string; index: number; links?: { title: string }[] }[] };
}

/** L'opera su Wikisource in italiano: stesso titolo e collegamento alla pagina dell'autore ("Autore:…"). */
async function wikisource(e: BookTarget): Promise<FreeEdition['wikisource']> {
  const title = normalizeText(stripParens(e.title));
  const surname = surnameOf(e);
  if (!title) return null;
  const res = await fetchJson<WikisourceSearch>(
    `https://it.wikisource.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${encodeURIComponent(stripParens(e.title))}` +
      `&gsrnamespace=0&gsrlimit=10&prop=links&plnamespace=102&pllimit=max`,
    CACHE,
  );
  const pages = (res.query?.pages ?? []).sort((a, b) => a.index - b.index);
  const hit = pages.find(
    (p) =>
      !p.title.includes('/') &&
      normalizeText(stripParens(p.title)) === title &&
      (!surname || (p.links ?? []).some((l) => normalizeText(l.title).includes(surname))),
  );
  if (!hit) return null;
  const page = encodeURIComponent(hit.title.replace(/ /g, '_'));
  return {
    title: hit.title,
    url: `https://it.wikisource.org/wiki/${page}`,
    epub: `https://ws-export.wmcloud.org/?format=epub&lang=it&page=${page}`,
  };
}

export async function lookupFreeBooks({ log = console.log } = {}) {
  const cache = await new MetaCache<FreeEdition>(FREE_BOOKS_CACHE, 180).load();
  const authors = await new MetaCache<AuthorInfo>(AUTHOR_INFO_CACHE, 180).load();
  let free = 0;
  let done = 0;
  try {
    for (const [key, e] of await bookTargets()) {
      const died = publicDomain(e, (k) => authors.get(k));
      if (died === undefined) continue;
      free++;
      if (cache.get(key)) continue;
      done++;
      const edition: FreeEdition = { authorDied: died, liberLiber: await liberLiber(e), wikisource: await wikisource(e) };
      cache.set(key, edition);
      log(`- ${e.subtitle} – ${e.title}: Liber Liber ${edition.liberLiber ? '✓' : '✗'}, Wikisource ${edition.wikisource ? '✓' : '✗'}`);
      if (done % 10 === 0) await cache.save();
    }
  } catch (err) {
    log(`! edizioni gratuite: ${(err as Error).message}`); // probabilmente rate limit: riprova alla prossima run
  }
  await cache.save();
  log(`Libri di pubblico dominio: ${free}, ${done} cercati ora`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  lookupFreeBooks().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
