import { describe, expect, it } from 'vitest';
import { seriesSubtitle } from '../src/lib/aggregate';
import { seasonList, seriesId } from '../scripts/series-info';
import { seasonStale, toEpisode } from '../scripts/episode-info';

describe('seriesSubtitle', () => {
  it("separa i creatori dall'anno", () => {
    expect(seriesSubtitle('David Benioff, D. B. Weiss (2011)')).toEqual({ creators: 'David Benioff, D. B. Weiss', year: '2011', label: null });
    expect(seriesSubtitle('(2022)')).toEqual({ creators: null, year: '2022', label: null });
    expect(seriesSubtitle(null)).toEqual({ creators: null, year: null, label: null });
  });

  it('riconosce la stagione della Top 10 Netflix', () => {
    expect(seriesSubtitle('Stagione 2')).toEqual({ creators: null, year: null, label: 'Stagione 2' });
    expect(seriesSubtitle('Miniserie')).toEqual({ creators: null, year: null, label: 'Miniserie' });
    expect(seriesSubtitle('Parte 1')).toEqual({ creators: null, year: null, label: 'Parte 1' });
  });
});

describe('seriesId', () => {
  it("prende l'ID TMDB dall'externalId o dal link, non quello dei film", () => {
    expect(seriesId({ title: 'X', externalId: 'tmdb:tv:1399', sourceUrl: null })).toBe(1399);
    expect(seriesId({ title: 'X', externalId: null, sourceUrl: 'https://www.themoviedb.org/tv/7' })).toBe(7);
    expect(seriesId({ title: 'X', externalId: 'tmdb:movie:42', sourceUrl: 'https://www.themoviedb.org/movie/42' })).toBeNull();
    expect(seriesId({ title: 'X', externalId: null, sourceUrl: 'https://www.netflix.com/tudum/top10/italy/tv' })).toBeNull();
  });
});

describe('seasonList', () => {
  it('tiene le stagioni con episodi, speciali in fondo', () => {
    const list = seasonList([
      { season_number: 0, name: 'Speciali', air_date: '2010-01-01', episode_count: 3 },
      { season_number: 2, name: 'Stagione 2', air_date: '2012-01-01', episode_count: 8 },
      { season_number: 1, name: '', air_date: null, episode_count: 10 },
      { season_number: 3, name: 'Stagione 3', episode_count: 0 },
    ]);
    expect(list.map((s) => s.n)).toEqual([1, 2, 0]);
    expect(list[0]).toEqual({ n: 1, name: 'Stagione 1', date: null, episodes: 10 });
  });
});

describe('seasonStale', () => {
  const now = Date.parse('2026-10-17T00:00:00Z');
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
  it("rinnova l'ultima stagione in corso ogni settimana e tutto entro 150 giorni", () => {
    expect(seasonStale(undefined, false, now)).toBe(true);
    expect(seasonStale(daysAgo(10), false, now)).toBe(false);
    expect(seasonStale(daysAgo(10), true, now)).toBe(true);
    expect(seasonStale(daysAgo(3), true, now)).toBe(false);
    expect(seasonStale(daysAgo(151), false, now)).toBe(true);
  });
});

describe('toEpisode', () => {
  it("completa con l'inglese titolo segnaposto e trama mancante", () => {
    const e = toEpisode(
      { episode_number: 4, name: 'Episodio 4', overview: '', vote_average: 7.25, vote_count: 12, crew: [{ job: 'Director', name: 'A' }, { job: 'Writer', name: 'B' }] },
      { episode_number: 4, name: 'The Real Title', overview: 'Plot.' },
    );
    expect(e).toMatchObject({ n: 4, title: 'The Real Title', overview: 'Plot.', overviewLang: 'en', vote: 7.3, directors: ['A'], writers: ['B'] });
    expect(toEpisode({ episode_number: 1, name: 'Pilota', overview: 'Trama.' })).toMatchObject({ title: 'Pilota', overviewLang: 'it' });
  });
});
