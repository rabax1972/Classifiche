import { describe, expect, it } from 'vitest';
import { movieSubtitle } from '../src/lib/aggregate';
import { movieId, pickTrailer } from '../scripts/movie-info';

describe('movieSubtitle', () => {
  it("separa i registi dall'anno", () => {
    expect(movieSubtitle('Joe Russo, Anthony Russo (2026)')).toEqual({ directors: 'Joe Russo, Anthony Russo', year: '2026' });
    expect(movieSubtitle('(2025)')).toEqual({ directors: null, year: '2025' });
    expect(movieSubtitle('Zach Cregger')).toEqual({ directors: 'Zach Cregger', year: null });
    expect(movieSubtitle(null)).toEqual({ directors: null, year: null });
  });
});

describe('movieId', () => {
  it("prende l'ID TMDB dall'externalId o dal link", () => {
    expect(movieId({ title: 'X', externalId: 'tmdb:movie:42', sourceUrl: null })).toBe(42);
    expect(movieId({ title: 'X', externalId: null, sourceUrl: 'https://www.themoviedb.org/movie/7' })).toBe(7);
    expect(movieId({ title: 'X', externalId: null, sourceUrl: 'https://www.netflix.com/tudum/top10/italy' })).toBeNull();
  });
});

describe('pickTrailer', () => {
  it('preferisce il trailer in italiano su YouTube', () => {
    const v = (key: string, type: string, lang: string, site = 'YouTube') => ({ key, type, site, iso_639_1: lang, official: true });
    expect(pickTrailer([v('en', 'Trailer', 'en'), v('it', 'Trailer', 'it'), v('vimeo', 'Trailer', 'it', 'Vimeo')])).toBe('it');
    expect(pickTrailer([v('teaser', 'Teaser', 'en'), v('trailer', 'Trailer', 'en')])).toBe('trailer');
    expect(pickTrailer([v('clip', 'Clip', 'it')])).toBeNull();
  });
});
