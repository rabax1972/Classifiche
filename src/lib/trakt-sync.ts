// Sincronizzazione delle visioni da Trakt (https://trakt.tv) verso le spunte dell'account, dal browser (pagina /account/, solo
// per l'account configurato in .env: TRAKT_ACCOUNT). Legge la cronologia del profilo pubblico TRAKT_USERNAME con la Client ID
// dell'app Trakt (pubblica per natura; l'app deve avere il sito tra le "Javascript (CORS) origins") e aggiunge le spunte che
// mancano, senza toglierne: stesse regole di scripts/trakt-import.ts.
//
//   Film (lista "visti"): già visti se è spuntata una chiave del catalogo /film/catalogo.json; altrimenti "movie:{ID TMDB}",
//   che vale come la spunta del titolo quando il film è in classifica (src/lib/seen.ts, aliasSeen).
//   Serie ("serie-viste", "tv:{ID TMDB}"): solo con tutti gli episodi andati in onda visti (speciali esclusi).
//   Episodi ("episodi-visti", "{ID TMDB}:{stagione}:{episodio}"): tutti quelli della cronologia.

import { getTicks, mergeTicks, type TickLists } from './ticks';
import type { SeenMovie } from './types';

const API = 'https://api.trakt.tv';
/** Come movieIdKey di src/lib/seen.ts (non importato: quel modulo ascolta gli eventi della pagina). */
const movieIdKey = (id: number) => `movie:${id}`;
const PAGE = 250;

export interface TraktConfig {
  clientId: string;
  user: string;
  /** URL del catalogo dei film (/film/catalogo.json). */
  catalog: string;
}

export interface TraktSyncResult {
  films: number;
  series: number;
  episodes: number;
}

interface Ids {
  tmdb: number | null;
}
interface WatchedMovie {
  movie: { ids: Ids };
}
interface WatchedShow {
  show: { ids: Ids; aired_episodes?: number };
}
interface HistoryEpisode {
  episode: { season: number; number: number };
  show: { ids: Ids };
}

async function traktPages<T>(cfg: TraktConfig, path: string, progress: (m: string) => void, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}/users/${encodeURIComponent(cfg.user)}/${path}?page=${page}&limit=${PAGE}`, {
      headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': cfg.clientId },
    });
    if (!res.ok) throw new Error(`Trakt ha risposto ${res.status}: controlla che il profilo sia pubblico e che il sito sia tra le origini CORS dell'app.`);
    const items = (await res.json()) as T[];
    if (!items.length) break;
    out.push(...items);
    progress(`${label}: ${out.length}`);
  }
  return out;
}

/** Spunte che mancano rispetto alla cronologia di Trakt (funzione pura, per i test). */
export function missingTicks(
  data: { movies: WatchedMovie[]; shows: WatchedShow[]; history: HistoryEpisode[]; catalog: Map<number, string[]> },
  have: { films: Set<string>; series: Set<string>; episodes: Set<string> },
): TickLists {
  const films = new Set<string>();
  for (const { movie } of data.movies) {
    const id = movie.ids.tmdb;
    if (!id) continue;
    const keys = data.catalog.get(id) ?? [];
    if (!keys.some((k) => have.films.has(k)) && !have.films.has(movieIdKey(id))) films.add(movieIdKey(id));
  }

  const episodes = new Set<string>();
  const regular = new Map<number, Set<string>>();
  for (const { episode, show } of data.history) {
    const id = show.ids.tmdb;
    if (!id) continue;
    const key = `${id}:${episode.season}:${episode.number}`;
    if (!have.episodes.has(key)) episodes.add(key);
    if (episode.season > 0) (regular.get(id) ?? regular.set(id, new Set()).get(id)!).add(key);
  }

  const series = new Set<string>();
  for (const { show } of data.shows) {
    const id = show.ids.tmdb;
    const key = `tv:${id}`;
    if (id && show.aired_episodes && (regular.get(id)?.size ?? 0) >= show.aired_episodes && !have.series.has(key)) series.add(key);
  }
  return { visti: [...films], 'serie-viste': [...series], 'episodi-visti': [...episodes] };
}

export async function syncTrakt(cfg: TraktConfig, progress: (m: string) => void = () => {}): Promise<TraktSyncResult> {
  const movies = await traktPages<WatchedMovie>(cfg, 'watched/movies', progress, 'Film su Trakt');
  const shows = await traktPages<WatchedShow>(cfg, 'watched/shows', progress, 'Serie su Trakt');
  const history = await traktPages<HistoryEpisode>(cfg, 'history/episodes', progress, 'Episodi su Trakt');
  progress('Confronto con le spunte…');
  const res = await fetch(cfg.catalog);
  const catalog = new Map<number, string[]>();
  if (res.ok) for (const f of ((await res.json()) as { films: SeenMovie[] }).films) catalog.set(f.tmdbId, f.keys);

  const lists = missingTicks(
    { movies, shows, history, catalog },
    { films: getTicks('visti'), series: getTicks('serie-viste'), episodes: getTicks('episodi-visti') },
  );
  const result = { films: lists.visti!.length, series: lists['serie-viste']!.length, episodes: lists['episodi-visti']!.length };
  if (result.films || result.series || result.episodes) {
    progress('Salvataggio nell\'account…');
    await mergeTicks(lists);
  }
  return result;
}
