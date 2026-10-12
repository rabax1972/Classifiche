// Costruzione delle classifiche per periodo (funzioni pure, usate da scripts/aggregate.ts).

import {
  periodChart,
  rankList,
  todayChart,
  windowEndingAt,
  withChanges,
  type DailyList,
} from './aggregate';
import { CATEGORIES, PERIODS, SOURCES } from './sources';
import type { CategoryId, ChartView, OfficialChart, PeriodChart, PeriodId, RankedEntry } from './types';

export const CHART_LIMIT = 50;

export interface CoverInfo {
  cover: string | null;
  url: string | null;
}

/** Completa le copertine mancanti (es. Netflix, FIMI) usando una cache esterna. */
export type CoverResolver = (entry: RankedEntry, chart: OfficialChart) => CoverInfo | undefined;

export function officialView(charts: OfficialChart[], resolveCover?: CoverResolver): ChartView | null {
  const latest = charts.at(-1);
  if (!latest) return null;
  const previous = charts.at(-2);
  let entries = withChanges(rankList(latest.entries, CHART_LIMIT), previous ? rankList(previous.entries, 1000) : null);
  if (resolveCover) {
    entries = entries.map((e) => (e.cover ? e : { ...e, cover: resolveCover(e, latest)?.cover ?? null }));
  }
  return {
    kind: 'official',
    label: 'Ufficiale',
    sources: [latest.source],
    periodLabel: latest.periodLabel,
    from: latest.periodKey,
    to: latest.periodKey,
    entries,
  };
}

/**
 * Giorni massimi utilizzabili per una categoria, in base ai limiti di conservazione delle sue fonti.
 * Es. TMDB: 180 giorni, quindi l'"Anno" calcolato copre gli ultimi 180 giorni.
 */
export function maxWindowDays(category: CategoryId): number {
  const limits = CATEGORIES[category].snapshotSources
    .map((s) => SOURCES[s]?.retentionDays)
    .filter((d): d is number => typeof d === 'number');
  return limits.length ? Math.min(...limits) : Infinity;
}

export function snapshotView(category: CategoryId, period: PeriodId, lists: DailyList[]): ChartView | null {
  if (lists.length === 0) return null;

  if (period === 'oggi') {
    const t = todayChart(lists, CHART_LIMIT)!;
    return {
      kind: 'daily',
      label: 'Classifica del giorno',
      sources: [t.source],
      periodLabel: 'Oggi',
      from: t.date,
      to: t.date,
      note: t.previousDate ? `Variazioni rispetto al ${t.previousDate}` : undefined,
      entries: t.entries,
    };
  }

  const wanted = PERIODS[period].days;
  const days = Math.min(wanted, maxWindowDays(category));
  const end = lists.at(-1)!.date;
  const window = windowEndingAt(end, days);
  const r = periodChart(lists, window, CHART_LIMIT);
  if (r.entries.length === 0) return null;
  const notes: string[] = [];
  if (days < wanted) notes.push(`I termini d'uso di TMDB consentono di conservare i dati per ${days} giorni: il periodo è limitato di conseguenza.`);
  if (r.daysWithData < days) notes.push(`Calcolata su ${r.daysWithData} ${r.daysWithData === 1 ? 'giorno' : 'giorni'} di dati disponibili su ${days}.`);
  return {
    kind: 'computed',
    label: 'Calcolata da snapshot',
    sources: r.sources,
    periodLabel: days < wanted ? `Ultimi ${days} giorni` : PERIODS[period].computedLabel,
    from: window.from,
    to: window.to,
    coverage: { days: r.daysWithData, expected: days },
    note: notes.join(' ') || undefined,
    entries: r.entries,
  };
}

export interface BuildInput {
  category: CategoryId;
  period: PeriodId;
  lists: DailyList[];
  /** Classifiche ufficiali applicabili al periodo, in ordine cronologico. */
  official: OfficialChart[];
  resolveCover?: CoverResolver;
  today: string;
  generatedAt: string;
}

export function buildPeriodChart(input: BuildInput): PeriodChart {
  const { category, period, lists, official, resolveCover, today, generatedAt } = input;
  const views: ChartView[] = [];
  const o = officialView(official, resolveCover);
  if (o) views.push(o);
  const s = snapshotView(category, period, lists);
  if (s) views.push(s);
  const lastSnapshot = lists.at(-1)?.date ?? null;
  return {
    category,
    period,
    generatedAt,
    lastSnapshot,
    stale: lastSnapshot !== null && lastSnapshot < today,
    views,
  };
}
