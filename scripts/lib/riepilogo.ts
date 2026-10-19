// Riepilogo di un aggiornamento per il riquadro dell'amministratore in /account/: nuove entrate nelle classifiche rispetto a prima
// dell'aggiornamento, fonti non raggiunte, file pubblicati. Lo costruisce scripts/pubblica-aruba.ts.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { CATEGORIES, PERIODS, sourceName } from '../../src/lib/sources';
import { CATEGORY_IDS, PERIOD_IDS, type PeriodChart, type SourceStatus, type UpdateChartChange, type UpdateSummary } from '../../src/lib/types';

/** Titoli mostrati per ogni classifica: gli altri si contano soltanto. */
const MAX_TITLES = 10;

/** Nuove entrate e uscite di ogni vista (abbinate per etichetta) tra due versioni della stessa classifica. Funzione pura. */
export function chartChanges(before: PeriodChart | null, after: PeriodChart): UpdateChartChange[] {
  const out: UpdateChartChange[] = [];
  for (const view of after.views) {
    const old = before?.views.find((v) => v.label === view.label);
    const oldKeys = new Set(old?.entries.map((e) => e.key) ?? []);
    const newKeys = new Set(view.entries.map((e) => e.key));
    const added = view.entries.filter((e) => !oldKeys.has(e.key));
    const removed = old?.entries.filter((e) => !newKeys.has(e.key)).length ?? 0;
    if (!added.length && !removed) continue;
    out.push({
      categoria: CATEGORIES[after.category].label,
      periodo: PERIODS[after.period].label,
      vista: view.label,
      nuovi: added.slice(0, MAX_TITLES).map((e) => (e.subtitle ? `${e.title} — ${e.subtitle}` : e.title)),
      altri: Math.max(0, added.length - MAX_TITLES),
      usciti: removed,
    });
  }
  return out;
}

/** Classifica com'era nel commit indicato (null se allora non c'era o il commit non è disponibile). */
function chartAt(commit: string, file: string): PeriodChart | null {
  try {
    return JSON.parse(execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }));
  } catch {
    return null;
  }
}

/**
 * Riepilogo dell'aggiornamento. $before: commit di prima dell'aggiornamento dei dati (variabile PRIMA del workflow);
 * senza, le classifiche non si confrontano.
 */
export function buildSummary(before: string | undefined, published: string[]): UpdateSummary {
  let classifiche: UpdateChartChange[] | null = null;
  if (before) {
    classifiche = [];
    for (const category of CATEGORY_IDS) {
      for (const period of PERIOD_IDS) {
        const file = `data/charts/${category}/${period}.json`;
        if (!existsSync(file)) continue;
        classifiche.push(...chartChanges(chartAt(before, file), JSON.parse(readFileSync(file, 'utf8')) as PeriodChart));
      }
    }
  }
  const status: SourceStatus[] = existsSync('data/status.json') ? JSON.parse(readFileSync('data/status.json', 'utf8')) : [];
  const episodi = published.filter((f) => f.startsWith('serie-tv/episodi/')).length;
  const pagine = published.filter((f) => f.endsWith('.html')).length;
  return {
    quando: new Date().toISOString(),
    fonti: {
      totali: status.length,
      errori: status
        .filter((s) => !s.ok)
        .map((s) => ({ fonte: sourceName(s.source), categoria: CATEGORIES[s.category]?.label ?? s.category, errore: (s.error ?? '').slice(0, 200) })),
    },
    classifiche,
    file: { pagine, episodi, altri: published.length - pagine - episodi },
  };
}
