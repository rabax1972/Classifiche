// Funzioni pure di aggregazione: nessun accesso a file o rete, così sono testabili.

import type { Change, ChartEntry, DailySnapshot, RankedEntry } from './types';

/** Punti Borda: 1° posto = 100, 2° = 99, … 100° = 1, oltre = 0. */
export const BORDA_MAX = 100;

export function bordaPoints(rank: number, max = BORDA_MAX): number {
  if (!Number.isFinite(rank) || rank < 1) return 0;
  return Math.max(0, max + 1 - Math.floor(rank));
}

// ---------------------------------------------------------------- date

const DAY_MS = 86_400_000;

function parseDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Data non valida: ${day}`);
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  return new Date(parseDay(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

export interface DateWindow {
  from: string;
  to: string;
  days: number;
}

/** Finestra mobile di `days` giorni che termina in `end` (inclusa). */
export function windowEndingAt(end: string, days: number): DateWindow {
  return { from: addDays(end, -(days - 1)), to: end, days };
}

/** Finestra immediatamente precedente, della stessa lunghezza. */
export function previousWindow(w: DateWindow): DateWindow {
  return windowEndingAt(addDays(w.from, -1), w.days);
}

// ---------------------------------------------------------------- identità

/** Normalizza titoli/artisti per riconoscere lo stesso elemento tra giorni e fonti diverse. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\((feat|ft|with)\.?[^)]*\)/g, '')
    .replace(/\s(feat|ft)\.?\s.*$/g, '')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Divide il sottotitolo di un brano nei singoli artisti, conservando i separatori:
 * "Shiva & Geolier" → ["Shiva", " & ", "Geolier"] (gli indici pari sono artisti).
 * Virgola, "&" e "feat." dividono sempre; " e " (frequente nelle classifiche FIMI) solo se `keepWhole`
 * non riconosce il nome intero come un unico artista (es. "Colapesce e Dimartino"). "x" non divide mai.
 */
export function splitArtists(subtitle: string, keepWhole: (name: string) => boolean = () => false): string[] {
  return subtitle
    .split(/(\s*,\s*|\s+&\s+|\s+(?:feat|ft)\.?\s+)/i)
    .flatMap((part, i) => (i % 2 === 0 && / e /i.test(part) && !keepWhole(part) ? part.split(/(\s+e\s+)/i) : [part]));
}

export const artistKey = (name: string) => normalizeText(name);

/** Sottotitolo dei film ("Joe Russo, Anthony Russo (2026)") diviso in registi e anno. */
export function movieSubtitle(subtitle: string | null): { directors: string | null; year: string | null } {
  const m = (subtitle ?? '').match(/^(.*?)\s*(?:\((\d{4})\))?$/);
  return { directors: m?.[1]?.trim() || null, year: m?.[2] ?? null };
}

export function entryKey(e: Pick<ChartEntry, 'title' | 'subtitle'>): string {
  // Del sottotitolo conta solo il primo nome (es. il primo artista).
  const firstSub = normalizeText((e.subtitle ?? '').split(/,| e | & | x /i)[0]);
  return `${normalizeText(e.title)}|${firstSub}`;
}

// ---------------------------------------------------------------- snapshot

export interface DailyList {
  date: string;
  source: string;
  entries: ChartEntry[];
}

/**
 * Sceglie la lista del giorno: la prima fonte in ordine di priorità che ha dati.
 * Restituisce null se lo snapshot non contiene nessuna fonte valida.
 */
export function pickDailyList(snapshot: DailySnapshot, priority: string[]): DailyList | null {
  for (const source of priority) {
    const s = snapshot.sources[source];
    if (s && s.entries.length > 0) return { date: snapshot.date, source, entries: s.entries };
  }
  return null;
}

export function toDailyLists(snapshots: DailySnapshot[], priority: string[]): DailyList[] {
  return snapshots
    .map((s) => pickDailyList(s, priority))
    .filter((d): d is DailyList => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- Borda

export interface BordaResult {
  entries: RankedEntry[];
  /** Giorni della finestra per cui esiste una lista. */
  daysWithData: number;
  sources: string[];
}

/**
 * Somma i punti Borda di ogni elemento su tutti i giorni della finestra.
 * Ordine: punti totali ↓, posizione migliore ↑, giorni in classifica ↓, titolo.
 * I giorni senza dati vengono semplicemente saltati (nessuna penalità né interpolazione).
 */
export function aggregateBorda(lists: DailyList[], window: DateWindow, limit = 50): BordaResult {
  const inWindow = lists.filter((l) => l.date >= window.from && l.date <= window.to);

  interface Acc {
    latest: ChartEntry;
    latestDate: string;
    points: number;
    days: Set<string>;
    bestRank: number;
  }
  const acc = new Map<string, Acc>();

  for (const list of inWindow) {
    const seenToday = new Set<string>();
    for (const e of list.entries) {
      const key = entryKey(e);
      // Se una fonte elenca due volte lo stesso elemento nello stesso giorno, conta solo la posizione migliore.
      if (seenToday.has(key)) continue;
      seenToday.add(key);

      const a = acc.get(key);
      const pts = bordaPoints(e.rank);
      if (!a) {
        acc.set(key, { latest: e, latestDate: list.date, points: pts, days: new Set([list.date]), bestRank: e.rank });
        continue;
      }
      a.points += pts;
      a.days.add(list.date);
      a.bestRank = Math.min(a.bestRank, e.rank);
      if (list.date >= a.latestDate) {
        a.latest = e;
        a.latestDate = list.date;
      }
    }
  }

  const ranked = [...acc.entries()]
    .map(([key, a]) => ({ key, a }))
    .sort(
      (x, y) =>
        y.a.points - x.a.points ||
        x.a.bestRank - y.a.bestRank ||
        y.a.days.size - x.a.days.size ||
        x.a.latest.title.localeCompare(y.a.latest.title, 'it'),
    )
    .slice(0, limit)
    .map(
      ({ key, a }, i): RankedEntry => ({
        ...a.latest,
        rank: i + 1,
        key,
        change: null,
        points: a.points,
        daysInChart: a.days.size,
        bestRank: a.bestRank,
      }),
    );

  return {
    entries: ranked,
    daysWithData: new Set(inWindow.map((l) => l.date)).size,
    sources: [...new Set(inWindow.map((l) => l.source))],
  };
}

// ---------------------------------------------------------------- variazioni

export function computeChange(currentRank: number, previousRank: number | undefined): Change {
  if (previousRank === undefined) return { kind: 'new' };
  if (previousRank === currentRank) return { kind: 'same' };
  return previousRank > currentRank
    ? { kind: 'up', by: previousRank - currentRank }
    : { kind: 'down', by: currentRank - previousRank };
}

/**
 * Aggiunge la variazione rispetto alla classifica precedente.
 * Se la classifica precedente non esiste affatto (es. primo giorno), change resta null:
 * non ha senso marcare tutto come "nuovo".
 */
export function withChanges(
  current: RankedEntry[],
  previous: Pick<RankedEntry, 'key' | 'rank'>[] | null,
): RankedEntry[] {
  if (!previous || previous.length === 0) return current.map((e) => ({ ...e, change: null }));
  const prevRank = new Map(previous.map((p) => [p.key, p.rank]));
  return current.map((e) => ({ ...e, change: computeChange(e.rank, prevRank.get(e.key)) }));
}

/** Converte una lista grezza (già ordinata dalla fonte) in RankedEntry. */
export function rankList(entries: ChartEntry[], limit = 50): RankedEntry[] {
  const seen = new Set<string>();
  const out: RankedEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.rank - b.rank)) {
    const key = entryKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, key, change: null });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- classifica "Oggi"

export interface TodayResult {
  date: string;
  source: string;
  entries: RankedEntry[];
  previousDate: string | null;
}

/** Oggi = ultimo snapshot disponibile, confrontato con lo snapshot precedente. */
export function todayChart(lists: DailyList[], limit = 50): TodayResult | null {
  if (lists.length === 0) return null;
  const sorted = [...lists].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  const prev = sorted.length > 1 ? sorted[sorted.length - 2]! : null;
  const current = rankList(last.entries, limit);
  const previous = prev ? rankList(prev.entries, Number.MAX_SAFE_INTEGER) : null;
  return {
    date: last.date,
    source: last.source,
    entries: withChanges(current, previous),
    previousDate: prev?.date ?? null,
  };
}

/** Classifica calcolata per una finestra, con variazioni rispetto alla finestra precedente. */
export function periodChart(lists: DailyList[], window: DateWindow, limit = 50) {
  const current = aggregateBorda(lists, window, limit);
  const prevResult = aggregateBorda(lists, previousWindow(window), Number.MAX_SAFE_INTEGER);
  return {
    ...current,
    entries: withChanges(current.entries, prevResult.daysWithData > 0 ? prevResult.entries : null),
  };
}
