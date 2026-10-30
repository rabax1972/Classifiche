// Scheda "Oscar al miglior film" della pagina Film: tutti i vincitori, dalla cerimonia più recente.
//
// L'elenco viene da Wikidata (dati CC0: premio ricevuto P166 = Oscar al miglior film Q102427, con la data della cerimonia P585 e
// l'ID TMDB P4947); i premiati che non sono film (i produttori) restano fuori perché non hanno un ID TMDB. Titolo italiano,
// locandina e regista vengono da TMDB, come nelle altre classifiche. Il sito dell'Academy non viene letto: è solo il link di
// ogni riga alla pagina della cerimonia.
//
//   npm run oscar:film               rifà l'elenco se ha più di 30 giorni
//   npm run oscar:film -- --force    lo rifà comunque

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChartEntry, OfficialChart } from '../src/lib/types';
import { hasTmdbKey, tmdb, withPeople, type TmdbItem } from './adapters/tmdb';
import { loadEnv } from './lib/env';
import { fetchJson } from './lib/http';
import { DATA_DIR, readJson, writeJson } from './lib/store';

export const OSCAR_FILE = path.join(DATA_DIR, 'official', 'film', 'oscar.json');
export const OSCAR_NOTE =
  'Tutti i film premiati con l\'Oscar al miglior film, dalla cerimonia più recente; tra parentesi l\'anno di uscita del film. ' +
  'Elenco da Wikidata (CC0), titoli e locandine da TMDB.';
const REFRESH_DAYS = 30;
const WIKIDATA = 'https://query.wikidata.org/sparql';
const BEST_PICTURE = 'Q102427';

interface SparqlRow {
  film: { value: string };
  tmdb: { value: string };
  date?: { value: string };
}

export interface OscarWinner {
  tmdbId: number;
  /** Giorno della cerimonia (YYYY-MM-DD). */
  ceremony: string;
}

/** Un vincitore per film, con la data di cerimonia più recente (Wikidata ne ha a volte due), dal più recente. */
export function oscarWinners(rows: SparqlRow[]): OscarWinner[] {
  const byFilm = new Map<string, OscarWinner>();
  for (const r of rows) {
    const tmdbId = Number(r.tmdb.value);
    const ceremony = r.date?.value.slice(0, 10) ?? '';
    if (!tmdbId || !ceremony) continue;
    const prev = byFilm.get(r.film.value);
    if (!prev || ceremony > prev.ceremony) byFilm.set(r.film.value, { tmdbId, ceremony });
  }
  return [...byFilm.values()].sort((a, b) => b.ceremony.localeCompare(a.ceremony));
}

export async function buildOscarWinners({ force = false, log = console.log } = {}): Promise<OfficialChart | null> {
  const current = await readJson<OfficialChart>(OSCAR_FILE);
  if (!force && current && Date.now() - Date.parse(current.fetchedAt) < REFRESH_DAYS * 86_400_000) {
    log(`Oscar al miglior film del ${current.periodKey}: ancora valido.`);
    return current;
  }
  if (!hasTmdbKey()) {
    log('Chiave TMDB mancante: Oscar al miglior film saltato.');
    return null;
  }
  const query = `SELECT ?film ?tmdb ?date WHERE {
    ?film p:P166 ?st . ?st ps:P166 wd:${BEST_PICTURE} .
    OPTIONAL { ?st pq:P585 ?date }
    ?film wdt:P4947 ?tmdb .
  }`;
  const res = await fetchJson<{ results: { bindings: SparqlRow[] } }>(`${WIKIDATA}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
    timeoutMs: 60_000,
  });
  const winners = oscarWinners(res.results.bindings);
  if (winners.length < 90) throw new Error(`Solo ${winners.length} vincitori da Wikidata`);

  const items: TmdbItem[] = [];
  for (const w of winners) {
    const m = await tmdb<TmdbItem>(`/movie/${w.tmdbId}?language=it-IT`, { cacheTtlMs: 7 * 86_400_000 });
    items.push({ ...m, id: w.tmdbId });
  }
  const ceremonyOf = new Map(winners.map((w) => [`tmdb:movie:${w.tmdbId}`, w.ceremony.slice(0, 4)]));
  const entries: ChartEntry[] = (await withPeople(items, 'movie', 'oscar', winners.length)).map((e) => ({
    ...e,
    sourceUrl: `https://www.oscars.org/oscars/ceremonies/${ceremonyOf.get(e.externalId ?? '')}`,
  }));

  const fetchedAt = new Date().toISOString();
  const day = fetchedAt.slice(0, 10);
  const chart: OfficialChart = {
    category: 'film',
    source: 'oscar',
    periodType: 'year',
    periodKey: day,
    periodLabel: `${entries.length} vincitori, dal ${winners.at(-1)!.ceremony.slice(0, 4)} al ${winners[0]!.ceremony.slice(0, 4)}`,
    url: 'https://www.oscars.org/oscars/ceremonies',
    fetchedAt,
    entries,
  };
  await writeJson(OSCAR_FILE, chart);
  log(`Oscar al miglior film: ${entries.length} film (ultimo: ${entries[0]?.title}).`);
  return chart;
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  loadEnv();
  buildOscarWinners({ force: process.argv.includes('--force') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
