// Schede degli artisti per la modale delle Canzoni: introduzione della voce di Wikipedia (prima in italiano,
// poi in inglese; CC BY-SA) e foto con licenza libera da Wikimedia Commons, con autore e licenza da citare.
// Link alla pagina dell'artista su Apple Music dall'API di ricerca di iTunes.
// Lanciato da `npm run info:canzoni` dopo le schede dei brani.

import { artistKey, normalizeText, splitArtists } from '../src/lib/aggregate';
import { PERIOD_IDS, type ArtistInfo, type WikiIntro } from '../src/lib/types';
import { fetchJson } from './lib/http';
import { MetaCache, readChart } from './lib/store';
import { trimExtract } from './lib/wiki';

export const ARTIST_INFO_CACHE = 'artist-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/** Titoli tipici delle voci sugli artisti, per distinguerle dagli omonimi ("Shiva" è la divinità). */
const QUALIFIERS: Record<'it' | 'en', string[]> = {
  it: ['', 'cantante', 'rapper', 'cantautore', 'cantautrice', 'gruppo musicale', 'disc jockey', 'musicista', 'produttore discografico', 'duo musicale'],
  en: ['', 'singer', 'rapper', 'band', 'musician', 'DJ', 'record producer', 'South Korean singer', 'American singer', 'Colombian singer', 'duo'],
};

/** Parole che nella prima frase della voce indicano un artista musicale. */
const MUSIC_WORDS: Record<'it' | 'en', RegExp> = {
  it: /\b(cantant[ei]|cantautor[ei]|cantautric[ei]|rapper|trapper|gruppo musicale|band|disc jockey|dj|produttor[ei] discografic[oi]|musicist[ai]|duo musicale|compositor[ei]|beatmaker|chitarrist[ai]|pianist[ai])\b/i,
  en: /\b(singers?|rappers?|band|musicians?|disc jockey|dj|record producer|songwriters?|duo|musical group|boy band|girl group|composers?)\b/i,
};

type WikiPage = {
  title: string;
  missing?: boolean;
  length?: number;
  extract?: string;
  pageimage?: string;
  thumbnail?: { source: string };
  pageprops?: { disambiguation?: string };
  links?: { title: string }[];
};

interface WikiPages {
  query?: { pages?: WikiPage[] };
}

/** "KAROL G" → "Karol G": i titoli di Wikipedia distinguono le maiuscole (tranne la prima lettera). */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase());

const wikiPages = async (lang: 'it' | 'en', titles: string[], props: string) =>
  (
    await fetchJson<WikiPages>(
      `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(titles.join('|'))}&${props}`,
      CACHE,
    )
  ).query?.pages ?? [];

const PAGE_PROPS =
  'prop=extracts|pageimages|pageprops|info&exintro=1&explaintext=1&exlimit=max&piprop=thumbnail|name&pithumbsize=480&pilicense=free&ppprop=disambiguation';

async function wikiArtist(lang: 'it' | 'en', name: string) {
  const want = normalizeText(name);
  const names = [...new Set([name, titleCase(name)])];
  let pages = await wikiPages(lang, names.flatMap((n) => QUALIFIERS[lang].map((q) => (q ? `${n} (${q})` : n))), PAGE_PROPS);

  const isArtist = (p: WikiPage) =>
    !p.missing && !p.pageprops && Boolean(p.extract) && normalizeText(p.title.replace(/\s*\(.*\)$/, '')) === want && MUSIC_WORDS[lang].test(p.extract!.slice(0, 300));

  // Nessuna voce con i titoli tipici: prova quelle elencate nelle pagine di disambiguazione
  // (es. "Elisa (cantante 1977)").
  if (!pages.some(isArtist)) {
    const disambiguation = pages.filter((p) => p.pageprops).map((p) => p.title);
    if (disambiguation.length) {
      const linked = await wikiPages(lang, disambiguation, 'prop=links&pllimit=max&plnamespace=0');
      const titles = linked.flatMap((p) => (p.links ?? []).map((l) => l.title).filter((t) => t.startsWith(`${p.title} (`))).slice(0, 50);
      if (titles.length) pages = await wikiPages(lang, titles, PAGE_PROPS);
    }
  }

  // Due musicisti omonimi: la voce più ampia è, di solito, quella dell'artista più noto.
  const p = pages.filter(isArtist).sort((a, b) => (b.length ?? 0) - (a.length ?? 0))[0];
  if (!p) return null;
  const intro: WikiIntro = {
    lang,
    title: p.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    extract: trimExtract(p.extract!),
  };
  return { intro, image: p.pageimage && p.thumbnail ? { file: p.pageimage, src: p.thumbnail.source } : null };
}

interface CommonsInfo {
  query?: {
    pages?: {
      missing?: boolean;
      imageinfo?: { descriptionurl: string; extmetadata?: Record<string, { value: string } | undefined> }[];
    }[];
  };
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Autore e licenza della foto: senza questi dati la foto non viene usata. */
async function commonsCredit(image: { file: string; src: string }): Promise<ArtistInfo['photo']> {
  const res = await fetchJson<CommonsInfo>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&titles=${encodeURIComponent(`File:${image.file}`)}` +
      `&prop=imageinfo&iiprop=extmetadata|url&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl`,
    CACHE,
  );
  const info = res.query?.pages?.[0]?.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  const license = meta.LicenseShortName?.value;
  if (!info || !license) return null;
  const author = stripHtml(meta.Artist?.value ?? '');
  return {
    src: image.src,
    page: info.descriptionurl,
    author: author.length > 80 ? `${author.slice(0, 79)}…` : author || 'autore sconosciuto',
    license: stripHtml(license),
    licenseUrl: meta.LicenseUrl?.value ?? null,
  };
}

async function appleArtist(name: string): Promise<string | null> {
  const res = await fetchJson<{ results: { artistName?: string; artistLinkUrl?: string }[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&country=it&media=music&entity=musicArtist&limit=5`,
    CACHE,
  );
  const hit = res.results.find((r) => normalizeText(r.artistName) === normalizeText(name));
  return hit?.artistLinkUrl?.replace(/[?&]uo=\d+/, '') ?? null;
}

export async function lookupArtistInfo({ budget = 60, log = console.log } = {}) {
  const cache = await new MetaCache<ArtistInfo>(ARTIST_INFO_CACHE, 180).load();
  // Nomi da cercare: per "A e B" prima il nome intero (può essere un gruppo), poi, se non c'è, i singoli artisti.
  const names = new Map<string, string>();
  for (const period of PERIOD_IDS) {
    const chart = await readChart('canzoni', period);
    for (const v of chart?.views ?? [])
      for (const e of v.entries)
        splitArtists(e.subtitle ?? '', () => true).forEach((name, i) => {
          if (i % 2 === 0 && name.trim()) names.set(artistKey(name), name.trim());
        });
  }

  let done = 0;
  const missing: string[] = [];
  const lookup = async (name: string) => {
    const key = artistKey(name);
    if (cache.has(key)) return cache.get(key)!;
    if (done >= budget) {
      missing.push(name);
      return null;
    }
    done++;
    const found = (await wikiArtist('it', name)) ?? (await wikiArtist('en', name));
    const photo = found?.image ? await commonsCredit(found.image) : null;
    const appleUrl = await appleArtist(name);
    const info: ArtistInfo = { wiki: found?.intro ?? null, photo, appleUrl };
    cache.set(key, info);
    log(`- ${name}: ${found ? `Wikipedia ${found.intro.lang} «${found.intro.title}»` : 'Wikipedia ✗'}, foto ${photo ? '✓' : '✗'}, Apple ${appleUrl ? '✓' : '✗'}`);
    if (done % 10 === 0) await cache.save();
    return info;
  };

  try {
    for (const name of names.values()) {
      const whole = await lookup(name);
      if (/ e /i.test(name) && whole && !whole.wiki)
        for (const [i, part] of splitArtists(name).entries()) if (i % 2 === 0 && part.trim()) await lookup(part.trim());
    }
  } catch (err) {
    log(`! schede artisti: ${(err as Error).message}`); // probabilmente rate limit: riprova alla prossima run
  }
  await cache.save();
  log(`Schede artisti: ${done} nuove${missing.length ? `, ${missing.length} ancora da completare` : ''}`);
}
