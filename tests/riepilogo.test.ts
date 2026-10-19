import { describe, expect, it } from 'vitest';
import { chartChanges } from '../scripts/lib/riepilogo';
import type { PeriodChart, RankedEntry } from '../src/lib/types';

const entry = (key: string, title: string, subtitle: string | null = null): RankedEntry =>
  ({ key, title, subtitle, rank: 1, cover: null, source: 's', sourceUrl: null, externalId: null, change: null });
const chart = (entries: RankedEntry[]): PeriodChart => ({
  category: 'canzoni',
  period: 'oggi',
  generatedAt: '',
  lastSnapshot: null,
  stale: false,
  views: [{ kind: 'daily', label: 'Classifica del giorno', sources: [], periodLabel: 'Oggi', from: '', to: '', entries }],
});

describe('chartChanges', () => {
  it('elenca le nuove entrate e conta le uscite, per vista', () => {
    const before = chart([entry('a', 'A'), entry('b', 'B')]);
    const after = chart([entry('a', 'A'), entry('c', 'C', 'Artista')]);
    expect(chartChanges(before, after)).toEqual([
      { categoria: 'Canzoni', periodo: 'Oggi', vista: 'Classifica del giorno', nuovi: ['C — Artista'], altri: 0, usciti: 1 },
    ]);
  });

  it('niente se la classifica non è cambiata; oltre 10 titoli li conta soltanto', () => {
    const same = chart([entry('a', 'A')]);
    expect(chartChanges(same, same)).toEqual([]);
    const many = chart(Array.from({ length: 12 }, (_, i) => entry(`k${i}`, `T${i}`)));
    const [c] = chartChanges(null, many);
    expect(c!.nuovi).toHaveLength(10);
    expect(c!.altri).toBe(2);
  });
});
