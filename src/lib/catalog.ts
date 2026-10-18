// Schede dei cataloghi delle liste personali (pagine dei visti), costruite dai dati TMDB delle schede: usate sia dagli script di
// importazione (scripts/trakt-import.ts) sia dai file statici dei cataloghi (src/pages/*/catalogo.json.ts).

import { mergeProviders } from './providers';
import type { SeenSeries, SeriesCard, SeriesInfo } from './types';

/** Serie del catalogo dalla sua scheda (src/lib/types.ts, SeriesInfo); null se manca il titolo. */
export function toSeenSeries(info: SeriesInfo, title = info.title): SeenSeries | null {
  if (!title) return null;
  return {
    tmdbId: info.tmdbId,
    title,
    firstAired: info.firstAired,
    creators: info.creators.map((c) => c.name),
    poster: info.poster?.replace('/w500/', '/w185/') ?? null,
    vote: info.vote && info.votes >= 10 ? info.vote : null,
    votes: info.votes,
    genres: info.genres,
    seasons: info.seasons,
    episodes: info.episodes,
    status: info.status ? (info.status === 'Ended' || info.status === 'Canceled' ? 'conclusa' : 'in-corso') : null,
    providers: mergeProviders(info.watch?.flatrate ?? []),
  };
}

/** Scheda per la modale della serie (src/components/SeriesDialog.astro), come quella costruita per le classifiche. */
export function toSeriesCard(info: SeriesInfo, title: string): SeriesCard {
  return {
    title,
    creators: info.creators.map((c) => c.name).join(', ') || null,
    year: info.firstAired?.slice(0, 4) ?? null,
    label: null,
    cover: info.poster?.replace('/w500/', '/w185/') ?? null,
    sourceUrl: `https://www.themoviedb.org/tv/${info.tmdbId}`,
    seenKey: `tv:${info.tmdbId}`,
    info,
  };
}
