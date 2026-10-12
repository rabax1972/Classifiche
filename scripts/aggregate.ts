// Genera data/charts/{categoria}/{periodo}.json dagli snapshot e dalle classifiche ufficiali.

import { pathToFileURL } from 'node:url';
import { entryKey, toDailyLists } from '../src/lib/aggregate';
import { buildPeriodChart, type CoverResolver } from '../src/lib/build';
import { CATEGORIES } from '../src/lib/sources';
import { CATEGORY_IDS, PERIOD_IDS, type OfficialChart } from '../src/lib/types';
import { ITUNES_COVER_CACHE, type ItunesCover } from './adapters/apple';
import { COVER_CACHE, coverKey, mediaFor, type CoverLookup } from './adapters/tmdb';
import { MetaCache, readOfficial, readSnapshots, saveChart, todayInItaly } from './lib/store';

export async function buildCharts() {
  const today = todayInItaly();
  const generatedAt = new Date().toISOString();
  const tmdbCovers = await new MetaCache<CoverLookup>(COVER_CACHE, 150).load();
  const itunesCovers = await new MetaCache<ItunesCover>(ITUNES_COVER_CACHE, 365).load();

  const resolveCover: CoverResolver = (entry, chart) => {
    if (chart.source === 'netflix') return tmdbCovers.get(coverKey(mediaFor(chart.category), entry.title));
    if (chart.source === 'wikipedia-fimi') return itunesCovers.get(entryKey(entry));
    return undefined;
  };

  console.log(`Aggregazione ${today}`);
  for (const category of CATEGORY_IDS) {
    const cfg = CATEGORIES[category];
    const lists = toDailyLists(await readSnapshots(category), cfg.snapshotSources);
    for (const period of PERIOD_IDS) {
      const o = cfg.officialFor[period];
      const official: OfficialChart[] = o
        ? (await readOfficial(category, o.periodType)).filter((c) => c.source === o.source)
        : [];
      const chart = buildPeriodChart({ category, period, lists, official, resolveCover, today, generatedAt });
      await saveChart(chart);
      const summary = chart.views.map((v) => `${v.label}: ${v.entries.length}`).join(', ') || 'vuota';
      console.log(`- ${category}/${period}: ${summary}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  buildCharts().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
