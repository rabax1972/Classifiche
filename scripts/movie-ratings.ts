// Voti dei film su IMDb e Rotten Tomatoes, per le righe di Cinema e Film, la scheda del film e le liste personali.
//
// - ID IMDb: dall'API di TMDB (/movie/{id}/external_ids), conservato tra un aggiornamento e l'altro;
// - voto IMDb: dai dataset non commerciali ufficiali di IMDb (title.ratings, come la IMDb Top 100 di scripts/imdb-top.ts);
// - Tomatometer di Rotten Tomatoes: da Wikidata (dati CC0, proprietà P444 con "pubblicato da" Rotten Tomatoes), che lo
//   registra con una data e non sempre aggiornato. Il sito di Rotten Tomatoes non viene letto e non ha un'API pubblica.
//
// I film delle classifiche (schede di data/cache/movie-info.json) vanno in data/cache/movie-ratings.json; quelli che sono solo
// nel catalogo privato di scripts/trakt-import.ts (privato/film-visti.json) in privato/film-voti.json, fuori da git.
// Ogni run aggiunge i film nuovi; una volta a settimana rinnova tutti i voti.
//
//   npm run ratings:film               film nuovi (e tutti, se l'ultimo aggiornamento completo ha più di una settimana)
//   npm run ratings:film -- --force    rinnova tutti i voti

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MovieInfo, MovieRatings, MovieRatingsFile, RottenRating, SeenMovieCatalog } from '../src/lib/types';
import { hasTmdbKey, tmdb } from './adapters/tmdb';
import { downloadImdbRatings } from './imdb-top';
import { loadEnv } from './lib/env';
import { fetchJson } from './lib/http';
import { DATA_DIR, readJson, writeJson, type CacheEntry } from './lib/store';
import { MOVIE_INFO_CACHE } from './movie-info';

const PUBLIC_FILE = path.join(DATA_DIR, 'cache', 'movie-ratings.json');
const PRIVATE_FILE = path.resolve('privato', 'film-voti.json');
const PRIVATE_CATALOG = path.resolve('privato', 'film-visti.json');
const REFRESH_DAYS = 7;
const WIKIDATA = 'https://query.wikidata.org/sparql';
const WIKIDATA_BATCH = 100;
const ROTTEN_TOMATOES = 'Q105584';
/** Metodo "Tomatometer score" (l'altro valore di Rotten Tomatoes su Wikidata è il voto medio). */
const TOMATOMETER = 'Q108403393';

interface SparqlRow {
  imdb: { value: string };
  score?: { value: string };
  method?: { value: string };
  date?: { value: string };
  rtid?: { value: string };
}

/** Tomatometer più recente di ogni ID IMDb, da Wikidata. */
export function pickTomatometer(rows: SparqlRow[]): Map<string, RottenRating> {
  const out = new Map<string, RottenRating>();
  for (const r of rows) {
    const id = r.imdb.value;
    const url = r.rtid ? `https://www.rottentomatoes.com/${r.rtid.value}` : null;
    const score = r.score?.value.match(/^(\d{1,3})%$/)?.[1];
    const method = r.method?.value.split('/').pop();
    if (!score || (method && method !== TOMATOMETER)) continue;
    const date = r.date?.value.slice(0, 10) ?? null;
    const prev = out.get(id);
    if (prev && (prev.date ?? '') >= (date ?? '')) continue;
    out.set(id, { score: Number(score), date, url: url ?? prev?.url ?? null });
  }
  return out;
}

async function tomatometers(ids: string[], log: (m: string) => void): Promise<Map<string, RottenRating>> {
  const out = new Map<string, RottenRating>();
  for (let i = 0; i < ids.length; i += WIKIDATA_BATCH) {
    const values = ids.slice(i, i + WIKIDATA_BATCH).map((id) => `"${id}"`).join(' ');
    const query = `SELECT ?imdb ?score ?method ?date ?rtid WHERE {
      VALUES ?imdb { ${values} }
      ?film wdt:P345 ?imdb .
      OPTIONAL { ?film p:P444 ?st . ?st ps:P444 ?score ; pq:P447 wd:${ROTTEN_TOMATOES} .
        OPTIONAL { ?st pq:P459 ?method } OPTIONAL { ?st pq:P585 ?date } }
      OPTIONAL { ?film wdt:P1258 ?rtid }
    }`;
    try {
      const res = await fetchJson<{ results: { bindings: SparqlRow[] } }>(`${WIKIDATA}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json' },
        timeoutMs: 60_000,
      });
      for (const [id, rt] of pickTomatometer(res.results.bindings)) out.set(id, rt);
    } catch (e) {
      log(`Wikidata non raggiungibile (${(e as Error).message}): Rotten Tomatoes saltato per ${Math.min(WIKIDATA_BATCH, ids.length - i)} film.`);
    }
  }
  return out;
}

/** Voti IMDb dei soli ID richiesti, dal file TSV dei dataset. */
function imdbRatings(tsv: string, wanted: Set<string>): Map<string, { value: number; votes: number }> {
  const out = new Map<string, { value: number; votes: number }>();
  for (const line of tsv.split('\n')) {
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (!wanted.has(id)) continue;
    const [, r, v] = line.split('\t');
    out.set(id, { value: Number(r), votes: Number(v) });
  }
  return out;
}

export async function lookupMovieRatings({ force = false, log = console.log } = {}) {
  if (!hasTmdbKey()) {
    log('Chiave TMDB mancante: voti IMDb e Rotten Tomatoes saltati.');
    return;
  }
  const info = await readJson<Record<string, CacheEntry<MovieInfo>>>(path.join(DATA_DIR, 'cache', `${MOVIE_INFO_CACHE}.json`));
  const publicIds = new Set(Object.values(info ?? {}).map((e) => e.value.tmdbId));
  const catalog = await readJson<SeenMovieCatalog>(PRIVATE_CATALOG);
  const privateIds = new Set((catalog?.films ?? []).map((f) => f.tmdbId).filter((id) => !publicIds.has(id)));

  const prevPublic = await readJson<MovieRatingsFile>(PUBLIC_FILE);
  const prevPrivate = await readJson<MovieRatingsFile>(PRIVATE_FILE);
  const prev = { ...prevPrivate?.films, ...prevPublic?.films };
  const age = (f: MovieRatingsFile | null) => (f ? Date.now() - Date.parse(f.date) : Infinity);
  const full = force || age(prevPublic) > REFRESH_DAYS * 86_400_000 || (privateIds.size > 0 && age(prevPrivate) > REFRESH_DAYS * 86_400_000);

  const all = [...publicIds, ...privateIds];
  const todo = full ? all : all.filter((id) => !prev[id]);
  if (todo.length === 0) {
    log('Voti dei film: niente da aggiornare.');
    return;
  }
  log(`Voti dei film: ${todo.length} da ${full ? 'rinnovare' : 'aggiungere'}.`);

  // ID IMDb: già noti o da TMDB.
  const imdbIds = new Map<number, string | null>();
  let calls = 0;
  for (const id of todo) {
    if (prev[id]?.imdbId) {
      imdbIds.set(id, prev[id].imdbId);
      continue;
    }
    try {
      const ext = await tmdb<{ imdb_id?: string | null }>(`/movie/${id}/external_ids`);
      imdbIds.set(id, ext.imdb_id?.match(/^tt\d+$/) ? ext.imdb_id : null);
    } catch {
      imdbIds.set(id, null);
    }
    if (++calls % 200 === 0) log(`- ID IMDb: ${calls} richieste a TMDB`);
  }

  const wanted = new Set([...imdbIds.values()].filter((v): v is string => Boolean(v)));
  const imdb = imdbRatings(await downloadImdbRatings(), wanted);
  const rt = await tomatometers([...wanted], log);

  const fresh: Record<string, MovieRatings> = {};
  for (const [id, imdbId] of imdbIds)
    fresh[id] = { imdbId, imdb: imdbId ? (imdb.get(imdbId) ?? null) : null, rt: imdbId ? (rt.get(imdbId) ?? null) : null };

  const today = new Date().toISOString().slice(0, 10);
  const write = async (file: string, ids: Set<number>, previous: MovieRatingsFile | null) => {
    const films: Record<string, MovieRatings> = {};
    for (const id of [...ids].sort((a, b) => a - b)) {
      const r = fresh[id] ?? prev[id];
      if (r) films[id] = r;
    }
    await writeJson(file, { date: full ? today : (previous?.date ?? today), films } satisfies MovieRatingsFile, true);
    return Object.keys(films).length;
  };
  const n = await write(PUBLIC_FILE, publicIds, prevPublic);
  const m = privateIds.size ? await write(PRIVATE_FILE, privateIds, prevPrivate) : 0;
  const count = (f: (r: MovieRatings) => unknown) => Object.values(fresh).filter(f).length;
  log(`Voti dei film: ${n} delle classifiche, ${m} del catalogo privato; nuovi dati: ${count((r) => r.imdb)} IMDb, ${count((r) => r.rt)} Rotten Tomatoes.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  lookupMovieRatings({ force: process.argv.includes('--force') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
