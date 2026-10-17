// Schede dei brani (e poi degli artisti, scripts/artist-info.ts) per le modali delle Canzoni: album, uscita, genere e durata da iTunes,
// descrizione dall'introduzione della voce di Wikipedia (prima in italiano, poi in inglese; CC BY-SA, citata in pagina).
// I testi delle canzoni non vengono raccolti: sono protetti da diritto d'autore, la modale rimanda a un sito con licenza.
//
//   npm run info:canzoni               completa le schede mancanti dei brani in classifica (con un budget per run)
//   npm run info:canzoni -- --all      senza budget (prima run)

import { pathToFileURL } from 'node:url';
import { entryKey, normalizeText } from '../src/lib/aggregate';
import { PERIOD_IDS, type RankedEntry, type SongInfo } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { fetchJson } from './lib/http';
import { nameMatch, overlap, stripParens } from './lib/match';
import { MetaCache, readChart } from './lib/store';
import { trimExtract } from './lib/wiki';
import { lookupArtistInfo } from './artist-info';

export const SONG_INFO_CACHE = 'song-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

interface ItunesTrack {
  wrapperType?: string;
  kind?: string;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  primaryGenreName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

const firstArtist = (s: string | null) => (s ?? '').split(/,| e | & | x /i)[0]!.trim();

async function itunesTrack(e: RankedEntry): Promise<ItunesTrack | null> {
  const id = e.externalId?.match(/^apple:(\d+)$/)?.[1];
  if (id) {
    const res = await fetchJson<{ results: ItunesTrack[] }>(`https://itunes.apple.com/lookup?id=${id}&country=it`, CACHE);
    const hit = res.results.find((r) => r.wrapperType === 'track');
    if (hit) return hit;
  }
  const term = encodeURIComponent(`${stripParens(e.title)} ${firstArtist(e.subtitle)}`);
  const res = await fetchJson<{ results: ItunesTrack[] }>(
    `https://itunes.apple.com/search?term=${term}&country=it&media=music&entity=song&limit=5`,
    CACHE,
  );
  return (
    res.results.find(
      (r) => overlap(stripParens(e.title), r.trackName ?? '') >= 0.8 && nameMatch(firstArtist(e.subtitle), r.artistName ?? '') >= 0.5,
    ) ?? null
  );
}

interface WikiSearch {
  query?: { pages?: { title: string; index: number; extract?: string }[] };
}

/** Parole che nella prima frase di una voce indicano un brano (e non un album o un film omonimo). */
const SONG_WORDS: Record<'it' | 'en', RegExp> = {
  it: /\b(singolo|singoli|brano|canzone)\b/i,
  en: /\b(song|single)\b/i,
};

/** Introduzione della voce sul brano, solo se il titolo coincide e la voce cita l'artista. */
async function wikiIntro(lang: 'it' | 'en', e: RankedEntry): Promise<SongInfo['wiki']> {
  const title = normalizeText(stripParens(e.title));
  const artist = normalizeText(firstArtist(e.subtitle));
  if (!title || !artist) return null;
  const q = encodeURIComponent(`${stripParens(e.title)} ${firstArtist(e.subtitle)}`);
  const res = await fetchJson<WikiSearch>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${q}&gsrlimit=5` +
      `&prop=extracts&exintro=1&explaintext=1&exlimit=max&redirects=1`,
    CACHE,
  );
  const pages = (res.query?.pages ?? []).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    if (normalizeText(stripParens(p.title)) !== title) continue;
    const extract = p.extract?.trim() ?? '';
    const firstSentence = extract.slice(0, 300);
    const song = firstSentence.search(SONG_WORDS[lang]);
    const album = firstSentence.search(/\balbum\b/i);
    if (song < 0 || (album >= 0 && album < song)) continue;
    if (!normalizeText(extract).includes(artist)) continue;
    return {
      lang,
      title: p.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      extract: trimExtract(extract),
    };
  }
  return null;
}

export async function lookupSongInfo({ budget = 60, log = console.log } = {}) {
  const cache = await new MetaCache<SongInfo>(SONG_INFO_CACHE, 180).load();
  const entries = new Map<string, RankedEntry>();
  for (const period of PERIOD_IDS) {
    const chart = await readChart('canzoni', period);
    for (const v of chart?.views ?? []) for (const e of v.entries) if (!entries.has(entryKey(e))) entries.set(entryKey(e), e);
  }

  let done = 0;
  for (const [key, e] of entries) {
    if (cache.has(key)) continue;
    if (done >= budget) break;
    done++;
    try {
      const t = await itunesTrack(e);
      const wiki = (await wikiIntro('it', e)) ?? (await wikiIntro('en', e));
      cache.set(key, {
        album: t?.collectionName?.replace(/ - Single$/, '') ?? null,
        released: t?.releaseDate?.slice(0, 10) ?? null,
        genre: t?.primaryGenreName ?? null,
        durationMs: t?.trackTimeMillis ?? null,
        cover: biggerArtwork(t?.artworkUrl100, 600) ?? biggerArtwork(e.cover ?? undefined, 600),
        appleUrl: t?.trackViewUrl?.replace(/[?&]uo=\d+/, '') ?? null,
        wiki,
      });
      log(`- ${e.subtitle} – ${e.title}: ${t ? 'iTunes ✓' : 'iTunes ✗'}, ${wiki ? `Wikipedia ${wiki.lang} ✓` : 'Wikipedia ✗'}`);
    } catch (err) {
      log(`! ${e.subtitle} – ${e.title}: ${(err as Error).message}`);
      break; // probabilmente rate limit: riprova alla prossima run
    }
    if (done % 10 === 0) await cache.save();
  }
  await cache.save();
  const missing = [...entries.keys()].filter((k) => !cache.has(k)).length;
  log(`Schede brani: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const budget = process.argv.includes('--all') ? Infinity : 60;
  Promise.resolve()
    .then(() => lookupSongInfo({ budget }))
    .then(() => lookupArtistInfo({ budget }))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
