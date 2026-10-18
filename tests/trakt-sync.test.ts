import { describe, expect, it } from 'vitest';
import { missingTicks } from '../src/lib/trakt-sync';

const ep = (show: number, season: number, number: number) => ({ episode: { season, number }, show: { ids: { tmdb: show } } });

describe('missingTicks', () => {
  it('aggiunge solo quello che manca: film per ID TMDB, serie complete, episodi', () => {
    const lists = missingTicks(
      {
        movies: [{ movie: { ids: { tmdb: 1 } } }, { movie: { ids: { tmdb: 2 } } }, { movie: { ids: { tmdb: 3 } } }, { movie: { ids: { tmdb: null } } }],
        shows: [
          { show: { ids: { tmdb: 10 }, aired_episodes: 2 } },
          { show: { ids: { tmdb: 20 }, aired_episodes: 3 } },
        ],
        history: [ep(10, 1, 1), ep(10, 1, 2), ep(10, 0, 1), ep(20, 1, 1)],
        catalog: new Map([[1, ['film uno|regista 2020', 'movie:1']]]),
      },
      { films: new Set(['film uno|regista 2020', 'movie:3']), series: new Set(), episodes: new Set(['10:1:1']) },
    );
    // Film 1 già visto con la chiave del catalogo, film 3 già spuntato per ID: manca solo il 2.
    expect(lists.visti).toEqual(['movie:2']);
    // Serie 10: 2 episodi su 2 (lo speciale non conta); serie 20: 1 su 3.
    expect(lists['serie-viste']).toEqual(['tv:10']);
    expect(lists['episodi-visti']).toEqual(['10:1:2', '10:0:1', '20:1:1']);
  });
});
