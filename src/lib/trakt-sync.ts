// Sincronizzazione delle visioni da Trakt (https://trakt.tv) verso le spunte dell'account, dal browser (pagina /account/, solo
// per l'account configurato in .env: TRAKT_ACCOUNT). Legge la cronologia del profilo pubblico TRAKT_USERNAME con la Client ID
// dell'app Trakt (pubblica per natura; l'app deve avere il sito tra le "Javascript (CORS) origins") e aggiunge le spunte che
// mancano, senza toglierne: stesse regole di scripts/trakt-import.ts.
//
//   Film (lista "visti"): già visti se è spuntata una chiave del catalogo /film/catalogo.json; altrimenti "movie:{ID TMDB}",
//   che vale come la spunta del titolo quando il film è in classifica (src/lib/seen.ts, aliasSeen).
//   Serie ("serie-viste", "tv:{ID TMDB}"): solo con tutti gli episodi andati in onda visti (speciali esclusi).
//   Episodi ("episodi-visti", "{ID TMDB}:{stagione}:{episodio}"): tutti quelli della cronologia.
//   Date: ogni sincronizzazione mette sulle spunte (anche quelle che c'erano già) la data di visione di Trakt, per l'ordinamento
//   "Ultimi visti" delle liste personali.

import { getTicks, mergeTicks, setTickDates, type TickLists } from './ticks';
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
  /** Titoli di quello che è stato aggiunto (film, poi serie, poi episodi), da mostrare quando sono pochi. */
  titles: string[];
}

interface Ids {
  tmdb: number | null;
}
interface WatchedMovie {
  last_watched_at?: string;
  movie: { ids: Ids; title?: string; year?: number | null };
}
interface WatchedShow {
  last_watched_at?: string;
  show: { ids: Ids; aired_episodes?: number; title?: string };
}
interface HistoryEpisode {
  watched_at?: string;
  episode: { season: number; number: number; title?: string | null };
  show: { ids: Ids; title?: string };
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

/** Titoli leggibili delle spunte aggiunte: "Film (anno)", "Serie (serie completa)", "Serie 1x05 – Titolo". Funzione pura. */
export function addedTitles(data: { movies: WatchedMovie[]; shows: WatchedShow[]; history: HistoryEpisode[] }, lists: TickLists): string[] {
  const labels = new Map<string, string>();
  for (const { movie } of data.movies) {
    if (movie.ids.tmdb && movie.title) labels.set(movieIdKey(movie.ids.tmdb), movie.year ? `${movie.title} (${movie.year})` : movie.title);
  }
  const showTitles = new Map<number, string>();
  for (const { show } of data.shows) {
    if (show.ids.tmdb && show.title) {
      showTitles.set(show.ids.tmdb, show.title);
      labels.set(`tv:${show.ids.tmdb}`, `${show.title} (serie completa)`);
    }
  }
  for (const { episode, show } of data.history) {
    const id = show.ids.tmdb;
    if (!id) continue;
    const name = show.title ?? showTitles.get(id) ?? `Serie ${id}`;
    const code = `${episode.season}x${String(episode.number).padStart(2, '0')}`;
    labels.set(`${id}:${episode.season}:${episode.number}`, `${name} ${code}${episode.title ? ` – ${episode.title}` : ''}`);
  }
  return [...lists.visti!, ...lists['serie-viste']!, ...lists['episodi-visti']!].map((key) => labels.get(key) ?? key);
}

/**
 * Data di visione (secondi) per le chiavi delle spunte: film (tutte le chiavi del catalogo e "movie:{id}"), serie complete,
 * episodi (l'ultima visione, se rivisti). Funzione pura.
 */
export function watchDates(
  data: { movies: WatchedMovie[]; shows: WatchedShow[]; history: HistoryEpisode[]; catalog: Map<number, string[]> },
): Record<string, Record<string, number>> {
  const seconds = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) || 0 : 0);
  const films: Record<string, number> = {};
  for (const { movie, last_watched_at } of data.movies) {
    const id = movie.ids.tmdb;
    const when = seconds(last_watched_at);
    if (!id || !when) continue;
    for (const key of [...(data.catalog.get(id) ?? []), movieIdKey(id)]) films[key] = Math.max(films[key] ?? -Infinity, when);
  }
  const series: Record<string, number> = {};
  for (const { show, last_watched_at } of data.shows) {
    const when = seconds(last_watched_at);
    if (show.ids.tmdb && when) series[`tv:${show.ids.tmdb}`] = when;
  }
  const episodes: Record<string, number> = {};
  for (const { episode, show, watched_at } of data.history) {
    const when = seconds(watched_at);
    const key = `${show.ids.tmdb}:${episode.season}:${episode.number}`;
    if (show.ids.tmdb && when) episodes[key] = Math.max(episodes[key] ?? -Infinity, when);
  }
  return { visti: films, 'serie-viste': series, 'episodi-visti': episodes };
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
  const result = {
    films: lists.visti!.length,
    series: lists['serie-viste']!.length,
    episodes: lists['episodi-visti']!.length,
    titles: addedTitles({ movies, shows, history }, lists),
  };
  if (result.films || result.series || result.episodes) {
    progress('Salvataggio nell\'account…');
    await mergeTicks(lists);
  }
  progress('Date di visione…');
  await setTickDates(watchDates({ movies, shows, history, catalog }));
  return result;
}
