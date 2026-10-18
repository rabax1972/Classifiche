import { describe, expect, it } from 'vitest';
import { movieKeys } from '../scripts/trakt-import';

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
