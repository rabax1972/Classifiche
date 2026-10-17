// Schede delle serie (e poi dei creatori, scripts/creator-info.ts) per le modali di Serie TV: trama, generi, stagioni,
// stato, reti, voto, interpreti, trailer e dove vederla in Italia, tutto dall'API di TMDB (uso non commerciale,
// dati conservati al massimo 6 mesi; la disponibilità in streaming è di JustWatch, da citare).
//
// Per i titoli delle classifiche Netflix, che non hanno un ID TMDB, si usa la ricerca già fatta per le copertine.
//
// Poi gli episodi di ogni stagione (scripts/episode-info.ts).
//
//   npm run info:serie               completa le schede mancanti (con un budget per run)
//   npm run info:serie -- --all      senza budget (prima run)

import { pathToFileURL } from 'node:url';
import { entryKey } from '../src/lib/aggregate';
import { PERIOD_IDS, type RankedEntry, type SeasonSummary, type SeriesInfo } from '../src/lib/types';
import { COVER_CACHE, META_MAX_AGE_DAYS, TMDB_IMG, hasTmdbKey, tmdb, tmdbIdOf, type CoverLookup } from './adapters/tmdb';
import { loadEnv } from './lib/env';
import { MetaCache, readChart } from './lib/store';
import { trimExtract } from './lib/wiki';
import { pickTrailer, providers, type TmdbWatch } from './movie-info';
import { lookupCreatorInfo } from './creator-info';
import { lookupEpisodes } from './episode-info';

export const SERIES_INFO_CACHE = 'series-info';
const CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

/** ID TMDB della serie: dalla classifica TMDB o, per Netflix, dalla ricerca delle copertine. */
export function seriesId(e: Pick<RankedEntry, 'title' | 'externalId' | 'sourceUrl'>, covers?: MetaCache<CoverLookup>): number | null {
  return tmdbIdOf(e, 'tv', covers);
}

/** Tutte le serie della pagina Serie TV, per chiave (entryKey), con l'ID TMDB. */
export async function seriesTargets(): Promise<Map<string, { entry: RankedEntry; id: number | null }>> {
  const covers = await new MetaCache<CoverLookup>(COVER_CACHE, META_MAX_AGE_DAYS).load();
  const out = new Map<string, { entry: RankedEntry; id: number | null }>();
  for (const period of PERIOD_IDS) {
    const chart = await readChart('serie-tv', period);
    for (const v of chart?.views ?? [])
      for (const e of v.entries) if (!out.has(entryKey(e))) out.set(entryKey(e), { entry: e, id: seriesId(e, covers) });
  }
  return out;
}

interface TmdbSeries {
  name?: string;
  original_name?: string;
  overview?: string;
  tagline?: string;
  genres?: { name: string }[];
  episode_run_time?: number[];
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  next_episode_to_air?: { air_date?: string; season_number: number; episode_number: number } | null;
  last_episode_to_air?: { runtime?: number | null } | null;
  networks?: { name: string }[];
  seasons?: { season_number: number; name?: string; air_date?: string | null; episode_count?: number }[];
  created_by?: { id: number; name: string }[];
  vote_average?: number;
  vote_count?: number;
  poster_path?: string | null;
  aggregate_credits?: { cast: { name: string; roles?: { character?: string; episode_count?: number }[]; order: number }[] };
  videos?: { results: { site: string; type: string; key: string; official?: boolean; iso_639_1?: string }[] };
  'watch/providers'?: { results: Record<string, TmdbWatch | undefined> };
}

/** Stagioni con almeno un episodio, in ordine; gli speciali (stagione 0) in fondo. */
export function seasonList(seasons: NonNullable<TmdbSeries['seasons']>): SeasonSummary[] {
  return seasons
    .filter((s) => (s.episode_count ?? 0) > 0)
    .map((s) => ({ n: s.season_number, name: s.name?.trim() || (s.season_number ? `Stagione ${s.season_number}` : 'Speciali'), date: s.air_date || null, episodes: s.episode_count! }))
    .sort((a, b) => (a.n || Infinity) - (b.n || Infinity));
}

async function seriesInfo(id: number): Promise<SeriesInfo> {
  const s = await tmdb<TmdbSeries>(
    `/tv/${id}?language=it-IT&append_to_response=aggregate_credits,videos,watch/providers&include_video_language=it,en,null`,
    CACHE,
  );
  let overview = s.overview?.trim() || null;
  let overviewLang: SeriesInfo['overviewLang'] = overview ? 'it' : null;
  if (!overview) {
    const en = await tmdb<TmdbSeries>(`/tv/${id}?language=en-US`, CACHE);
    overview = en.overview?.trim() || null;
    overviewLang = overview ? 'en' : null;
  }
  const watch = s['watch/providers']?.results.IT;
  const next = s.next_episode_to_air;
  return {
    tmdbId: id,
    overview: overview ? trimExtract(overview, 1400) : null,
    overviewLang,
    tagline: s.tagline?.trim() || null,
    originalTitle: s.original_name && s.original_name !== s.name ? s.original_name : null,
    genres: (s.genres ?? []).map((g) => g.name),
    episodeRuntime: s.episode_run_time?.[0] || s.last_episode_to_air?.runtime || null,
    firstAired: s.first_air_date || null,
    lastAired: s.last_air_date || null,
    status: s.status || null,
    seasons: s.number_of_seasons || null,
    episodes: s.number_of_episodes || null,
    seasonList: seasonList(s.seasons ?? []),
    nextEpisode: next?.air_date ? { date: next.air_date, season: next.season_number, episode: next.episode_number } : null,
    networks: (s.networks ?? []).map((n) => n.name).slice(0, 3),
    vote: s.vote_count ? Math.round((s.vote_average ?? 0) * 10) / 10 : null,
    votes: s.vote_count ?? 0,
    poster: s.poster_path ? `${TMDB_IMG}/w500${s.poster_path}` : null,
    creators: (s.created_by ?? []).map((c) => ({ id: c.id, name: c.name })),
    cast: [...(s.aggregate_credits?.cast ?? [])]
      .sort((a, b) => a.order - b.order)
      .slice(0, 8)
      .map((c) => ({ name: c.name, character: c.roles?.[0]?.character?.trim() || null })),
    trailer: pickTrailer(s.videos?.results ?? []),
    watch:
      watch && (watch.flatrate || watch.rent || watch.buy)
        ? { link: watch.link, flatrate: providers(watch.flatrate), rent: providers(watch.rent), buy: providers(watch.buy) }
        : null,
  };
}

export async function lookupSeriesInfo({ budget = 80, log = console.log } = {}) {
  const cache = await new MetaCache<SeriesInfo>(SERIES_INFO_CACHE, META_MAX_AGE_DAYS).load();
  const targets = await seriesTargets();

  let done = 0;
  for (const [key, { entry, id }] of targets) {
    // Schede raccolte prima dell'elenco delle stagioni: si rifanno.
    if ((cache.has(key) && cache.get(key)!.seasonList) || !id) continue;
    if (done >= budget) break;
    done++;
    try {
      const info = await seriesInfo(id);
      cache.set(key, info);
      log(`- ${entry.title}: trama ${info.overview ? info.overviewLang : '✗'}, trailer ${info.trailer ? '✓' : '✗'}, streaming ${info.watch ? '✓' : '✗'}`);
    } catch (err) {
      log(`! ${entry.title}: ${(err as Error).message}`);
      break; // probabilmente rate limit: riprova alla prossima run
    }
    if (done % 10 === 0) await cache.save();
  }
  await cache.save();
  const missing = [...targets].filter(([k, t]) => t.id && !cache.get(k)?.seasonList).length;
  log(`Schede serie: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  if (!hasTmdbKey()) {
    console.log('Chiave TMDB mancante: schede delle serie non aggiornate.');
  } else {
    const budget = process.argv.includes('--all') ? Infinity : 80;
    Promise.resolve()
      .then(() => lookupSeriesInfo({ budget }))
      .then(() => lookupCreatorInfo({ budget }))
      .then(() => lookupEpisodes({ budget: budget === Infinity ? Infinity : 150 }))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}
