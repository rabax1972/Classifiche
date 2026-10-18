import { describe, expect, it } from 'vitest';
import { pickTomatometer } from '../scripts/movie-ratings';

const v = (value: string) => ({ value });
const TOMATOMETER = 'http://www.wikidata.org/entity/Q108403393';
const AVERAGE = 'http://www.wikidata.org/entity/Q108403540';

describe('pickTomatometer', () => {
  it('tiene il Tomatometer più recente e scarta il voto medio', () => {
    const rt = pickTomatometer([
      { imdb: v('tt1'), score: v('9.4/10'), method: v(AVERAGE), date: v('2026-01-01T00:00:00Z'), rtid: v('m/film') },
      { imdb: v('tt1'), score: v('95%'), method: v(TOMATOMETER), date: v('2024-01-30T00:00:00Z'), rtid: v('m/film') },
      { imdb: v('tt1'), score: v('97%'), method: v(TOMATOMETER), date: v('2026-01-15T00:00:00Z'), rtid: v('m/film') },
      { imdb: v('tt2'), score: v('40%'), rtid: v('m/altro') },
      { imdb: v('tt3') },
    ]);
    expect(rt.get('tt1')).toEqual({ score: 97, date: '2026-01-15', url: 'https://www.rottentomatoes.com/m/film' });
    expect(rt.get('tt2')).toEqual({ score: 40, date: null, url: 'https://www.rottentomatoes.com/m/altro' });
    expect(rt.has('tt3')).toBe(false);
  });
});
