// Schede dei podcast per la modale della classifica Podcast: genere, numero di episodi, copertina e link al feed dall'API di
// ricerca di iTunes (Apple Podcasts), poi descrizione e ultimi episodi dal feed RSS pubblico del podcast (fatto apposta per essere
// letto dalle app di podcast). Le schede scadono dopo una settimana, così gli ultimi episodi restano recenti.
//
//   npm run info:podcast               completa le schede mancanti o scadute dei podcast in classifica (con un budget per run)
//   npm run info:podcast -- --all      senza budget

import { pathToFileURL } from 'node:url';
import { podcastKey } from '../src/lib/aggregate';
import { PERIOD_IDS, type PodcastEpisode, type PodcastInfo } from '../src/lib/types';
import { biggerArtwork } from './adapters/apple';
import { fetchJson, fetchText } from './lib/http';
import { overlap } from './lib/match';
import { MetaCache, readChart } from './lib/store';

export const PODCAST_INFO_CACHE = 'podcast-info';
const MAX_AGE_DAYS = 7;
const LATEST = 5;
const MAX_DESCRIPTION = 1200;

interface ItunesPodcast {
  collectionId?: number;
  collectionName?: string;
  collectionViewUrl?: string;
  feedUrl?: string;
  genres?: string[];
  trackCount?: number;
  artworkUrl600?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** Testo semplice da un campo del feed: CDATA, HTML (anche con le entità) e spazi. */
export function feedText(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const html = cdata ? cdata[1]! : decodeEntities(raw);
  return decodeEntities(
    html
      .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

/** Contenuto del primo elemento `name` (es. "title", "itunes:duration"). */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1]! : null;
}

/** "1:02:03", "45:10" o secondi → secondi. */
export function durationSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  const s = parts.reduce((acc, n) => acc * 60 + n, 0);
  return s > 0 ? Math.round(s) : null;
}

/** Taglia un testo lungo alla fine di una frase. */
function trimText(text: string, max = MAX_DESCRIPTION): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

/** Descrizione, sito e ultimi episodi dal feed RSS. */
export function parseFeed(xml: string): Pick<PodcastInfo, 'description' | 'website' | 'latest'> {
  const [channel = '', ...rawItems] = xml.split(/<item[\s>]/i);
  const description = tag(channel, 'description') ?? tag(channel, 'itunes:summary');
  const website = tag(channel.replace(/<image[\s>][\s\S]*?<\/image>/i, ''), 'link');
  const latest: PodcastEpisode[] = rawItems
    .map((item) => {
      const date = Date.parse(feedText(tag(item, 'pubDate') ?? ''));
      const link = feedText(tag(item, 'link') ?? '');
      return {
        title: feedText(tag(item, 'title') ?? ''),
        date: Number.isNaN(date) ? null : new Date(date).toISOString().slice(0, 10),
        seconds: durationSeconds(feedText(tag(item, 'itunes:duration') ?? '')),
        url: /^https?:\/\//.test(link) ? link : null,
      };
    })
    .filter((e) => e.title)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, LATEST);
  const text = description ? feedText(description) : '';
  const site = website ? feedText(website) : '';
  return { description: text ? trimText(text) : null, website: /^https?:\/\//.test(site) ? site : null, latest };
}

async function itunesPodcast(title: string, appleId: string | null): Promise<ItunesPodcast | null> {
  if (appleId) {
    const { results } = await fetchJson<{ results: ItunesPodcast[] }>(`https://itunes.apple.com/lookup?id=${appleId}&country=it`, { retries: 1 });
    if (results[0]) return results[0];
  }
  const { results } = await fetchJson<{ results: ItunesPodcast[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&country=it&media=podcast&entity=podcast&limit=5`,
    { retries: 1 },
  );
  return results.find((r) => overlap(title, r.collectionName ?? '') >= 0.8 && overlap(r.collectionName ?? '', title) >= 0.5) ?? null;
}

/** Podcast delle classifiche (oggi per primi), con l'ID Apple quando compaiono nella scheda Apple Podcasts. */
async function podcastTargets() {
  const targets = new Map<string, { title: string; appleId: string | null }>();
  for (const period of PERIOD_IDS)
    for (const view of (await readChart('podcast', period))?.views ?? [])
      for (const e of view.entries) {
        const key = podcastKey(e.title);
        const appleId = e.externalId?.match(/^apple:(\d+)$/)?.[1] ?? null;
        const known = targets.get(key);
        if (!known) targets.set(key, { title: e.title, appleId });
        else known.appleId ??= appleId;
      }
  return targets;
}

export async function lookupPodcastInfo({ budget = 30, log = console.log } = {}) {
  const cache = await new MetaCache<PodcastInfo>(PODCAST_INFO_CACHE, MAX_AGE_DAYS).load();
  const targets = await podcastTargets();
  let done = 0;
  let missing = 0;
  for (const [key, { title, appleId }] of targets) {
    if (cache.has(key)) continue;
    if (done >= budget) {
      missing++;
      continue;
    }
    done++;
    try {
      const it = await itunesPodcast(title, appleId);
      let feed: Pick<PodcastInfo, 'description' | 'website' | 'latest'> = { description: null, website: null, latest: [] };
      if (it?.feedUrl) {
        try {
          feed = parseFeed(await fetchText(it.feedUrl, { retries: 1, timeoutMs: 60_000 }));
        } catch (err) {
          log(`  feed non letto per "${title}": ${(err as Error).message}`);
        }
      }
      cache.set(key, {
        appleUrl: it?.collectionViewUrl?.replace(/\?.*$/, '') ?? null,
        genres: (it?.genres ?? []).filter((g) => g !== 'Podcasts' && g !== 'Podcast'),
        episodes: it?.trackCount ?? null,
        cover: biggerArtwork(it?.artworkUrl600, 600),
        feedUrl: it?.feedUrl ?? null,
        ...feed,
      });
    } catch (err) {
      log(`  scheda non trovata per "${title}": ${(err as Error).message}`);
      break; // probabilmente rate limit di iTunes: riprova alla prossima run
    }
  }
  await cache.save();
  log(`Schede podcast: ${done} nuove${missing ? `, ${missing} ancora da completare` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  lookupPodcastInfo({ budget: process.argv.includes('--all') ? Infinity : 30 }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
