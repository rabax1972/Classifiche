// Lettura/scrittura dei file JSON in /data.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addDays } from '../../src/lib/aggregate';
import { SOURCES } from '../../src/lib/sources';
import type {
  CategoryId,
  DailySnapshot,
  OfficialChart,
  OfficialPeriodType,
  PeriodChart,
  PeriodId,
  SourceSnapshot,
  SourceStatus,
} from '../../src/lib/types';

export const DATA_DIR = path.resolve(process.env.CLASSIFICHE_DATA_DIR ?? 'data');

const p = {
  snapshots: (c: CategoryId) => path.join(DATA_DIR, 'snapshots', c),
  snapshot: (c: CategoryId, date: string) => path.join(DATA_DIR, 'snapshots', c, `${date}.json`),
  official: (c: CategoryId, t: OfficialPeriodType) => path.join(DATA_DIR, 'official', c, t),
  chart: (c: CategoryId, period: PeriodId) => path.join(DATA_DIR, 'charts', c, `${period}.json`),
  status: () => path.join(DATA_DIR, 'status.json'),
  cache: (name: string) => path.join(DATA_DIR, 'cache', `${name}.json`),
};

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`File JSON non valido: ${file}: ${(e as Error).message}`);
  }
}

export async function writeJson(file: string, data: unknown, pretty = false) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, pretty ? 2 : undefined) + '\n');
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Data odierna nel fuso orario italiano (YYYY-MM-DD). */
export function todayInItaly(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
}

// ---------------------------------------------------------------- snapshot

export async function saveSourceSnapshot(category: CategoryId, date: string, snap: SourceSnapshot) {
  const file = p.snapshot(category, date);
  const existing = (await readJson<DailySnapshot>(file)) ?? { date, category, sources: {} };
  existing.sources[snap.source] = snap;
  await writeJson(file, existing);
}

export async function readSnapshots(category: CategoryId): Promise<DailySnapshot[]> {
  const files = await listJson(p.snapshots(category));
  const out: DailySnapshot[] = [];
  for (const f of files) {
    const s = await readJson<DailySnapshot>(path.join(p.snapshots(category), f));
    if (s) out.push(s);
  }
  return out;
}

/**
 * Applica i limiti di conservazione delle fonti (es. TMDB: 180 giorni):
 * rimuove i dati scaduti e cancella gli snapshot rimasti vuoti.
 */
export async function pruneSnapshots(category: CategoryId, today: string): Promise<number> {
  let removed = 0;
  for (const f of await listJson(p.snapshots(category))) {
    const file = path.join(p.snapshots(category), f);
    const snap = await readJson<DailySnapshot>(file);
    if (!snap) continue;
    let changed = false;
    for (const source of Object.keys(snap.sources)) {
      const days = SOURCES[source]?.retentionDays;
      if (days && snap.date < addDays(today, -days)) {
        delete snap.sources[source];
        changed = true;
        removed++;
      }
    }
    if (!changed) continue;
    if (Object.keys(snap.sources).length === 0) await rm(file);
    else await writeJson(file, snap);
  }
  return removed;
}

// ---------------------------------------------------------------- ufficiali

export async function saveOfficial(chart: OfficialChart) {
  await writeJson(path.join(p.official(chart.category, chart.periodType), `${chart.periodKey}.json`), chart);
}

export async function officialExists(c: CategoryId, t: OfficialPeriodType, key: string) {
  return (await readJson(path.join(p.official(c, t), `${key}.json`))) !== null;
}

/** Classifiche ufficiali di un tipo, ordinate per periodo crescente. */
export async function readOfficial(c: CategoryId, t: OfficialPeriodType): Promise<OfficialChart[]> {
  const out: OfficialChart[] = [];
  for (const f of await listJson(p.official(c, t))) {
    const chart = await readJson<OfficialChart>(path.join(p.official(c, t), f));
    if (chart) out.push(chart);
  }
  return out.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

// ---------------------------------------------------------------- classifiche e stato

export async function saveChart(chart: PeriodChart) {
  await writeJson(p.chart(chart.category, chart.period), chart);
}

export async function readChart(c: CategoryId, period: PeriodId): Promise<PeriodChart | null> {
  return readJson<PeriodChart>(p.chart(c, period));
}

export async function readStatus(): Promise<SourceStatus[]> {
  return (await readJson<SourceStatus[]>(p.status())) ?? [];
}

export async function saveStatus(status: SourceStatus[]) {
  await writeJson(
    p.status(),
    [...status].sort((a, b) => a.category.localeCompare(b.category) || a.source.localeCompare(b.source)),
    true,
  );
}

// ---------------------------------------------------------------- cache metadati

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
}

/** Cache persistente (committata) per metadati come registi o copertine, con scadenza. */
export class MetaCache<T> {
  private data: Record<string, CacheEntry<T>> = {};
  private dirty = false;

  constructor(
    private name: string,
    private maxAgeDays: number,
  ) {}

  async load() {
    this.data = (await readJson<Record<string, CacheEntry<T>>>(p.cache(this.name))) ?? {};
    // Scarta le voci scadute (es. vincolo TMDB di 6 mesi).
    const limit = Date.now() - this.maxAgeDays * 86_400_000;
    for (const [k, v] of Object.entries(this.data)) {
      if (Date.parse(v.fetchedAt) < limit) {
        delete this.data[k];
        this.dirty = true;
      }
    }
    return this;
  }

  has(key: string) {
    return key in this.data;
  }

  get(key: string): T | undefined {
    return this.data[key]?.value;
  }

  set(key: string, value: T) {
    this.data[key] = { value, fetchedAt: new Date().toISOString() };
    this.dirty = true;
  }

  async save() {
    if (!this.dirty) return;
    const sorted = Object.fromEntries(Object.entries(this.data).sort(([a], [b]) => a.localeCompare(b)));
    await writeJson(p.cache(this.name), sorted, true);
    this.dirty = false;
  }
}
