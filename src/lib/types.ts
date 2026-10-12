// Schema dati condiviso tra script di ingestion, aggregazione e UI.

export const CATEGORY_IDS = ['canzoni', 'libri', 'cinema', 'film', 'serie-tv'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const PERIOD_IDS = ['oggi', 'settimana', 'mese', 'anno'] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];

/** Una riga di classifica, nel formato comune a tutte le fonti. */
export interface ChartEntry {
  rank: number;
  title: string;
  /** Artista, autore, regista… */
  subtitle: string | null;
  cover: string | null;
  source: string;
  sourceUrl: string | null;
  externalId: string | null;
}

/** Classifica raccolta da una singola fonte in un giorno. */
export interface SourceSnapshot {
  source: string;
  fetchedAt: string;
  entries: ChartEntry[];
}

/** File data/snapshots/{categoria}/{YYYY-MM-DD}.json */
export interface DailySnapshot {
  date: string;
  category: CategoryId;
  sources: Record<string, SourceSnapshot>;
}

export type OfficialPeriodType = 'week' | 'month' | 'year';

/** File data/official/{categoria}/{week|month|year}/{chiave}.json */
export interface OfficialChart {
  category: CategoryId;
  source: string;
  periodType: OfficialPeriodType;
  /** Settimana: data di fine (YYYY-MM-DD); anno: YYYY. */
  periodKey: string;
  periodLabel: string;
  url: string | null;
  fetchedAt: string;
  entries: ChartEntry[];
}

export type Change =
  | { kind: 'new' }
  | { kind: 'same' }
  | { kind: 'up'; by: number }
  | { kind: 'down'; by: number };

export interface RankedEntry extends ChartEntry {
  key: string;
  change: Change | null;
  /** Solo per classifiche calcolate da snapshot. */
  points?: number;
  daysInChart?: number;
  bestRank?: number;
}

/** official = classifica ufficiale della fonte; daily = ultimo snapshot; computed = Borda sugli snapshot. */
export type ViewKind = 'official' | 'daily' | 'computed';

export interface ChartView {
  kind: ViewKind;
  label: string;
  sources: string[];
  periodLabel: string;
  from: string;
  to: string;
  /** Giorni con dati / giorni del periodo (solo calcolate). */
  coverage?: { days: number; expected: number };
  note?: string;
  entries: RankedEntry[];
}

/** File data/charts/{categoria}/{periodo}.json, letto dalla UI. */
export interface PeriodChart {
  category: CategoryId;
  period: PeriodId;
  generatedAt: string;
  /** Data dell'ultimo snapshot valido della categoria. */
  lastSnapshot: string | null;
  /** true se l'ultimo snapshot non è di oggi (fonte non raggiungibile). */
  stale: boolean;
  views: ChartView[];
}

/** File data/status.json: esito dell'ultima ingestion per fonte. */
export interface SourceStatus {
  source: string;
  category: CategoryId;
  ok: boolean;
  lastAttempt: string;
  lastSuccess: string | null;
  error?: string;
  entries?: number;
}
