// Spotify Podcast Charts — https://podcastcharts.byspotify.com/it/top-podcasts
// La pagina carica la classifica da un JSON dello stesso sito (100 podcast, in ordine). Le Linee guida di Spotify vietano
// crawling e scraping: la fonte è usata con l'ok esplicito del proprietario del sito (21/10/2026), una richiesta al giorno.

import type { ChartEntry } from '../../src/lib/types';
import { fetchJson } from '../lib/http';
import { cleanEntries, type SourceAdapter } from './types';

const CHART = 'https://podcastcharts.byspotify.com/api/charts/top-podcasts?region=it&limit=100';

export interface SpotifyChartItem {
  showUri: string;
  showName: string;
  showPublisher?: string;
  showImageUrl?: string;
  chartRankMove?: string;
}

/** "spotify:show:ID" → pagina del podcast sul web player. */
export const spotifyShowUrl = (uri: string) => `https://open.spotify.com/show/${uri.split(':').at(-1)}`;

export function parseSpotifyChart(items: SpotifyChartItem[], source: string): ChartEntry[] {
  return items.map((s, i) => ({
    rank: i + 1,
    title: s.showName,
    subtitle: s.showPublisher || null,
    cover: s.showImageUrl ?? null,
    source,
    sourceUrl: s.showUri ? spotifyShowUrl(s.showUri) : null,
    externalId: s.showUri || null,
  }));
}

export const spotifyPodcasts: SourceAdapter = {
  id: 'spotify-podcasts',
  dailyCategories: ['podcast'],
  async fetchDaily() {
    const items = await fetchJson<SpotifyChartItem[]>(CHART);
    if (!Array.isArray(items)) throw new Error('Risposta di Spotify non valida');
    return cleanEntries(parseSpotifyChart(items, this.id));
  },
};
