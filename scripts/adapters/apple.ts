// Apple RSS Marketing Tools — https://rss.marketingtools.apple.com/
// Feed pubblici, senza chiave. Linkiamo sempre la pagina Apple dell'elemento.
// iTunes Search API — https://performance-partners.apple.com/search-api (~20 richieste/minuto).

import { entryKey } from '../../src/lib/aggregate';
import type { ChartEntry, OfficialChart } from '../../src/lib/types';
import { fetchJson } from '../lib/http';
import { MetaCache } from '../lib/store';
import { cleanEntries, type SourceAdapter } from './types';

const RSS = 'https://rss.marketingtools.apple.com/api/v2/it';

export interface AppleFeed {
  feed: {
    title: string;
    updated: string;
    results: { id: string; name: string; artistName: string; artworkUrl100?: string; url?: string }[];
  };
}

/** Le copertine Apple accettano qualsiasi dimensione nel nome file: 100x100 → 200x200. */
export function biggerArtwork(url: string | undefined, size = 200): string | null {
  return url ? url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : null;
}

export function parseAppleFeed(json: AppleFeed, source: string): ChartEntry[] {
  return json.feed.results.map((r, i) => ({
    rank: i + 1,
    title: r.name,
    subtitle: r.artistName,
    cover: biggerArtwork(r.artworkUrl100),
    source,
    sourceUrl: r.url ?? null,
    externalId: `apple:${r.id}`,
  }));
}

export const appleMusic: SourceAdapter = {
  id: 'apple-music',
  dailyCategories: ['canzoni'],
  async fetchDaily() {
    return cleanEntries(parseAppleFeed(await fetchJson<AppleFeed>(`${RSS}/music/most-played/50/songs.json`), this.id));
  },
};

export const appleBooks: SourceAdapter = {
  id: 'apple-books',
  dailyCategories: ['libri'],
  async fetchDaily() {
    return cleanEntries(parseAppleFeed(await fetchJson<AppleFeed>(`${RSS}/books/top-paid/50/books.json`), this.id));
  },
};

export const applePodcasts: SourceAdapter = {
  id: 'apple-podcasts',
  dailyCategories: ['podcast'],
  async fetchDaily() {
    const entries = parseAppleFeed(await fetchJson<AppleFeed>(`${RSS}/podcasts/top/50/podcasts.json`), this.id);
    // Quando manca l'editore il feed scrive "Unknown".
    return cleanEntries(entries.map((e) => (e.subtitle === 'Unknown' ? { ...e, subtitle: null } : e)));
  },
};

// ---------------------------------------------------------------- copertine (iTunes Search)

export interface ItunesCover {
  cover: string | null;
  url: string | null;
}

export const ITUNES_COVER_CACHE = 'itunes-covers';

interface ItunesSearch {
  results: { artworkUrl100?: string; trackViewUrl?: string; trackName?: string; artistName?: string }[];
}

/**
 * Cerca le copertine dei brani delle classifiche ufficiali (Wikipedia non le fornisce).
 * Con un budget per run, per restare nei limiti dell'API (~20 richieste/minuto):
 * le copertine mancanti vengono completate nelle run successive.
 */
export async function lookupItunesCovers(charts: OfficialChart[], log: (m: string) => void, budget = 30) {
  const cache = await new MetaCache<ItunesCover>(ITUNES_COVER_CACHE, 365).load();
  let calls = 0;
  outer: for (const chart of charts) {
    for (const e of chart.entries) {
      const key = entryKey(e);
      if (cache.has(key)) continue;
      if (calls >= budget) break outer;
      calls++;
      const term = encodeURIComponent(`${e.title} ${(e.subtitle ?? '').split(/,| e /)[0]}`);
      try {
        const res = await fetchJson<ItunesSearch>(
          `https://itunes.apple.com/search?term=${term}&country=it&media=music&entity=song&limit=1`,
          { retries: 1 },
        );
        const hit = res.results[0];
        cache.set(key, { cover: biggerArtwork(hit?.artworkUrl100), url: hit?.trackViewUrl ?? null });
      } catch (err) {
        log(`  copertina iTunes non trovata per "${e.title}": ${(err as Error).message}`);
        break; // probabilmente rate limit: riprova alla prossima run
      }
    }
  }
  await cache.save();
  if (calls) log(`  ricerche copertine iTunes: ${calls}`);
}
