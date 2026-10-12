// Raccoglie le classifiche correnti da tutte le fonti e le salva in /data.
// Una fonte che fallisce non blocca le altre: l'errore finisce in data/status.json
// e il sito continua a mostrare l'ultimo snapshot valido.
//
//   npm run ingest            run giornaliera
//   npm run seed              prima run: recupera anche lo storico disponibile

import { pathToFileURL } from 'node:url';
import { CATEGORIES } from '../src/lib/sources';
import { CATEGORY_IDS, type CategoryId, type OfficialChart, type SourceStatus } from '../src/lib/types';
import { lookupItunesCovers } from './adapters/apple';
import { ADAPTERS } from './adapters/index';
import { hasTmdbKey, lookupCovers } from './adapters/tmdb';
import type { AdapterContext, SourceAdapter } from './adapters/types';
import { loadEnv } from './lib/env';
import { redact } from './lib/http';
import {
  pruneSnapshots,
  readOfficial,
  readStatus,
  saveOfficial,
  saveSourceSnapshot,
  saveStatus,
  todayInItaly,
} from './lib/store';

function envSatisfied(a: SourceAdapter): boolean {
  if (!a.requiredEnv) return true;
  return a.requiredEnv.some((group) => group.every((name) => Boolean(process.env[name])));
}

export async function ingest({ seed = false } = {}) {
  loadEnv();
  const today = todayInItaly();
  const log = (m: string) => console.log(m);
  const ctx: AdapterContext = { today, seed, log };
  const status = new Map((await readStatus()).map((s) => [`${s.category}|${s.source}`, s]));
  const now = new Date().toISOString();
  let failures = 0;

  const record = (category: CategoryId, source: string, ok: boolean, extra: Partial<SourceStatus> = {}) => {
    const prev = status.get(`${category}|${source}`);
    status.set(`${category}|${source}`, {
      source,
      category,
      ok,
      lastAttempt: now,
      lastSuccess: ok ? now : (prev?.lastSuccess ?? null),
      ...extra,
    });
  };

  console.log(`Ingestion ${today}${seed ? ' (seed)' : ''}`);
  for (const adapter of ADAPTERS) {
    if (!envSatisfied(adapter)) {
      const vars = adapter.requiredEnv!.map((g) => g.join('+')).join(' oppure ');
      console.log(`- ${adapter.id}: saltata (manca ${vars})`);
      continue;
    }

    for (const category of adapter.dailyCategories ?? []) {
      try {
        const entries = await adapter.fetchDaily!(category, ctx);
        await saveSourceSnapshot(category, today, { source: adapter.id, fetchedAt: new Date().toISOString(), entries });
        record(category, adapter.id, true, { entries: entries.length });
        console.log(`- ${adapter.id} [${category}]: ${entries.length} voci`);
      } catch (e) {
        failures++;
        const error = redact((e as Error).message);
        record(category, adapter.id, false, { error });
        console.warn(`! ${adapter.id} [${category}]: ${error}`);
      }
    }

    if (adapter.fetchOfficial) {
      try {
        const charts = await adapter.fetchOfficial(ctx);
        for (const c of charts) await saveOfficial(c);
        for (const category of new Set(charts.map((c) => c.category))) {
          record(category, adapter.id, true, { entries: charts.filter((c) => c.category === category).length });
        }
        console.log(`- ${adapter.id}: ${charts.length} classifiche ufficiali nuove`);
      } catch (e) {
        failures++;
        const error = redact((e as Error).message);
        for (const category of officialCategories(adapter.id)) record(category, adapter.id, false, { error });
        console.warn(`! ${adapter.id}: ${error}`);
      }
    }
  }

  // Copertine per le classifiche ufficiali che non le forniscono.
  try {
    if (hasTmdbKey()) {
      const recent = (cs: OfficialChart[]) => cs.slice(-8);
      const nf = [...recent(await readOfficial('film', 'week')), ...recent(await readOfficial('serie-tv', 'week'))];
      await lookupCovers(nf, log);
    }
    await lookupItunesCovers((await readOfficial('canzoni', 'year')).reverse(), log);
  } catch (e) {
    console.warn(`! copertine: ${(e as Error).message}`);
  }

  // Limiti di conservazione (TMDB: 180 giorni).
  for (const c of CATEGORY_IDS) {
    const n = await pruneSnapshots(c, today);
    if (n) console.log(`- ${c}: rimossi ${n} snapshot scaduti`);
  }

  await saveStatus([...status.values()]);
  console.log(failures ? `Completato con ${failures} errori (vedi data/status.json)` : 'Completato');
  return failures;
}

function officialCategories(source: string): CategoryId[] {
  return CATEGORY_IDS.filter((c) => Object.values(CATEGORIES[c].officialFor).some((o) => o.source === source));
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  ingest({ seed: process.argv.includes('--seed') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
