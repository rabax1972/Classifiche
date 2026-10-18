// Classifica "IMDb Top 100" della pagina Film, dai dataset non commerciali ufficiali di IMDb
// (https://developer.imdb.com/non-commercial-datasets/, uso personale e non commerciale, con attribuzione).
// Il sito di IMDb vieta lo scraping (robots.txt e Conditions of Use): le pagine della Top 250 non vengono lette.
//
// IMDb non pubblica la formula della sua Top 250: si usa quella storica, la media bayesiana
//   WR = v / (v + m) · R + m / (v + m) · C   con m = 25.000 voti minimi e C = 7,0,
// e dei titoli ordinati così si tengono i primi 100 film (titolo, locandina e regista da TMDB, che dice anche se un ID IMDb
// è un film o una serie), ordinati poi per voto come la ricerca "Top 100" di IMDb. IMDb toglie dalla sua classifica i titoli
// con voti "di campagna" e conta solo i votanti abituali: qui, come approssimazione, si scartano i film con pochi voti su TMDB
// (es. Hababam Sınıfı, The Kashmir Files) e i film per la TV (speciali, stand-up).
//
//   npm run imdb:top               rifà la classifica se ha più di una settimana
//   npm run imdb:top -- --force    la rifà comunque

import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChartEntry, OfficialChart } from '../src/lib/types';
import { META_MAX_AGE_DAYS, hasTmdbKey, tmdb, withPeople, type TmdbItem } from './adapters/tmdb';
import { loadEnv } from './lib/env';
import { fetchBuffer } from './lib/http';
import { DATA_DIR, MetaCache, readJson, writeJson } from './lib/store';

/** Nota della scheda, con l'attribuzione richiesta dalla licenza dei dataset. */
export const IMDB_TOP_NOTE =
  'Ricostruita dai dataset ufficiali di IMDb con la formula storica della Top 250 (media bayesiana dei voti, almeno 25.000 voti): ' +
  'IMDb non pubblica la formula attuale, quindi qualche titolo può differire dalla classifica del sito. Ordinata per voto IMDb. ' +
  'Information courtesy of IMDb (https://www.imdb.com). Used with permission.';

const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
export const IMDB_TOP_FILE = path.join(DATA_DIR, 'official', 'film', 'imdb-top.json');
const MIN_VOTES = 25_000;
const MEAN = 7.0;
const SIZE = 100;
const REFRESH_DAYS = 7;
/** Voti minimi su TMDB, contro i titoli spinti da campagne di voto su IMDb. */
const MIN_TMDB_VOTES = 1000;
const TV_MOVIE_GENRE = 10770;

interface Rating {
  id: string;
  rating: number;
  votes: number;
  weighted: number;
}

/** Titoli con almeno MIN_VOTES voti, dal punteggio bayesiano più alto. */
export function rankRatings(tsv: string): Rating[] {
  const out: Rating[] = [];
  for (const line of tsv.split('\n').slice(1)) {
    const [id, r, v] = line.split('\t');
    const rating = Number(r);
    const votes = Number(v);
    if (!id || !(votes >= MIN_VOTES)) continue;
    out.push({ id, rating, votes, weighted: (votes * rating + MIN_VOTES * MEAN) / (votes + MIN_VOTES) });
  }
  return out.sort((a, b) => b.weighted - a.weighted);
}

export async function buildImdbTop({ force = false, log = console.log } = {}): Promise<OfficialChart | null> {
  const current = await readJson<OfficialChart>(IMDB_TOP_FILE);
  if (!force && current && Date.now() - Date.parse(current.fetchedAt) < REFRESH_DAYS * 86_400_000) {
    log(`IMDb Top 100 del ${current.periodKey}: ancora valida.`);
    return current;
  }
  if (!hasTmdbKey()) {
    log('Chiave TMDB mancante: IMDb Top 100 saltata.');
    return null;
  }
  const ranked = rankRatings(gunzipSync(await fetchBuffer(RATINGS_URL, { timeoutMs: 120_000, cacheTtlMs: 20 * 3_600_000 })).toString('utf8'));
  // ID IMDb → film TMDB (null: serie, episodio o titolo assente su TMDB).
  const found = await new MetaCache<TmdbItem | null>('imdb-tmdb', META_MAX_AGE_DAYS).load();
  const films: { item: TmdbItem; r: Rating }[] = [];
  for (const r of ranked) {
    if (films.length >= SIZE) break;
    if (!found.has(r.id)) {
      const res = await tmdb<{ movie_results: TmdbItem[] }>(`/find/${r.id}?external_source=imdb_id&language=it-IT`);
      found.set(r.id, res.movie_results[0] ?? null);
    }
    const item = found.get(r.id);
    if (item && (item.vote_count ?? 0) >= MIN_TMDB_VOTES && !item.genre_ids?.includes(TV_MOVIE_GENRE)) films.push({ item, r });
  }
  await found.save();
  if (films.length < SIZE) throw new Error(`Solo ${films.length} film trovati su TMDB`);

  // Come https://www.imdb.com/search/title/?groups=top_100&sort=user_rating,desc: per voto, a parità per numero di voti.
  films.sort((a, b) => b.r.rating - a.r.rating || b.r.votes - a.r.votes);
  const byTmdb = new Map(films.map((f) => [`tmdb:movie:${f.item.id}`, f.r]));
  const entries: ChartEntry[] = (await withPeople(films.map((f) => f.item), 'movie', 'imdb', SIZE)).map((e) => {
    const r = byTmdb.get(e.externalId ?? '')!;
    return { ...e, sourceUrl: `https://www.imdb.com/it/title/${r.id}/`, rating: { value: r.rating, votes: r.votes } };
  });
  const fetchedAt = new Date().toISOString();
  const day = fetchedAt.slice(0, 10);
  const [y, m, d] = day.split('-');
  const chart: OfficialChart = {
    category: 'film',
    source: 'imdb',
    periodType: 'year',
    periodKey: day,
    periodLabel: `Voti al ${d}/${m}/${y}`,
    url: 'https://www.imdb.com/chart/top/',
    fetchedAt,
    entries,
  };
  await writeJson(IMDB_TOP_FILE, chart);
  log(`IMDb Top 100: ${entries.length} film (primo: ${entries[0]?.title}).`);
  return chart;
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  buildImdbTop({ force: process.argv.includes('--force') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
