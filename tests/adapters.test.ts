import { describe, expect, it } from 'vitest';
import { biggerArtwork, parseAppleFeed } from '../scripts/adapters/apple';
import { parseLastfm } from '../scripts/adapters/lastfm';
import { expectedLatestWeek, parseNetflixTsv, seasonLabel, toOfficialCharts } from '../scripts/adapters/netflix';
import { toEntry } from '../scripts/adapters/tmdb';
import { cleanEntries } from '../scripts/adapters/types';
import { parseSinglesTable } from '../scripts/adapters/wikipedia';

describe('Netflix', () => {
  const tsv = [
    'country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10',
    'Italy\tIT\t2026-10-04\tTV\t1\tMinerva Academy\tMinerva Academy: Season 1\t2',
    'Italy\tIT\t2026-10-04\tFilms\t1\tUNABOMBER\tN/A\t2',
    'France\tFR\t2026-10-04\tFilms\t1\tAutre\tN/A\t1',
    'Italy\tIT\t2026-09-27\tTV\t1\tMinerva Academy\tMinerva Academy: Season 1\t1',
  ].join('\n');

  it('filtra l\'Italia e mappa le categorie', () => {
    const rows = parseNetflixTsv(tsv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ category: 'film', title: 'UNABOMBER', season: null });
  });

  it('fallisce se il formato del file cambia', () => {
    expect(() => parseNetflixTsv('a\tb\nx\ty')).toThrow(/formato/);
  });

  it('crea una classifica per categoria e settimana', () => {
    const charts = toOfficialCharts(parseNetflixTsv(tsv), 'now');
    expect(charts).toHaveLength(3);
    const tv = charts.find((c) => c.category === 'serie-tv' && c.periodKey === '2026-10-04')!;
    expect(tv.periodLabel).toBe('Settimana 28/09/2026 – 04/10/2026');
    expect(tv.entries[0]).toMatchObject({ title: 'Minerva Academy', subtitle: 'Stagione 1' });
    expect(tv.url).toContain('/italy/tv?week=2026-10-04');
  });

  it('traduce le etichette di stagione', () => {
    expect(seasonLabel('Physical 100: Italy', 'Physical 100: Italy: Season 2')).toBe('Stagione 2');
    expect(seasonLabel('X', 'X: Limited Series')).toBe('Miniserie');
    expect(seasonLabel('X', null)).toBeNull();
  });

  it('calcola l\'ultima settimana già pubblicata (aggiornamento del martedì)', () => {
    expect(expectedLatestWeek('2026-10-11')).toBe('2026-10-04'); // domenica
    expect(expectedLatestWeek('2026-10-13')).toBe('2026-10-11'); // martedì
    expect(expectedLatestWeek('2026-10-12')).toBe('2026-10-04'); // lunedì
  });
});

describe('Wikipedia (FIMI)', () => {
  const html = `
    <table class="wikitable"><tr><th>Anno</th><th>Note</th></tr><tr><td>1</td><td>x</td></tr></table>
    <table class="wikitable sortable">
      <tr><th><abbr>N°</abbr></th><th>Titolo</th><th>Artista(i)</th></tr>
      <tr><th scope="row">1</th><td><a>Balorda nostalgia</a><sup class="reference">[1]</sup></td><td>Olly e Juli</td></tr>
      <tr><th scope="row">2</th><td>Devastante</td><td rowspan="2">Olly e Juli</td></tr>
      <tr><th scope="row">3</th><td>Scarabocchi</td></tr>
      <tr><th scope="row">4</th><td>"Battito"</td><td>Fedez</td></tr>
    </table>`;

  it('riconosce la tabella giusta, rimuove le note e gestisce i rowspan', () => {
    const e = parseSinglesTable(html, 'wikipedia-fimi', 'https://it.wikipedia.org/wiki/X');
    expect(e.map((x) => [x.rank, x.title, x.subtitle])).toEqual([
      [1, 'Balorda nostalgia', 'Olly e Juli'],
      [2, 'Devastante', 'Olly e Juli'],
      [3, 'Scarabocchi', 'Olly e Juli'],
      [4, 'Battito', 'Fedez'],
    ]);
  });

  it('restituisce una lista vuota se non trova tabelle compatibili', () => {
    expect(parseSinglesTable('<p>niente</p>', 's', 'u')).toEqual([]);
  });
});

describe('Apple RSS', () => {
  it('converte il feed nel formato comune', () => {
    const e = parseAppleFeed(
      {
        feed: {
          title: 'Top brani',
          updated: '',
          results: [{ id: '1', name: 'Lontano', artistName: 'Sfera Ebbasta', artworkUrl100: 'https://x/a/100x100bb.jpg', url: 'https://music.apple.com/it/1' }],
        },
      },
      'apple-music',
    );
    expect(e[0]).toEqual({
      rank: 1,
      title: 'Lontano',
      subtitle: 'Sfera Ebbasta',
      cover: 'https://x/a/200x200bb.jpg',
      source: 'apple-music',
      sourceUrl: 'https://music.apple.com/it/1',
      externalId: 'apple:1',
    });
  });
  it('biggerArtwork gestisce URL mancanti', () => {
    expect(biggerArtwork(undefined)).toBeNull();
  });
});

describe('Last.fm', () => {
  it('converte la risposta', () => {
    const e = parseLastfm({ tracks: { track: [{ name: 'Song', url: 'https://last.fm/x', artist: { name: 'Artist' } }] } });
    expect(e[0]).toMatchObject({ rank: 1, title: 'Song', subtitle: 'Artist', cover: null, source: 'lastfm' });
  });
  it('propaga gli errori dell\'API', () => {
    expect(() => parseLastfm({ error: 10, message: 'Invalid API key' })).toThrow(/Invalid API key/);
  });
});

describe('TMDB', () => {
  it('converte film e serie', () => {
    expect(toEntry({ id: 5, title: 'Film', poster_path: '/p.jpg' }, 'movie', 1, 'tmdb-streaming')).toMatchObject({
      title: 'Film',
      cover: 'https://image.tmdb.org/t/p/w185/p.jpg',
      sourceUrl: 'https://www.themoviedb.org/movie/5',
      externalId: 'tmdb:movie:5',
    });
    expect(toEntry({ id: 7, name: 'Serie', poster_path: null }, 'tv', 2, 's')).toMatchObject({ title: 'Serie', cover: null });
  });
});

describe('cleanEntries', () => {
  const e = (rank: number, title: string) => ({ rank, title, subtitle: ' A ', cover: null, source: 's', sourceUrl: null, externalId: null });
  it('scarta righe vuote, ordina e rinumera', () => {
    expect(cleanEntries([e(3, 'C'), e(1, ' A '), e(2, '  ')]).map((x) => [x.rank, x.title, x.subtitle])).toEqual([
      [1, 'A', 'A'],
      [2, 'C', 'A'],
    ]);
  });
  it('rifiuta una classifica vuota', () => {
    expect(() => cleanEntries([])).toThrow();
  });
});
