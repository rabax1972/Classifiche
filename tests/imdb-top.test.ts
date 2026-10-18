import { describe, expect, it } from 'vitest';
import { rankRatings } from '../scripts/imdb-top';

describe('rankRatings', () => {
  const tsv = [
    'tconst\taverageRating\tnumVotes',
    'tt1\t9.5\t30000', // voto alto ma pochi voti: la media bayesiana lo abbassa
    'tt2\t9.0\t2000000',
    'tt3\t9.9\t24999', // sotto la soglia dei 25.000 voti
    'tt4\t8.0\t500000',
    '',
  ].join('\n');

  it('scarta i titoli con meno di 25.000 voti e ordina per media bayesiana', () => {
    expect(rankRatings(tsv).map((r) => r.id)).toEqual(['tt2', 'tt1', 'tt4']);
  });

  it('calcola la media bayesiana con 25.000 voti a 7,0', () => {
    const r = rankRatings(tsv).find((x) => x.id === 'tt1')!;
    expect(r.weighted).toBeCloseTo((30000 * 9.5 + 25000 * 7) / 55000);
  });
});
