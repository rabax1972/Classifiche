// Episodi delle serie per la modale di Serie TV: per ogni stagione titolo, data, durata, trama, fotogramma, voto, regia e
// sceneggiatura, dall'API di TMDB (una richiesta per stagione, due se manca la trama in italiano).
// Un file per serie in data/cache/episodes/{tmdbId}.json, con la data di raccolta di ogni stagione: le stagioni scadono dopo
// 150 giorni (limite TMDB di 6 mesi) e l'ultima stagione delle serie in corso si rinnova ogni settimana. I file delle serie
// uscite dalle classifiche vengono cancellati. Il sito li pubblica come /serie-tv/episodi/{tmdbId}/{stagione}.json.
// Lanciato da `npm run info:serie` dopo le schede delle serie e dei creatori.

import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { EpisodeCacheFile, EpisodeInfo, SeasonEpisodes, SeriesInfo } from '../src/lib/types';
import { META_MAX_AGE_DAYS, TMDB_IMG, tmdb } from './adapters/tmdb';
import { DATA_DIR, MetaCache, readJson, writeJson } from './lib/store';
import { trimExtract } from './lib/wiki';
import { SERIES_INFO_CACHE, seriesTargets } from './series-info';

export const EPISODE_DIR = path.join(DATA_DIR, 'cache', 'episodes');
/** Ogni quanti giorni si rinnova l'ultima stagione di una serie in corso (nuovi episodi, date annunciate). */
const CURRENT_REFRESH_DAYS = 7;
const CACHE = { retries: 1, cacheTtlMs: 86_400_000 };

interface TmdbEpisode {
  episode_number: number;
  name?: string;
  air_date?: string | null;
  runtime?: number | null;
  overview?: string;
  still_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  crew?: { job: string; name: string }[];
}

/** La stagione va scaricata (di nuovo)? */
export function seasonStale(fetchedAt: string | undefined, current: boolean, now = Date.now()): boolean {
  if (!fetchedAt) return true;
  const days = (now - Date.parse(fetchedAt)) / 86_400_000;
  return days > META_MAX_AGE_DAYS || (current && days > CURRENT_REFRESH_DAYS);
}

/** Titolo segnaposto di TMDB quando manca quello vero ("Episodio 4", "Episode 4"). */
const placeholder = (title: string | undefined) => !title?.trim() || /^(episodio|episode)\s+\d+$/i.test(title.trim());

const names = (crew: TmdbEpisode['crew'], jobs: string[]) => [...new Set((crew ?? []).filter((c) => jobs.includes(c.job)).map((c) => c.name))].slice(0, 3);

export function toEpisode(e: TmdbEpisode, en?: TmdbEpisode): EpisodeInfo {
  const it = e.overview?.trim() || null;
  const fallback = it ? null : en?.overview?.trim() || null;
  const overview = it ?? fallback;
  return {
    n: e.episode_number,
    title: (placeholder(e.name) && !placeholder(en?.name) ? en!.name! : e.name)?.trim() || `Episodio ${e.episode_number}`,
    date: e.air_date || null,
    runtime: e.runtime || null,
    overview: overview ? trimExtract(overview, 700) : null,
    overviewLang: it ? 'it' : fallback ? 'en' : null,
    still: e.still_path ? `${TMDB_IMG}/w300${e.still_path}` : null,
    vote: e.vote_count ? Math.round((e.vote_average ?? 0) * 10) / 10 : null,
    votes: e.vote_count ?? 0,
    directors: names(e.crew, ['Director']),
    writers: names(e.crew, ['Writer', 'Screenplay', 'Teleplay', 'Story']),
  };
}

/** Episodi di una stagione; restituisce anche il numero di richieste fatte. */
async function seasonEpisodes(id: number, season: number): Promise<{ data: SeasonEpisodes; calls: number }> {
  const it = await tmdb<{ episodes?: TmdbEpisode[] }>(`/tv/${id}/season/${season}?language=it-IT`, CACHE);
  const episodes = it.episodes ?? [];
  // Trame o titoli mancanti in italiano: si completano con l'inglese.
  if (!episodes.some((e) => !e.overview?.trim() || placeholder(e.name)))
    return { data: { episodes: episodes.map((e) => toEpisode(e)) }, calls: 1 };
  const en = await tmdb<{ episodes?: TmdbEpisode[] }>(`/tv/${id}/season/${season}?language=en-US`, CACHE);
  const byNumber = new Map((en.episodes ?? []).map((e) => [e.episode_number, e]));
  return { data: { episodes: episodes.map((e) => toEpisode(e, byNumber.get(e.episode_number))) }, calls: 2 };
}

/** `budget`: numero massimo di richieste a TMDB. */
export async function lookupEpisodes({ budget = 150, log = console.log } = {}) {
  const shows = await new MetaCache<SeriesInfo>(SERIES_INFO_CACHE, META_MAX_AGE_DAYS).load();
  const series = new Map<number, SeriesInfo>();
  for (const key of (await seriesTargets()).keys()) {
    const info = shows.get(key);
    if (info?.seasonList) series.set(info.tmdbId, info);
  }

  await mkdir(EPISODE_DIR, { recursive: true });
  let removed = 0;
  for (const f of await readdir(EPISODE_DIR))
    if (f.endsWith('.json') && !series.has(Number(f.replace(/\.json$/, '')))) {
      await rm(path.join(EPISODE_DIR, f));
      removed++;
    }

  let calls = 0;
  let seasons = 0;
  let stop = false;
  for (const [id, info] of series) {
    if (stop) break;
    const file = path.join(EPISODE_DIR, `${id}.json`);
    const data = (await readJson<EpisodeCacheFile>(file)) ?? { seasons: {} };
    let changed = false;
    // Via le stagioni scadute o non più elencate.
    const listed = new Set(info.seasonList.map((s) => String(s.n)));
    for (const [n, s] of Object.entries(data.seasons))
      if (!listed.has(n) || seasonStale(s.fetchedAt, false)) {
        delete data.seasons[n];
        changed = true;
      }

    const running = info.status !== 'Ended' && info.status !== 'Canceled';
    const last = Math.max(...info.seasonList.map((s) => s.n));
    for (const s of info.seasonList) {
      if (!seasonStale(data.seasons[s.n]?.fetchedAt, running && s.n === last)) continue;
      if (calls >= budget) {
        stop = true;
        break;
      }
      try {
        const r = await seasonEpisodes(id, s.n);
        data.seasons[s.n] = { fetchedAt: new Date().toISOString(), ...r.data };
        calls += r.calls;
        seasons++;
        changed = true;
      } catch (err) {
        log(`! episodi ${id} stagione ${s.n}: ${(err as Error).message}`); // probabilmente rate limit: riprova alla prossima run
        stop = true;
        break;
      }
    }
    if (changed) await writeJson(file, data);
  }
  log(`Episodi: ${seasons} stagioni scaricate (${calls} richieste)${removed ? `, ${removed} serie rimosse` : ''}${stop ? ', altre alla prossima run' : ''}`);
}
