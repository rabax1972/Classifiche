import { describe, expect, it } from 'vitest';
import { movieKeys, seenMovie } from '../scripts/trakt-import';

const crew = (...names: string[]) => ({ crew: names.map((name) => ({ job: 'Director', name })) });

describe('movieKeys', () => {
  it('regista unico: una chiave per anno (uscita originale e italiana) e quelle col solo titolo', () => {
    const keys = movieKeys(
      {
        title: 'Mr. Morfina',
        original_title: 'Novocaine',
        release_date: '2025-03-12',
        credits: crew('Dan Berk'),
        release_dates: { results: [{ iso_3166_1: 'IT', release_dates: [{ release_date: '2026-01-08T00:00:00.000Z' }] }] },
      },
      'Novocaine',
    );
    expect(keys.sort()).toEqual(['mr morfina|', 'mr morfina|dan berk 2025', 'mr morfina|dan berk 2026', 'novocaine|']);
  });

  it('due registi: il primo nome in entrambi gli ordini, senza anno', () => {
    const keys = movieKeys({ title: 'Avengers: Endgame', release_date: '2019-04-24', credits: crew('Joe Russo', 'Anthony Russo') }, 'Avengers: Endgame');
    expect(keys).toContain('avengers endgame|joe russo');
    expect(keys).toContain('avengers endgame|anthony russo');
  });

  it('titolo originale solo in alfabeto latino; i titoli di sole cifre restano', () => {
    expect(movieKeys({ title: 'Demon Slayer', original_title: '鬼滅の刃 2', credits: crew() }, 'Demon Slayer')).toEqual(['demon slayer|']);
    expect(movieKeys({ title: '1917', original_title: '1917', release_date: '2019-12-25', credits: crew('Sam Mendes') }, '1917').sort()).toEqual([
      '1917|',
      '1917|sam mendes 2019',
    ]);
  });
});

describe('seenMovie', () => {
  it('scheda del catalogo: locandina piccola, voto solo con almeno 10 voti, servizi unificati', () => {
    const f = seenMovie(
      {
        title: 'Matchbox: Il film',
        release_date: '2026-09-19',
        poster_path: '/abc.jpg',
        vote_average: 7.85,
        vote_count: 120,
        genres: [{ name: 'Avventura' }],
        runtime: 112,
        credits: crew('Sam Hargrave'),
        'watch/providers': {
          results: {
            IT: {
              link: 'https://www.themoviedb.org/movie/1/watch?locale=IT',
              flatrate: [
                { provider_name: 'HBO Max Amazon Channel', logo_path: '/canale.png', display_priority: 2 },
                { provider_name: 'HBO Max', logo_path: '/hbo.png', display_priority: 1 },
              ],
            },
          },
        },
      },
      1,
      ['matchbox il film|sam hargrave 2026'],
    );
    expect(f).toMatchObject({ year: 2026, vote: 7.9, runtime: 112, directors: ['Sam Hargrave'], genres: ['Avventura'] });
    expect(f.poster).toBe('https://image.tmdb.org/t/p/w185/abc.jpg');
    expect(f.providers).toEqual([{ name: 'HBO Max', logo: 'https://image.tmdb.org/t/p/w92/hbo.png' }]);
    expect(seenMovie({ title: 'X', vote_average: 9, vote_count: 3 }, 2, []).vote).toBeNull();
  });
});
