// Netflix Top 10 — https://www.netflix.com/tudum/top10
// File TSV pubblicato da Netflix per il download (classifiche settimanali per paese, settimana lun–dom).
// Pesa ~30 MB: lo scarichiamo solo quando manca la settimana più recente attesa.

import { addDays } from '../../src/lib/aggregate';
import type { CategoryId, ChartEntry, OfficialChart } from '../../src/lib/types';
import { fetchText } from '../lib/http';
import { officialExists } from '../lib/store';
import type { SourceAdapter } from './types';

const TSV_URL = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';
const COUNTRY = 'IT';

const CATEGORY_MAP: Record<string, CategoryId> = { Films: 'film', TV: 'serie-tv' };

export interface NetflixRow {
  week: string;
  category: CategoryId;
  rank: number;
  title: string;
  season: string | null;
}

export function parseNetflixTsv(tsv: string, country = COUNTRY): NetflixRow[] {
  const lines = tsv.split(/\r?\n/);
  const header = lines[0]?.split('\t') ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Colonna "${name}" assente nel TSV Netflix: formato cambiato?`);
    return i;
  };
  const c = {
    iso: col('country_iso2'),
    week: col('week'),
    category: col('category'),
    rank: col('weekly_rank'),
    title: col('show_title'),
    season: col('season_title'),
  };
  const rows: NetflixRow[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    if (f[c.iso] !== country) continue;
    const category = CATEGORY_MAP[f[c.category] ?? ''];
    if (!category) continue;
    const season = f[c.season];
    rows.push({
      week: f[c.week]!,
      category,
      rank: Number(f[c.rank]),
      title: f[c.title]!,
      season: season && season !== 'N/A' ? season : null,
    });
  }
  return rows;
}

/** "Physical 100: Italy: Season 1" → "Stagione 1" */
export function seasonLabel(title: string, season: string | null): string | null {
  if (!season) return null;
  const rest = season.startsWith(`${title}: `) ? season.slice(title.length + 2) : season;
  return rest
    .replace(/^Season (\d+)/i, 'Stagione $1')
    .replace(/^Limited Series$/i, 'Miniserie')
    .replace(/^Part (\d+)/i, 'Parte $1');
}

export function toOfficialCharts(rows: NetflixRow[], fetchedAt: string): OfficialChart[] {
  const groups = new Map<string, NetflixRow[]>();
  for (const r of rows) {
    const k = `${r.category}|${r.week}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()].map(([k, rs]) => {
    const [category, week] = k.split('|') as [CategoryId, string];
    const path = category === 'serie-tv' ? '/tv' : '';
    const url = `https://www.netflix.com/tudum/top10/italy${path}?week=${week}`;
    const entries: ChartEntry[] = rs
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({
        rank: r.rank,
        title: r.title,
        // Solo dati stabili nel sottotitolo: serve a riconoscere il titolo da una settimana all'altra.
        subtitle: seasonLabel(r.title, r.season),
        cover: null,
        source: 'netflix',
        sourceUrl: url,
        externalId: null,
      }));
    return {
      category,
      source: 'netflix',
      periodType: 'week' as const,
      periodKey: week,
      periodLabel: `Settimana ${formatDay(addDays(week, -6))} – ${formatDay(week)}`,
      url,
      fetchedAt,
      entries,
    };
  });
}

function formatDay(day: string) {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/** Ultima domenica i cui dati dovrebbero essere già pubblicati (Netflix aggiorna il martedì). */
export function expectedLatestWeek(today: string): string {
  const published = addDays(today, -2);
  const dow = new Date(`${published}T00:00:00Z`).getUTCDay(); // 0 = domenica
  return addDays(published, -dow);
}

export const netflix: SourceAdapter = {
  id: 'netflix',
  async fetchOfficial(ctx) {
    const expected = expectedLatestWeek(ctx.today);
    if (!ctx.seed && (await officialExists('film', 'week', expected)) && (await officialExists('serie-tv', 'week', expected))) {
      ctx.log(`  settimana ${expected} già presente, download saltato`);
      return [];
    }
    // Cache di 20 ore: più run nello stesso giorno non riscaricano il file.
    const tsv = await fetchText(TSV_URL, { cacheTtlMs: 20 * 3600_000, timeoutMs: 120_000 });
    const rows = parseNetflixTsv(tsv);
    if (rows.length === 0) throw new Error('Nessuna riga per l\'Italia nel TSV Netflix');
    // Seed: due anni di storico; run giornaliere: le ultime 8 settimane.
    const since = addDays(ctx.today, ctx.seed ? -730 : -56);
    const charts = toOfficialCharts(rows.filter((r) => r.week >= since), new Date().toISOString());
    const fresh: OfficialChart[] = [];
    for (const c of charts) {
      if (ctx.seed || !(await officialExists(c.category, 'week', c.periodKey))) fresh.push(c);
    }
    return fresh;
  },
};
