// Film per la scheda "I miei visti" della pagina Film, come file statico (/film/visti.json) scaricato solo da chi ha l'account
// e apre la scheda: il catalogo privato/film-visti.json (scripts/trakt-import.ts, fuori da git) più i film delle classifiche
// Cinema e Film con la scheda TMDB, così compaiono anche quelli spuntati sul sito. Quali sono visti lo decide la pagina,
// con le spunte dell'utente (lista "visti").
import type { APIRoute } from 'astro';
import { movieSubtitle } from '../../lib/aggregate';
import { getChart, getMovieInfo } from '../../lib/data';
import { mergeProviders } from '../../lib/providers';
import { PERIOD_IDS, type SeenMovie, type SeenMovieCatalog } from '../../lib/types';

/** Dati TMDB conservati al massimo 6 mesi: un catalogo più vecchio di 150 giorni non viene pubblicato. */
const MAX_AGE_DAYS = 150;

const catalogs = import.meta.glob<SeenMovieCatalog>('/privato/film-visti.json', { eager: true, import: 'default' });

function seenMovies(): SeenMovie[] {
  const films = new Map<number, SeenMovie>();
  for (const catalog of Object.values(catalogs)) {
    if (Date.now() - Date.parse(catalog.date) > MAX_AGE_DAYS * 86_400_000) continue;
    for (const f of catalog.films) films.set(f.tmdbId, f);
  }
  // Film delle classifiche: dati più freschi (aggiornati ogni giorno), chiavi unite a quelle del catalogo.
  for (const category of ['cinema', 'film'] as const)
    for (const period of PERIOD_IDS)
      for (const view of getChart(category, period)?.views ?? [])
        for (const e of view.entries) {
          const info = getMovieInfo(e.key);
          if (!info) continue;
          const known = films.get(info.tmdbId);
          films.set(info.tmdbId, {
            tmdbId: info.tmdbId,
            title: e.title,
            year: Number(info.released?.slice(0, 4) || movieSubtitle(e.subtitle).year) || null,
            directors: info.directors.map((d) => d.name),
            poster: info.poster?.replace('/w500/', '/w185/') ?? e.cover,
            vote: info.vote && info.votes >= 10 ? info.vote : null,
            votes: info.votes,
            genres: info.genres,
            runtime: info.runtime,
            providers: mergeProviders(info.watch?.flatrate ?? []),
            keys: [...new Set([e.key, ...(known?.keys ?? [])])],
          });
        }
  return [...films.values()];
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ films: seenMovies() }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
