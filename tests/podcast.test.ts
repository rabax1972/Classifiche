import { describe, expect, it } from 'vitest';
import { parseSpotifyChart, spotifyShowUrl } from '../scripts/adapters/spotify';
import { durationSeconds, feedText, parseFeed } from '../scripts/podcast-info';
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

describe('feed RSS dei podcast', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <title>Il Mondo</title><link>https://www.internazionale.it/podcast</link>
    <image><url>x.jpg</url><link>https://img.example</link></image>
    <description><![CDATA[<p>Il podcast quotidiano di <b>Internazionale</b>.</p><p>Ogni mattina.</p>]]></description>
    <item><title>Episodio vecchio</title><pubDate>Mon, 19 Oct 2026 04:00:00 GMT</pubDate><itunes:duration>1:02:03</itunes:duration></item>
    <item><title>Gaza &amp; dintorni</title><link>https://www.internazionale.it/ep/2</link><pubDate>Tue, 20 Oct 2026 04:00:00 GMT</pubDate><itunes:duration>1530</itunes:duration></item>
  </channel></rss>`;

  it('legge descrizione, sito ed episodi, dal più recente', () => {
    expect(parseFeed(xml)).toEqual({
      description: 'Il podcast quotidiano di Internazionale.\nOgni mattina.',
      website: 'https://www.internazionale.it/podcast',
      latest: [
        { title: 'Gaza & dintorni', date: '2026-10-20', seconds: 1530, url: 'https://www.internazionale.it/ep/2' },
        { title: 'Episodio vecchio', date: '2026-10-19', seconds: 3723, url: null },
      ],
    });
  });

  it('converte durate e testi', () => {
    expect(durationSeconds('45:10')).toBe(2710);
    expect(durationSeconds('abc')).toBeNull();
    expect(feedText('&lt;p&gt;Uno&lt;/p&gt;&lt;p&gt;Due &amp;#39;tre&amp;#39;&lt;/p&gt;')).toBe("Uno\nDue 'tre'");
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
