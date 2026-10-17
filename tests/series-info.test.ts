import { describe, expect, it } from 'vitest';
import { seriesSubtitle } from '../src/lib/aggregate';
import { seriesId } from '../scripts/series-info';

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
