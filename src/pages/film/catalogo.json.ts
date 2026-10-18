// Catalogo dei film per le liste personali (scheda "I miei visti" della pagina Film e pagina "Da vedere"), come file statico
// (/film/catalogo.json) scaricato solo quando servono: il catalogo privato/film-visti.json (scripts/trakt-import.ts, fuori da
// git) più tutte le schede dei film in cache (data/cache/movie-info.json, anche di film non più in classifica finché non
// scadono). Quali film mostrare lo decide la pagina, con le spunte dell'utente (liste "visti" e "da-vedere").
import type { APIRoute } from 'astro';
import { movieSubtitle } from '../../lib/aggregate';
import { allMovieInfo, getChart, getMovieRatings } from '../../lib/data';
import { mergeProviders } from '../../lib/providers';
import { PERIOD_IDS, type RankedEntry, type SeenMovie, type SeenMovieCatalog } from '../../lib/types';

/** Dati TMDB conservati al massimo 6 mesi: un catalogo più vecchio di 150 giorni non viene pubblicato. */
const MAX_AGE_DAYS = 150;

const catalogs = import.meta.glob<SeenMovieCatalog>('/privato/film-visti.json', { eager: true, import: 'default' });

function catalog(): SeenMovie[] {
  const films = new Map<number, SeenMovie>();
  for (const c of Object.values(catalogs)) {
    if (Date.now() - Date.parse(c.date) > MAX_AGE_DAYS * 86_400_000) continue;
    for (const f of c.films) films.set(f.tmdbId, { ...f, keys: [...f.keys, `movie:${f.tmdbId}`] });
  }
  // Titolo e locandina delle classifiche attuali, per le schede raccolte prima che avessero il titolo.
  const inCharts = new Map<string, RankedEntry>();
  for (const category of ['cinema', 'film'] as const)
    for (const period of PERIOD_IDS) for (const view of getChart(category, period)?.views ?? []) for (const e of view.entries) inCharts.set(e.key, e);

  // Schede dei film delle classifiche: dati più freschi (rinnovati dal cron), chiavi unite a quelle del catalogo.
  for (const [key, info] of allMovieInfo()) {
    const entry = inCharts.get(key);
    const title = info.title ?? entry?.title;
    if (!title) continue;
    const known = films.get(info.tmdbId);
    films.set(info.tmdbId, {
      tmdbId: info.tmdbId,
      title,
      year: Number(info.released?.slice(0, 4) || movieSubtitle(entry?.subtitle ?? null).year) || known?.year || null,
      released: info.released ?? known?.released ?? null,
      directors: info.directors.map((d) => d.name),
      poster: info.poster?.replace('/w500/', '/w185/') ?? entry?.cover ?? null,
      vote: info.vote && info.votes >= 10 ? info.vote : null,
      votes: info.votes,
      genres: info.genres,
      runtime: info.runtime,
      providers: mergeProviders(info.watch?.flatrate ?? []),
      keys: [...new Set([key, ...(known?.keys ?? []), `movie:${info.tmdbId}`])],
    });
  }
  // Voti IMDb e Rotten Tomatoes (data/cache/movie-ratings.json e privato/film-voti.json).
  return [...films.values()].map((f) => {
    const r = getMovieRatings(f.tmdbId);
    return r ? { ...f, imdbId: r.imdbId, imdb: r.imdb, rt: r.rt } : f;
  });
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ films: catalog() }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
