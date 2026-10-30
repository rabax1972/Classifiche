import { describe, expect, it } from 'vitest';
import { oscarWinners } from '../scripts/oscar-winners';

const row = (film: string, tmdb: string, date?: string) => ({ film: { value: film }, tmdb: { value: tmdb }, date: date ? { value: date } : undefined });

describe('oscarWinners', () => {
  it('un film per vincitore, con la cerimonia più recente, dal più recente', () => {
    const w = oscarWinners([
      row('Q1', '28966', '1929-05-16T00:00:00Z'),
      row('Q2', '143', '1930-01-01T00:00:00Z'),
      row('Q2', '143', '1930-11-01T00:00:00Z'),
      row('Q3', '872585', '2024-03-10T00:00:00Z'),
      row('Q4', '1', undefined),
    ]);
    expect(w).toEqual([
      { tmdbId: 872585, ceremony: '2024-03-10' },
      { tmdbId: 143, ceremony: '1930-11-01' },
      { tmdbId: 28966, ceremony: '1929-05-16' },
    ]);
  });
});
