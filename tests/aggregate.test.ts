import { describe, expect, it } from 'vitest';
import {
  addDays,
  aggregateBorda,
  bordaPoints,
  splitArtists,
  computeChange,
  entryKey,
  periodChart,
  pickDailyList,
  previousWindow,
  todayChart,
  toDailyLists,
  windowEndingAt,
  withChanges,
  type DailyList,
} from '../src/lib/aggregate';
import type { ChartEntry, DailySnapshot } from '../src/lib/types';

function entry(rank: number, title: string, subtitle = 'Artista'): ChartEntry {
  return { rank, title, subtitle, cover: null, source: 'test', sourceUrl: null, externalId: null };
}

function list(date: string, titles: string[], source = 'test'): DailyList {
  return { date, source, entries: titles.map((t, i) => entry(i + 1, t)) };
}

describe('bordaPoints', () => {
  it('assegna 100 punti al primo e 1 al centesimo', () => {
    expect(bordaPoints(1)).toBe(100);
    expect(bordaPoints(2)).toBe(99);
    expect(bordaPoints(100)).toBe(1);
  });
  it('restituisce 0 per posizioni fuori scala o non valide', () => {
    expect(bordaPoints(101)).toBe(0);
    expect(bordaPoints(0)).toBe(0);
    expect(bordaPoints(-3)).toBe(0);
    expect(bordaPoints(Number.NaN)).toBe(0);
  });
});

describe('finestre temporali', () => {
  it('calcola finestra e finestra precedente', () => {
    const w = windowEndingAt('2026-10-11', 7);
    expect(w).toEqual({ from: '2026-10-05', to: '2026-10-11', days: 7 });
    expect(previousWindow(w)).toEqual({ from: '2026-09-28', to: '2026-10-04', days: 7 });
  });
  it('gestisce cambi di mese e anni bisestili', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(windowEndingAt('2026-03-01', 30).from).toBe('2026-01-31');
  });
  it('rifiuta date malformate', () => {
    expect(() => addDays('11/10/2026', 1)).toThrow();
  });
});

describe('entryKey', () => {
  it('ignora maiuscole, accenti, punteggiatura e featuring', () => {
    expect(entryKey({ title: 'PER NOI (feat. Achille Lauro)', subtitle: 'Geolier' })).toBe(
      entryKey({ title: 'Per noi', subtitle: 'GEOLIER' }),
    );
    expect(entryKey({ title: 'Città', subtitle: 'Anna' })).toBe(entryKey({ title: 'citta', subtitle: 'anna' }));
  });
  it('usa solo il primo artista', () => {
    expect(entryKey({ title: 'X', subtitle: 'Geolier, Ultimo' })).toBe(entryKey({ title: 'X', subtitle: 'Geolier' }));
  });
  it('distingue titoli uguali di artisti diversi', () => {
    expect(entryKey({ title: 'Hello', subtitle: 'Adele' })).not.toBe(entryKey({ title: 'Hello', subtitle: 'Lionel Richie' }));
  });
});

describe('aggregateBorda', () => {
  const w = windowEndingAt('2026-10-03', 3);

  it('somma i punti su più giorni e ordina per punteggio', () => {
    const lists = [
      list('2026-10-01', ['A', 'B', 'C']),
      list('2026-10-02', ['B', 'A', 'C']),
      list('2026-10-03', ['B', 'C', 'A']),
    ];
    const r = aggregateBorda(lists, w);
    expect(r.entries.map((e) => e.title)).toEqual(['B', 'A', 'C']);
    expect(r.entries[0]).toMatchObject({ rank: 1, points: 99 + 100 + 100, daysInChart: 3, bestRank: 1 });
    expect(r.entries[1]).toMatchObject({ points: 100 + 99 + 98, bestRank: 1 });
    expect(r.daysWithData).toBe(3);
  });

  it('a parità di punti premia la posizione migliore', () => {
    // A: 1° e 3° (100+98=198); B: 2° e 2° (99+99=198) → vince A per bestRank.
    const lists = [list('2026-10-01', ['A', 'B', 'C']), list('2026-10-02', ['C', 'B', 'A'])];
    const r = aggregateBorda(lists, w);
    const a = r.entries.find((e) => e.title === 'A')!;
    const b = r.entries.find((e) => e.title === 'B')!;
    expect(a.points).toBe(b.points);
    expect(a.rank).toBeLessThan(b.rank);
  });

  it('a parità di punti e posizione migliore premia più giorni in classifica', () => {
    const lists = [
      { date: '2026-10-01', source: 't', entries: [entry(1, 'A'), entry(2, 'B')] },
      { date: '2026-10-02', source: 't', entries: [entry(51, 'B')] },
      { date: '2026-10-03', source: 't', entries: [entry(51, 'A')] },
    ];
    // A: 100+50 = 150, best 1, 2 giorni; B: 99+50 = 149.
    const r = aggregateBorda(lists, w);
    expect(r.entries[0]!.title).toBe('A');
  });

  it('ignora i giorni fuori finestra', () => {
    const lists = [list('2026-09-30', ['Z']), list('2026-10-03', ['A'])];
    const r = aggregateBorda(lists, w);
    expect(r.entries.map((e) => e.title)).toEqual(['A']);
    expect(r.daysWithData).toBe(1);
  });

  it('gestisce giorni mancanti senza penalità né errori', () => {
    const lists = [list('2026-10-01', ['A', 'B']), list('2026-10-03', ['B', 'A'])];
    const r = aggregateBorda(lists, w);
    expect(r.daysWithData).toBe(2);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]!.daysInChart).toBe(2);
  });

  it('restituisce una classifica vuota senza dati', () => {
    expect(aggregateBorda([], w)).toEqual({ entries: [], daysWithData: 0, sources: [] });
  });

  it('usa i metadati (es. copertina) più recenti', () => {
    const lists = [
      { date: '2026-10-01', source: 't', entries: [{ ...entry(1, 'A'), cover: 'old.jpg' }] },
      { date: '2026-10-02', source: 't', entries: [{ ...entry(1, 'A'), cover: 'new.jpg' }] },
    ];
    expect(aggregateBorda(lists, w).entries[0]!.cover).toBe('new.jpg');
  });

  it('conta una sola volta i duplicati nello stesso giorno', () => {
    const lists = [{ date: '2026-10-01', source: 't', entries: [entry(1, 'A'), entry(5, 'A')] }];
    expect(aggregateBorda(lists, w).entries[0]!.points).toBe(100);
  });

  it('rispetta il limite', () => {
    const titles = Array.from({ length: 80 }, (_, i) => `T${i}`);
    expect(aggregateBorda([list('2026-10-02', titles)], w, 20).entries).toHaveLength(20);
  });
});

describe('variazioni', () => {
  it('computeChange', () => {
    expect(computeChange(3, undefined)).toEqual({ kind: 'new' });
    expect(computeChange(3, 3)).toEqual({ kind: 'same' });
    expect(computeChange(2, 5)).toEqual({ kind: 'up', by: 3 });
    expect(computeChange(5, 2)).toEqual({ kind: 'down', by: 3 });
  });

  it('senza classifica precedente non marca tutto come nuovo', () => {
    const cur = aggregateBorda([list('2026-10-01', ['A'])], windowEndingAt('2026-10-01', 1)).entries;
    expect(withChanges(cur, null)[0]!.change).toBeNull();
    expect(withChanges(cur, [])[0]!.change).toBeNull();
  });

  it('periodChart confronta con la finestra precedente', () => {
    const lists = [
      list('2026-09-28', ['A', 'B']),
      list('2026-09-29', ['A', 'B']),
      list('2026-09-30', ['B', 'A', 'C']),
      list('2026-10-01', ['B', 'C', 'A']),
    ];
    // Finestra 2 giorni: corrente 30/09–01/10, precedente 28–29/09.
    const r = periodChart(lists, windowEndingAt('2026-10-01', 2));
    const byTitle = Object.fromEntries(r.entries.map((e) => [e.title, e.change]));
    expect(byTitle.B).toEqual({ kind: 'up', by: 1 });
    expect(byTitle.A).toEqual({ kind: 'down', by: 1 });
    expect(byTitle.C).toEqual({ kind: 'new' });
  });

  it('periodChart senza dati precedenti lascia change a null', () => {
    const r = periodChart([list('2026-10-01', ['A'])], windowEndingAt('2026-10-01', 7));
    expect(r.entries[0]!.change).toBeNull();
  });
});

describe('cambio periodo', () => {
  const lists = Array.from({ length: 40 }, (_, i) =>
    list(addDays('2026-09-02', i), i < 35 ? ['Vecchio', 'Nuovo'] : ['Nuovo', 'Vecchio']),
  );
  const end = '2026-10-11';

  it('la settimana privilegia i dati recenti', () => {
    const r = aggregateBorda(lists, windowEndingAt(end, 7));
    expect(r.entries[0]!.title).toBe('Nuovo');
    expect(r.daysWithData).toBe(7);
  });

  it('il mese e l\'anno pesano tutto il periodo', () => {
    expect(aggregateBorda(lists, windowEndingAt(end, 30)).entries[0]!.title).toBe('Vecchio');
    const year = aggregateBorda(lists, windowEndingAt(end, 365));
    expect(year.entries[0]!.title).toBe('Vecchio');
    expect(year.daysWithData).toBe(40);
  });
});

describe('snapshot e fonti', () => {
  const snap = (date: string, sources: DailySnapshot['sources']): DailySnapshot => ({
    date,
    category: 'canzoni',
    sources,
  });
  const src = (source: string, titles: string[]) => ({
    source,
    fetchedAt: '2026-10-01T06:00:00Z',
    entries: titles.map((t, i) => entry(i + 1, t)),
  });

  it('usa la fonte primaria quando disponibile', () => {
    const s = snap('2026-10-01', { primary: src('primary', ['A']), backup: src('backup', ['B']) });
    expect(pickDailyList(s, ['primary', 'backup'])!.source).toBe('primary');
  });

  it('ripiega sulla fonte secondaria se la primaria manca o è vuota', () => {
    expect(pickDailyList(snap('d', { backup: src('backup', ['B']) }), ['primary', 'backup'])!.source).toBe('backup');
    expect(
      pickDailyList(snap('d', { primary: src('primary', []), backup: src('backup', ['B']) }), ['primary', 'backup'])!
        .source,
    ).toBe('backup');
  });

  it('scarta gli snapshot senza fonti valide e ordina per data', () => {
    const lists = toDailyLists(
      [snap('2026-10-02', { primary: src('primary', ['A']) }), snap('2026-10-01', {}), snap('2026-09-30', { primary: src('primary', ['B']) })],
      ['primary'],
    );
    expect(lists.map((l) => l.date)).toEqual(['2026-09-30', '2026-10-02']);
  });
});

describe('todayChart', () => {
  it('usa l\'ultimo snapshot e confronta con il precedente disponibile', () => {
    const r = todayChart([list('2026-10-08', ['A', 'B']), list('2026-10-10', ['B', 'A', 'C'])])!;
    expect(r.date).toBe('2026-10-10');
    expect(r.previousDate).toBe('2026-10-08');
    expect(r.entries.map((e) => [e.title, e.change?.kind])).toEqual([
      ['B', 'up'],
      ['A', 'down'],
      ['C', 'new'],
    ]);
  });

  it('con un solo snapshot non ha variazioni', () => {
    const r = todayChart([list('2026-10-10', ['A'])])!;
    expect(r.previousDate).toBeNull();
    expect(r.entries[0]!.change).toBeNull();
  });

  it('senza snapshot restituisce null', () => {
    expect(todayChart([])).toBeNull();
  });
});

describe('splitArtists', () => {
  it('divide su virgola, & e feat. conservando i separatori', () => {
    expect(splitArtists('KAROL G, Judeline & rusowsky')).toEqual(['KAROL G', ', ', 'Judeline', ' & ', 'rusowsky']);
    expect(splitArtists('Sfera Ebbasta feat. Shiva')).toEqual(['Sfera Ebbasta', ' feat. ', 'Shiva']);
  });

  it('divide su " e " solo se il nome intero non è un unico artista', () => {
    expect(splitArtists('Sfera Ebbasta e Shiva')).toEqual(['Sfera Ebbasta', ' e ', 'Shiva']);
    expect(splitArtists('Colapesce e Dimartino', (n) => n === 'Colapesce e Dimartino')).toEqual(['Colapesce e Dimartino']);
    expect(splitArtists('Fabri Fibra e Tredici Pietro, Joshua')).toEqual(['Fabri Fibra', ' e ', 'Tredici Pietro', ', ', 'Joshua']);
  });

  it('non divide su "x" né dentro le parole', () => {
    expect(splitArtists('Pinguini Tattici Nucleari')).toEqual(['Pinguini Tattici Nucleari']);
    expect(splitArtists('Myss Keta x Elodie')).toEqual(['Myss Keta x Elodie']);
  });
});
