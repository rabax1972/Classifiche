// Film e serie visti su Trakt (https://trakt.tv), convertiti nel file di spunte che la pagina /account/ sa importare
// ("Importa da file"): le spunte vanno così solo nell'account con cui si è entrati sul sito, e il file dichiara a quale
// account è destinato (la pagina rifiuta di importarlo in un altro).
//
// Basta la "Client ID" di un'app Trakt (TRAKT_CLIENT_ID) e un profilo pubblico (TRAKT_USERNAME). Uso personale, non commerciale.
//
//   Film (lista "visti", chiave entryKey): per i film già nelle classifiche Cinema/Film si usa la chiave della classifica
//   (abbinamento per ID TMDB), per gli altri si mettono tutte le chiavi che il film potrà avere (movieKeys), così la spunta
//   compare quando entra in classifica.
//   Serie ("serie-viste", chiave "tv:{ID TMDB}"): solo quelle con tutti gli episodi andati in onda visti.
//   Episodi ("episodi-visti", chiave "{ID TMDB}:{stagione}:{episodio}"): tutti quelli nella cronologia.
//
// Scrive anche i cataloghi dei film visti (privato/film-visti.json: titolo, anno, locandina, voto, generi, durata, servizi
// da TMDB e le chiavi di ogni film) e delle serie viste anche solo in parte (privato/serie-viste.json), pubblicati con il sito
// nella scheda "I miei visti" della pagina Film e nella pagina "Le mie serie viste" (src/pages/*/catalogo.json.ts).
// Vanno rigenerati entro 150 giorni (dati TMDB): poi la build li ignora.
//
//   npm run import:trakt -- --account email@esempio.it   scrive privato/spunte-trakt-{data}.json e i due cataloghi

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryKey } from '../src/lib/aggregate';
import { toSeenSeries } from '../src/lib/catalog';
import { mergeProviders } from '../src/lib/providers';
import type { SeenMovie, SeenMovieCatalog, SeenSeries, SeenSeriesCatalog } from '../src/lib/types';
import { TMDB_IMG, hasTmdbKey, tmdb } from './adapters/tmdb';
import { loadEnv } from './lib/env';
import { fetchJson } from './lib/http';
import { italianRelease, movieTargets, providers, type TmdbWatch } from './movie-info';
import { seriesInfo } from './series-info';

const API = 'https://api.trakt.tv';
const PAGE = 250; // limite massimo di Trakt per pagina
const OUT_DIR = path.resolve('privato');
/** Risposte TMDB riusate tra un'importazione e l'altra (.cache/http, fuori da git). */
const TMDB_CACHE = { retries: 1, cacheTtlMs: 7 * 86_400_000 };

interface TraktIds {
  tmdb: number | null;
}
interface WatchedMovie {
  movie: { title: string; year: number | null; ids: TraktIds };
}
interface WatchedShow {
  show: { title: string; ids: TraktIds; aired_episodes?: number };
}
interface HistoryEpisode {
  episode: { season: number; number: number };
  show: { title: string; ids: TraktIds };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function trakt<T>(pathAndQuery: string): Promise<T> {
  return fetchJson<T>(`${API}${pathAndQuery}`, {
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': process.env.TRAKT_CLIENT_ID!.trim() },
  });
}

/** Tutte le pagine di un elenco Trakt (oltre l'ultima pagina Trakt risponde con un elenco vuoto). */
async function allPages<T>(pathAndQuery: string, log: (m: string) => void): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const items = await trakt<T[]>(`${pathAndQuery}${sep}page=${page}&limit=${PAGE}`);
    if (!items.length) break;
    out.push(...items);
    log(`  ${pathAndQuery}: ${out.length}`);
  }
  return out;
}

interface TmdbMovie {
  title: string;
  original_title?: string;
  release_date?: string;
  credits?: { crew: { job: string; name: string }[] };
  release_dates?: { results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] };
}

interface TmdbMovieFull extends TmdbMovie {
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  genres?: { name: string }[];
  runtime?: number | null;
  'watch/providers'?: { results: Record<string, TmdbWatch | undefined> };
}

/**
 * Le chiavi che il film può avere in classifica (entryKey), tutte: la spunta vale per quella che comparirà.
 * Fonti TMDB: titolo italiano + "Regista, Regista (anno)", dove l'anno è quello dell'uscita italiana per il Cinema e i
 * registi possono arrivare in un altro ordine; Top 10 Netflix: solo il titolo, a volte quello originale o inglese.
 */
export function movieKeys(m: TmdbMovie, traktTitle: string): string[] {
  const directors = (m.credits?.crew ?? []).filter((p) => p.job === 'Director').map((p) => p.name).slice(0, 2);
  const italian = m.release_dates?.results.find((r) => r.iso_3166_1 === 'IT')?.release_dates ?? [];
  const years = new Set([m.release_date, ...italian.map((r) => r.release_date)].map((d) => d?.slice(0, 4)).filter(Boolean));
  const subtitles: (string | null)[] = [];
  if (directors.length > 1) subtitles.push(directors.join(', '), [...directors].reverse().join(', '));
  else for (const y of years.size ? years : [undefined]) subtitles.push([directors[0], y ? `(${y})` : null].filter(Boolean).join(' ') || null);
  const keys = new Set(subtitles.map((subtitle) => entryKey({ title: m.title, subtitle })));
  // Il titolo originale solo se in alfabeto latino: normalizzato, "鬼滅の刃 2" diventerebbe "2".
  const original = /[a-z]/i.test(m.original_title ?? '') ? m.original_title : null;
  for (const title of [m.title, original, traktTitle]) if (title) keys.add(entryKey({ title, subtitle: null }));
  return [...keys];
}

/** Scheda del film per il catalogo, con le chiavi che può avere in classifica. */
export function seenMovie(m: TmdbMovieFull, id: number, keys: string[]): SeenMovie {
  const votes = m.vote_count ?? 0;
  return {
    tmdbId: id,
    title: m.title,
    year: Number(m.release_date?.slice(0, 4)) || null,
    released: italianRelease(m),
    directors: (m.credits?.crew ?? []).filter((p) => p.job === 'Director').map((p) => p.name).slice(0, 2),
    poster: m.poster_path ? `${TMDB_IMG}/w185${m.poster_path}` : null,
    vote: m.vote_average && votes >= 10 ? Math.round(m.vote_average * 10) / 10 : null,
    votes,
    genres: (m.genres ?? []).map((g) => g.name),
    runtime: m.runtime || null,
    providers: mergeProviders(providers(m['watch/providers']?.results.IT?.flatrate)),
    keys,
  };
}

async function lookupMovie(id: number): Promise<TmdbMovieFull | null> {
  try {
    return await tmdb<TmdbMovieFull>(`/movie/${id}?language=it-IT&append_to_response=credits,release_dates,watch/providers`, TMDB_CACHE);
  } catch {
    return null; // film rimosso da TMDB o errore di rete: finisce tra quelli non abbinati
  }
}

export async function importTrakt(user: string, account: string, log: (m: string) => void = console.log) {
  log(`Trakt: cronologia di ${user}`);
  const movies = await allPages<WatchedMovie>(`/users/${encodeURIComponent(user)}/watched/movies`, log);
  const shows = await allPages<WatchedShow>(`/users/${encodeURIComponent(user)}/watched/shows`, log);
  const history = await allPages<HistoryEpisode>(`/users/${encodeURIComponent(user)}/history/episodes`, log);

  // Episodi: chiave della modale delle serie (SeriesDialog, episodeKey).
  const episodes = new Set<string>();
  const regular = new Map<number, Set<string>>(); // episodi visti per serie, speciali esclusi (per "serie vista")
  for (const { episode, show } of history) {
    const id = show.ids.tmdb;
    if (!id) continue;
    episodes.add(`${id}:${episode.season}:${episode.number}`);
    if (episode.season > 0) (regular.get(id) ?? regular.set(id, new Set()).get(id)!).add(`${episode.season}:${episode.number}`);
  }

  // Serie: vista solo se sono stati visti tutti gli episodi andati in onda (Trakt li conta senza gli speciali).
  const series: string[] = [];
  const partial: string[] = [];
  for (const { show } of shows) {
    const id = show.ids.tmdb;
    if (!id) continue;
    const seen = regular.get(id)?.size ?? 0;
    if (show.aired_episodes && seen >= show.aired_episodes) series.push(`tv:${id}`);
    else partial.push(`${show.title} (${seen}/${show.aired_episodes ?? '?'})`);
  }

  // Catalogo delle serie viste, anche solo in parte (pagina "Le mie serie viste").
  const seriesCatalog: SeenSeries[] = [];
  for (const [i, { show }] of shows.entries()) {
    if (!show.ids.tmdb) continue;
    try {
      const s = toSeenSeries(await seriesInfo(show.ids.tmdb));
      if (s) seriesCatalog.push(s);
    } catch {
      // Serie rimossa da TMDB o errore di rete: resta fuori dal catalogo.
    }
    if ((i + 1) % 50 === 0) log(`  serie: ${i + 1}/${shows.length}`);
  }

  // Film: prima la chiave della classifica (stesso ID TMDB), poi tutte quelle possibili (movieKeys).
  const chartKeys = new Map<number, string>();
  for (const [key, { id }] of await movieTargets()) if (id) chartKeys.set(id, key);
  const films = new Set<string>();
  const catalog: SeenMovie[] = [];
  const unmatched: string[] = [];
  let fromCharts = 0;
  for (const [i, { movie }] of movies.entries()) {
    const id = movie.ids.tmdb;
    const m = id ? await lookupMovie(id) : null;
    if (!id || !m) {
      unmatched.push(`${movie.title} (${movie.year ?? '?'})`);
      continue;
    }
    const chartKey = chartKeys.get(id);
    const keys = movieKeys(m, movie.title);
    if (chartKey) fromCharts++;
    // Spunte: la chiave della classifica se il film c'è già, altrimenti tutte quelle possibili. Catalogo: tutte.
    for (const key of chartKey ? [chartKey] : keys) films.add(key);
    catalog.push(seenMovie(m, id, [...new Set([...(chartKey ? [chartKey] : []), ...keys])]));
    if ((i + 1) % 100 === 0) log(`  film abbinati: ${i + 1}/${movies.length}`);
  }

  const day = new Date().toISOString().slice(0, 10);
  const data = {
    sito: 'Classifiche Italia',
    versione: 1,
    data: day,
    origine: `trakt:${user}`,
    account,
    liste: { visti: [...films], 'serie-viste': series, 'episodi-visti': [...episodes] },
  };
  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `spunte-trakt-${day}.json`);
  await writeFile(file, JSON.stringify(data, null, 2));
  const catalogFile = path.join(OUT_DIR, 'film-visti.json');
  await writeFile(catalogFile, JSON.stringify({ date: day, films: catalog } satisfies SeenMovieCatalog));

  log(`\nFilm: ${movies.length - unmatched.length} abbinati su ${movies.length} visti (${fromCharts} già nelle classifiche), ${films.size} chiavi.`);
  if (unmatched.length) log(`  Non abbinati (${unmatched.length}): ${unmatched.join('; ')}`);
  log(`Serie: ${series.length} viste per intero; ${partial.length} iniziate, con solo le spunte degli episodi.`);
  log(`Episodi: ${episodes.size}.`);
  const seriesFile = path.join(OUT_DIR, 'serie-viste.json');
  await writeFile(seriesFile, JSON.stringify({ date: day, series: seriesCatalog } satisfies SeenSeriesCatalog));
  log(`\nCataloghi dei film e delle serie viste (pubblicati con il sito): ${catalogFile}, ${seriesFile}`);
  log(`\nFile: ${file}\nImportalo da /account/ ("Importa da file") dopo essere entrato come ${account}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  const user = (arg('utente') ?? process.env.TRAKT_USERNAME ?? '').replace(/^@/, '');
  const account = arg('account') ?? process.env.TRAKT_ACCOUNT ?? '';
  if (!process.env.TRAKT_CLIENT_ID?.trim() || !user || !account || !hasTmdbKey()) {
    console.error('Servono TRAKT_CLIENT_ID e TMDB_READ_TOKEN (o TMDB_API_KEY) in .env, TRAKT_USERNAME (o --utente) e --account (o TRAKT_ACCOUNT).');
    process.exit(1);
  }
  importTrakt(user, account.toLowerCase()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
