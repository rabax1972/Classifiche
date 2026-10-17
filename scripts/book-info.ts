// Schede dei libri (e poi degli autori, scripts/author-info.ts) per le modali dei Libri: la trama è la presentazione
// dell'editore su Apple Books (API di lookup di iTunes), citata in pagina con il link al libro; genere, uscita e
// copertina grande dalla stessa scheda. Senza presentazione, l'introduzione della voce di Wikipedia (CC BY-SA).
//
// Oltre ai libri in classifica, anche quelli delle liste curate ("Libri da avere" e Le Monde).
//
//   npm run info:libri               completa le schede mancanti (con un budget per run)
//   npm run info:libri -- --all      senza budget (prima run)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryKey, normalizeText } from '../src/lib/aggregate';
import { PERIOD_IDS, type BookInfo, type CuratedList, type RankedEntry } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { fetchJson } from './lib/http';
import { curatedKey, nameMatch, overlap, stripParens } from './lib/match';
import { DATA_DIR, MetaCache, readChart } from './lib/store';
import { trimExtract, wikiUrl } from './lib/wiki';
import { lookupAuthorInfo } from './author-info';

export const BOOK_INFO_CACHE = 'book-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };
/** Sotto questa lunghezza (caratteri) la presentazione dell'editore cede il posto a Wikipedia, se c'è. */
const MIN_BLURB = 250;

interface ItunesBook {
  kind?: string;
  trackName?: string;
  artistName?: string;
  artistViewUrl?: string;
  description?: string;
  genres?: string[];
  releaseDate?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

const firstAuthor = (s: string | null) => (s ?? '').split(/,| & | e /i)[0]!.trim();
const cleanUrl = (url: string | undefined) => url?.replace(/[?&]uo=\d+/, '') ?? null;

/** Un libro di cui serve la scheda: dalla classifica Libri o da una lista curata. */
export type BookTarget = Pick<RankedEntry, 'title' | 'subtitle' | 'cover' | 'sourceUrl' | 'externalId'>;

const CURATED_BOOKS = ['libri-da-avere', 'libri-le-monde'];

/** Tutti i libri delle pagine, per chiave (entryKey per la classifica, curatedKey per le liste). */
export async function bookTargets(): Promise<Map<string, BookTarget>> {
  const out = new Map<string, BookTarget>();
  for (const period of PERIOD_IDS) {
    const chart = await readChart('libri', period);
    for (const v of chart?.views ?? []) for (const e of v.entries) if (!out.has(entryKey(e))) out.set(entryKey(e), e);
  }
  for (const id of CURATED_BOOKS) {
    const list = JSON.parse(await readFile(path.join(DATA_DIR, 'curated', `${id}.json`), 'utf8')) as CuratedList;
    for (const e of list.entries) {
      const appleId = e.url?.match(/books\.apple\.com\/.*\/id(\d+)/)?.[1];
      out.set(curatedKey(e), { title: e.title, subtitle: e.creator, cover: e.cover ?? null, sourceUrl: e.url ?? null, externalId: appleId ? `apple:${appleId}` : null });
    }
  }
  return out;
}

async function itunesBook(e: BookTarget): Promise<ItunesBook | null> {
  const id = e.externalId?.match(/^apple:(\d+)$/)?.[1];
  if (id) {
    const res = await fetchJson<{ results: ItunesBook[] }>(`https://itunes.apple.com/lookup?id=${id}&country=it`, CACHE);
    const hit = res.results.find((r) => r.kind === 'ebook');
    if (hit) return hit;
  }
  const term = encodeURIComponent(`${stripParens(e.title)} ${firstAuthor(e.subtitle)}`);
  const res = await fetchJson<{ results: ItunesBook[] }>(`https://itunes.apple.com/search?term=${term}&country=it&media=ebook&entity=ebook&limit=5`, CACHE);
  return (
    res.results.find(
      (r) => overlap(stripParens(e.title), r.trackName ?? '') >= 0.8 && nameMatch(firstAuthor(e.subtitle), r.artistName ?? '') >= 0.5,
    ) ?? null
  );
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };

/**
 * Presentazione dell'editore in testo semplice: un paragrafo per riga, senza le righe di soli hashtag
 * ("#Spicy #HateToLove") che alcuni editori aggiungono in fondo.
 */
export function blurbText(html: string): string {
  return html
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) =>
      code[0] === '#' ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? m),
    )
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter((l) => l && !/^(#\S+\s*)+$/.test(l))
    .join('\n');
}

interface WikiSearch {
  query?: { pages?: { title: string; index: number; extract?: string }[] };
}

/** Parole che nella prima frase di una voce indicano un libro (e non un film o una serie omonima). */
const BOOK_WORDS: Record<'it' | 'en', RegExp> = {
  it: /\b(romanz[oi]|libr[oi]|saggi[oi]?|raccolta|raccont[oi]|novella|thriller|giallo|opera letteraria)\b/i,
  en: /\b(novels?|books?|novella|memoir|essay|short stor(y|ies)|non-fiction)\b/i,
};

/** Introduzione della voce sul libro, solo se il titolo coincide e la voce cita l'autore. */
async function wikiIntro(lang: 'it' | 'en', e: BookTarget): Promise<BookInfo['wiki']> {
  const title = normalizeText(stripParens(e.title));
  const surname = normalizeText(firstAuthor(e.subtitle).split(' ').at(-1));
  if (!title || !surname) return null;
  const q = encodeURIComponent(`${stripParens(e.title)} ${firstAuthor(e.subtitle)}`);
  const res = await fetchJson<WikiSearch>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${q}&gsrlimit=5` +
      `&prop=extracts&exintro=1&explaintext=1&exlimit=max&redirects=1`,
    CACHE,
  );
  const pages = (res.query?.pages ?? []).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    if (normalizeText(stripParens(p.title)) !== title) continue;
    const extract = p.extract?.trim() ?? '';
    if (!BOOK_WORDS[lang].test(extract.slice(0, 300)) || !normalizeText(extract).includes(surname)) continue;
    return { lang, title: p.title, url: wikiUrl(lang, p.title), extract: trimExtract(extract) };
  }
  return null;
}

/** Genere più specifico tra quelli di Apple Books ("Libri" è la categoria generica). */
const bookGenre = (genres: string[] | undefined) => genres?.filter((g) => g !== 'Libri' && g !== 'Books').at(-1) ?? null;

export async function lookupBookInfo({ budget = 60, log = console.log } = {}) {
  const cache = await new MetaCache<BookInfo>(BOOK_INFO_CACHE, 180).load();
  const entries = await bookTargets();

  let done = 0;
  for (const [key, e] of entries) {
    if (cache.has(key)) continue;
    if (done >= budget) break;
    done++;
    try {
      const b = await itunesBook(e);
      const text = b?.description ? trimExtract(blurbText(b.description), 1400) || null : null;
      // Una presentazione breve è spesso solo una nota sull'edizione ("A cura di…", "Edizione integrale"):
      // in quel caso, se c'è, è meglio la voce di Wikipedia.
      const wiki = text && text.length >= MIN_BLURB ? null : ((await wikiIntro('it', e)) ?? (await wikiIntro('en', e)));
      const blurb = wiki ? null : text;
      cache.set(key, {
        blurb,
        wiki,
        released: b?.releaseDate?.slice(0, 10) ?? null,
        genre: bookGenre(b?.genres),
        cover: biggerArtwork(b?.artworkUrl100, 600) ?? biggerArtwork(e.cover ?? undefined, 600),
        appleUrl: cleanUrl(b?.trackViewUrl) ?? e.sourceUrl,
        authorUrl: cleanUrl(b?.artistViewUrl),
      });
      log(`- ${e.subtitle} – ${e.title}: ${b ? 'Apple Books ✓' : 'Apple Books ✗'}, trama ${blurb ? '✓' : wiki ? `Wikipedia ${wiki.lang}` : '✗'}`);
    } catch (err) {
      log(`! ${e.subtitle} – ${e.title}: ${(err as Error).message}`);
      break; // probabilmente rate limit: riprova alla prossima run
    }
    if (done % 10 === 0) await cache.save();
  }
  await cache.save();
  const missing = [...entries.keys()].filter((k) => !cache.has(k)).length;
  log(`Schede libri: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const budget = process.argv.includes('--all') ? Infinity : 60;
  Promise.resolve()
    .then(() => lookupBookInfo({ budget }))
    .then(() => lookupAuthorInfo({ budget }))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
