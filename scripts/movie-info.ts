// Schede dei film (e poi dei registi, scripts/director-info.ts) per le modali di Cinema e Film: trama, generi, durata,
// uscita in Italia, voto, cast, trailer e dove vederlo in Italia, tutto dall'API di TMDB (uso non commerciale,
// dati conservati al massimo 6 mesi; la disponibilità in streaming è di JustWatch, da citare).
//
// Per i titoli delle classifiche Netflix, che non hanno un ID TMDB, si usa la ricerca già fatta per le copertine.
//
//   npm run info:film               completa le schede mancanti (con un budget per run)
//   npm run info:film -- --all      senza budget (prima run)

import { pathToFileURL } from 'node:url';
import { entryKey } from '../src/lib/aggregate';
import { PERIOD_IDS, type MovieInfo, type RankedEntry, type WatchProvider } from '../src/lib/types';
import { COVER_CACHE, META_MAX_AGE_DAYS, TMDB_IMG, hasTmdbKey, tmdb, tmdbIdOf, type CoverLookup } from './adapters/tmdb';
import { loadEnv } from './lib/env';
import { MetaCache, readChart } from './lib/store';
import { trimExtract } from './lib/wiki';
import { lookupDirectorInfo } from './director-info';

export const MOVIE_INFO_CACHE = 'movie-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };
const MOVIE_CATEGORIES = ['cinema', 'film'] as const;

/** ID TMDB del film: dalla classifica TMDB o, per Netflix, dalla ricerca delle copertine. */
export function movieId(e: Pick<RankedEntry, 'title' | 'externalId' | 'sourceUrl'>, covers?: MetaCache<CoverLookup>): number | null {
  return tmdbIdOf(e, 'movie', covers);
}

/** Tutti i film delle pagine Cinema e Film, per chiave (entryKey), con l'ID TMDB. */
export async function movieTargets(): Promise<Map<string, { entry: RankedEntry; id: number | null }>> {
  const covers = await new MetaCache<CoverLookup>(COVER_CACHE, META_MAX_AGE_DAYS).load();
  const out = new Map<string, { entry: RankedEntry; id: number | null }>();
  for (const category of MOVIE_CATEGORIES)
    for (const period of PERIOD_IDS) {
      const chart = await readChart(category, period);
      for (const v of chart?.views ?? [])
        for (const e of v.entries) if (!out.has(entryKey(e))) out.set(entryKey(e), { entry: e, id: movieId(e, covers) });
    }
  return out;
}

interface TmdbMovie {
  title?: string;
  original_title?: string;
  overview?: string;
  tagline?: string;
  genres?: { name: string }[];
  runtime?: number;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
  poster_path?: string | null;
  credits?: { cast: { name: string; character?: string; order: number }[]; crew: { id: number; name: string; job: string }[] };
  videos?: { results: { site: string; type: string; key: string; official?: boolean; iso_639_1?: string }[] };
  release_dates?: { results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };
  'watch/providers'?: { results: Record<string, TmdbWatch | undefined> };
}

export interface TmdbWatch {
  link: string;
  flatrate?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
}

export interface TmdbProvider {
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
}

/** Il trailer da mostrare: prima quelli in italiano, poi gli ufficiali, poi i teaser. */
export function pickTrailer(videos: NonNullable<TmdbMovie['videos']>['results']): string | null {
  const score = (v: (typeof videos)[number]) => (v.iso_639_1 === 'it' ? 4 : 0) + (v.type === 'Trailer' ? 2 : 0) + (v.official ? 1 : 0);
  return (
    videos
      .filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
      .sort((a, b) => score(b) - score(a))[0]?.key ?? null
  );
}

/** Prima uscita nelle sale italiane (tipi 2 e 3 di TMDB: limitata e cinematografica), altrimenti la data di uscita originale. */
export function italianRelease(m: Pick<TmdbMovie, 'release_date' | 'release_dates'>): string | null {
  const it = m.release_dates?.results.find((r) => r.iso_3166_1 === 'IT')?.release_dates ?? [];
  const theatrical = it.filter((d) => d.type === 2 || d.type === 3).map((d) => d.release_date.slice(0, 10)).sort();
  return theatrical[0] ?? (m.release_date || null);
}

export const providers = (list: TmdbProvider[] | undefined): WatchProvider[] =>
  [...(list ?? [])]
    .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
    .slice(0, 8)
    .map((p) => ({ name: p.provider_name, logo: p.logo_path ? `${TMDB_IMG}/w92${p.logo_path}` : null }));

async function movieInfo(id: number): Promise<MovieInfo> {
  const m = await tmdb<TmdbMovie>(
    `/movie/${id}?language=it-IT&append_to_response=credits,videos,release_dates,watch/providers&include_video_language=it,en,null`,
    CACHE,
  );
  let overview = m.overview?.trim() || null;
  let overviewLang: MovieInfo['overviewLang'] = overview ? 'it' : null;
  if (!overview) {
    const en = await tmdb<TmdbMovie>(`/movie/${id}?language=en-US`, CACHE);
    overview = en.overview?.trim() || null;
    overviewLang = overview ? 'en' : null;
  }
  const watch = m['watch/providers']?.results.IT;
  return {
    tmdbId: id,
    title: m.title,
    overview: overview ? trimExtract(overview, 1400) : null,
    overviewLang,
    tagline: m.tagline?.trim() || null,
    originalTitle: m.original_title && m.original_title !== m.title ? m.original_title : null,
    genres: (m.genres ?? []).map((g) => g.name),
    runtime: m.runtime || null,
    released: italianRelease(m),
    vote: m.vote_count ? Math.round((m.vote_average ?? 0) * 10) / 10 : null,
    votes: m.vote_count ?? 0,
    poster: m.poster_path ? `${TMDB_IMG}/w500${m.poster_path}` : null,
    directors: (m.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => ({ id: c.id, name: c.name })),
    cast: [...(m.credits?.cast ?? [])]
      .sort((a, b) => a.order - b.order)
      .slice(0, 8)
      .map((c) => ({ name: c.name, character: c.character?.trim() || null })),
    trailer: pickTrailer(m.videos?.results ?? []),
    watch:
      watch && (watch.flatrate || watch.rent || watch.buy)
        ? { link: watch.link, flatrate: providers(watch.flatrate), rent: providers(watch.rent), buy: providers(watch.buy) }
        : null,
  };
}

export async function lookupMovieInfo({ budget = 80, log = console.log } = {}) {
  const cache = await new MetaCache<MovieInfo>(MOVIE_INFO_CACHE, META_MAX_AGE_DAYS).load();
  const targets = await movieTargets();

  let done = 0;
  for (const [key, { entry, id }] of targets) {
    // Anche le schede senza titolo (raccolte prima che ci fosse): serve alle pagine dei film visti e da vedere.
    if ((cache.has(key) && cache.get(key)!.title) || !id) continue;
    if (done >= budget) break;
    done++;
    try {
      const info = await movieInfo(id);
      cache.set(key, info);
      log(`- ${entry.title}: trama ${info.overview ? info.overviewLang : '✗'}, trailer ${info.trailer ? '✓' : '✗'}, streaming ${info.watch ? '✓' : '✗'}`);
    } catch (err) {
      log(`! ${entry.title}: ${(err as Error).message}`);
      break; // probabilmente rate limit: riprova alla prossima run
    }
    if (done % 10 === 0) await cache.save();
  }
  await cache.save();
  const missing = [...targets].filter(([k, t]) => t.id && !cache.get(k)?.title).length;
  log(`Schede film: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  if (!hasTmdbKey()) {
    console.log('Chiave TMDB mancante: schede dei film non aggiornate.');
  } else {
    const budget = process.argv.includes('--all') ? Infinity : 80;
    Promise.resolve()
      .then(() => lookupMovieInfo({ budget }))
      .then(() => lookupDirectorInfo({ budget }))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}
