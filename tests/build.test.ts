import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, type DailyList } from '../src/lib/aggregate';
import { buildPeriodChart, maxWindowDays, officialView } from '../src/lib/build';
import type { ChartEntry, OfficialChart } from '../src/lib/types';

const entry = (rank: number, title: string): ChartEntry => ({
  rank,
  title,
  subtitle: null,
  cover: null,
  source: 's',
  sourceUrl: null,
  externalId: null,
});
const list = (date: string, titles: string[], source = 'tmdb-streaming'): DailyList => ({
  date,
  source,
  entries: titles.map((t, i) => entry(i + 1, t)),
});
const official = (key: string, titles: string[]): OfficialChart => ({
  category: 'film',
  source: 'netflix',
  periodType: 'week',
  periodKey: key,
  periodLabel: `Settimana ${key}`,
  url: null,
  fetchedAt: '',
  entries: titles.map((t, i) => entry(i + 1, t)),
});

const base = { generatedAt: 'now', today: '2026-10-11' } as const;

describe('buildPeriodChart', () => {
  it('mette la classifica ufficiale prima di quella calcolata', () => {
    const c = buildPeriodChart({
      ...base,
      category: 'film',
      period: 'settimana',
      lists: [list('2026-10-11', ['A'])],
      official: [official('2026-09-27', ['X', 'Y']), official('2026-10-04', ['Y', 'X', 'Z'])],
    });
    expect(c.views.map((v) => v.label)).toEqual(['Ufficiale', 'Calcolata da snapshot']);
    expect(c.views[0]!.entries.map((e) => [e.title, e.change?.kind])).toEqual([
      ['Y', 'up'],
      ['X', 'down'],
      ['Z', 'new'],
    ]);
  });

  it('senza dati produce una classifica vuota, non un errore', () => {
    const c = buildPeriodChart({ ...base, category: 'cinema', period: 'mese', lists: [], official: [] });
    expect(c.views).toEqual([]);
    expect(c.lastSnapshot).toBeNull();
    expect(c.stale).toBe(false);
  });

  it('segnala dati non aggiornati quando la fonte non risponde da giorni', () => {
    const c = buildPeriodChart({ ...base, category: 'libri', period: 'oggi', lists: [list('2026-10-08', ['A'], 'apple-books')], official: [] });
    expect(c.stale).toBe(true);
    expect(c.lastSnapshot).toBe('2026-10-08');
    expect(c.views[0]!.to).toBe('2026-10-08');
  });

  it('indica la copertura quando mancano giorni', () => {
    const c = buildPeriodChart({
      ...base,
      category: 'libri',
      period: 'settimana',
      lists: [list('2026-10-09', ['A'], 'apple-books'), list('2026-10-11', ['A'], 'apple-books')],
      official: [],
    });
    expect(c.views[0]!.coverage).toEqual({ days: 2, expected: 7 });
    expect(c.views[0]!.note).toMatch(/2 giorni di dati disponibili su 7/);
  });

  it('limita l\'anno a 180 giorni per le categorie basate su TMDB', () => {
    expect(maxWindowDays('film')).toBe(180);
    expect(maxWindowDays('canzoni')).toBe(Infinity);
    const lists = [list('2026-10-11', ['A'])];
    const c = buildPeriodChart({ ...base, category: 'film', period: 'anno', lists, official: [] });
    const v = c.views[0]!;
    expect(v.periodLabel).toBe('Ultimi 180 giorni');
    expect(v.from).toBe(addDays('2026-10-11', -179));
    expect(v.note).toMatch(/TMDB/);
  });
});

describe('officialView', () => {
  it('applica le copertine dalla cache senza sovrascrivere quelle esistenti', () => {
    const v = officialView([official('2026-10-04', ['A', 'B'])], (e) => ({ cover: `${e.title}.jpg`, url: null }))!;
    expect(v.entries.map((e) => e.cover)).toEqual(['A.jpg', 'B.jpg']);
  });
});

describe('pruneSnapshots (limite TMDB)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'classifiche-'));
    process.env.CLASSIFICHE_DATA_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.CLASSIFICHE_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it('rimuove solo i dati TMDB più vecchi di 180 giorni', async () => {
    const { pruneSnapshots, readSnapshots } = await import('../scripts/lib/store');
    const snapDir = path.join(dir, 'snapshots', 'film');
    await mkdir(snapDir, { recursive: true });
    const src = (source: string) => ({ source, fetchedAt: '', entries: [entry(1, 'A')] });
    const write = (date: string, sources: Record<string, unknown>) =>
      writeFile(path.join(snapDir, `${date}.json`), JSON.stringify({ date, category: 'film', sources }));
    await write('2026-01-01', { 'tmdb-streaming': src('tmdb-streaming') }); // scaduto → file eliminato
    await write('2026-02-01', { 'tmdb-streaming': src('tmdb-streaming'), netflix: src('netflix') }); // resta solo netflix
    await write('2026-09-01', { 'tmdb-streaming': src('tmdb-streaming') }); // valido

    expect(await pruneSnapshots('film', '2026-10-11')).toBe(2);
    expect(await readdir(snapDir)).toEqual(['2026-02-01.json', '2026-09-01.json']);
    const snaps = await readSnapshots('film');
    expect(Object.keys(snaps[0]!.sources)).toEqual(['netflix']);
  });
});
