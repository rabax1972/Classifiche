// Schede degli artisti per la modale delle Canzoni: introduzione della voce di Wikipedia (prima in italiano,
// poi in inglese; CC BY-SA) e foto con licenza libera da Wikimedia Commons, con autore e licenza da citare.
// Link alla pagina dell'artista su Apple Music dall'API di ricerca di iTunes.
// Lanciato da `npm run info:canzoni` dopo le schede dei brani.

import { artistKey, normalizeText, splitArtists } from '../src/lib/aggregate';
import { PERIOD_IDS, type ArtistInfo } from '../src/lib/types';
import { fetchJson } from './lib/http';
import { MetaCache, readChart } from './lib/store';
import { commonsCredit, wikiPerson, type PersonKind } from './lib/wiki';

export const ARTIST_INFO_CACHE = 'artist-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/** Le voci sugli artisti, distinte dagli omonimi ("Shiva" è la divinità). */
const MUSICIAN: PersonKind = {
  qualifiers: {
    it: ['', 'cantante', 'rapper', 'cantautore', 'cantautrice', 'gruppo musicale', 'disc jockey', 'musicista', 'produttore discografico', 'duo musicale'],
    en: ['', 'singer', 'rapper', 'band', 'musician', 'DJ', 'record producer', 'South Korean singer', 'American singer', 'Colombian singer', 'duo'],
  },
  words: {
    it: /\b(cantant[ei]|cantautor[ei]|cantautric[ei]|rapper|trapper|gruppo musicale|band|disc jockey|dj|produttor[ei] discografic[oi]|musicist[ai]|duo musicale|compositor[ei]|beatmaker|chitarrist[ai]|pianist[ai])\b/i,
    en: /\b(singers?|rappers?|band|musicians?|disc jockey|dj|record producer|songwriters?|duo|musical group|boy band|girl group|composers?)\b/i,
  },
};

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
    const found = (await wikiPerson('it', name, MUSICIAN)) ?? (await wikiPerson('en', name, MUSICIAN));
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
