// Last.fm — https://www.last.fm/api/show/geo.getTopTracks
// Termini: uso non commerciale, attribuzione con link a Last.fm, rispetto dei limiti di utilizzo.
// Usata come fonte di riserva per le Canzoni se Apple Music non risponde.

import type { ChartEntry } from '../../src/lib/types';
import { fetchJson } from '../lib/http';
import { cleanEntries, type SourceAdapter } from './types';

export interface LastfmTopTracks {
  tracks?: { track: { name: string; url: string; mbid?: string; artist: { name: string } }[] };
  error?: number;
  message?: string;
}

export function parseLastfm(json: LastfmTopTracks): ChartEntry[] {
  if (json.error) throw new Error(`Last.fm errore ${json.error}: ${json.message}`);
  return (json.tracks?.track ?? []).map((t, i) => ({
    rank: i + 1,
    title: t.name,
    subtitle: t.artist.name,
    // Last.fm non fornisce più copertine reali (solo un segnaposto).
    cover: null,
    source: 'lastfm',
    sourceUrl: t.url,
    externalId: t.mbid ? `mbid:${t.mbid}` : null,
  }));
}

export const lastfm: SourceAdapter = {
  id: 'lastfm',
  requiredEnv: [['LASTFM_API_KEY']],
  dailyCategories: ['canzoni'],
  async fetchDaily() {
    const key = encodeURIComponent(process.env.LASTFM_API_KEY!);
    const json = await fetchJson<LastfmTopTracks>(
      `https://ws.audioscrobbler.com/2.0/?method=geo.gettoptracks&country=italy&limit=50&format=json&api_key=${key}`,
    );
    return cleanEntries(parseLastfm(json));
  },
};
