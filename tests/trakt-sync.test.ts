import { describe, expect, it } from 'vitest';
import { addedTitles, missingTicks, watchDates } from '../src/lib/trakt-sync';

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

describe('addedTitles', () => {
  it('dà un titolo leggibile a film, serie complete ed episodi aggiunti', () => {
    const titles = addedTitles(
      {
        movies: [{ movie: { ids: { tmdb: 2 }, title: 'Dune', year: 2021 } }],
        shows: [{ show: { ids: { tmdb: 10 }, title: 'Dark' } }],
        history: [{ episode: { season: 1, number: 2, title: 'Bugie' }, show: { ids: { tmdb: 10 }, title: 'Dark' } }],
      },
      { visti: ['movie:2', 'movie:99'], 'serie-viste': ['tv:10'], 'episodi-visti': ['10:1:2'] },
    );
    // Senza dati su Trakt resta la chiave.
    expect(titles).toEqual(['Dune (2021)', 'movie:99', 'Dark (serie completa)', 'Dark 1x02 – Bugie']);
  });
});

describe('watchDates', () => {
  it('data di visione per tutte le chiavi del film, per la serie e per ogni episodio (la più recente se rivisto)', () => {
    const t = (iso: string) => Date.parse(iso) / 1000;
    const dates = watchDates({
      movies: [{ last_watched_at: '2026-10-18T19:30:00.000Z', movie: { ids: { tmdb: 398395 } } }, { movie: { ids: { tmdb: 5 } } }],
      shows: [{ last_watched_at: '2026-09-01T20:00:00.000Z', show: { ids: { tmdb: 10 } } }],
      history: [
        { watched_at: '2026-08-01T20:00:00.000Z', episode: { season: 1, number: 1 }, show: { ids: { tmdb: 10 } } },
        { watched_at: '2026-09-01T20:00:00.000Z', episode: { season: 1, number: 1 }, show: { ids: { tmdb: 10 } } },
      ],
      catalog: new Map([[398395, ['timecode|juanjo gimenez pena 2016']]]),
    });
    expect(dates.visti).toEqual({ 'timecode|juanjo gimenez pena 2016': t('2026-10-18T19:30:00Z'), 'movie:398395': t('2026-10-18T19:30:00Z') });
    expect(dates['serie-viste']).toEqual({ 'tv:10': t('2026-09-01T20:00:00Z') });
    expect(dates['episodi-visti']).toEqual({ '10:1:1': t('2026-09-01T20:00:00Z') });
  });
});
