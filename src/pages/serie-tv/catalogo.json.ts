// Catalogo delle serie per la pagina "Le mie serie viste", come file statico (/serie-tv/catalogo.json) scaricato solo da quella
// pagina: il catalogo privato/serie-viste.json (scripts/trakt-import.ts, fuori da git) più tutte le schede delle serie in cache
// (data/cache/series-info.json). Quali serie mostrare lo decide la pagina, con le spunte dell'utente ("serie-viste" ed
// "episodi-visti").
import type { APIRoute } from 'astro';
import { toSeenSeries } from '../../lib/catalog';
import { allSeriesInfo, getChart } from '../../lib/data';
import { PERIOD_IDS, type SeenSeries, type SeenSeriesCatalog } from '../../lib/types';

/** Dati TMDB conservati al massimo 6 mesi: un catalogo più vecchio di 150 giorni non viene pubblicato. */
const MAX_AGE_DAYS = 150;

const catalogs = import.meta.glob<SeenSeriesCatalog>('/privato/serie-viste.json', { eager: true, import: 'default' });

function catalog(): SeenSeries[] {
  const series = new Map<number, SeenSeries>();
  for (const c of Object.values(catalogs)) {
    if (Date.now() - Date.parse(c.date) > MAX_AGE_DAYS * 86_400_000) continue;
    for (const s of c.series) series.set(s.tmdbId, s);
  }
  // Titoli delle classifiche attuali, per le schede raccolte prima che avessero il titolo.
  const titles = new Map<string, string>();
  for (const period of PERIOD_IDS) for (const view of getChart('serie-tv', period)?.views ?? []) for (const e of view.entries) titles.set(e.key, e.title);
  // Schede delle serie delle classifiche: dati più freschi (rinnovati dal cron).
  for (const [key, info] of allSeriesInfo()) {
    const s = toSeenSeries(info, info.title ?? titles.get(key));
    if (s) series.set(s.tmdbId, s);
  }
  return [...series.values()];
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ series: catalog() }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
