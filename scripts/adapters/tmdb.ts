// TMDB — https://developer.themoviedb.org/
// Termini: uso non commerciale, attribuzione con logo + disclaimer, cache max 6 mesi
// (gestita da retentionDays in sources.ts e dalla scadenza di MetaCache).

import { normalizeText } from '../../src/lib/aggregate';
import type { CategoryId, ChartEntry, OfficialChart } from '../../src/lib/types';
import { fetchJson } from '../lib/http';
import { MetaCache } from '../lib/store';
import { cleanEntries, type SourceAdapter } from './types';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w185';
/** Rinnovo dei metadati prima del limite di 180 giorni imposto dai termini TMDB. */
const META_MAX_AGE_DAYS = 150;
const PAGES = 3; // 20 risultati per pagina → top 50

type Media = 'movie' | 'tv';

export interface TmdbItem {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  popularity?: number;
  media_type?: string;
}

interface TmdbPage {
  page: number;
  total_pages: number;
  results: TmdbItem[];
}

export const TMDB_ENV = [['TMDB_READ_TOKEN'], ['TMDB_API_KEY']];

function auth(): { headers: Record<string, string>; query: string } {
  const token = process.env.TMDB_READ_TOKEN;
  if (token) return { headers: { Authorization: `Bearer ${token}` }, query: '' };
  const key = process.env.TMDB_API_KEY;
  if (key) return { headers: {}, query: `api_key=${encodeURIComponent(key)}` };
  throw new Error('Chiave TMDB mancante (TMDB_READ_TOKEN o TMDB_API_KEY)');
}

export function hasTmdbKey() {
  return Boolean(process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY);
}

async function tmdb<T>(pathAndQuery: string): Promise<T> {
  const { headers, query } = auth();
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  return fetchJson<T>(`${API}${pathAndQuery}${query ? sep + query : ''}`, { headers });
}

async function pages(pathAndQuery: string): Promise<TmdbItem[]> {
  const out: TmdbItem[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const res = await tmdb<TmdbPage>(`${pathAndQuery}${sep}page=${page}`);
    out.push(...res.results);
    if (page >= res.total_pages) break;
  }
  return out;
}

export function mediaFor(category: CategoryId): Media {
  return category === 'serie-tv' ? 'tv' : 'movie';
}

/** Converte un risultato TMDB nel formato comune. `subtitle` viene completato con regista/creatori. */
export function toEntry(item: TmdbItem, media: Media, rank: number, source: string): ChartEntry {
  return {
    rank,
    title: (media === 'movie' ? item.title : item.name) ?? '',
    subtitle: null,
    cover: item.poster_path ? `${IMG}${item.poster_path}` : null,
    source,
    sourceUrl: `https://www.themoviedb.org/${media}/${item.id}`,
    externalId: `tmdb:${media}:${item.id}`,
  };
}

function year(item: TmdbItem): string | null {
  return (item.release_date || item.first_air_date || '').slice(0, 4) || null;
}

/** Regista (film) o creatori (serie), con cache persistente. */
async function people(media: Media, id: number, cache: MetaCache<string | null>): Promise<string | null> {
  const key = `${media}:${id}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let value: string | null = null;
  try {
    if (media === 'movie') {
      const c = await tmdb<{ crew: { job: string; name: string }[] }>(`/movie/${id}/credits?language=it-IT`);
      value = c.crew.filter((p) => p.job === 'Director').map((p) => p.name).slice(0, 2).join(', ') || null;
    } else {
      const d = await tmdb<{ created_by?: { name: string }[] }>(`/tv/${id}?language=it-IT`);
      value = (d.created_by ?? []).map((p) => p.name).slice(0, 2).join(', ') || null;
    }
  } catch {
    return null; // metadato facoltativo: non blocca la classifica
  }
  cache.set(key, value);
  return value;
}

async function withPeople(items: TmdbItem[], media: Media, source: string): Promise<ChartEntry[]> {
  const cache = await new MetaCache<string | null>('tmdb-people', META_MAX_AGE_DAYS).load();
  const entries: ChartEntry[] = [];
  for (const [i, item] of items.entries()) {
    const e = toEntry(item, media, i + 1, source);
    const who = await people(media, item.id, cache);
    const y = year(item);
    e.subtitle = [who, y ? `(${y})` : null].filter(Boolean).join(' ') || null;
    entries.push(e);
  }
  await cache.save();
  return cleanEntries(entries);
}

function dedupe(items: TmdbItem[]): TmdbItem[] {
  const seen = new Set<number>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/** Film/serie più popolari tra quelli disponibili in abbonamento in Italia. */
export const tmdbStreaming: SourceAdapter = {
  id: 'tmdb-streaming',
  requiredEnv: TMDB_ENV,
  dailyCategories: ['film', 'serie-tv'],
  async fetchDaily(category) {
    const media = mediaFor(category);
    const items = await pages(
      `/discover/${media}?language=it-IT&watch_region=IT&with_watch_monetization_types=flatrate&sort_by=popularity.desc&vote_count.gte=20&include_adult=false`,
    );
    return withPeople(dedupe(items), media, this.id);
  },
};

/** Tendenze del giorno su TMDB (globali: l'endpoint trending non filtra per paese). */
export const tmdbTrending: SourceAdapter = {
  id: 'tmdb-trending',
  requiredEnv: TMDB_ENV,
  dailyCategories: ['film', 'serie-tv'],
  async fetchDaily(category) {
    const media = mediaFor(category);
    return withPeople(dedupe(await pages(`/trending/${media}/day?language=it-IT`)), media, this.id);
  },
};

/** Film in programmazione nelle sale italiane, ordinati per popolarità. */
export const tmdbNowPlaying: SourceAdapter = {
  id: 'tmdb-now-playing',
  requiredEnv: TMDB_ENV,
  dailyCategories: ['cinema'],
  async fetchDaily() {
    const items = dedupe(await pages('/movie/now_playing?language=it-IT&region=IT'));
    items.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return withPeople(items, 'movie', this.id);
  },
};

// ---------------------------------------------------------------- copertine per Netflix Top 10

export interface CoverLookup {
  cover: string | null;
  url: string | null;
}

export const COVER_CACHE = 'tmdb-covers';

export function coverKey(media: Media, title: string) {
  return `${media}:${normalizeText(title)}`;
}

/**
 * Cerca su TMDB le copertine dei titoli delle classifiche ufficiali (Netflix non le fornisce).
 * Il risultato è salvato in data/cache/tmdb-covers.json (scadenza 150 giorni) e applicato
 * in fase di aggregazione: i file ufficiali restano senza dati TMDB.
 */
export async function lookupCovers(charts: OfficialChart[], log: (m: string) => void, budget = 200) {
  const cache = await new MetaCache<CoverLookup>(COVER_CACHE, META_MAX_AGE_DAYS).load();
  let calls = 0;
  for (const chart of charts) {
    const media = mediaFor(chart.category);
    for (const e of chart.entries) {
      const key = coverKey(media, e.title);
      if (cache.has(key)) continue;
      if (calls++ >= budget) break;
      const q = encodeURIComponent(e.title.replace(/:\s*(stagione|season|parte|part|limited series).*$/i, ''));
      try {
        const res = await tmdb<TmdbPage>(`/search/${media}?language=it-IT&region=IT&query=${q}`);
        const hit = res.results[0];
        cache.set(key, {
          cover: hit?.poster_path ? `${IMG}${hit.poster_path}` : null,
          url: hit ? `https://www.themoviedb.org/${media}/${hit.id}` : null,
        });
      } catch (err) {
        log(`  copertina non trovata per "${e.title}": ${(err as Error).message}`);
      }
    }
  }
  await cache.save();
  if (calls) log(`  ricerche copertine TMDB: ${Math.min(calls, budget)}`);
}
