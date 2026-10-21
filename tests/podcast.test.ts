import { describe, expect, it } from 'vitest';
import { parseSpotifyChart, spotifyShowUrl } from '../scripts/adapters/spotify';
import { libraryShows } from '../scripts/spotify-import';
import { podcastKey } from '../src/lib/aggregate';

describe('podcastKey', () => {
  it('usa solo il titolo, senza la parte dopo " - " o ": "', () => {
    expect(podcastKey('SEIETRENTA - La rassegna stampa di Chora Media')).toBe('podcast:seietrenta');
    expect(podcastKey('Seietrenta')).toBe('podcast:seietrenta');
    expect(podcastKey('Black Box: La scatola nera della finanza')).toBe('podcast:black box');
    expect(podcastKey('PULP PODCAST')).toBe('podcast:pulp podcast');
  });

  it('tiene il titolo intero se la prima parte è troppo corta', () => {
    expect(podcastKey('Tg - Il notiziario')).toBe('podcast:tg il notiziario');
  });
});

describe('Spotify Podcast Charts', () => {
  it('converte la classifica nel formato comune', () => {
    const [e] = parseSpotifyChart(
      [{ showUri: 'spotify:show:5qrDv6O8ON44pXR70z4lPz', showName: 'Elisa True Crime', showPublisher: 'Twords', showImageUrl: 'https://i.scdn.co/image/x' }],
      'spotify-podcasts',
    );
    expect(e).toEqual({
      rank: 1,
      title: 'Elisa True Crime',
      subtitle: 'Twords',
      cover: 'https://i.scdn.co/image/x',
      source: 'spotify-podcasts',
      sourceUrl: 'https://open.spotify.com/show/5qrDv6O8ON44pXR70z4lPz',
      externalId: 'spotify:show:5qrDv6O8ON44pXR70z4lPz',
    });
    expect(spotifyShowUrl('spotify:show:abc')).toBe('https://open.spotify.com/show/abc');
  });
});

describe('importazione da Spotify', () => {
  it('legge i podcast seguiti di YourLibrary.json, senza righe vuote né doppioni', () => {
    const shows = libraryShows({
      tracks: [{ artist: 'X', track: 'Y' }],
      shows: [
        { name: 'Il Mondo', publisher: 'Internazionale', uri: 'spotify:show:1' },
        { name: 'Il Mondo', publisher: 'Internazionale', uri: 'spotify:show:1' },
        { name: ' ', publisher: 'Nessuno', uri: 'spotify:show:2' },
        { name: 'Senza URI', publisher: '' },
      ],
    });
    expect(shows).toEqual([
      { name: 'Il Mondo', publisher: 'Internazionale', uri: 'spotify:show:1' },
      { name: 'Senza URI', publisher: null, uri: null },
    ]);
  });

  it('rifiuta un file senza podcast seguiti', () => {
    expect(() => libraryShows({ tracks: [] })).toThrow(/shows/);
  });
});
